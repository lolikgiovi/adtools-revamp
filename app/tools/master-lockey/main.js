/**
 * Master Lockey Tool
 * Tool for viewing and searching localization keys from configured domains
 */

import { BaseTool } from '../../core/BaseTool.js';
import { MasterLockeyTemplate } from './template.js';
import { MasterLockeyService } from './service.js';
import { IndexedDBService } from './indexeddb-service.js';
import { getIconSvg } from './icon.js';
import { UsageTracker } from '../../core/UsageTracker.js';
import './styles.css';

class MasterLockey extends BaseTool {
  constructor(eventBus) {
    super({
      id: 'master-lockey',
      name: 'Master Lockey',
      description: 'View and search localization keys from configured domains',
      icon: 'language',
      category: 'application',
      eventBus,
    });

    this.service = new MasterLockeyService();
    this.dbService = new IndexedDBService();
    this.currentDomain = null;
    this.currentDomainUrl = null;
    this.parsedData = null; // { languagePackId, languages, rows }
    this.filteredRows = null;
    
    // Virtual scrolling state for performance with large datasets
    this.virtualScroll = {
      rowHeight: 42, // Estimated row height in pixels
      visibleRows: 50, // Number of rows to render at once
      scrollTop: 0,
      startIndex: 0,
      endIndex: 50,
    };
    
    // Debounce timer for search
    this.searchDebounceTimer = null;
    
    // Initialize IndexedDB
    this.dbService.init().catch(err => {
      console.error('Failed to initialize IndexedDB:', err);
    });
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return MasterLockeyTemplate;
  }

  onMount() {
    this.bindElements();
    this.loadDomainConfig();
    this.setupEventListeners();
    
    // Try to load cached data for the first selected domain
    this.tryLoadCache();
  }

  bindElements() {
    this.els = {
      domainSelector: this.container.querySelector('#domain-selector'),
      btnFetch: this.container.querySelector('#btn-fetch-data'),
      cacheInfo: this.container.querySelector('#cache-info'),
      cacheTimestamp: this.container.querySelector('#cache-timestamp'),
      lockeyInfo: this.container.querySelector('#lockey-info'),
      infoDomainName: this.container.querySelector('#info-domain-name'),
      infoVersion: this.container.querySelector('#info-version'),
      searchSection: this.container.querySelector('#search-section'),
      searchMode: this.container.querySelector('#search-mode'),
      searchInput: this.container.querySelector('#search-input'),
      btnClearSearch: this.container.querySelector('#btn-clear-search'),
      searchHint: this.container.querySelector('#search-hint'),
      resultsCount: this.container.querySelector('#results-count'),
      resultsText: this.container.querySelector('#results-text'),
      emptyState: this.container.querySelector('#empty-state'),
      loadingState: this.container.querySelector('#loading-state'),
      errorState: this.container.querySelector('#error-state'),
      errorTitle: this.container.querySelector('#error-title'),
      errorMessage: this.container.querySelector('#error-message'),
      btnRetry: this.container.querySelector('#btn-retry'),
      tableContainer: this.container.querySelector('#table-container'),
      tableHead: this.container.querySelector('#table-head'),
      tableBody: this.container.querySelector('#table-body'),
    };
  }

  loadDomainConfig() {
    try {
      const configJson = localStorage.getItem('config.lockeyDomains');
      const domains = configJson ? JSON.parse(configJson) : [];
      
      // Clear existing options (except the first placeholder)
      this.els.domainSelector.innerHTML = '<option value="">Select a domain...</option>';
      
      if (domains.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No domains configured (go to Settings)';
        option.disabled = true;
        this.els.domainSelector.appendChild(option);
        return;
      }
      
      domains.forEach(({ key, value }) => {
        const option = document.createElement('option');
        option.value = JSON.stringify({ key, value });
        option.textContent = key;
        this.els.domainSelector.appendChild(option);
      });
    } catch (error) {
      console.error('Failed to load domain config:', error);
    }
  }

