/**
 * Master Lockey Tool
 * Tool for viewing and searching localization keys from configured domains
 */

import { BaseTool } from "../../core/BaseTool.js";
import { MasterLockeyTemplate } from "./template.js";
import { MasterLockeyService } from "./service.js";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

class MasterLockey extends BaseTool {
  constructor(eventBus) {
    super({
      id: "master-lockey",
      name: "Master Lockey",
      description: "View and search localization keys from configured domains",
      icon: "language",
      category: "application",
      eventBus,
    });

    this.service = new MasterLockeyService();
    this.currentDomain = null;
    this.currentDomainUrl = null;
    this.parsedData = null; // { languagePackId, languages, rows }
    this.filteredRows = null;

    // Virtual scrolling state for performance with large datasets
    this.virtualScroll = {
      rowHeight: 42, // Estimated row height in pixels
      coreRows: 100, // Core visible rows
      overscan: 30, // Buffer rows on each side (top and bottom)
      startIndex: 0,
      endIndex: 160, // coreRows + (2 * overscan)
    };

    // Debounce timer for search
    this.searchDebounceTimer = null;

    // Throttle for scroll events
    this.scrollUpdateQueued = false;

    // Whole word match setting
    this.wholeWord = false;

    // Confluence integration state
    this.confluenceResults = null; // Array of { key, status, inRemote }
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

    // Track feature usage
    UsageTracker.trackFeature("master_lockey");

    // Try to load cached data for the first selected domain
    this.tryLoadCache();
  }

  bindElements() {
    this.els = {
      domainSelector: this.container.querySelector("#domain-selector"),
      btnFetch: this.container.querySelector("#btn-fetch-data"),
      cacheInfo: this.container.querySelector("#cache-info"),
      cacheTimestamp: this.container.querySelector("#cache-timestamp"),
      lockeyInfo: this.container.querySelector("#lockey-info"),
      infoDomainName: this.container.querySelector("#info-domain-name"),
      infoVersion: this.container.querySelector("#info-version"),
      searchSection: this.container.querySelector("#search-section"),
      searchMode: this.container.querySelector("#search-mode"),
      searchInput: this.container.querySelector("#search-input"),
      btnClearSearch: this.container.querySelector("#btn-clear-search"),
      btnWholeWord: this.container.querySelector("#btn-whole-word"),
      searchHint: this.container.querySelector("#search-hint"),
      resultsCount: this.container.querySelector("#results-count"),
      resultsText: this.container.querySelector("#results-text"),
      emptyState: this.container.querySelector("#empty-state"),
      loadingState: this.container.querySelector("#loading-state"),
      errorState: this.container.querySelector("#error-state"),
      errorTitle: this.container.querySelector("#error-title"),
      errorMessage: this.container.querySelector("#error-message"),
      btnRetry: this.container.querySelector("#btn-retry"),
      tableContainer: this.container.querySelector("#table-container"),
      tableHead: this.container.querySelector("#table-head"),
      tableBody: this.container.querySelector("#table-body"),
      // Confluence elements
      confluenceSection: this.container.querySelector("#confluence-section"),
      confluencePageInput: this.container.querySelector("#confluence-page-input"),
      btnFetchConfluence: this.container.querySelector("#btn-fetch-confluence"),
      confluenceError: this.container.querySelector("#confluence-error"),
      confluenceResults: this.container.querySelector("#confluence-results"),
      confluenceResultsCount: this.container.querySelector("#confluence-results-count"),
      confluenceTableBody: this.container.querySelector("#confluence-table-body"),
      btnExportTsv: this.container.querySelector("#btn-export-tsv"),
      btnExportCsv: this.container.querySelector("#btn-export-csv"),
    };
  }

  loadDomainConfig() {
    try {
      const configJson = localStorage.getItem("config.lockeyDomains");
      const domains = configJson ? JSON.parse(configJson) : [];

      // Clear existing options (except the first placeholder)
      this.els.domainSelector.innerHTML = '<option value="">Pick Domain</option>';

      if (domains.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No domains configured (go to Settings)";
        option.disabled = true;
        this.els.domainSelector.appendChild(option);
        return;
      }

      domains.forEach(({ key, value }) => {
        const option = document.createElement("option");
        option.value = JSON.stringify({ key, value });
        option.textContent = key;
        this.els.domainSelector.appendChild(option);
      });
    } catch (error) {
      console.error("Failed to load domain config:", error);
    }
  }

