import { JSONToolsService } from "./service.js";
import { JSONToolsTemplate } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { isTauri } from "../../core/Runtime.js";

class JSONTools extends BaseTool {
  constructor(eventBus) {
    super({
      id: "json-tools",
      name: "JSON Tools",
      description: "JSON Tools for validation, formatting, and manipulation",
      icon: "json",
      category: "application",
      eventBus: eventBus,
    });
    this.editor = null;
    this.outputEditor = null;
    this.currentTab = "validator";
    this.isErrorPanelCollapsed = false;
    this.validatedJson = null; // Store validated JSON for table operations
    this.isTransposed = false; // Track transpose state
    this.isExpanded = false; // Track expand state
    this.keySortOrder = "natural"; // natural, asc, desc
    // Search state
    this.searchMatches = [];
    this.currentMatchIndex = -1;
    this.isSearchOpen = false;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return JSONToolsTemplate;
  }

  async onMount() {
    await this.initializeMonacoEditor();
    this.bindToolEvents();
    this.setupTabs();
    // this.processCurrentTab();
  }

  async initializeMonacoEditor() {
    // Configure Monaco workers for Vite ESM builds
    self.MonacoEnvironment = {
      getWorker(_, label) {
        switch (label) {
          case "json":
            return new jsonWorker();
          case "css":
            return new cssWorker();
          case "html":
            return new htmlWorker();
          case "typescript":
          case "javascript":
            return new tsWorker();
          default:
            return new editorWorker();
        }
      },
    };

    // Create Monaco Editor instance via ESM import (left/input)
    this.editor = monaco.editor.create(document.getElementById("json-editor"), {
      value: "",
      language: "json",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      insertSpaces: true,
      suggestOnTriggerCharacters: false,
    });

    // Create Monaco Editor for the right/output panel (editable)
    this.outputEditor = monaco.editor.create(document.getElementById("json-output"), {
      value: "",
      language: "json",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      insertSpaces: true,
      suggestOnTriggerCharacters: false,
    });

    // Load saved content from localStorage
    try {
      const key = "tool:json-tools:editor";
      this._jsonStorageKey = key;
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        this.editor.setValue(saved);
      }
    } catch (_) {}