  setupEventListeners() {
    // Domain selector change
    this.els.domainSelector.addEventListener('change', () => {
      const selected = this.els.domainSelector.value;
      if (selected) {
        const { key, value } = JSON.parse(selected);
        this.currentDomain = key;
        this.currentDomainUrl = value;
        this.els.btnFetch.disabled = false;
        
        // Try to load cached data for this domain
        this.tryLoadCache();
      } else {
        this.currentDomain = null;
        this.currentDomainUrl = null;
        this.els.btnFetch.disabled = true;
        this.hideCache();
      }
    });

    // Fetch button click
    this.els.btnFetch.addEventListener('click', () => {
      this.fetchData();
    });

    // Search mode change
    this.els.searchMode.addEventListener('change', () => {
      this.updateSearchHint();
      this.applyFilterDebounced();
    });

    // Search input with debouncing (300ms delay)
    this.els.searchInput.addEventListener('input', () => {
      this.applyFilterDebounced();
    });

    // Clear search
    this.els.btnClearSearch.addEventListener('click', () => {
      this.els.searchInput.value = '';
      this.applyFilter();
    });

    // Retry button
    this.els.btnRetry.addEventListener('click', () => {
      this.fetchData();
    });
    
    // Virtual scroll handler
    this.els.tableContainer.addEventListener('scroll', () => {
      this.handleTableScroll();
    });
  }

  applyFilterDebounced() {
    // Clear existing timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    
    // Set new timer (300ms delay)
    this.searchDebounceTimer = setTimeout(() => {
      this.applyFilter();
    }, 300);
  }

  handleTableScroll() {
    if (!this.filteredRows || this.filteredRows.length === 0) return;
    
    const scrollTop = this.els.tableContainer.scrollTop;
    const startIndex = Math.floor(scrollTop / this.virtualScroll.rowHeight);
    const endIndex = Math.min(
      startIndex + this.virtualScroll.visibleRows,
      this.filteredRows.length
    );
    
    // Only re-render if the visible range changed significantly
    if (
      Math.abs(startIndex - this.virtualScroll.startIndex) > 10 ||
      Math.abs(endIndex - this.virtualScroll.endIndex) > 10
    ) {
      this.virtualScroll.startIndex = startIndex;
      this.virtualScroll.endIndex = endIndex;
      this.renderTableBody(this.filteredRows, this.parsedData.languages);
    }
  }

  updateSearchHint() {
    const mode = this.els.searchMode.value;
    if (mode === 'key') {
      this.els.searchHint.textContent = 'Tip: For key search, use comma-separated values (e.g., key1, key2)';
    } else {
      this.els.searchHint.textContent = 'Tip: Search will match text in any language column';
    }
  }

  async tryLoadCache() {
    if (!this.currentDomain) return;
    
    try {
      const cached = await this.dbService.getLockeyData(this.currentDomain);
      if (cached && cached.data) {
        this.parsedData = cached.data;
        this.displayData();
        this.showCache(cached.timestamp);
        
        UsageTracker.trackEvent('master_lockey', 'load_from_cache', { domain: this.currentDomain });
      } else {
        this.hideCache();
      }
    } catch (error) {
      console.error('Failed to load cache:', error);
      this.hideCache();
    }
  }

  async fetchData() {
    if (!this.currentDomainUrl) return;
    
    this.showLoading();
    this.hideError();
    this.hideCache();
    
    try {
      UsageTracker.trackEvent('master_lockey', 'fetch_data', { domain: this.currentDomain });
      
      const rawData = await this.service.fetchLockeyData(this.currentDomainUrl);
      this.parsedData = this.service.parseLockeyData(rawData);
      
      // Cache the parsed data
      await this.dbService.saveLockeyData(this.currentDomain, this.parsedData);
      
      this.displayData();
      this.showCache(Date.now());
      this.hideLoading();
      
      this.showSuccess('Data fetched successfully!');
    } catch (error) {
      console.error('Fetch error:', error);
      this.hideLoading();
      this.showError('Failed to Fetch Data', error.message);
      
      UsageTracker.trackEvent('master_lockey', 'fetch_error', { 
        domain: this.currentDomain,
        error: error.message 
      });
    }
  }

  displayData() {
    if (!this.parsedData) return;
    
    const { languagePackId, languages, rows } = this.parsedData;
    
    // Update info section
    this.els.infoDomainName.textContent = this.currentDomain;
    this.els.infoVersion.textContent = languagePackId;
    this.els.lockeyInfo.style.display = 'block';
    
    // Show search section
    this.els.searchSection.style.display = 'flex';
    
    // Build table headers
    this.buildTableHeaders(languages);
    
    // Apply filter (or show all if no filter)
    this.applyFilter();
    
    // Hide empty state, show table
    this.hideEmpty();
    this.els.tableContainer.style.display = 'block';
  }

  buildTableHeaders(languages) {
    const headerRow = document.createElement('tr');
    
    // Key column
    const keyHeader = document.createElement('th');
    keyHeader.textContent = 'Key';
    headerRow.appendChild(keyHeader);
    
    // Language columns
    languages.forEach(lang => {
      const langHeader = document.createElement('th');
      langHeader.textContent = lang.toUpperCase();
      headerRow.appendChild(langHeader);
    });
    
    this.els.tableHead.innerHTML = '';
    this.els.tableHead.appendChild(headerRow);
  }