  setupEventListeners() {
    // Domain selector change
    this.els.domainSelector.addEventListener("change", () => {
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
    this.els.btnFetch.addEventListener("click", () => {
      this.fetchData();
    });

    // Search mode change
    this.els.searchMode.addEventListener("change", () => {
      this.updateSearchHint();
      this.applyFilterDebounced();
    });

    // Search input with debouncing (300ms delay)
    this.els.searchInput.addEventListener("input", () => {
      this.applyFilterDebounced();
    });

    // Clear search
    this.els.btnClearSearch.addEventListener("click", () => {
      this.els.searchInput.value = "";
      this.applyFilter();
    });

    // Whole word toggle
    this.els.btnWholeWord.addEventListener("click", () => {
      this.wholeWord = !this.wholeWord;
      this.els.btnWholeWord.classList.toggle("active", this.wholeWord);

      UsageTracker.trackEvent("master_lockey", "toggle_whole_word", {
        enabled: this.wholeWord,
      });

      this.applyFilter();
    });

    // Retry button
    this.els.btnRetry.addEventListener("click", () => {
      this.fetchData();
    });

    // Virtual scroll handler
    this.els.tableContainer.addEventListener("scroll", () => {
      this.handleTableScroll();
    });

    // Confluence event listeners
    this.setupConfluenceListeners();
  }

  setupConfluenceListeners() {
    // Enable/disable fetch button based on input
    this.els.confluencePageInput.addEventListener("input", () => {
      const value = this.els.confluencePageInput.value.trim();
      this.els.btnFetchConfluence.disabled = !value;
    });

    // Fetch button click
    this.els.btnFetchConfluence.addEventListener("click", () => {
      this.fetchFromConfluence();
    });

    // Enter key in input
    this.els.confluencePageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !this.els.btnFetchConfluence.disabled) {
        this.fetchFromConfluence();
      }
    });

    // Export buttons
    this.els.btnExportTsv.addEventListener("click", () => this.exportResults("tsv"));
    this.els.btnExportCsv.addEventListener("click", () => this.exportResults("csv"));
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

    // Throttle scroll updates - only one update per frame
    if (this.scrollUpdateQueued) return;