    // Persist content changes with a light debounce
    this._persistTimer = null;
    this.editor.onDidChangeModelContent(() => {
      clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => {
        try {
          localStorage.setItem(this._jsonStorageKey || "tool:json-tools:editor", this.editor.getValue());
        } catch (_) {}
      }, 300);
    });
  }

  bindToolEvents() {
    // Tab switching
    document.querySelectorAll(".json-tools-tabs .tab-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Action buttons
    document.querySelector(".btn-action-primary").addEventListener("click", () => {
      this.clearErrors();
      this.processCurrentTab();
    });

    document.querySelector(".btn-clear").addEventListener("click", () => {
      this.editor.setValue("");
      try {
        localStorage.setItem(this._jsonStorageKey || "tool:json-tools:editor", "");
      } catch (_) {}
      this.clearOutput();
      this.clearErrors();
    });

    document.querySelector(".btn-copy-input").addEventListener("click", () => {
      this.clearErrors();
      this.copyToClipboard(this.editor.getValue());
    });

    document.querySelector(".btn-paste").addEventListener("click", () => {
      this.clearErrors();
      this.pasteFromClipboard();
    });

    document.querySelector(".btn-copy-output").addEventListener("click", () => {
      this.clearErrors();
      if (this.currentTab === "json-to-table") {
        // Extract table as HTML for Excel compatibility (preserves nested tables)
        const html = this.extractTableAsHTML();
        if (html) {
          this.copyHTMLToClipboard(html);
        }
      } else {
        const output = this.outputEditor ? this.outputEditor.getValue() : "";
        this.copyToClipboard(output);
      }
    });

    // Export to Excel button
    document.querySelector(".btn-export-excel").addEventListener("click", () => {
      this.clearErrors();
      this.exportToExcel();
    });

    // Extract keys options
    document.querySelectorAll('input[name="extract-type"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (this.currentTab === "extract-keys") {
          this.clearErrors();
          this.processCurrentTab();
        }
      });
    });

    // Sort order options
    document.querySelectorAll('input[name="sort-order"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (this.currentTab === "extract-keys") {
          this.clearErrors();
          this.processCurrentTab();
        }
      });
    });

    // Transpose table button
    const transposeBtn = document.querySelector(".btn-transpose-table");
    if (transposeBtn) {
      transposeBtn.addEventListener("click", () => {
        this.transposeTable();
      });
    }

    // Expand table button
    const expandBtn = document.querySelector(".btn-expand-table");
    if (expandBtn) {
      expandBtn.addEventListener("click", () => {
        this.toggleExpandTable();
      });
    }

    // Search input
    const searchInput = document.querySelector(".table-search-input");
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.searchTable(e.target.value);
        }, 150);
      });
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.shiftKey) {
            this.navigateSearch(-1);
          } else {
            this.navigateSearch(1);
          }
        }
      });
    }

    // Search navigation buttons
    const prevBtn = document.querySelector(".btn-search-prev");
    const nextBtn = document.querySelector(".btn-search-next");
    if (prevBtn) prevBtn.addEventListener("click", () => this.navigateSearch(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => this.navigateSearch(1));

    // Toggle search button
    const toggleSearchBtn = document.querySelector(".btn-toggle-search");
    if (toggleSearchBtn) {
      toggleSearchBtn.addEventListener("click", () => {
        this.toggleSearch();
      });
    }

    // Toggle extract options dropdown
    const toggleExtractBtn = document.querySelector(".btn-toggle-extract-options");
    if (toggleExtractBtn) {
      toggleExtractBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleExtractOptions();
      });
      // Close dropdown when clicking outside
      document.addEventListener("click", () => {
        const menu = document.querySelector(".extract-options-menu");
        if (menu) menu.style.display = "none";
      });
    }
  }

  setupTabs() {
    // Restore last selected tab from localStorage
    const savedTab = localStorage.getItem("json-tools-tab") || "prettify";
    this.switchTab(savedTab);
  }

  switchTab(tabName) {
    const previousTab = this.currentTab;
    document.querySelectorAll(".json-tools-tabs .tab-button").forEach((btn) => {
      btn.classList.remove("active");
    });
    document.querySelector(`.json-tools-tabs [data-tab="${tabName}"]`).classList.add("active");

    // Update current tab and save to localStorage
    this.currentTab = tabName;
    localStorage.setItem("json-tools-tab", tabName);

    // Track tab switch for workflow analysis
    if (previousTab !== tabName) {
      UsageTracker.trackEvent("json-tools", "tab_switch", {
        from_tab: previousTab,
        to_tab: tabName,
      });
    }

    // Update action button text
    const actionButton = document.querySelector(".btn-action-primary");
    const buttonTexts = {
      prettify: "Beautify",
      minify: "Minify",
      stringify: "Stringify",
      unstringify: "Unstringify",
      escape: "Escape",
      unescape: "Unescape",
      "extract-keys": "Extract Keys",
      "json-to-table": "Convert to Table",
    };
    actionButton.textContent = buttonTexts[tabName] || "Action";

    // Show/hide extract options panel
    const extractOptions = document.getElementById("extract-options");
    if (tabName === "extract-keys") {
      extractOptions.style.display = "inline-flex";
    } else {
      extractOptions.style.display = "none";
      // Also hide the menu
      const menu = document.querySelector(".extract-options-menu");
      if (menu) menu.style.display = "none";
    }

    // Update output title
    const outputTitle = document.getElementById("output-title");
    const titles = {
      prettify: "Formatted JSON",
      minify: "Minified JSON",
      stringify: "Stringified JSON",
      unstringify: "Parsed JSON",
      escape: "Escaped JSON",
      unescape: "Unescaped JSON",
      "extract-keys": "Extracted Keys",
      "json-to-table": "Table View",
    };
    outputTitle.textContent = titles[tabName] || "Output";

    // Toggle between Monaco editor and table output
    const jsonOutput = document.getElementById("json-output");
    const tableOutput = document.getElementById("json-table-output");
    const tableOptions = document.getElementById("table-options");
    const transposeBtn = document.querySelector(".btn-transpose-table");
    const expandBtn = document.querySelector(".btn-expand-table");
    const inputSection = document.querySelector(".json-editor-section");
    const outputSection = document.querySelector(".json-output-section");

    // Reset expand state when switching tabs
    if (this.isExpanded) {
      this.isExpanded = false;
      if (inputSection) inputSection.style.display = "flex";
      if (outputSection) outputSection.classList.remove("expanded");
      if (expandBtn) expandBtn.textContent = "Expand";
    }

    if (tabName === "json-to-table") {
      jsonOutput.style.display = "none";
      tableOutput.style.display = "block";
      if (transposeBtn) transposeBtn.style.display = "inline-flex";
      if (expandBtn) expandBtn.style.display = "inline-flex";
      // Show search toggle button and export button
      const searchToggleBtn = document.querySelector(".btn-toggle-search");
      if (searchToggleBtn) searchToggleBtn.style.display = "inline-flex";
      const exportExcelBtn = document.querySelector(".btn-export-excel");
      if (exportExcelBtn) exportExcelBtn.style.display = "inline-flex";
    } else {
      jsonOutput.style.display = "block";
      tableOutput.style.display = "none";
      if (transposeBtn) transposeBtn.style.display = "none";
      if (expandBtn) expandBtn.style.display = "none";
      // Hide search toggle and group
      const searchToggleBtn = document.querySelector(".btn-toggle-search");
      const searchGroup = document.querySelector(".table-search-group");
      if (searchToggleBtn) searchToggleBtn.style.display = "none";
      if (searchGroup) searchGroup.style.display = "none";
      this.isSearchOpen = false;
      // Hide export button
      const exportExcelBtn = document.querySelector(".btn-export-excel");
      if (exportExcelBtn) exportExcelBtn.style.display = "none";
    }

    // Process current content
    // this.processCurrentTab();
  }

  processCurrentTab() {
    const content = this.editor.getValue().trim();

    if (!content) {
      this.clearOutput();
      this.clearErrors();
      return;
    }

    switch (this.currentTab) {
      case "prettify":
        this.prettifyJSON();
        break;
      case "minify":
        this.minifyJSON();
        break;
      case "stringify":
        this.stringifyJSON();
        break;
      case "unstringify":
        this.unstringifyJSON();
        break;
      case "escape":
        this.escapeJSON();
        break;
      case "unescape":
        this.unescapeJSON();
        break;
      case "extract-keys":
        this.extractKeys();
        break;
      case "json-to-table":
        this.jsonToTable();
        break;
    }
  }

  prettifyJSON() {
    UsageTracker.trackFeature("json-tools", "prettify");
    const content = this.editor.getValue().trim();

    const res = JSONToolsService.prettify(content);
    if (res.error) {
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      this.showSuccess("JSON is valid ✅");
      this.outputEditor.setValue(res.result || "");
    }
  }

  minifyJSON() {
    UsageTracker.trackFeature("json-tools", "minify");
    const content = this.editor.getValue().trim();

    const res = JSONToolsService.minify(content);
    if (res.error) {
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      this.outputEditor.setValue(res.result || "");
    }
  }

  stringifyJSON() {
    UsageTracker.trackFeature("json-tools", "stringify");
    const content = this.editor.getValue().trim();

    const res = JSONToolsService.stringify(content);
    if (res.error) {
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      this.outputEditor.setValue(res.result || "");
    }
  }

  unstringifyJSON() {
    UsageTracker.trackFeature("json-tools", "unstringify");
    const content = this.editor.getValue().trim();

    const res = JSONToolsService.unstringify(content);
    if (res.error) {
      this.showError("JSON Unstringify Error", res.error.message, res.error.position);
    } else {
      this.outputEditor.setValue(res.result || "");
      this.clearErrors();
    }
  }

  escapeJSON() {
    UsageTracker.trackFeature("json-tools", "escape");
    const content = this.editor.getValue().trim();

    const res = JSONToolsService.escape(content);
    if (res.error) {
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      this.outputEditor.setValue(res.result || "");
    }
  }

  unescapeJSON() {
    UsageTracker.trackFeature("json-tools", "unescape");
    const content = this.editor.getValue().trim();

    const res = JSONToolsService.unescape(content);
    if (res.error) {
      this.showError("JSON Unescape Error", res.error.message, res.error.position);
    } else {
      this.outputEditor.setValue(res.result || "");
      this.clearErrors();
    }
  }

  extractKeys() {
    UsageTracker.trackFeature("json-tools", "extract_keys");
    const content = this.editor.getValue().trim();
    const extractType = document.querySelector('input[name="extract-type"]:checked').value;
    const sortOrder = document.querySelector('input[name="sort-order"]:checked').value;

    const res = JSONToolsService.extractKeys(content, extractType === "paths", sortOrder);
    if (res.error) {
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      this.outputEditor.setValue(res.result || "");
    }
  }

  jsonToTable() {
    UsageTracker.trackFeature("json-tools", "json_to_table");
    const content = this.editor.getValue().trim();
    const tableOutput = document.getElementById("json-table-output");

    // Validate JSON first
    try {
      this.validatedJson = JSON.parse(content);
      this.isTransposed = true; // Default to transposed view
      this.keySortOrder = "natural"; // Reset sort order on new conversion
    } catch (error) {
      this.validatedJson = null;
      UsageTracker.trackEvent("json-tools", "parse_error", UsageTracker.enrichErrorMeta(error, { action: "json_to_table" }));
      tableOutput.innerHTML = `<div class="table-error">Invalid JSON: ${error.message}</div>`;
      return;
    }

    // Render the table
    this.renderTable();
  }

  renderTable() {
    const tableOutput = document.getElementById("json-table-output");
    if (!this.validatedJson) {
      tableOutput.innerHTML = '<div class="table-error">No valid JSON to display</div>';
      return;
    }

    const res = JSONToolsService.jsonToTable(JSON.stringify(this.validatedJson), this.isTransposed, this.keySortOrder);
    if (res.error) {
      tableOutput.innerHTML = `<div class="table-error">${res.error.message}</div>`;
    } else {
      tableOutput.innerHTML = res.result || "";

      // Add click handler for Key header sort toggle (only in transposed view)
      if (this.isTransposed) {
        const keyHeader = tableOutput.querySelector(".key-header-sortable");
        if (keyHeader) {
          keyHeader.addEventListener("click", () => {
            this.cycleKeySortOrder();
          });
        }
      }
    }
  }

  cycleKeySortOrder() {
    // Cycle through: natural -> asc -> desc -> natural
    if (this.keySortOrder === "natural") {
      this.keySortOrder = "asc";
    } else if (this.keySortOrder === "asc") {
      this.keySortOrder = "desc";
    } else {
      this.keySortOrder = "natural";
    }
    this.renderTable();
  }

  transposeTable() {
    if (!this.validatedJson) {
      return; // No data to transpose
    }

    // Toggle transpose state
    this.isTransposed = !this.isTransposed;

    // Re-render table with new transpose state
    this.renderTable();
  }

  toggleExpandTable() {
    const inputSection = document.querySelector(".json-editor-section");
    const outputSection = document.querySelector(".json-output-section");
    const expandBtn = document.querySelector(".btn-expand-table");

    if (!inputSection || !outputSection) return;

    this.isExpanded = !this.isExpanded;

    if (this.isExpanded) {
      // Expand - hide input, expand output
      inputSection.style.display = "none";
      outputSection.classList.add("expanded");
      expandBtn.textContent = "Shrink";
    } else {
      // Shrink - show input, restore output
      inputSection.style.display = "flex";
      outputSection.classList.remove("expanded");
      expandBtn.textContent = "Expand";
    }
  }

  searchTable(query) {
    const tableOutput = document.getElementById("json-table-output");
    const matchCountEl = document.querySelector(".search-match-count");

    // Clear previous highlights
    tableOutput.querySelectorAll(".search-match, .search-current").forEach((el) => {
      el.classList.remove("search-match", "search-current");
    });
    this.searchMatches = [];
    this.currentMatchIndex = -1;

    if (!query || query.trim() === "") {
      if (matchCountEl) matchCountEl.textContent = "";
      return;
    }

    const lowerQuery = query.toLowerCase();

    // Find all leaf td cells (cells without nested tables inside)
    const cells = tableOutput.querySelectorAll(".json-table td");
    cells.forEach((cell) => {
      // Skip cells that contain nested tables - we'll search their children instead
      if (cell.querySelector(".nested-table")) return;

      // Skip key-index cells (row numbers)
      if (cell.classList.contains("key-index")) return;

      const text = cell.textContent.toLowerCase();
      if (text.includes(lowerQuery)) {
        cell.classList.add("search-match");
        this.searchMatches.push(cell);
      }
    });

    // Update match count
    if (matchCountEl) {
      if (this.searchMatches.length > 0) {
        this.currentMatchIndex = 0;
        this.searchMatches[0].classList.add("search-current");
        this.searchMatches[0].scrollIntoView({ behavior: "smooth", block: "center" });
        matchCountEl.textContent = `1/${this.searchMatches.length}`;
      } else {
        matchCountEl.textContent = "0 matches";
      }
    }

    // Track search for effectiveness analysis
    UsageTracker.trackEvent(
      "json-tools",
      "table_search",
      {
        query_length: query.length,
        match_count: this.searchMatches.length,
      },
      2000,
    ); // Debounce 2 seconds
  }

  navigateSearch(direction) {
    if (this.searchMatches.length === 0) return;

    // Remove current highlight
    if (this.currentMatchIndex >= 0) {
      this.searchMatches[this.currentMatchIndex].classList.remove("search-current");
    }

    // Move to next/prev
    this.currentMatchIndex += direction;
    if (this.currentMatchIndex >= this.searchMatches.length) {
      this.currentMatchIndex = 0;
    } else if (this.currentMatchIndex < 0) {
      this.currentMatchIndex = this.searchMatches.length - 1;
    }

    // Highlight new current
    const current = this.searchMatches[this.currentMatchIndex];
    current.classList.add("search-current");
    current.scrollIntoView({ behavior: "smooth", block: "center" });

    // Update counter
    const matchCountEl = document.querySelector(".search-match-count");
    if (matchCountEl) {
      matchCountEl.textContent = `${this.currentMatchIndex + 1}/${this.searchMatches.length}`;
    }
  }

  toggleSearch() {
    const searchGroup = document.querySelector(".table-search-group");
    const searchInput = document.querySelector(".table-search-input");

    this.isSearchOpen = !this.isSearchOpen;

    if (this.isSearchOpen) {
      if (searchGroup) searchGroup.style.display = "flex";
      if (searchInput) searchInput.focus();
    } else {
      if (searchGroup) searchGroup.style.display = "none";
      // Clear search when closing
      if (searchInput) searchInput.value = "";
      this.searchTable("");
    }
  }

  toggleExtractOptions() {
    const menu = document.querySelector(".extract-options-menu");
    if (menu) {
      const isVisible = menu.style.display === "flex";
      menu.style.display = isVisible ? "none" : "flex";
    }
  }

  // getAllKeys and getErrorPosition are now provided by JSONToolsService

  showError(title, message, position = null) {
    let locationText = "";
    let line = null;
    let column = null;
    if (position !== null) {
      const content = this.editor.getValue();
      const lines = content.substring(0, position).split("\n");
      line = lines.length;
      column = lines[lines.length - 1].length + 1;
      locationText = `Line ${line}, Column ${column}`;
    }

    const parts = [title, message].filter(Boolean).join(": ");
    const composed = locationText ? `${parts}\n${locationText}` : parts;
    if (this.outputEditor) this.outputEditor.setValue(composed || "");

    // Add a simple marker to the input editor to hint error position
    try {
      const model = this.editor && this.editor.getModel ? this.editor.getModel() : null;
      if (model) {
        const markers = [];
        if (line !== null && column !== null) {
          markers.push({
            severity: monaco.MarkerSeverity.Error,
            message: message || title || "Error",
            startLineNumber: line,
            startColumn: column,
            endLineNumber: line,
            endColumn: column + 1,
          });
        }
        monaco.editor.setModelMarkers(model, "json-tools", markers);
      }
    } catch (_) {}
  }

  clearErrors() {
    try {
      const model = this.editor && this.editor.getModel ? this.editor.getModel() : null;
      if (model) monaco.editor.setModelMarkers(model, "json-tools", []);
    } catch (_) {}
  }

  clearOutput() {
    if (this.outputEditor) this.outputEditor.setValue("");
  }

  /**
   * Extract table HTML for clipboard - Excel can parse HTML tables directly
   * @returns {string|null} HTML string or null if no table
   */
  extractTableAsHTML() {
    const tableOutput = document.getElementById("json-table-output");
    const table = tableOutput?.querySelector(".json-table");
    if (!table) {
      this.showError("No table to copy");
      return null;
    }
    // Return the outer HTML of the table
    return table.outerHTML;
  }

  /**
   * Extract nested table data as an object/array for JSON stringification
   */
  extractNestedTableData(table) {
    const rows = table.querySelectorAll("tr");
    const result = [];

    rows.forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      if (cells.length === 2) {
        // Key-value pair (object-like)
        const key = cells[0].textContent.trim();
        const nestedTable = cells[1].querySelector(".nested-table");
        if (nestedTable) {
          result.push({ [key]: this.extractNestedTableData(nestedTable) });
        } else {
          result.push({ [key]: cells[1].textContent.trim() });
        }
      } else if (cells.length === 1) {
        // Array element
        const nestedTable = cells[0].querySelector(".nested-table");
        if (nestedTable) {
          result.push(this.extractNestedTableData(nestedTable));
        } else {
          result.push(cells[0].textContent.trim());
        }
      }
    });

    return result.length === 1 ? result[0] : result;
  }

  /**
   * Copy HTML content to clipboard - Excel can parse HTML tables
   * Uses Tauri native clipboard API when available for full HTML support
   */
  async copyHTMLToClipboard(html) {
    console.log("[Clipboard] HTML length:", html.length, "chars");
    const inTauri = isTauri();
    console.log("[Clipboard] Tauri detected:", inTauri);

    // Check if running in Tauri environment
    if (inTauri) {
      try {
        // Dynamic import of Tauri clipboard plugin
        console.log("[Clipboard] Using Tauri writeHtml...");
        const { writeHtml } = await import("@tauri-apps/plugin-clipboard-manager");
        // writeHtml accepts HTML string and optional plain text fallback
        await writeHtml(html, this.generateTSVFromData());
        console.log("[Clipboard] Tauri writeHtml SUCCESS");
        this.showSuccess("Copied to clipboard!");
        return;
      } catch (error) {
        console.warn("[Clipboard] Tauri clipboard failed, falling back to browser API:", error);
        // Fall through to browser API
      }
    }

    // Browser API fallback (works in Chrome, may fail in some WebViews)
    try {
      const blob = new Blob([html], { type: "text/html" });
      const clipboardItem = new ClipboardItem({
        "text/html": blob,
        "text/plain": new Blob([this.generateTSVFromData()], { type: "text/plain" }),
      });
      await navigator.clipboard.write([clipboardItem]);
      this.showSuccess("Copied to clipboard!");
    } catch (error) {
      // Final fallback to plain text TSV
      console.warn("HTML clipboard failed, falling back to TSV:", error);
      const tsv = this.generateTSVFromData();
      this.copyToClipboard(tsv);
    }
  }

  /**
   * Generate TSV from validated JSON data using flattened dot-notation
   * Excel for Mac doesn't support nested HTML tables, so we flatten nested objects
   */
  generateTSVFromData() {
    if (!this.validatedJson) return "";

    const data = this.validatedJson;
    const rows = [];

    // Flatten the data - collect all key-value pairs with dot-notation for nested
    const flattenedPairs = [];
    this.flattenObject(data, "", flattenedPairs);

    if (flattenedPairs.length === 0) return "";

    // Generate TSV with Key/Value columns
    rows.push("Key\tValue");
    flattenedPairs.forEach(({ key, value }) => {
      rows.push(`${key}\t${value}`);
    });

    return rows.join("\n");
  }

  /**
   * Recursively flatten an object/array into key-value pairs with dot-notation
   * @param {*} obj - Object to flatten
   * @param {string} prefix - Current path prefix (e.g., "dataHeader" or "data[0]")
   * @param {Array} result - Array to push results to
   */
  flattenObject(obj, prefix, result) {
    if (obj === null) {
      result.push({ key: prefix || "(root)", value: "null" });
      return;
    }

    if (obj === undefined) {
      result.push({ key: prefix || "(root)", value: "" });
      return;
    }

    if (typeof obj !== "object") {
      // Primitive value
      const value = String(obj).replace(/[\t\n\r]/g, " ");
      result.push({ key: prefix || "(root)", value });
      return;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        result.push({ key: prefix || "(root)", value: "[]" });
        return;
      }
      obj.forEach((item, index) => {
        const newPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
        this.flattenObject(item, newPrefix, result);
      });
      return;
    }

    // Object
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      result.push({ key: prefix || "(root)", value: "{}" });
      return;
    }

    keys.forEach((key) => {
      const newPrefix = prefix ? `${prefix}.${key}` : key;
      this.flattenObject(obj[key], newPrefix, result);
    });
  }

  formatValueForTSV(value) {
    if (value === null) return "null";
    if (value === undefined) return "";
    if (typeof value === "object") {
      return JSON.stringify(value).replace(/[\t\n\r]/g, " ");
    }
    return String(value).replace(/[\t\n\r]/g, " ");
  }

  /**
   * Export table data to Excel (.xlsx) file
   */
  async exportToExcel() {
    if (!this.validatedJson) {
      this.showError("No data to export");
      return;
    }

    try {
      // Dynamic import of xlsx library
      const XLSX = await import("xlsx");

      // Get flattened data for export
      const flattenedPairs = [];
      this.flattenObject(this.validatedJson, "", flattenedPairs);

      if (flattenedPairs.length === 0) {
        this.showError("No data to export");
        return;
      }

      // Create worksheet data with headers
      const wsData = [["Key", "Value"]];
      flattenedPairs.forEach(({ key, value }) => {
        wsData.push([key, value]);
      });

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Auto-size columns
      const maxKeyLength = Math.max(...flattenedPairs.map((p) => p.key.length), 3);
      const maxValueLength = Math.min(Math.max(...flattenedPairs.map((p) => String(p.value).length), 5), 100);
      ws["!cols"] = [{ wch: Math.min(maxKeyLength + 2, 60) }, { wch: Math.min(maxValueLength + 2, 100) }];

      XLSX.utils.book_append_sheet(wb, ws, "JSON Data");

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
      const filename = `json_export_${timestamp}.xlsx`;

      // Trigger download
      XLSX.writeFile(wb, filename);

      this.showSuccess(`Exported to ${filename}`);
      UsageTracker.trackEvent("json_tools", "export_excel");
    } catch (error) {
      console.error("Export failed:", error);
      this.showError("Failed to export to Excel");
    }
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess("Copied to clipboard!");
    } catch (error) {
      this.showError("Failed to copy to clipboard");
      console.error("Clipboard error:", error);
    }
  }

  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      this.editor.setValue(text);
    } catch (error) {
      this.showError("Failed to paste from clipboard", "Make sure you have granted clipboard permissions.");
      console.error("Clipboard error:", error);
    }
  }

  onUnmount() {
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    if (this.outputEditor) {
      this.outputEditor.dispose();
      this.outputEditor = null;
    }
  }
}

export { JSONTools };