  applyFilter() {
    if (!this.parsedData) return;
    
    const mode = this.els.searchMode.value;
    const query = this.els.searchInput.value.trim();
    const { languages, rows } = this.parsedData;
    
    // Filter data
    this.filteredRows = this.service.filterData(rows, { mode, query, languages });
    
    // Render table body
    this.renderTableBody(this.filteredRows, languages);
    
    // Update results count
    if (query) {
      this.els.resultsCount.style.display = 'block';
      this.els.resultsText.textContent = `${this.filteredRows.length} of ${rows.length} results`;
    } else {
      this.els.resultsCount.style.display = 'none';
    }
    
    UsageTracker.trackEvent('master_lockey', 'search', { 
      mode, 
      hasQuery: !!query,
      resultCount: this.filteredRows.length 
    });
  }

  renderTableBody(rows, languages) {
    this.els.tableBody.innerHTML = '';
    
    if (rows.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = languages.length + 1;
      emptyCell.textContent = 'No matching results found';
      emptyCell.style.textAlign = 'center';
      emptyCell.style.padding = '40px';
      emptyCell.style.color = '#999';
      emptyRow.appendChild(emptyCell);
      this.els.tableBody.appendChild(emptyRow);
      return;
    }
    
    // Virtual scrolling: only render visible rows + some padding
    const startIndex = this.virtualScroll.startIndex;
    const endIndex = this.virtualScroll.endIndex;
    const visibleRows = rows.slice(startIndex, endIndex);
    
    // Add spacer row before visible rows to maintain scroll position
    if (startIndex > 0) {
      const spacerBefore = document.createElement('tr');
      spacerBefore.style.height = `${startIndex * this.virtualScroll.rowHeight}px`;
      spacerBefore.innerHTML = `<td colspan="${languages.length + 1}"></td>`;
      this.els.tableBody.appendChild(spacerBefore);
    }
    
    // Render visible rows
    visibleRows.forEach(row => {
      const tr = document.createElement('tr');
      
      // Key cell
      const keyCell = document.createElement('td');
      keyCell.textContent = row.key;
      keyCell.title = row.key; // Tooltip for long keys
      tr.appendChild(keyCell);
      
      // Language cells
      languages.forEach(lang => {
        const cell = document.createElement('td');
        cell.textContent = row[lang] || '';
        cell.title = row[lang] || ''; // Tooltip for long text
        tr.appendChild(cell);
      });
      
      this.els.tableBody.appendChild(tr);
    });
    
    // Add spacer row after visible rows
    const remainingRows = rows.length - endIndex;
    if (remainingRows > 0) {
      const spacerAfter = document.createElement('tr');
      spacerAfter.style.height = `${remainingRows * this.virtualScroll.rowHeight}px`;
      spacerAfter.innerHTML = `<td colspan="${languages.length + 1}"></td>`;
      this.els.tableBody.appendChild(spacerAfter);
    }
  }

  showLoading() {
    this.els.loadingState.style.display = 'flex';
    this.els.emptyState.style.display = 'none';
    this.els.errorState.style.display = 'none';
    this.els.tableContainer.style.display = 'none';
    this.els.lockeyInfo.style.display = 'none';
    this.els.searchSection.style.display = 'none';
    
    this.els.btnFetch.classList.add('loading');
    this.els.btnFetch.querySelector('.btn-spinner').style.display = 'inline';
    this.els.btnFetch.disabled = true;
  }

  hideLoading() {
    this.els.loadingState.style.display = 'none';
    this.els.btnFetch.classList.remove('loading');
    this.els.btnFetch.querySelector('.btn-spinner').style.display = 'none';
    this.els.btnFetch.disabled = false;
  }

  showError(title, message) {
    this.els.errorTitle.textContent = title;
    this.els.errorMessage.textContent = message;
    this.els.errorState.style.display = 'flex';
    this.els.emptyState.style.display = 'none';
    this.els.tableContainer.style.display = 'none';
    this.els.lockeyInfo.style.display = 'none';
    this.els.searchSection.style.display = 'none';
  }

  hideError() {
    this.els.errorState.style.display = 'none';
  }

  hideEmpty() {
    this.els.emptyState.style.display = 'none';
  }

  showCache(timestamp) {
    const formatted = this.service.formatTimestamp(timestamp);
    this.els.cacheTimestamp.textContent = formatted;
    this.els.cacheInfo.style.display = 'flex';
  }

  hideCache() {
    this.els.cacheInfo.style.display = 'none';
  }

  onUnmount() {
    // Cleanup if needed
  }
}

export { MasterLockey };