    this.scrollUpdateQueued = true;
    requestAnimationFrame(() => {
      const scrollTop = this.els.tableContainer.scrollTop;
      const containerHeight = this.els.tableContainer.clientHeight;

      // Calculate which row is at the top of viewport
      const topRowIndex = Math.floor(scrollTop / this.virtualScroll.rowHeight);

      // Calculate ideal range with overscan buffer
      const idealStart = Math.max(0, topRowIndex - this.virtualScroll.overscan);
      const idealEnd = Math.min(
        this.filteredRows.length,
        topRowIndex + Math.ceil(containerHeight / this.virtualScroll.rowHeight) + this.virtualScroll.overscan
      );

      // Only re-render if we've scrolled outside the overscan buffer
      const needsUpdate =
        idealStart < this.virtualScroll.startIndex ||
        idealEnd > this.virtualScroll.endIndex ||
        idealStart > this.virtualScroll.startIndex + this.virtualScroll.overscan ||
        idealEnd < this.virtualScroll.endIndex - this.virtualScroll.overscan;

      if (needsUpdate) {
        // Render with overscan buffer
        this.virtualScroll.startIndex = idealStart;
        this.virtualScroll.endIndex = Math.min(
          idealStart + this.virtualScroll.coreRows + 2 * this.virtualScroll.overscan,
          this.filteredRows.length
        );
        this.renderTableBody(this.filteredRows, this.parsedData.languages);
      }

      this.scrollUpdateQueued = false;
    });
  }

  updateSearchHint() {
    const mode = this.els.searchMode.value;
    if (mode === "key") {
      this.els.searchHint.textContent = "Tip: For key search, use comma-separated values (e.g., key1, key2)";
    } else {
      this.els.searchHint.textContent = "Tip: Search will match text in any language column";
    }
  }

  async tryLoadCache() {
    if (!this.currentDomain) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const cached = await invoke("load_lockey_cache", { domain: this.currentDomain });

      if (cached && cached.data) {
        this.parsedData = cached.data;
        this.displayData();
        this.showCache(cached.timestamp);

        UsageTracker.trackEvent("master_lockey", "load_from_cache", { domain: this.currentDomain });
      } else {
        this.hideCache();
      }
    } catch (error) {
      console.error("Failed to load cache:", error);
      this.hideCache();
    }
  }

  async fetchData() {
    if (!this.currentDomainUrl) return;

    this.showLoading();
    this.hideError();
    this.hideCache();

    try {
      UsageTracker.trackEvent("master_lockey", "fetch_latest_data", { domain: this.currentDomain });

      const rawData = await this.service.fetchLockeyData(this.currentDomainUrl);
      this.parsedData = this.service.parseLockeyData(rawData);

      // Cache the parsed data using Tauri backend
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_lockey_cache", {
        domain: this.currentDomain,
        data: this.parsedData,
      });

      this.displayData();
      this.showCache(Date.now());
      this.hideLoading();

      this.showSuccess("Data fetched successfully!");
    } catch (error) {
      console.error("Fetch error:", error);
      this.hideLoading();
      this.showError("Failed to Fetch Data", error.message);

      UsageTracker.trackEvent("master_lockey", "fetch_error", {
        domain: this.currentDomain,
        error: error.message,
      });
    }
  }

  displayData() {
    if (!this.parsedData) return;

    const { languagePackId, languages, rows } = this.parsedData;

    // Update info section
    this.els.infoDomainName.textContent = this.currentDomain;
    this.els.infoVersion.textContent = languagePackId;
    this.els.lockeyInfo.style.display = "block";

    // Show search section
    this.els.searchSection.style.display = "flex";

    // Build table headers
    this.buildTableHeaders(languages);

    // Apply filter (or show all if no filter)
    this.applyFilter();

    // Hide empty state, show table
    this.hideEmpty();
    this.els.tableContainer.style.display = "block";

    // Show Confluence section (Tauri only)
    this.showConfluenceSection();
  }

  buildTableHeaders(languages) {
    const headerRow = document.createElement("tr");

    // Key column
    const keyHeader = document.createElement("th");
    keyHeader.textContent = "Key";
    headerRow.appendChild(keyHeader);

    // Language columns
    languages.forEach((lang) => {
      const langHeader = document.createElement("th");
      langHeader.textContent = lang.toUpperCase();
      headerRow.appendChild(langHeader);
    });

    this.els.tableHead.innerHTML = "";
    this.els.tableHead.appendChild(headerRow);
  }

  applyFilter() {
    if (!this.parsedData) return;

    const searchMode = this.els.searchMode.value;
    const searchQuery = this.els.searchInput.value.trim();

    if (!searchQuery) {
      this.filteredRows = this.parsedData.rows;
      this.renderTableBody(this.filteredRows, this.parsedData.languages);
      // Show total entry count when no search is active
      this.els.resultsCount.style.display = "block";
      this.els.resultsText.textContent = `Showing ${this.formatNumber(this.parsedData.rows.length)} entries`;
      return;
    }

    let filtered;
    if (searchMode === "key") {
      // Search by key (comma-separated)
      filtered = this.service.filterByKeys(this.parsedData.rows, searchQuery, this.wholeWord);
    } else {
      // Search by content
      filtered = this.service.filterByContent(this.parsedData.rows, this.parsedData.languages, searchQuery, this.wholeWord);
    }

    this.filteredRows = filtered;
    this.renderTableBody(this.filteredRows, this.parsedData.languages);

    // Update results count
    this.els.resultsCount.style.display = "block";
    this.els.resultsText.textContent = `${this.formatNumber(this.filteredRows.length)} of ${this.formatNumber(
      this.parsedData.rows.length
    )} results`;

    // Track search with specific action based on mode
    const searchAction = searchMode === "key" ? "search_by_key" : "search_by_content";
    UsageTracker.trackEvent("master_lockey", searchAction, {
      whole_word: this.wholeWord,
      results: filtered.length,
      total_rows: this.parsedData.rows.length,
    });
  }

  renderTableBody(rows, languages) {
    this.els.tableBody.innerHTML = "";

    if (rows.length === 0) {
      const emptyRow = document.createElement("tr");
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = languages.length + 1;
      emptyCell.textContent = "No matching results found";
      emptyCell.style.textAlign = "center";
      emptyCell.style.padding = "40px";
      emptyCell.style.color = "#999";
      emptyRow.appendChild(emptyCell);
      this.els.tableBody.appendChild(emptyRow);
      return;
    }

    const startIndex = this.virtualScroll.startIndex;
    const endIndex = this.virtualScroll.endIndex;
    const visibleRows = rows.slice(startIndex, endIndex);

    // Get search info for highlighting
    const searchMode = this.els.searchMode.value;
    const searchQuery = this.els.searchInput.value.trim();
    const shouldHighlight = searchMode === "content" && searchQuery.length > 0;

    // Add top spacer to maintain scroll position
    if (startIndex > 0) {
      const spacerBefore = document.createElement("tr");
      spacerBefore.style.height = `${startIndex * this.virtualScroll.rowHeight}px`;
      spacerBefore.innerHTML = `<td colspan="${languages.length + 1}"></td>`;
      this.els.tableBody.appendChild(spacerBefore);
    }

    // Render visible rows with overscan buffer
    visibleRows.forEach((row) => {
      const tr = document.createElement("tr");

      // Key cell
      const keyCell = document.createElement("td");
      keyCell.textContent = row.key;
      keyCell.title = row.key;
      tr.appendChild(keyCell);

      // Language cells with highlighting
      languages.forEach((lang) => {
        const cell = document.createElement("td");
        const cellText = row[lang] || "";

        // Check if this is a placeholder value (already transformed in service)
        const isPlaceholder = cellText.startsWith("json raw value is");

        if (isPlaceholder) {
          // Render placeholder with special styling
          const span = document.createElement("span");
          span.className = "empty-value";
          span.textContent = this.escapeSpecialChars(cellText);
          cell.appendChild(span);
          cell.title = this.escapeSpecialChars(cellText);
        } else {
          // Normal value - apply highlighting if searching by content
          if (shouldHighlight) {
            cell.innerHTML = this.highlightText(cellText, searchQuery);
          } else {
            cell.textContent = this.escapeSpecialChars(cellText);
          }
          cell.title = this.escapeSpecialChars(cellText);
        }

        tr.appendChild(cell);
      });

      this.els.tableBody.appendChild(tr);
    });

    // Add bottom spacer
    const remainingRows = rows.length - endIndex;
    if (remainingRows > 0) {
      const spacerAfter = document.createElement("tr");
      spacerAfter.style.height = `${remainingRows * this.virtualScroll.rowHeight}px`;
      spacerAfter.innerHTML = `<td colspan="${languages.length + 1}"></td>`;
      this.els.tableBody.appendChild(spacerAfter);
    }
  }

  /**
   * Format number with dot as thousand separator (e.g., 14443 -> 14.443)
   * @param {number} num - Number to format
   * @returns {string} Formatted number string
   */
  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  escapeSpecialChars(text) {
    if (!text) return text;

    return text
      .replace(/\\/g, "\\\\") // Backslash first (to avoid double-escaping)
      .replace(/\n/g, "\\n") // Newline
      .replace(/\r/g, "\\r") // Carriage return
      .replace(/\t/g, "\\t") // Tab
      .replace(/\f/g, "\\f") // Form feed
      .replace(/\v/g, "\\v"); // Vertical tab
  }

  highlightText(text, query) {
    if (!query || !text) return text;

    // First, escape special characters (newlines, tabs, etc.)
    const escapedSpecialChars = this.escapeSpecialChars(text);

    // Then, escape HTML entities to prevent HTML injection
    const escapeHtml = (str) => {
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    };

    const escapedText = escapeHtml(escapedSpecialChars);

    // Escape special regex characters in query
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Create regex based on whole word setting
    const pattern = this.wholeWord ? `\\b(${escapedQuery})\\b` : `(${escapedQuery})`;
    const regex = new RegExp(pattern, "gi");

    // Replace matches with highlighted version
    return escapedText.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  showLoading() {
    this.els.loadingState.style.display = "flex";
    this.els.emptyState.style.display = "none";
    this.els.errorState.style.display = "none";
    this.els.tableContainer.style.display = "none";
    this.els.lockeyInfo.style.display = "none";
    this.els.searchSection.style.display = "none";

    this.els.btnFetch.classList.add("loading");
    this.els.btnFetch.querySelector(".btn-spinner").style.display = "inline";
    this.els.btnFetch.disabled = true;
  }

  hideLoading() {
    this.els.loadingState.style.display = "none";
    this.els.btnFetch.classList.remove("loading");
    this.els.btnFetch.querySelector(".btn-spinner").style.display = "none";
    this.els.btnFetch.disabled = false;
  }

  showError(title, message) {
    this.els.errorTitle.textContent = title;
    this.els.errorMessage.textContent = message;
    this.els.errorState.style.display = "flex";
    this.els.emptyState.style.display = "none";
    this.els.tableContainer.style.display = "none";
    this.els.lockeyInfo.style.display = "none";
    this.els.searchSection.style.display = "none";
  }

  hideError() {
    this.els.errorState.style.display = "none";
  }

  hideEmpty() {
    this.els.emptyState.style.display = "none";
  }

  showCache(timestamp) {
    const formatted = this.service.formatTimestamp(timestamp);
    this.els.cacheTimestamp.textContent = formatted;
    this.els.cacheInfo.style.display = "flex";
  }

  hideCache() {
    this.els.cacheInfo.style.display = "none";
  }

  onUnmount() {
    // Cleanup if needed
  }

  // =====================
  // Confluence Integration
  // =====================

  async showConfluenceSection() {
    try {
      const hasPat = await this.service.hasConfluencePat();
      const domain = localStorage.getItem("config.confluence.domain");
      const username = localStorage.getItem("config.confluence.username");

      if (hasPat && domain && username) {
        this.els.confluenceSection.style.display = "block";
      } else {
        this.els.confluenceSection.style.display = "none";
      }
    } catch (_) {
      // Not available (web mode)
      this.els.confluenceSection.style.display = "none";
    }
  }

  async fetchFromConfluence() {
    const pageIdOrUrl = this.els.confluencePageInput.value.trim();
    if (!pageIdOrUrl) return;

    // Show loading
    this.els.btnFetchConfluence.classList.add("loading");
    this.els.btnFetchConfluence.querySelector(".btn-spinner").style.display = "inline";
    this.els.btnFetchConfluence.disabled = true;
    this.hideConfluenceError();
    this.els.confluenceResults.style.display = "none";

    try {
      UsageTracker.trackEvent("master_lockey", "confluence_fetch", { pageIdOrUrl });

      // Fetch page content
      const htmlContent = await this.service.fetchConfluencePage(pageIdOrUrl);

      // Parse table for lockeys
      const lockeys = this.service.parseConfluenceTableForLockeys(htmlContent);

      if (lockeys.length === 0) {
        this.showConfluenceError(
          "No lockey table found on this page. Make sure the table has a column named 'Localization Key', 'Lockey', or 'Loc Key'."
        );
        return;
      }

      // Compare with remote data
      this.confluenceResults = this.service.compareLockeyWithRemote(lockeys, this.parsedData);

      // Display results
      this.displayConfluenceResults();

      UsageTracker.trackEvent("master_lockey", "confluence_fetch_success", {
        lockeysFound: lockeys.length,
      });
    } catch (error) {
      console.error("Confluence fetch error:", error);
      this.showConfluenceError(error.message);

      UsageTracker.trackEvent("master_lockey", "confluence_fetch_error", {
        error: error.message,
      });
    } finally {
      // Hide loading
      this.els.btnFetchConfluence.classList.remove("loading");
      this.els.btnFetchConfluence.querySelector(".btn-spinner").style.display = "none";
      this.els.btnFetchConfluence.disabled = false;
    }
  }

  displayConfluenceResults() {
    if (!this.confluenceResults) return;

    // Update count
    this.els.confluenceResultsCount.textContent = `Found ${this.confluenceResults.length} lockeys`;

    // Clear and populate table
    this.els.confluenceTableBody.innerHTML = "";

    this.confluenceResults.forEach((item) => {
      const tr = document.createElement("tr");

      // Lockey cell
      const keyCell = document.createElement("td");
      keyCell.textContent = item.key;
      keyCell.className = `status-${item.status}`;
      tr.appendChild(keyCell);

      // Status cell
      const statusCell = document.createElement("td");
      const statusLabels = {
        plain: "Released",
        new: "New (In Dev)",
        removed: "Removed (Previous)",
        "removed-new": "Removed (Current)",
      };
      statusCell.textContent = statusLabels[item.status] || item.status;
      statusCell.className = `status-${item.status}`;
      tr.appendChild(statusCell);

      // In Remote cell
      const inRemoteCell = document.createElement("td");
      inRemoteCell.textContent = item.inRemote ? "✓" : "✗";
      inRemoteCell.className = item.inRemote ? "in-remote-yes" : "in-remote-no";
      tr.appendChild(inRemoteCell);

      this.els.confluenceTableBody.appendChild(tr);
    });

    // Show results
    this.els.confluenceResults.style.display = "block";
  }

  showConfluenceError(message) {
    this.els.confluenceError.textContent = message;
    this.els.confluenceError.style.display = "block";
  }

  hideConfluenceError() {
    this.els.confluenceError.style.display = "none";
  }

  exportResults(format) {
    if (!this.confluenceResults || this.confluenceResults.length === 0) return;

    let content;
    if (format === "tsv") {
      content = this.service.exportAsTsv(this.confluenceResults);
    } else {
      content = this.service.exportAsCsv(this.confluenceResults);
    }

    // Copy to clipboard
    navigator.clipboard
      .writeText(content)
      .then(() => {
        this.showSuccess(`Copied ${this.confluenceResults.length} rows as ${format.toUpperCase()}`);

        UsageTracker.trackEvent("master_lockey", `confluence_export_${format}`, {
          rowCount: this.confluenceResults.length,
        });
      })
      .catch((err) => {
        console.error("Copy failed:", err);
        this.showError("Copy Failed", "Unable to copy to clipboard");
      });
  }
}

export { MasterLockey };
