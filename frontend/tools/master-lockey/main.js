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
    this.currentConfluencePageId = null;
    this.currentConfluenceTitle = null;
    this.hiddenKeys = [];

    // Page search state (for unified input)
    this.pageSearchState = {
      cachedPages: [], // All cached pages for search
      selectedIndex: -1,
      visibleItems: [],
    };
    this.pageSearchDebounceTimer = null;

    // Bulk Confluence search state
    this.bulkConfluenceResults = null; // Array of { screenName, lockeys: [...], error? }
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
    this.setupTabListeners();

    // Track feature usage
    UsageTracker.trackFeature("master_lockey", "mount");

    // Try to load cached data for the first selected domain
    this.tryLoadCache();
  }

  setupTabListeners() {
    // Restore last saved tab
    const savedTab = localStorage.getItem("masterLockeyActiveTab") || "lockey";
    const savedButton = Array.from(this.els.tabButtons).find((b) => b.dataset.tab === savedTab);
    if (savedButton) {
      this.switchTab(savedTab);
    }

    this.els.tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.dataset.tab;
        this.switchTab(targetTab);
        // Save tab state
        localStorage.setItem("masterLockeyActiveTab", targetTab);
        // Track tab switch
        UsageTracker.trackEvent("master_lockey", "tab_switch", { tab: targetTab });
      });
    });
  }

  switchTab(targetTab) {
    // Update active state on buttons
    this.els.tabButtons.forEach((b) => b.classList.remove("active"));
    const targetButton = Array.from(this.els.tabButtons).find((b) => b.dataset.tab === targetTab);
    if (targetButton) targetButton.classList.add("active");

    // Toggle panels
    if (targetTab === "lockey") {
      this.els.lockeyPanel.classList.add("active");
      this.els.confluencePanel.classList.remove("active");
      this.els.bulkSearchPanel.classList.remove("active");
    } else if (targetTab === "confluence") {
      this.els.lockeyPanel.classList.remove("active");
      this.els.confluencePanel.classList.add("active");
      this.els.bulkSearchPanel.classList.remove("active");
      // Initialize Confluence section when switching to tab
      this.showConfluenceSection();
    } else if (targetTab === "bulk-search") {
      this.els.lockeyPanel.classList.remove("active");
      this.els.confluencePanel.classList.remove("active");
      this.els.bulkSearchPanel.classList.add("active");
      // Check if data is loaded and update UI
      this.updateBulkSearchState();
    }
  }

  bindElements() {
    this.els = {
      domainSelector: this.container.querySelector("#domain-selector"),
      btnFetch: this.container.querySelector("#btn-fetch-data"),
      cacheInfo: this.container.querySelector("#cache-info"),
      cacheTimestamp: this.container.querySelector("#cache-timestamp"),
      domainControls: this.container.querySelector("#domain-controls"),
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
      pageSearchContainer: this.container.querySelector(".page-search-container"),
      pageSearchDropdown: this.container.querySelector("#page-search-dropdown"),
      btnRefreshPage: this.container.querySelector("#btn-refresh-page"),
      btnDeleteCache: this.container.querySelector("#btn-delete-cache"),
      confluencePageInput: this.container.querySelector("#confluence-page-input"),
      btnFetchConfluence: this.container.querySelector("#btn-fetch-confluence"),
      confluenceError: this.container.querySelector("#confluence-error"),
      confluenceResults: this.container.querySelector("#confluence-results"),
      confluenceResultsCount: this.container.querySelector("#confluence-results-count"),
      confluenceTableBody: this.container.querySelector("#confluence-table-body"),
      btnCopyLockey: this.container.querySelector("#btn-copy-lockey"),
      btnCopyTable: this.container.querySelector("#btn-copy-table"),
      hiddenKeysSection: this.container.querySelector("#hidden-keys-section"),
      hiddenKeysToggle: this.container.querySelector("#hidden-keys-toggle"),
      hiddenKeysCount: this.container.querySelector("#hidden-keys-count"),
      hiddenKeysContent: this.container.querySelector("#hidden-keys-content"),
      hiddenKeysBody: this.container.querySelector("#hidden-keys-body"),
      confluencePatWarning: this.container.querySelector("#confluence-pat-warning"),
      confluenceSettingsLink: this.container.querySelector("#confluence-settings-link"),
      confluenceEnHeader: this.container.querySelector("#confluence-en-header"),
      confluenceIdHeader: this.container.querySelector("#confluence-id-header"),
      // Tab elements
      tabButtons: this.container.querySelectorAll(".ml-tabs .tab-button"),
      lockeyPanel: this.container.querySelector("#lockey-tab-panel"),
      confluencePanel: this.container.querySelector("#confluence-tab-panel"),
      // Bulk search elements
      bulkSearchPanel: this.container.querySelector("#bulk-search-tab-panel"),
      bulkSearchInput: this.container.querySelector("#bulk-search-input"),
      btnBulkSearch: this.container.querySelector("#btn-bulk-search"),
      btnPasteBulk: this.container.querySelector("#btn-paste-bulk"),
      btnClearBulk: this.container.querySelector("#btn-clear-bulk"),
      bulkSearchNoData: this.container.querySelector("#bulk-search-no-data"),
      bulkSearchResults: this.container.querySelector("#bulk-search-results"),
      bulkSearchResultsCount: this.container.querySelector("#bulk-search-results-count"),
      bulkSearchTableBody: this.container.querySelector("#bulk-search-table-body"),
      btnCopyBulkLockey: this.container.querySelector("#btn-copy-bulk-lockey"),
      btnCopyBulkResults: this.container.querySelector("#btn-copy-bulk-results"),
      bulkSearchFilter: this.container.querySelector("#bulk-search-filter"),
      bulkSearchEnHeader: this.container.querySelector("#bulk-search-en-header"),
      bulkSearchIdHeader: this.container.querySelector("#bulk-search-id-header"),
      // Confluence mode toggle elements
      confluenceModeButtons: this.container.querySelectorAll(".confluence-mode-btn"),
      confluenceSingleMode: this.container.querySelector("#confluence-single-mode"),
      confluenceBulkMode: this.container.querySelector("#confluence-bulk-mode"),
      // Bulk Confluence elements
      bulkConfluenceInput: this.container.querySelector("#bulk-confluence-input"),
      btnBulkConfluenceSearch: this.container.querySelector("#btn-bulk-confluence-search"),
      btnPasteBulkConfluence: this.container.querySelector("#btn-paste-bulk-confluence"),
      btnClearBulkConfluence: this.container.querySelector("#btn-clear-bulk-confluence"),
      bulkConfluenceError: this.container.querySelector("#bulk-confluence-error"),
      bulkConfluenceResults: this.container.querySelector("#bulk-confluence-results"),
      bulkConfluenceResultsCount: this.container.querySelector("#bulk-confluence-results-count"),
      bulkConfluenceTableBody: this.container.querySelector("#bulk-confluence-table-body"),
      bulkConfluenceEnHeader: this.container.querySelector("#bulk-confluence-en-header"),
      bulkConfluenceIdHeader: this.container.querySelector("#bulk-confluence-id-header"),
      btnCopyBulkConfluenceLockey: this.container.querySelector("#btn-copy-bulk-confluence-lockey"),
      btnCopyBulkConfluenceTable: this.container.querySelector("#btn-copy-bulk-confluence-table"),
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

        // Try to load cached data for this domain (will refresh bulk confluence results after loading)
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

    // Bulk search event listeners
    this.setupBulkSearchListeners();

    // Confluence event listeners
    this.setupConfluenceListeners();
  }

  setupConfluenceListeners() {
    // Page search input handler with debounce
    this.els.confluencePageInput.addEventListener("input", () => {
      const value = this.els.confluencePageInput.value.trim();
      this.els.btnFetchConfluence.disabled = !value;
      this.handlePageSearchInputDebounced();
    });

    // Focus handler - show dropdown with all pages
    this.els.confluencePageInput.addEventListener("focus", () => {
      this.handlePageSearchInput();
    });

    // Keyboard navigation
    this.els.confluencePageInput.addEventListener("keydown", (e) => {
      if (this.els.pageSearchDropdown.style.display === "block") {
        this.handlePageSearchKeyDown(e);
      } else if (e.key === "Enter" && !this.els.btnFetchConfluence.disabled) {
        this.fetchFromConfluence();
      } else if (e.key === "ArrowDown") {
        this.handlePageSearchInput();
      }
    });

    // Click outside to close dropdown
    document.addEventListener("click", (e) => {
      if (this.els.pageSearchContainer && !this.els.pageSearchContainer.contains(e.target)) {
        this.hidePageSearchDropdown();
      }
    });

    // Fetch button click
    this.els.btnFetchConfluence.addEventListener("click", () => {
      this.hidePageSearchDropdown();
      this.fetchFromConfluence();
    });

    // Copy buttons
    this.els.btnCopyLockey.addEventListener("click", () => this.copyLockeyColumn());
    this.els.btnCopyTable.addEventListener("click", () => this.copyTableAsTsv());

    // Refresh button
    this.els.btnRefreshPage.addEventListener("click", () => {
      if (this.currentConfluencePageId) {
        this.fetchFromConfluence(this.currentConfluencePageId, true);
      }
    });

    // Delete cache button
    this.els.btnDeleteCache.addEventListener("click", () => {
      if (this.currentConfluencePageId) {
        this.deleteCurrentCache();
      }
    });

    // Hidden keys toggle
    this.els.hiddenKeysToggle.addEventListener("click", () => {
      const isExpanded = this.els.hiddenKeysToggle.classList.toggle("expanded");
      this.els.hiddenKeysContent.style.display = isExpanded ? "block" : "none";
    });

    // Mode toggle listeners (Single / Bulk)
    this.els.confluenceModeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        this.switchConfluenceMode(mode);
      });
    });

    // Bulk Confluence event listeners
    this.setupBulkConfluenceListeners();
  }

  switchConfluenceMode(mode) {
    // Update button active states
    this.els.confluenceModeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    // Toggle panels
    if (mode === "single") {
      this.els.confluenceSingleMode.classList.add("active");
      this.els.confluenceBulkMode.classList.remove("active");
    } else {
      this.els.confluenceSingleMode.classList.remove("active");
      this.els.confluenceBulkMode.classList.add("active");
    }

    // Track mode switch
    UsageTracker.trackEvent("master_lockey", "confluence_mode_switch", { mode });
  }

  setupBulkConfluenceListeners() {
    // Input change - enable/disable search button
    this.els.bulkConfluenceInput.addEventListener("input", () => {
      const value = this.els.bulkConfluenceInput.value.trim();
      this.els.btnBulkConfluenceSearch.disabled = !value;
    });

    // Search button
    this.els.btnBulkConfluenceSearch.addEventListener("click", async () => {
      try {
        await this.performBulkConfluenceSearch();
      } catch (err) {
        console.error("Bulk confluence search error:", err);
        this.els.bulkConfluenceError.textContent = `Error: ${err.message}`;
        this.els.bulkConfluenceError.style.display = "block";
        // Reset button state on error
        this.els.btnBulkConfluenceSearch.classList.remove("loading");
        this.els.btnBulkConfluenceSearch.querySelector(".btn-spinner").style.display = "none";
        this.els.btnBulkConfluenceSearch.disabled = false;
      }
    });

    // Paste button
    this.els.btnPasteBulkConfluence.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        this.els.bulkConfluenceInput.value = text;
        this.els.btnBulkConfluenceSearch.disabled = !text.trim();
      } catch (err) {
        console.error("Failed to paste:", err);
      }
    });

    // Clear button
    this.els.btnClearBulkConfluence.addEventListener("click", () => {
      this.els.bulkConfluenceInput.value = "";
      this.els.btnBulkConfluenceSearch.disabled = true;
      this.els.bulkConfluenceResults.style.display = "none";
      this.els.bulkConfluenceError.style.display = "none";
      this.bulkConfluenceResults = null;
    });

    // Copy lockey button
    this.els.btnCopyBulkConfluenceLockey.addEventListener("click", () => {
      this.copyBulkConfluenceLockey();
    });

    // Copy table button
    this.els.btnCopyBulkConfluenceTable.addEventListener("click", () => {
      this.copyBulkConfluenceTable();
    });
  }

  handlePageSearchInputDebounced() {
    if (this.pageSearchDebounceTimer) {
      clearTimeout(this.pageSearchDebounceTimer);
    }
    this.pageSearchDebounceTimer = setTimeout(() => {
      this.handlePageSearchInput();
    }, 150);
  }

  handlePageSearchInput() {
    const input = this.els.confluencePageInput.value.trim();
    const cachedPages = this.pageSearchState.cachedPages;

    // Determine if input looks like a URL or page ID
    const isUrlLike = input && (input.includes("/") || input.includes("http") || /^\d+$/.test(input));

    // Filter cached pages by title (case-insensitive)
    let matchedPages = [];
    if (input) {
      const lowerInput = input.toLowerCase();
      matchedPages = cachedPages.filter((page) => page.title && page.title.toLowerCase().includes(lowerInput));
    } else {
      // Show all cached pages when empty
      matchedPages = cachedPages.slice(0, 10);
    }

    this.showPageSearchDropdown(matchedPages, input, isUrlLike);
  }

  showPageSearchDropdown(pages, inputValue, isUrlLike) {
    const dropdown = this.els.pageSearchDropdown;
    dropdown.innerHTML = "";
    this.pageSearchState.visibleItems = [];
    this.pageSearchState.selectedIndex = -1;

    // If input looks like URL/ID, show "Fetch new page" option first
    if (isUrlLike && inputValue) {
      const fetchItem = document.createElement("div");
      fetchItem.className = "page-search-item fetch-new";
      fetchItem.innerHTML = `
        <span class="item-icon">+</span>
        <span class="item-text">Fetch: ${this.truncateText(inputValue, 40)}</span>
      `;
      fetchItem.dataset.action = "fetch";
      fetchItem.dataset.value = inputValue;
      fetchItem.addEventListener("click", () => {
        this.hidePageSearchDropdown();
        this.fetchFromConfluence();
      });
      dropdown.appendChild(fetchItem);
      this.pageSearchState.visibleItems.push(fetchItem);
    }

    // Show cached pages
    if (pages.length > 0) {
      pages.forEach((page) => {
        const item = document.createElement("div");
        item.className = "page-search-item";
        item.innerHTML = `
          <span class="item-text">${this.escapeHtml(page.title)}</span>
        `;
        item.dataset.action = "load";
        item.dataset.pageId = page.pageId;
        item.addEventListener("click", () => {
          this.selectPageFromDropdown(page.pageId, page.title);
        });
        dropdown.appendChild(item);
        this.pageSearchState.visibleItems.push(item);
      });
    }

    // Show empty state if no results
    if (this.pageSearchState.visibleItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "page-search-empty";
      empty.textContent = "No cached pages. Enter a Confluence URL to fetch.";
      dropdown.appendChild(empty);
    }

    dropdown.style.display = "block";
  }

  hidePageSearchDropdown() {
    this.els.pageSearchDropdown.style.display = "none";
    this.pageSearchState.selectedIndex = -1;
  }

  selectPageFromDropdown(pageId, title) {
    this.els.confluencePageInput.value = title || "";
    this.hidePageSearchDropdown();
    this.loadCachedPage(pageId);
    this.els.btnFetchConfluence.disabled = true; // Disable since we're loading cached
  }

  handlePageSearchKeyDown(event) {
    const items = this.pageSearchState.visibleItems;
    if (items.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.pageSearchState.selectedIndex = Math.min(this.pageSearchState.selectedIndex + 1, items.length - 1);
        this.updatePageSearchSelection();
        break;

      case "ArrowUp":
        event.preventDefault();
        this.pageSearchState.selectedIndex = Math.max(this.pageSearchState.selectedIndex - 1, -1);
        this.updatePageSearchSelection();
        break;

      case "Enter":
        event.preventDefault();
        if (this.pageSearchState.selectedIndex >= 0 && this.pageSearchState.selectedIndex < items.length) {
          const selectedItem = items[this.pageSearchState.selectedIndex];
          if (selectedItem.dataset.action === "fetch") {
            this.hidePageSearchDropdown();
            this.fetchFromConfluence();
          } else if (selectedItem.dataset.action === "load") {
            const pageId = selectedItem.dataset.pageId;
            const page = this.pageSearchState.cachedPages.find((p) => p.pageId === pageId);
            this.selectPageFromDropdown(pageId, page?.title);
          }
        } else if (!this.els.btnFetchConfluence.disabled) {
          this.hidePageSearchDropdown();
          this.fetchFromConfluence();
        }
        break;

      case "Escape":
        this.hidePageSearchDropdown();
        break;
    }
  }

  updatePageSearchSelection() {
    this.pageSearchState.visibleItems.forEach((item, index) => {
      if (index === this.pageSearchState.selectedIndex) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }

  truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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
        this.updateBulkSearchState();

        UsageTracker.trackEvent("master_lockey", "load_from_cache", { domain: this.currentDomain });

        // Refresh bulk confluence results if they exist (EN/ID values depend on parsedData)
        if (this.bulkConfluenceResults && this.bulkConfluenceResults.length > 0) {
          this.displayBulkConfluenceResults(this.bulkConfluenceResults);
        }
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
      this.updateBulkSearchState();

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

    // Update version hash display (just show the hash, domain is visible in dropdown)
    this.els.infoVersion.textContent = languagePackId;
    this.els.infoVersion.style.display = "inline";

    // Show search section
    this.els.searchSection.style.display = "flex";

    // Build table headers
    this.buildTableHeaders(languages);

    // Apply filter (or show all if no filter)
    this.applyFilter();

    // Hide empty state, show table
    this.hideEmpty();
    this.els.tableContainer.style.display = "block";

    // Update Confluence comparison with new domain data
    this.refreshConfluenceComparison();
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
    this.els.infoVersion.style.display = "none";
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
    this.els.infoVersion.style.display = "none";
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
        // Full credentials configured - hide warning, enable controls
        this.els.confluencePatWarning.style.display = "none";
        this.els.confluencePageInput.disabled = false;
        // Load cached pages dropdown
        await this.loadCachedPagesDropdown();
      } else {
        // Missing credentials - show warning, disable controls
        this.els.confluencePatWarning.style.display = "block";
        this.els.confluencePageInput.disabled = true;
        this.els.btnFetchConfluence.disabled = true;

        // Add click handler for settings link (only once)
        if (!this._confluenceSettingsLinkBound) {
          this._confluenceSettingsLinkBound = true;
          this.els.confluenceSettingsLink?.addEventListener("click", (e) => {
            e.preventDefault();
            // Navigate to settings page
            this.eventBus?.emit?.("navigate", { page: "settings" });
          });
        }
      }
    } catch (_) {
      // Not available (web mode) - show warning with message
      // this.els.confluencePatWarning.style.display = "block";
      // this.els.confluencePatWarning.textContent = "Confluence integration is only available in the desktop app.";
      this.els.confluencePageInput.disabled = true;
      this.els.btnFetchConfluence.disabled = true;
    }
  }

  /**
   * Refresh confluence results comparison with current domain data
   */
  refreshConfluenceComparison() {
    if (!this.confluenceResults || this.confluenceResults.length === 0) return;

    // Re-compare with current domain data
    // Get the original lockeys without inRemote status
    const originalLockeys = this.confluenceResults.map(({ key, status }) => ({ key, status }));
    this.confluenceResults = this.service.compareLockeyWithRemote(originalLockeys, this.parsedData);

    // Re-display results
    this.displayConfluenceResults();
  }

  async loadCachedPagesDropdown() {
    try {
      const pages = await this.service.loadAllCachedPages();
      // Store pages in search state for the unified search input
      this.pageSearchState.cachedPages = pages;
    } catch (error) {
      console.error("Failed to load cached pages:", error);
      this.pageSearchState.cachedPages = [];
    }
  }

  async loadCachedPage(pageId) {
    try {
      const cached = await this.service.loadConfluenceCache(pageId);
      if (!cached) {
        this.showConfluenceError("Cached page not found");
        return;
      }

      this.currentConfluencePageId = pageId;
      this.currentConfluenceTitle = cached.title;
      this.confluenceResults = cached.lockeys;
      this.hiddenKeys = cached.hiddenKeys || [];

      // Update input field with page title and enable buttons
      this.els.confluencePageInput.value = cached.title || "";
      this.els.btnRefreshPage.disabled = false;
      this.els.btnDeleteCache.disabled = false;

      UsageTracker.trackEvent("master_lockey", "confluence_load_cached", {
        pageId,
        lockeyCount: cached.lockeys?.length || 0,
      });

      this.displayConfluenceResults();
    } catch (error) {
      console.error("Failed to load cached page:", error);
      this.showConfluenceError(error.message);
    }
  }

  async fetchFromConfluence(pageIdOverride = null, isRefresh = false) {
    const pageIdOrUrl = pageIdOverride || this.els.confluencePageInput.value.trim();
    if (!pageIdOrUrl) return;

    // Show loading
    this.els.btnFetchConfluence.classList.add("loading");
    this.els.btnFetchConfluence.querySelector(".btn-spinner").style.display = "inline";
    this.els.btnFetchConfluence.disabled = true;
    this.hideConfluenceError();
    this.els.confluenceResults.style.display = "none";

    try {
      UsageTracker.trackEvent("master_lockey", "confluence_fetch", { pageIdOrUrl, isRefresh });

      // Fetch page content (returns { id, title, html })
      const pageData = await this.service.fetchConfluencePage(pageIdOrUrl);

      // Parse table for lockeys
      const lockeys = this.service.parseConfluenceTableForLockeys(pageData.html);

      if (lockeys.length === 0) {
        this.showConfluenceError(
          "No lockey table found on this page. Make sure the table has a column named 'Localization Key', 'Lockey', or 'Loc Key'."
        );
        return;
      }

      // Compare with remote data
      const comparedLockeys = this.service.compareLockeyWithRemote(lockeys, this.parsedData);

      // Format title
      const formattedTitle = this.service.formatPageTitle(pageData.title);

      // Save to cache (preserves hidden keys on refresh)
      await this.service.saveConfluenceCache(pageData.id, formattedTitle, comparedLockeys);

      // Update state
      this.currentConfluencePageId = pageData.id;
      this.currentConfluenceTitle = formattedTitle;
      this.confluenceResults = comparedLockeys;

      // Load hidden keys from cache
      const cached = await this.service.loadConfluenceCache(pageData.id);
      this.hiddenKeys = cached?.hiddenKeys || [];

      // Display results
      this.displayConfluenceResults();

      // Refresh cached pages list and update input to show page title
      await this.loadCachedPagesDropdown();
      this.els.confluencePageInput.value = formattedTitle;
      this.els.btnRefreshPage.disabled = false;
      this.els.btnDeleteCache.disabled = false;
      this.els.btnFetchConfluence.disabled = true;
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
      // Note: Don't re-enable button here - it's handled in try/catch blocks appropriately
    }
  }

  displayConfluenceResults() {
    if (!this.confluenceResults) return;

    const hiddenKeys = this.hiddenKeys || [];
    const visibleResults = this.confluenceResults.filter((r) => !hiddenKeys.includes(r.key));
    const hiddenResults = this.confluenceResults.filter((r) => hiddenKeys.includes(r.key));

    // Count active vs striked
    const activeCount = visibleResults.filter((r) => r.status === "plain").length;
    const strikedCount = visibleResults.filter((r) => r.status === "striked").length;
    const totalCount = visibleResults.length;

    // Update EN/ID headers with domain name
    const domainSuffix = this.currentDomain ? ` - ${this.currentDomain}` : "";
    this.els.confluenceEnHeader.textContent = `EN${domainSuffix}`;
    this.els.confluenceIdHeader.textContent = `ID${domainSuffix}`;

    // Update count format: "22 lockeys: 16 active lockeys, and 6 striked lockeys (colored red below) on the screen"
    let countText = `${totalCount} lockey${totalCount !== 1 ? "s" : ""}: `;
    countText += `${activeCount} active lockey${activeCount !== 1 ? "s" : ""}`;
    if (strikedCount > 0) {
      countText += `, and ${strikedCount} striked lockey${strikedCount !== 1 ? "s" : ""} (colored red below) on the screen`;
    }
    if (hiddenResults.length > 0) {
      countText += ` (${hiddenResults.length} hidden)`;
    }
    this.els.confluenceResultsCount.textContent = countText;

    // Build a map of remote lockey data for EN/ID lookup
    const remoteKeyMap = new Map();
    if (this.parsedData?.rows) {
      this.parsedData.rows.forEach((row) => {
        remoteKeyMap.set(row.key, row);
      });
    }

    // Clear and populate table
    this.els.confluenceTableBody.innerHTML = "";

    visibleResults.forEach((item) => {
      const tr = document.createElement("tr");
      const remoteData = remoteKeyMap.get(item.key);

      // Lockey cell
      const keyCell = document.createElement("td");
      keyCell.textContent = item.key;
      keyCell.className = `status-${item.status}`;
      tr.appendChild(keyCell);

      // EN cell
      const enCell = document.createElement("td");
      enCell.textContent = remoteData?.en || "-";
      enCell.className = `status-${item.status}`;
      enCell.title = remoteData?.en || "";
      tr.appendChild(enCell);

      // ID cell
      const idCell = document.createElement("td");
      idCell.textContent = remoteData?.id || "-";
      idCell.className = `status-${item.status}`;
      idCell.title = remoteData?.id || "";
      tr.appendChild(idCell);

      // Action cell (center aligned, minimal width)
      const actionCell = document.createElement("td");
      actionCell.className = "col-center col-action";
      const hideBtn = document.createElement("button");
      hideBtn.className = "btn-hide";
      hideBtn.textContent = "Hide Row";
      hideBtn.addEventListener("click", () => this.hideKey(item.key));
      actionCell.appendChild(hideBtn);
      tr.appendChild(actionCell);

      this.els.confluenceTableBody.appendChild(tr);
    });

    // Update hidden keys section
    this.displayHiddenKeys(hiddenResults);

    // Show results
    this.els.confluenceResults.style.display = "block";
  }

  displayHiddenKeys(hiddenResults) {
    if (hiddenResults.length === 0) {
      this.els.hiddenKeysSection.style.display = "none";
      return;
    }

    this.els.hiddenKeysSection.style.display = "block";
    this.els.hiddenKeysCount.textContent = hiddenResults.length;
    this.els.hiddenKeysBody.innerHTML = "";

    hiddenResults.forEach((item) => {
      const tr = document.createElement("tr");

      // Lockey cell
      const keyCell = document.createElement("td");
      keyCell.textContent = item.key;
      tr.appendChild(keyCell);

      // Action cell
      const actionCell = document.createElement("td");
      const unhideBtn = document.createElement("button");
      unhideBtn.className = "btn-unhide";
      unhideBtn.textContent = "Unhide";
      unhideBtn.addEventListener("click", () => this.unhideKey(item.key));
      actionCell.appendChild(unhideBtn);
      tr.appendChild(actionCell);

      this.els.hiddenKeysBody.appendChild(tr);
    });
  }

  async hideKey(key) {
    if (!this.currentConfluencePageId) return;

    try {
      await this.service.hideKey(this.currentConfluencePageId, key);
      this.hiddenKeys.push(key);
      this.displayConfluenceResults();
    } catch (error) {
      console.error("Failed to hide key:", error);
    }
  }

  async unhideKey(key) {
    if (!this.currentConfluencePageId) return;

    try {
      await this.service.unhideKey(this.currentConfluencePageId, key);
      this.hiddenKeys = this.hiddenKeys.filter((k) => k !== key);
      this.displayConfluenceResults();
    } catch (error) {
      console.error("Failed to unhide key:", error);
    }
  }

  async deleteCurrentCache() {
    if (!this.currentConfluencePageId) return;

    try {
      await this.service.deleteConfluenceCache(this.currentConfluencePageId);

      // Reset state
      this.currentConfluencePageId = null;
      this.currentConfluenceTitle = null;
      this.confluenceResults = null;
      this.hiddenKeys = [];

      // Clear UI
      this.els.confluenceResults.style.display = "none";
      this.els.confluencePageInput.value = "";
      this.els.btnRefreshPage.disabled = true;
      this.els.btnDeleteCache.disabled = true;
      this.els.btnFetchConfluence.disabled = true;

      // Refresh cached pages list
      await this.loadCachedPagesDropdown();

      this.showSuccess("Cache deleted");
    } catch (error) {
      console.error("Failed to delete cache:", error);
      this.showError("Delete Failed", error.message);
    }
  }

  showConfluenceError(message) {
    this.els.confluenceError.textContent = message;
    this.els.confluenceError.style.display = "block";
  }

  hideConfluenceError() {
    this.els.confluenceError.style.display = "none";
  }

  /**
   * Copy only lockey column to clipboard
   */
  copyLockeyColumn() {
    if (!this.confluenceResults || this.confluenceResults.length === 0) return;

    const hiddenKeys = this.hiddenKeys || [];
    const visibleResults = this.confluenceResults.filter((r) => !hiddenKeys.includes(r.key));

    // Just the lockey keys, one per line
    const content = visibleResults.map((r) => r.key).join("\n");

    navigator.clipboard
      .writeText(content)
      .then(() => {
        this.showSuccess(`Copied ${visibleResults.length} lockeys`);
        UsageTracker.trackEvent("master_lockey", "confluence_copy_lockey", {
          rowCount: visibleResults.length,
        });
      })
      .catch((err) => {
        console.error("Copy failed:", err);
        this.showError("Copy Failed", "Unable to copy to clipboard");
      });
  }

  /**
   * Copy full table as TSV for Excel paste
   */
  copyTableAsTsv() {
    if (!this.confluenceResults || this.confluenceResults.length === 0) return;

    const hiddenKeys = this.hiddenKeys || [];
    const visibleResults = this.confluenceResults.filter((r) => !hiddenKeys.includes(r.key));

    // Build remote key map for EN/ID
    const remoteKeyMap = new Map();
    if (this.parsedData?.rows) {
      this.parsedData.rows.forEach((row) => {
        remoteKeyMap.set(row.key, row);
      });
    }

    const domainName = this.currentDomain || "In Remote";
    const styleLabels = { plain: "Plain", striked: "Striked" };

    // Header row
    const header = ["Lockey", "EN", "ID", "Conflu Style", domainName].join("\t");

    // Data rows
    const rows = visibleResults.map((item) => {
      const remoteData = remoteKeyMap.get(item.key);
      return [
        item.key,
        remoteData?.en || "-",
        remoteData?.id || "-",
        styleLabels[item.status] || item.status,
        item.inRemote ? "Yes" : "No",
      ].join("\t");
    });

    const content = [header, ...rows].join("\n");

    navigator.clipboard
      .writeText(content)
      .then(() => {
        this.showSuccess(`Copied ${visibleResults.length} rows to clipboard`);
        UsageTracker.trackEvent("master_lockey", "confluence_copy_table", {
          rowCount: visibleResults.length,
        });
      })
      .catch((err) => {
        console.error("Copy failed:", err);
        this.showError("Copy Failed", "Unable to copy to clipboard");
      });
  }

  // =====================
  // Bulk Search Feature
  // =====================

  setupBulkSearchListeners() {
    // Input change handler - enable search button when input has content
    this.els.bulkSearchInput.addEventListener("input", () => {
      const hasInput = this.els.bulkSearchInput.value.trim().length > 0;
      const hasData = this.parsedData && this.parsedData.rows && this.parsedData.rows.length > 0;
      this.els.btnBulkSearch.disabled = !hasInput || !hasData;
    });

    // Search button click
    this.els.btnBulkSearch.addEventListener("click", () => {
      this.performBulkSearch();
    });

    // Clear button click
    this.els.btnClearBulk.addEventListener("click", () => {
      this.els.bulkSearchInput.value = "";
      this.els.bulkSearchResults.style.display = "none";
      this.els.btnBulkSearch.disabled = true;
    });

    // Paste button click
    this.els.btnPasteBulk.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        this.els.bulkSearchInput.value = text;
        // Update search button state
        const hasData = this.parsedData && this.parsedData.rows && this.parsedData.rows.length > 0;
        this.els.btnBulkSearch.disabled = !text.trim() || !hasData;
      } catch (err) {
        console.error("Paste failed:", err);
        this.showError("Paste Failed", "Unable to read from clipboard");
      }
    });

    // Copy lockey only button click
    this.els.btnCopyBulkLockey.addEventListener("click", () => {
      this.copyBulkLockeyOnly();
    });

    // Copy results button click
    this.els.btnCopyBulkResults.addEventListener("click", () => {
      this.copyBulkResults();
    });

    // Filter change
    this.els.bulkSearchFilter.addEventListener("change", () => {
      if (this.bulkSearchResults) {
        this.displayBulkSearchResults(this.bulkSearchResults);
      }
    });

    // Allow Enter+Ctrl/Cmd to trigger search
    this.els.bulkSearchInput.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !this.els.btnBulkSearch.disabled) {
        this.performBulkSearch();
      }
    });
  }

  updateBulkSearchState() {
    const hasData = this.parsedData && this.parsedData.rows && this.parsedData.rows.length > 0;

    if (hasData) {
      this.els.bulkSearchNoData.style.display = "none";
      this.els.bulkSearchInput.disabled = false;

      // Check if input has content and enable search button
      const hasInput = this.els.bulkSearchInput.value.trim().length > 0;
      this.els.btnBulkSearch.disabled = !hasInput;
    } else {
      this.els.bulkSearchNoData.style.display = "block";
      this.els.bulkSearchInput.disabled = true;
      this.els.btnBulkSearch.disabled = true;
      this.els.bulkSearchResults.style.display = "none";
    }
  }

  performBulkSearch() {
    const input = this.els.bulkSearchInput.value.trim();
    if (!input || !this.parsedData) return;

    // Parse input - split by newlines, trim each line, filter empty lines
    const keys = input
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (keys.length === 0) return;

    // Build a Map of all remote keys for O(1) lookup with content
    const remoteKeyMap = new Map();
    this.parsedData.rows.forEach((row) => {
      remoteKeyMap.set(row.key, row);
    });

    // Check each key against remote data and get content
    const results = keys.map((key) => {
      const remoteData = remoteKeyMap.get(key);
      return {
        key,
        exists: !!remoteData,
        en: remoteData?.en || "-",
        id: remoteData?.id || "-",
      };
    });

    // Store results for copy functionality
    this.bulkSearchResults = results;

    // Track usage
    UsageTracker.trackEvent("master_lockey", "bulk_search", {
      inputCount: keys.length,
      foundCount: results.filter((r) => r.exists).length,
      domain: this.currentDomain,
    });

    // Display results
    this.displayBulkSearchResults(results);
  }

  displayBulkSearchResults(results) {
    // Get filter value
    const filter = this.els.bulkSearchFilter.value;

    // Apply filter
    let filteredResults = results;
    if (filter === "found") {
      filteredResults = results.filter((r) => r.exists);
    } else if (filter === "not-found") {
      filteredResults = results.filter((r) => !r.exists);
    }

    // Update count (show filtered vs total)
    const foundCount = results.filter((r) => r.exists).length;
    const notFoundCount = results.length - foundCount;
    let countText = `${results.length} lockey${results.length !== 1 ? "s" : ""}: ${foundCount} found, ${notFoundCount} not found`;
    if (filter !== "all") {
      countText += ` (showing ${filteredResults.length})`;
    }
    this.els.bulkSearchResultsCount.textContent = countText;

    // Update EN/ID headers with domain name
    const domainSuffix = this.currentDomain ? ` - ${this.currentDomain}` : "";
    this.els.bulkSearchEnHeader.textContent = `EN${domainSuffix}`;
    this.els.bulkSearchIdHeader.textContent = `ID${domainSuffix}`;

    // Clear and populate table
    this.els.bulkSearchTableBody.innerHTML = "";

    filteredResults.forEach((item) => {
      const tr = document.createElement("tr");

      // Add class for not-found rows
      if (!item.exists) {
        tr.className = "row-not-found";
      }

      // Lockey cell
      const keyCell = document.createElement("td");
      keyCell.textContent = item.key;
      tr.appendChild(keyCell);

      // EN cell
      const enCell = document.createElement("td");
      enCell.textContent = item.en;
      enCell.title = item.en;
      tr.appendChild(enCell);

      // ID cell
      const idCell = document.createElement("td");
      idCell.textContent = item.id;
      idCell.title = item.id;
      tr.appendChild(idCell);

      this.els.bulkSearchTableBody.appendChild(tr);
    });

    // Show results
    this.els.bulkSearchResults.style.display = "block";
  }

  copyBulkResults() {
    if (!this.bulkSearchResults || this.bulkSearchResults.length === 0) return;

    // Apply current filter
    const filter = this.els.bulkSearchFilter.value;
    let filteredResults = this.bulkSearchResults;
    if (filter === "found") {
      filteredResults = this.bulkSearchResults.filter((r) => r.exists);
    } else if (filter === "not-found") {
      filteredResults = this.bulkSearchResults.filter((r) => !r.exists);
    }

    if (filteredResults.length === 0) return;

    // Format as TSV: Lockey\tEN\tID
    const domainSuffix = this.currentDomain ? ` - ${this.currentDomain}` : "";
    const header = `Lockey\tEN${domainSuffix}\tID${domainSuffix}`;
    const rows = filteredResults.map((r) => `${r.key}\t${r.en}\t${r.id}`);
    const content = [header, ...rows].join("\n");

    navigator.clipboard
      .writeText(content)
      .then(() => {
        this.showSuccess(`Copied ${filteredResults.length} results to clipboard`);
        UsageTracker.trackEvent("master_lockey", "bulk_search_copy", {
          rowCount: filteredResults.length,
        });
      })
      .catch((err) => {
        console.error("Copy failed:", err);
        this.showError("Copy Failed", "Unable to copy to clipboard");
      });
  }

  copyBulkLockeyOnly() {
    if (!this.bulkSearchResults || this.bulkSearchResults.length === 0) return;

    // Apply current filter
    const filter = this.els.bulkSearchFilter.value;
    let filteredResults = this.bulkSearchResults;
    if (filter === "found") {
      filteredResults = this.bulkSearchResults.filter((r) => r.exists);
    } else if (filter === "not-found") {
      filteredResults = this.bulkSearchResults.filter((r) => !r.exists);
    }

    if (filteredResults.length === 0) return;

    // Just the lockey keys, one per line
    const content = filteredResults.map((r) => r.key).join("\n");

    navigator.clipboard
      .writeText(content)
      .then(() => {
        this.showSuccess(`Copied ${filteredResults.length} lockeys to clipboard`);
        UsageTracker.trackEvent("master_lockey", "bulk_search_copy_lockey", {
          rowCount: filteredResults.length,
        });
      })
      .catch((err) => {
        console.error("Copy failed:", err);
        this.showError("Copy Failed", "Unable to copy to clipboard");
      });
  }

  // ================================
  // Bulk Confluence Search Methods
  // ================================

  async performBulkConfluenceSearch() {
    const inputValue = this.els.bulkConfluenceInput.value.trim();
    if (!inputValue) return;

    // Parse URLs/page IDs (one per line)
    const pageInputs = inputValue
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (pageInputs.length === 0) return;

    // Show loading
    this.els.btnBulkConfluenceSearch.classList.add("loading");
    this.els.btnBulkConfluenceSearch.querySelector(".btn-spinner").style.display = "inline";
    this.els.btnBulkConfluenceSearch.disabled = true;
    this.els.bulkConfluenceError.style.display = "none";
    this.els.bulkConfluenceResults.style.display = "none";

    UsageTracker.trackEvent("master_lockey", "bulk_confluence_search", {
      pageCount: pageInputs.length,
    });

    const results = [];

    // Fetch each page sequentially (to avoid overwhelming the server)
    for (const pageInput of pageInputs) {
      try {
        // Fetch page content
        const pageData = await this.service.fetchConfluencePage(pageInput);

        // Parse table for lockeys
        const lockeys = this.service.parseConfluenceTableForLockeys(pageData.html);

        // Compare with remote data
        const comparedLockeys = this.service.compareLockeyWithRemote(lockeys, this.parsedData);

        // Format title
        const formattedTitle = this.service.formatPageTitle(pageData.title);

        results.push({
          screenName: formattedTitle,
          pageId: pageData.id,
          pageUrl: pageInput, // Store the original URL for hyperlinks
          lockeys: comparedLockeys,
          error: null,
        });
      } catch (error) {
        // Store error for this page
        results.push({
          screenName: pageInput.substring(0, 50) + (pageInput.length > 50 ? "..." : ""),
          pageId: null,
          pageUrl: pageInput,
          lockeys: [],
          error: error.message,
        });
      }
    }

    // Hide loading
    this.els.btnBulkConfluenceSearch.classList.remove("loading");
    this.els.btnBulkConfluenceSearch.querySelector(".btn-spinner").style.display = "none";
    this.els.btnBulkConfluenceSearch.disabled = false;

    // Store results
    this.bulkConfluenceResults = results;

    // Display results
    this.displayBulkConfluenceResults(results);
  }

  displayBulkConfluenceResults(results) {
    if (!results || results.length === 0) return;

    // Calculate totals
    let totalLockeys = 0;
    let totalActive = 0;
    let totalStriked = 0;
    let successfulPages = 0;
    let failedPages = 0;

    results.forEach((result) => {
      if (result.error) {
        failedPages++;
      } else {
        successfulPages++;
        totalLockeys += result.lockeys.length;
        totalActive += result.lockeys.filter((l) => l.status === "plain").length;
        totalStriked += result.lockeys.filter((l) => l.status === "striked").length;
      }
    });

    // Update count label
    let countText = `${successfulPages} page${successfulPages !== 1 ? "s" : ""} fetched`;
    if (failedPages > 0) {
      countText += `, ${failedPages} failed`;
    }
    countText += ` • ${totalLockeys} lockey${totalLockeys !== 1 ? "s" : ""} (${totalActive} active`;
    if (totalStriked > 0) {
      countText += `, ${totalStriked} striked`;
    }
    countText += ")";
    this.els.bulkConfluenceResultsCount.textContent = countText;

    // Update EN/ID headers with domain name
    const domainSuffix = this.currentDomain ? ` - ${this.currentDomain}` : "";
    this.els.bulkConfluenceEnHeader.textContent = `EN${domainSuffix}`;
    this.els.bulkConfluenceIdHeader.textContent = `ID${domainSuffix}`;

    // Build a map of remote lockey data for EN/ID lookup
    const remoteKeyMap = new Map();
    if (this.parsedData?.rows) {
      this.parsedData.rows.forEach((row) => {
        remoteKeyMap.set(row.key, row);
      });
    }

    // Build table body - simple flat table with Screen column always visible
    const tbody = this.els.bulkConfluenceTableBody;
    tbody.innerHTML = "";

    results.forEach((result) => {
      if (result.error) {
        // Skip error pages - just don't show their rows
        return;
      }

      // Data rows for this screen
      result.lockeys.forEach((lockey) => {
        const tr = document.createElement("tr");
        tr.className = lockey.status === "striked" ? "status-striked" : "";

        // Screen column with hyperlink
        const screenTd = document.createElement("td");
        screenTd.className = "col-screen-name";

        const screenLink = document.createElement("a");
        screenLink.href = result.pageUrl;
        screenLink.target = "_blank";
        screenLink.rel = "noopener noreferrer";
        screenLink.textContent = result.screenName;
        screenLink.title = result.screenName;
        screenTd.appendChild(screenLink);
        tr.appendChild(screenTd);

        // Lockey column
        const lockeyTd = document.createElement("td");
        lockeyTd.textContent = lockey.key;
        lockeyTd.title = lockey.key;
        tr.appendChild(lockeyTd);

        // Lookup EN/ID from remote data
        const remoteRow = remoteKeyMap.get(lockey.key);
        const enValue = remoteRow?.en || "";
        const idValue = remoteRow?.id || "";

        // EN column
        const enTd = document.createElement("td");
        enTd.textContent = enValue;
        enTd.title = enValue;
        tr.appendChild(enTd);

        // ID column
        const idTd = document.createElement("td");
        idTd.textContent = idValue;
        idTd.title = idValue;
        tr.appendChild(idTd);

        tbody.appendChild(tr);
      });
    });

    // Show results
    this.els.bulkConfluenceResults.style.display = "block";
  }

  copyBulkConfluenceLockey() {
    if (!this.bulkConfluenceResults || this.bulkConfluenceResults.length === 0) return;

    // Collect all lockeys from all successful results
    const lockeys = [];
    this.bulkConfluenceResults.forEach((result) => {
      if (!result.error && result.lockeys) {
        result.lockeys.forEach((l) => lockeys.push(l.key));
      }
    });

    if (lockeys.length === 0) return;

    const content = lockeys.join("\n");

    navigator.clipboard
      .writeText(content)
      .then(() => {
        this.showSuccess(`Copied ${lockeys.length} lockeys to clipboard`);
        UsageTracker.trackEvent("master_lockey", "bulk_confluence_copy_lockey", {
          rowCount: lockeys.length,
        });
      })
      .catch((err) => {
        console.error("Copy failed:", err);
        this.showError("Copy Failed", "Unable to copy to clipboard");
      });
  }

  copyBulkConfluenceTable() {
    if (!this.bulkConfluenceResults || this.bulkConfluenceResults.length === 0) return;

    // Build a map of remote lockey data for EN/ID lookup
    const remoteKeyMap = new Map();
    if (this.parsedData?.rows) {
      this.parsedData.rows.forEach((row) => {
        remoteKeyMap.set(row.key, row);
      });
    }

    const domainSuffix = this.currentDomain ? ` - ${this.currentDomain}` : "";

    // Build both HTML and plain text versions
    const plainRows = [];
    let htmlRows = [];

    // Headers
    plainRows.push(["Screen", "Lockey", `EN${domainSuffix}`, `ID${domainSuffix}`].join("\t"));
    htmlRows.push(`<tr><th>Screen</th><th>Lockey</th><th>EN${domainSuffix}</th><th>ID${domainSuffix}</th></tr>`);

    // Data rows
    this.bulkConfluenceResults.forEach((result) => {
      if (!result.error && result.lockeys) {
        result.lockeys.forEach((lockey) => {
          const remoteRow = remoteKeyMap.get(lockey.key);
          const enValue = remoteRow?.en || "";
          const idValue = remoteRow?.id || "";

          // Plain text version
          plainRows.push([result.screenName, lockey.key, enValue, idValue].join("\t"));

          // HTML version with hyperlink and lockey styling
          const escapedUrl = result.pageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          const escapedName = result.screenName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const escapedLockey = lockey.key.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const escapedEn = enValue.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const escapedId = idValue.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

          // Style lockey based on status: red + strikethrough for striked, black for active
          const lockeyStyle =
            lockey.status === "striked" ? 'style="color: #ef4444; text-decoration: line-through;"' : 'style="color: #000000;"';

          htmlRows.push(
            `<tr><td><a href="${escapedUrl}" style="color: #3b82f6; text-decoration: underline;">${escapedName}</a></td><td ${lockeyStyle}>${escapedLockey}</td><td>${escapedEn}</td><td>${escapedId}</td></tr>`
          );
        });
      }
    });

    if (plainRows.length <= 1) return; // Only header, no data

    const plainText = plainRows.join("\n");
    const htmlContent = `<table>${htmlRows.join("")}</table>`;

    // Use ClipboardItem to write both HTML and plain text
    const dataRowCount = plainRows.length - 1;

    try {
      const clipboardItem = new ClipboardItem({
        "text/html": new Blob([htmlContent], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      });

      navigator.clipboard
        .write([clipboardItem])
        .then(() => {
          this.showSuccess(`Copied ${dataRowCount} results to clipboard (with hyperlinks)`);
          UsageTracker.trackEvent("master_lockey", "bulk_confluence_copy_table", {
            rowCount: dataRowCount,
            format: "html",
          });
        })
        .catch((err) => {
          console.error("HTML clipboard failed, falling back to plain text:", err);
          // Fallback to plain text
          navigator.clipboard
            .writeText(plainText)
            .then(() => {
              this.showSuccess(`Copied ${dataRowCount} results to clipboard`);
            })
            .catch((err2) => {
              console.error("Copy failed:", err2);
              this.showError("Copy Failed", "Unable to copy to clipboard");
            });
        });
    } catch (err) {
      // ClipboardItem not supported, fallback to plain text
      console.warn("ClipboardItem not supported, using plain text:", err);
      navigator.clipboard
        .writeText(plainText)
        .then(() => {
          this.showSuccess(`Copied ${dataRowCount} results to clipboard`);
          UsageTracker.trackEvent("master_lockey", "bulk_confluence_copy_table", {
            rowCount: dataRowCount,
            format: "plain",
          });
        })
        .catch((err2) => {
          console.error("Copy failed:", err2);
          this.showError("Copy Failed", "Unable to copy to clipboard");
        });
    }
  }
}

export { MasterLockey };
