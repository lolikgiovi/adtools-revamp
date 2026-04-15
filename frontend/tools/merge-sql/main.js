/**
 * Merge SQL Tool
 * Merges multiple SQL files into combined MERGE/INSERT/UPDATE and SELECT files
 */

import "./styles.css";
import { BaseTool } from "../../core/BaseTool.js";
import { getIconSvg } from "./icon.js";
import { MergeSqlTemplate } from "./template.js";
import { MergeSqlService } from "./service.js";
import { createOracleEditor } from "../../core/MonacoOracle.js";
import * as monaco from "monaco-editor";
import * as IndexedDBManager from "./indexeddb-manager.js";
import html2canvas from "html2canvas";

export class MergeSqlTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "merge-sql",
      name: "Merge SQL",
      description: "Merge multiple SQL files into combined MERGE/INSERT/UPDATE and SELECT files",
      icon: "merge-sql",
      category: "config",
      eventBus,
    });

    this.files = [];
    this.sortOrder = "asc";
    this.tableOrder = [];
    this.expandedTables = new Set();
    this.mergedEditor = null;
    this.selectEditor = null;
    this.validationEditor = null;
    this.inputEditor = null;
    this.validationSqlEditor = null;
    this.fileEditor = null;
    // Map<fileId, { model, lastSavedVersionId, autosaveTimer }>
    this.fileEditorModels = new Map();
    this.openFileIds = [];
    this.activeEditorFileId = null;
    this.inputMode = "files";
    this.currentTab = "report";
    this.currentSubtab = "merged";
    this.result = null;
    this.draggedCard = null;
    this.dragCardStartY = null;
    this.saveDebounceTimer = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return MergeSqlTemplate;
  }

  async onMount() {
    this.initMonaco();
    this.renderResultTabs();
    this.bindEvents();
    await this.loadFromIndexedDB();
    this.updateUI();
  }

  onUnmount() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    if (this.mergedEditor) {
      this.mergedEditor.dispose();
      this.mergedEditor = null;
    }
    if (this.selectEditor) {
      this.selectEditor.dispose();
      this.selectEditor = null;
    }
    if (this.validationEditor) {
      this.validationEditor.dispose();
      this.validationEditor = null;
    }
    if (this.inputEditor) {
      this.inputEditor.dispose();
      this.inputEditor = null;
    }
    if (this.validationSqlEditor) {
      this.validationSqlEditor.dispose();
      this.validationSqlEditor = null;
    }
    // Dispose all file editor models then the editor itself
    for (const entry of this.fileEditorModels.values()) {
      if (entry.autosaveTimer) clearTimeout(entry.autosaveTimer);
      entry.model.dispose();
    }
    this.fileEditorModels.clear();
    if (this.fileEditor) {
      this.fileEditor.dispose();
      this.fileEditor = null;
    }
  }

  initMonaco() {
    const mergedContainer = document.getElementById("merge-sql-merged-editor");
    const selectContainer = document.getElementById("merge-sql-select-editor");
    const validationContainer = document.getElementById("merge-sql-validation-editor");
    const inputContainer = document.getElementById("merge-sql-input-editor");
    const validationSqlContainer = document.getElementById("merge-sql-validation-sql-editor");

    const editorOptions = {
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      automaticLayout: true,
      readOnly: false,
      padding: { top: 12, bottom: 12 },
    };

    const readOnlyOptions = {
      ...editorOptions,
      readOnly: true,
    };

    if (mergedContainer) {
      this.mergedEditor = createOracleEditor(mergedContainer, editorOptions);
      this.mergedEditor.onDidChangeModelContent(() => this.debounceSaveResults());
    }

    if (selectContainer) {
      this.selectEditor = createOracleEditor(selectContainer, editorOptions);
      this.selectEditor.onDidChangeModelContent(() => this.debounceSaveResults());
    }

    if (validationContainer) {
      this.validationEditor = createOracleEditor(validationContainer, editorOptions);
      this.validationEditor.onDidChangeModelContent(() => this.debounceSaveResults());
    }

    if (inputContainer) {
      this.inputEditor = createOracleEditor(inputContainer, editorOptions);
      this.inputEditor.onDidChangeModelContent(() => this.debounceSaveResults());
    }

    if (validationSqlContainer) {
      this.validationSqlEditor = createOracleEditor(validationSqlContainer, readOnlyOptions);
    }

    // NOTE: fileEditor is intentionally NOT initialized here.
    // It is created lazily on first file open, after the Editor tab is visible,
    // so Monaco gets a correctly-sized container.
  }

  async loadFromIndexedDB() {
    const [files, state, results] = await Promise.all([
      IndexedDBManager.loadFiles(),
      IndexedDBManager.loadState(),
      IndexedDBManager.loadResults(),
    ]);

    if (files && files.length > 0) {
      this.files = files;
    }

    if (state) {
      if (state.sortOrder === "manual") {
        this.sortOrder = "asc";
      } else {
        this.sortOrder = state.sortOrder || "asc";
      }
      this.currentTab = state.currentTab || "report";
      this.currentSubtab = state.currentSubtab || "merged";

      if (state.tableOrder && Array.isArray(state.tableOrder)) {
        this.tableOrder = state.tableOrder;
      }
      if (state.expandedTables && Array.isArray(state.expandedTables)) {
        this.expandedTables = new Set(state.expandedTables);
      }

      const folderNameInput = document.getElementById("merge-sql-folder-name");
      if (folderNameInput && state.folderName) {
        folderNameInput.value = state.folderName;
      }

      if (state.inputMode) {
        this.switchInputMode(state.inputMode);
      }
    }

    if (results) {
      this.result = {
        mergedSql: results.mergedSql || "",
        selectSql: results.selectSql || "",
        validationSql: results.validationSql || "",
        duplicates: results.duplicates || [],
        report: results.report || null,
      };

      if (this.mergedEditor && results.mergedSql) {
        this.mergedEditor.setValue(results.mergedSql);
      }
      if (this.selectEditor && results.selectSql) {
        this.selectEditor.setValue(results.selectSql);
      }
      if (this.validationEditor && results.validationSql) {
        this.validationEditor.setValue(results.validationSql);
      }
      if (this.inputEditor && results.inputSql) {
        this.inputEditor.setValue(results.inputSql);
      }

      if (results.mergedSql || results.selectSql || results.validationSql || results.inputSql) {
        this.showResult();
        this.updateDuplicatesInsight();
      }
    }

    this.handleTabSwitch(this.currentTab);
  }

  debounceSaveResults() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(() => {
      const mergedSql = this.mergedEditor?.getValue() || "";
      const selectSql = this.selectEditor?.getValue() || "";
      const validationSql = this.validationEditor?.getValue() || "";
      const duplicates = this.result?.duplicates || [];
      const report = this.result?.report || null;
      const inputSql = this.inputEditor?.getValue() || "";
      IndexedDBManager.saveResults(mergedSql, selectSql, validationSql, duplicates, report, inputSql);
    }, 1000);
  }

  saveStateToIndexedDB() {
    const folderName = document.getElementById("merge-sql-folder-name")?.value || "MERGED";
    IndexedDBManager.saveState({
      sortOrder: this.sortOrder,
      folderName,
      currentTab: this.currentTab,
      currentSubtab: this.currentSubtab,
      inputMode: this.inputMode,
      tableOrder: this.tableOrder,
      expandedTables: [...this.expandedTables],
    });
  }

  saveFilesToIndexedDB() {
    IndexedDBManager.saveFiles(this.files);
  }

  bindEvents() {
    const addFilesBtn = document.getElementById("merge-sql-add-files");
    const addFolderBtn = document.getElementById("merge-sql-add-folder");
    const fileInput = document.getElementById("merge-sql-file-input");
    const folderInput = document.getElementById("merge-sql-folder-input");
    const mergeBtn = document.getElementById("merge-sql-btn");
    const clearFilesBtn = document.getElementById("merge-sql-clear-files-btn");
    const clearBtn = document.getElementById("merge-sql-clear-btn");
    const refreshValidationBtn = null;
    const copyBtn = document.getElementById("merge-sql-copy-btn");
    const downloadBtn = document.getElementById("merge-sql-download-btn");
    const downloadAllBtn = document.getElementById("merge-sql-download-all-btn");
    const sortAscBtn = document.getElementById("merge-sql-sort-asc");
    const sortDescBtn = document.getElementById("merge-sql-sort-desc");
    const sortManualBtn = document.getElementById("merge-sql-sort-manual");
    const resultTabs = document.getElementById("merge-sql-result-tabs");
    const viewDuplicatesBtn = document.getElementById("merge-sql-view-duplicates");
    const closeDuplicatesBtn = document.getElementById("merge-sql-close-duplicates");
    const duplicatesCloseBtn = document.getElementById("merge-sql-duplicates-close-btn");
    const viewReportBtn = document.getElementById("merge-sql-view-report");
    const folderNameInput = document.getElementById("merge-sql-folder-name");
    const modeToggle = document.getElementById("merge-sql-mode-toggle");
    const sqlRefreshBtn = document.getElementById("merge-sql-sql-refresh-btn");
    const sqlClearBtn = document.getElementById("merge-sql-sql-clear-btn");
    const copyReportTextBtn = document.getElementById("merge-sql-copy-report-text-btn");
    const copyReportImageBtn = document.getElementById("merge-sql-copy-report-image-btn");
    const downloadReportImageBtn = document.getElementById("merge-sql-download-report-image-btn");

    if (addFilesBtn) addFilesBtn.addEventListener("click", () => fileInput?.click());
    if (addFolderBtn) addFolderBtn.addEventListener("click", () => folderInput?.click());
    if (fileInput) fileInput.addEventListener("change", (e) => this.handleFileSelect(e));
    if (folderInput) folderInput.addEventListener("change", (e) => this.handleFolderSelect(e));
    if (mergeBtn) mergeBtn.addEventListener("click", () => this.handleMerge());
    if (clearFilesBtn) clearFilesBtn.addEventListener("click", () => this.handleClearFilesOnly());
    if (clearBtn) clearBtn.addEventListener("click", () => this.handleClearAll());
    if (copyBtn) copyBtn.addEventListener("click", () => this.handleCopy());
    if (downloadBtn) downloadBtn.addEventListener("click", () => this.handleDownload());
    if (downloadAllBtn) downloadAllBtn.addEventListener("click", () => this.handleDownloadAll());
    if (sortAscBtn) sortAscBtn.addEventListener("click", () => this.handleSort("asc"));
    if (sortDescBtn) sortDescBtn.addEventListener("click", () => this.handleSort("desc"));
    if (sortManualBtn) sortManualBtn.addEventListener("click", () => this.handleSort("manual"));
    if (viewDuplicatesBtn) viewDuplicatesBtn.addEventListener("click", () => this.showDuplicatesModal());
    if (closeDuplicatesBtn) closeDuplicatesBtn.addEventListener("click", () => this.hideDuplicatesModal());
    if (duplicatesCloseBtn) duplicatesCloseBtn.addEventListener("click", () => this.hideDuplicatesModal());
    if (viewReportBtn) viewReportBtn.addEventListener("click", () => this.handleTabSwitch("report"));
    if (folderNameInput) folderNameInput.addEventListener("input", () => this.saveStateToIndexedDB());
    if (sqlRefreshBtn) sqlRefreshBtn.addEventListener("click", () => this.handleSqlModeRefresh());
    if (sqlClearBtn) sqlClearBtn.addEventListener("click", () => this.handleSqlModeClear());
    if (copyReportTextBtn) copyReportTextBtn.addEventListener("click", () => this.handleCopyReportText());
    if (copyReportImageBtn) copyReportImageBtn.addEventListener("click", () => this.handleCopyReportImage());
    if (downloadReportImageBtn) downloadReportImageBtn.addEventListener("click", () => this.handleDownloadReportImage());

    if (modeToggle) {
      modeToggle.addEventListener("click", (e) => {
        const btn = e.target.closest(".mode-toggle-btn");
        if (btn && btn.dataset.mode) {
          this.switchInputMode(btn.dataset.mode);
        }
      });
    }

    if (resultTabs) {
      resultTabs.addEventListener("click", (e) => {
        const tab = e.target.closest(".merge-sql-result-tab");
        if (tab) this.handleTabSwitch(tab.dataset.tab);
      });
    }

    const reportSubtabs = document.getElementById("merge-sql-report-subtabs");
    if (reportSubtabs) {
      reportSubtabs.addEventListener("click", (e) => {
        const subtab = e.target.closest(".merge-sql-report-subtab");
        if (subtab) this.handleReportSubtabSwitch(subtab.dataset.subtab);
      });
    }

    const generatedSubtabs = document.getElementById("merge-sql-generated-subtabs");
    if (generatedSubtabs) {
      generatedSubtabs.addEventListener("click", (e) => {
        const subtab = e.target.closest(".merge-sql-generated-sql-subtab");
        if (subtab) this.handleGeneratedSubtabSwitch(subtab.dataset.subtab);
      });
    }

    const editorSaveBtn = document.getElementById("merge-sql-editor-save");
    if (editorSaveBtn) editorSaveBtn.addEventListener("click", () => this.saveActiveFile());

    const editorRevertBtn = document.getElementById("merge-sql-editor-revert");
    if (editorRevertBtn) editorRevertBtn.addEventListener("click", () => this.revertActiveFile());

    const editorTabsEl = document.getElementById("merge-sql-editor-tabs");
    if (editorTabsEl) {
      editorTabsEl.addEventListener("click", (e) => {
        const closeBtn = e.target.closest(".file-editor-tab-close");
        if (closeBtn) {
          e.stopPropagation();
          this.closeEditorTab(closeBtn.dataset.id);
          return;
        }
        const tab = e.target.closest(".file-editor-tab");
        if (tab) this.setActiveEditorFile(tab.dataset.id);
      });
    }
  }

  handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    this.addFiles(files);
    e.target.value = "";
  }

  handleFolderSelect(e) {
    const files = Array.from(e.target.files || []);
    const sqlFiles = files.filter((f) => f.name.toLowerCase().endsWith(".sql"));
    this.addFiles(sqlFiles);
    e.target.value = "";
  }

  addFiles(files) {
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".sql")) continue;

      const exists = this.files.some((f) => f.name === file.name && f.file.size === file.size);
      if (exists) continue;

      const newFile = {
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        name: file.name,
        editedContent: null,
      };

      this.files.push(newFile);

      const tableName = MergeSqlService.extractTableNameForSort(newFile.name);
      if (!this.tableOrder.includes(tableName)) {
        this.tableOrder.push(tableName);
      }
    }

    this.applySorting();
    this.saveFilesToIndexedDB();
    this.updateUI();
  }

  removeFile(fileId) {
    // Close editor tab if open before removing
    if (this.openFileIds.includes(fileId)) {
      this._closeEditorTabSilent(fileId);
    }
    const file = this.files.find((f) => f.id === fileId);
    this.files = this.files.filter((f) => f.id !== fileId);

    if (file) {
      const tableName = MergeSqlService.extractTableNameForSort(file.name);
      const stillExists = this.files.some((f) => MergeSqlService.extractTableNameForSort(f.name) === tableName);
      if (!stillExists) {
        this.tableOrder = this.tableOrder.filter((t) => t !== tableName);
        this.expandedTables.delete(tableName);
      }
    }

    this.applySorting();
    this.saveFilesToIndexedDB();
    this.saveStateToIndexedDB();
    this.updateUI();
  }

  handleSort(order) {
    if (order === "manual" && this.sortOrder !== "manual") {
      const groups = MergeSqlService.groupFilesByTable(this.files);
      this.tableOrder = [...groups.keys()];
    }
    this.sortOrder = order;
    this.applySorting();
    this.updateSortButtons();
    this.saveStateToIndexedDB();
    this.renderFileList();
  }

  applySorting() {
    this.files = MergeSqlService.sortFiles(this.files, this.sortOrder, this.tableOrder);
  }

  updateSortButtons() {
    const sortAscBtn = document.getElementById("merge-sql-sort-asc");
    const sortDescBtn = document.getElementById("merge-sql-sort-desc");
    const sortManualBtn = document.getElementById("merge-sql-sort-manual");

    [sortAscBtn, sortDescBtn, sortManualBtn].forEach((btn) => btn?.classList.remove("active"));

    if (this.sortOrder === "asc") sortAscBtn?.classList.add("active");
    if (this.sortOrder === "desc") sortDescBtn?.classList.add("active");
    if (this.sortOrder === "manual") sortManualBtn?.classList.add("active");
  }

  switchInputMode(mode) {
    if (this.inputMode === mode) return;
    this.inputMode = mode;
    this.saveStateToIndexedDB();

    const filesSection = document.getElementById("merge-sql-input-files");
    const sqlSection = document.getElementById("merge-sql-input-sql");
    const toggleBtns = document.querySelectorAll("#merge-sql-mode-toggle .mode-toggle-btn");

    toggleBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    if (filesSection) filesSection.style.display = mode === "files" ? "" : "none";
    if (sqlSection) sqlSection.style.display = mode === "sql" ? "" : "none";

    this.renderResultTabs();

    this.currentTab = "report";
    this.handleTabSwitch("report");
  }

  renderResultTabs() {
    const tabsLeft = document.getElementById("merge-sql-result-tabs-left");
    if (!tabsLeft) return;

    if (this.inputMode === "files") {
      tabsLeft.innerHTML = `
        <button class="tab-button merge-sql-result-tab active" data-tab="report">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3h18v18H3zM9 3v18M21 9H3M21 15H3"/>
          </svg>
          Report
        </button>
        <button class="tab-button merge-sql-result-tab" data-tab="generated">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
          Generated SQL
        </button>
        <button class="tab-button merge-sql-result-tab" data-tab="editor">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
          </svg>
          File Editor
        </button>
      `;
    } else {
      tabsLeft.innerHTML = `
        <button class="tab-button merge-sql-result-tab active" data-tab="report">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3h18v18H3zM9 3v18M21 9H3M21 15H3"/>
          </svg>
          Report
        </button>
        <button class="tab-button merge-sql-result-tab" data-tab="validation-sql">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13l5.93-4L15 7h4a2 2 0 0 1 2 2v2"></path>
            <path d="M14 21l-5.93-4L9 17H5a2 2 0 0 1-2-2v-2"></path>
          </svg>
          Validation SQL
        </button>
      `;
    }
  }

  handleTabSwitch(tab) {
    const prevTab = this.currentTab;
    this.currentTab = tab;

    if (tab === "report") {
      const validSubtabs = ["summary", "table-detail"];
      if (!validSubtabs.includes(this.currentSubtab)) {
        this.currentSubtab = "summary";
      }
    } else if (tab === "generated") {
      const validSubtabs = ["merged", "select", "validation"];
      if (!validSubtabs.includes(this.currentSubtab)) {
        this.currentSubtab = "merged";
      }
    } else if (tab === "validation-sql") {
      this.currentSubtab = "validation-sql";
    }

    this.saveStateToIndexedDB();

    const tabs = document.querySelectorAll(".merge-sql-result-tab");
    tabs.forEach((t) => t.classList.remove("active"));
    document.querySelector(`.merge-sql-result-tab[data-tab="${tab}"]`)?.classList.add("active");

    const reportContent = document.getElementById("merge-sql-report-content");
    const generatedContent = document.getElementById("merge-sql-generated-content");
    const validationTabContent = document.getElementById("merge-sql-validation-tab-content");
    const editorContent = document.getElementById("merge-sql-editor-content");
    const reportSubtabsEl = document.getElementById("merge-sql-report-subtabs");
    const generatedSubtabsEl = document.getElementById("merge-sql-generated-subtabs");

    if (reportContent) reportContent.classList.toggle("active", tab === "report");
    if (generatedContent) generatedContent.classList.toggle("active", tab === "generated");
    if (validationTabContent) validationTabContent.classList.toggle("active", tab === "validation-sql");
    if (editorContent) editorContent.classList.toggle("active", tab === "editor");

    if (reportSubtabsEl) reportSubtabsEl.style.display = tab === "report" ? "" : "none";
    if (generatedSubtabsEl) generatedSubtabsEl.style.display = tab === "generated" ? "" : "none";

    const resultActionsButtons = document.querySelector(".merge-sql-result-actions-buttons");
    const reportActionsButtons = document.getElementById("merge-sql-report-actions-buttons");
    if (resultActionsButtons) {
      resultActionsButtons.style.display = tab === "report" || tab === "editor" ? "none" : "";
    }
    if (reportActionsButtons) {
      reportActionsButtons.classList.toggle("visible", tab === "report");
    }

    if (tab === "report") {
      this.renderReport();
    } else if (tab === "generated") {
      if (this.currentSubtab === "merged" && this.mergedEditor) {
        setTimeout(() => this.mergedEditor.layout(), 0);
      } else if (this.currentSubtab === "select" && this.selectEditor) {
        setTimeout(() => this.selectEditor.layout(), 0);
      } else if (this.currentSubtab === "validation" && this.validationEditor) {
        setTimeout(() => this.validationEditor.layout(), 0);
      }
    } else if (tab === "validation-sql") {
      if (this.validationSqlEditor) {
        setTimeout(() => this.validationSqlEditor.layout(), 0);
      }
    } else if (tab === "editor") {
      if (this.fileEditor && this.activeEditorFileId) {
        setTimeout(() => this.fileEditor.layout(), 50);
      }
    }

    // Editor tab needs the result content area clear of the empty-state overlay.
    // Other tabs rely on the empty state to signal "no results yet".
    const resultEmptyEl = document.getElementById("merge-sql-result-empty");
    if (resultEmptyEl) {
      if (tab === "editor") {
        resultEmptyEl.style.display = "none";
      } else if (prevTab === "editor" && !this.result) {
        // Restore placeholder when leaving editor with no merge results
        resultEmptyEl.style.display = "";
      }
    }
  }

  handleGeneratedSubtabSwitch(subtab) {
    this.currentSubtab = subtab;
    this.saveStateToIndexedDB();

    const subtabs = document.querySelectorAll(".merge-sql-generated-sql-subtab");
    subtabs.forEach((t) => t.classList.remove("active"));
    document.querySelector(`.merge-sql-generated-sql-subtab[data-subtab="${subtab}"]`)?.classList.add("active");

    const mergedSubtab = document.getElementById("merge-sql-merged-subtab");
    const selectSubtab = document.getElementById("merge-sql-select-subtab");
    const validationSubtab = document.getElementById("merge-sql-validation-subtab");

    if (mergedSubtab) mergedSubtab.classList.toggle("active", subtab === "merged");
    if (selectSubtab) selectSubtab.classList.toggle("active", subtab === "select");
    if (validationSubtab) validationSubtab.classList.toggle("active", subtab === "validation");

    if (subtab === "merged" && this.mergedEditor) {
      setTimeout(() => this.mergedEditor.layout(), 0);
    } else if (subtab === "select" && this.selectEditor) {
      setTimeout(() => this.selectEditor.layout(), 0);
    } else if (subtab === "validation" && this.validationEditor) {
      setTimeout(() => this.validationEditor.layout(), 0);
    }
  }

  handleReportSubtabSwitch(subtab) {
    this.currentSubtab = subtab;
    this.saveStateToIndexedDB();

    const subtabs = document.querySelectorAll(".merge-sql-report-subtab");
    subtabs.forEach((t) => t.classList.remove("active"));
    document.querySelector(`.merge-sql-report-subtab[data-subtab="${subtab}"]`)?.classList.add("active");

    const summaryContent = document.getElementById("merge-sql-report-summary");
    const tableDetailContent = document.getElementById("merge-sql-report-table-detail");

    if (summaryContent) summaryContent.classList.toggle("active", subtab === "summary");
    if (tableDetailContent) tableDetailContent.classList.toggle("active", subtab === "table-detail");
  }

  // ─── File Editor Methods ────────────────────────────────────────────────────

  /**
   * Lazily creates the Monaco file editor on first use.
   * Must be called AFTER the Editor tab pane is visible so Monaco gets real dimensions.
   */
  _initFileEditor() {
    if (this.fileEditor) return;
    const container = document.getElementById("merge-sql-file-editor");
    if (!container) return;

    // Make the container visible before creating Monaco
    container.style.display = "";

    const editorOptions = {
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      automaticLayout: true,
      readOnly: false,
      padding: { top: 12, bottom: 12 },
    };

    this.fileEditor = createOracleEditor(container, editorOptions);
    this.fileEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      this.saveActiveFile();
    });
    this.fileEditor.onDidChangeModelContent(() => {
      if (this.activeEditorFileId) {
        this._scheduleAutosave(this.activeEditorFileId);
      }
    });
  }

  async openFileInEditor(fileId) {
    // If already open, just activate it
    if (this.openFileIds.includes(fileId)) {
      this.handleTabSwitch("editor");
      this.setActiveEditorFile(fileId);
      return;
    }

    const fileItem = this.files.find((f) => f.id === fileId);
    if (!fileItem) return;

    const content =
      fileItem.editedContent !== null
        ? fileItem.editedContent
        : await MergeSqlService.readFileContent(fileItem.file);

    // Create a Monaco model for this file
    const model = monaco.editor.createModel(content, "oracle-dml");

    this.fileEditorModels.set(fileId, {
      model,
      lastSavedVersionId: model.getAlternativeVersionId(),
      autosaveTimer: null,
    });

    this.openFileIds.push(fileId);
    this.renderEditorTabs();

    // Switch tab first so the container is visible BEFORE Monaco is initialized
    this.handleTabSwitch("editor");

    // Now safe to create Monaco on a visible container
    this._initFileEditor();

    this.setActiveEditorFile(fileId);
  }

  setActiveEditorFile(fileId) {
    const entry = this.fileEditorModels.get(fileId);
    if (!entry || !this.fileEditor) return;

    this.activeEditorFileId = fileId;

    // Show editor, hide empty state
    const editorEl = document.getElementById("merge-sql-file-editor");
    const emptyEl = document.getElementById("merge-sql-editor-empty");
    const toolbarEl = document.getElementById("merge-sql-editor-toolbar");
    if (editorEl) editorEl.style.display = "";
    if (emptyEl) emptyEl.style.display = "none";
    if (toolbarEl) toolbarEl.style.display = "";

    this.fileEditor.setModel(entry.model);
    setTimeout(() => this.fileEditor.layout(), 50);
    this._updateEditorToolbar(fileId);
    this._highlightActiveTab(fileId);
  }

  _scheduleAutosave(fileId) {
    const entry = this.fileEditorModels.get(fileId);
    if (!entry) return;

    const isDirty = entry.model.getAlternativeVersionId() !== entry.lastSavedVersionId;
    this._setTabDirty(fileId, isDirty);
    this._updateEditorToolbar(fileId);

    if (entry.autosaveTimer) clearTimeout(entry.autosaveTimer);
    entry.autosaveTimer = setTimeout(() => {
      this._persistFileEdit(fileId);
    }, 1000);
  }

  _persistFileEdit(fileId) {
    const entry = this.fileEditorModels.get(fileId);
    const fileItem = this.files.find((f) => f.id === fileId);
    if (!entry || !fileItem) return;

    const value = entry.model.getValue();
    fileItem.editedContent = value;
    entry.lastSavedVersionId = entry.model.getAlternativeVersionId();
    entry.autosaveTimer = null;

    IndexedDBManager.saveSingleFileEdit(fileId, value);

    this._setTabDirty(fileId, false);
    this._updateEditorToolbar(fileId);
    this._updateEditorStatus("Autosaved");
    this.renderFileList();
  }

  saveActiveFile() {
    if (!this.activeEditorFileId) return;
    if (this.fileEditorModels.get(this.activeEditorFileId)?.autosaveTimer) {
      clearTimeout(this.fileEditorModels.get(this.activeEditorFileId).autosaveTimer);
    }
    this._persistFileEdit(this.activeEditorFileId);
    this._updateEditorStatus("Saved");
  }

  async revertActiveFile() {
    if (!this.activeEditorFileId) return;
    const fileItem = this.files.find((f) => f.id === this.activeEditorFileId);
    const entry = this.fileEditorModels.get(this.activeEditorFileId);
    if (!fileItem || !entry) return;

    const confirmed = window.confirm(
      `Revert "${fileItem.name}" to its original content? All your edits will be lost.`
    );
    if (!confirmed) return;

    const originalContent = await MergeSqlService.readFileContent(fileItem.file);

    entry.model.setValue(originalContent);
    fileItem.editedContent = null;
    entry.lastSavedVersionId = entry.model.getAlternativeVersionId();

    IndexedDBManager.saveSingleFileEdit(this.activeEditorFileId, null);

    this._setTabDirty(this.activeEditorFileId, false);
    this._updateEditorToolbar(this.activeEditorFileId);
    this._updateEditorStatus("Reverted to original");
    this.renderFileList();
  }

  closeEditorTab(fileId) {
    // Flush any pending autosave before closing
    const entry = this.fileEditorModels.get(fileId);
    if (entry) {
      if (entry.autosaveTimer) {
        clearTimeout(entry.autosaveTimer);
        this._persistFileEdit(fileId);
      }
    }
    this._closeEditorTabSilent(fileId);
  }

  _closeEditorTabSilent(fileId) {
    const entry = this.fileEditorModels.get(fileId);
    if (entry) {
      if (entry.autosaveTimer) clearTimeout(entry.autosaveTimer);
      entry.model.dispose();
      this.fileEditorModels.delete(fileId);
    }

    const idx = this.openFileIds.indexOf(fileId);
    if (idx !== -1) this.openFileIds.splice(idx, 1);

    // Activate a neighbour or show empty state
    if (this.activeEditorFileId === fileId) {
      const next = this.openFileIds[idx] ?? this.openFileIds[idx - 1] ?? null;
      this.activeEditorFileId = null;
      if (next) {
        this.setActiveEditorFile(next);
      } else {
        this._showEditorEmptyState();
      }
    }

    this.renderEditorTabs();
  }

  _showEditorEmptyState() {
    const editorEl = document.getElementById("merge-sql-file-editor");
    const emptyEl = document.getElementById("merge-sql-editor-empty");
    const toolbarEl = document.getElementById("merge-sql-editor-toolbar");
    if (editorEl) editorEl.style.display = "none";
    if (emptyEl) emptyEl.style.display = "";
    if (toolbarEl) toolbarEl.style.display = "none";
  }

  renderEditorTabs() {
    const tabsEl = document.getElementById("merge-sql-editor-tabs");
    if (!tabsEl) return;

    if (this.openFileIds.length === 0) {
      tabsEl.innerHTML = "";
      return;
    }

    tabsEl.innerHTML = this.openFileIds
      .map((fileId) => {
        const fileItem = this.files.find((f) => f.id === fileId);
        if (!fileItem) return "";
        const isActive = fileId === this.activeEditorFileId;
        const entry = this.fileEditorModels.get(fileId);
        const isDirty =
          entry ? entry.model.getAlternativeVersionId() !== entry.lastSavedVersionId : false;
        return `<div class="file-editor-tab${isActive ? " active" : ""}${isDirty ? " dirty" : ""}" data-id="${this.escapeHtml(fileId)}">
          <svg class="file-editor-tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span class="file-editor-tab-label" title="${this.escapeHtml(fileItem.name)}">${this.escapeHtml(fileItem.name)}</span>
          <span class="file-editor-tab-dirty-dot"></span>
          <button class="file-editor-tab-close" data-id="${this.escapeHtml(fileId)}" title="Close">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>`;
      })
      .join("");
  }

  _highlightActiveTab(fileId) {
    const tabsEl = document.getElementById("merge-sql-editor-tabs");
    if (!tabsEl) return;
    tabsEl.querySelectorAll(".file-editor-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.id === fileId);
    });
  }

  _setTabDirty(fileId, isDirty) {
    const tabsEl = document.getElementById("merge-sql-editor-tabs");
    if (!tabsEl) return;
    const tab = tabsEl.querySelector(`.file-editor-tab[data-id="${fileId}"]`);
    if (tab) tab.classList.toggle("dirty", isDirty);
  }

  _updateEditorToolbar(fileId) {
    const entry = this.fileEditorModels.get(fileId);
    const isDirty = entry
      ? entry.model.getAlternativeVersionId() !== entry.lastSavedVersionId
      : false;
    const fileItem = this.files.find((f) => f.id === fileId);
    const hasOriginal = fileItem && fileItem.editedContent !== null;

    const saveBtn = document.getElementById("merge-sql-editor-save");
    const revertBtn = document.getElementById("merge-sql-editor-revert");
    if (saveBtn) saveBtn.disabled = !isDirty;
    if (revertBtn) revertBtn.disabled = !hasOriginal;
  }

  _updateEditorStatus(msg) {
    const statusEl = document.getElementById("merge-sql-editor-status");
    if (!statusEl) return;
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    statusEl.textContent = `${msg} · ${time}`;
  }

  // ────────────────────────────────────────────────────────────────────────────

  async handleMerge() {
    if (this.files.length === 0) {
      this.showError("No files to merge");
      return;
    }

    const mergeBtn = document.getElementById("merge-sql-btn");
    if (mergeBtn) {
      mergeBtn.disabled = true;
      mergeBtn.innerHTML = `
        <svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"></path>
        </svg>
        Processing...
      `;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const parsedFiles = [];

      for (const fileItem of this.files) {
        const content =
          fileItem.editedContent !== null
            ? fileItem.editedContent
            : await MergeSqlService.readFileContent(fileItem.file);
        const parsed = MergeSqlService.parseFile(content, fileItem.name);
        parsedFiles.push(parsed);
      }

      this.result = MergeSqlService.mergeFiles(parsedFiles);

      if (this.mergedEditor) {
        this.mergedEditor.setValue(this.result.mergedSql);
      }
      if (this.selectEditor) {
        this.selectEditor.setValue(this.result.selectSql);
      }
      if (this.validationEditor) {
        this.validationEditor.setValue(this.result.validationSql || "");
      }

      await IndexedDBManager.saveResults(
        this.result.mergedSql,
        this.result.selectSql,
        this.result.validationSql || "",
        this.result.duplicates,
        this.result.report,
        this.inputEditor?.getValue() || ""
      );

      this.showResult();
      this.updateDuplicatesInsight();
      this.showSuccess("SQL files merged successfully!");
      this.handleTabSwitch("report");
    } catch (error) {
      console.error("Merge failed:", error);
      this.showError(`Failed to merge files: ${error.message}`);
    } finally {
      if (mergeBtn) {
        mergeBtn.disabled = false;
        mergeBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"></path>
            <path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"></path>
            <path d="M12 2v20"></path>
          </svg>
          MERGE SQLs
        `;
      }
    }
  }

  async handleClearAll() {
    this.files = [];
    this.tableOrder = [];
    this.expandedTables = new Set();
    this.result = null;
    if (this.mergedEditor) this.mergedEditor.setValue("");
    if (this.selectEditor) this.selectEditor.setValue("");
    if (this.validationEditor) this.validationEditor.setValue("");
    if (this.inputEditor) this.inputEditor.setValue("");
    if (this.validationSqlEditor) this.validationSqlEditor.setValue("");
    this.hideResult();
    await IndexedDBManager.clearAll();
    this.updateUI();
  }

  async handleClearFilesOnly() {
    if (this.files.length === 0) {
      return;
    }

    this.files = [];
    this.tableOrder = [];
    this.expandedTables = new Set();
    this.saveFilesToIndexedDB();
    this.updateUI();
    this.showSuccess("Files cleared. Current SQL results are kept.");
  }

  async handleRefreshValidation() {
    const mergedSql = this.mergedEditor?.getValue() || "";
    if (!mergedSql.trim()) {
      this.showError("No merged SQL available to generate validation");
      return;
    }

    const validationSql = MergeSqlService.buildValidationSqlFromMergedSql(mergedSql);
    if (this.validationEditor) {
      this.validationEditor.setValue(validationSql);
    }

    this.result = {
      mergedSql,
      selectSql: this.selectEditor?.getValue() || this.result?.selectSql || "",
      validationSql,
      duplicates: this.result?.duplicates || [],
      report: this.result?.report || null,
    };

    await IndexedDBManager.saveResults(
      this.result.mergedSql,
      this.result.selectSql,
      this.result.validationSql,
      this.result.duplicates,
      this.result.report,
      this.inputEditor?.getValue() || ""
    );

    this.showResult();
    this.currentSubtab = "validation";
    this.handleGeneratedSubtabSwitch("validation");
    this.handleTabSwitch("generated");
    this.showSuccess("Validation SQL refreshed from current Merged SQL");
  }

  async handleSqlModeRefresh() {
    const mergedSql = this.inputEditor?.getValue() || "";
    if (!mergedSql.trim()) {
      this.showError("No merged SQL to process");
      return;
    }

    const sqlRefreshBtn = document.getElementById("merge-sql-sql-refresh-btn");
    if (sqlRefreshBtn) {
      sqlRefreshBtn.disabled = true;
    }

    try {
      const validationSql = MergeSqlService.buildValidationSqlFromMergedSql(mergedSql);
      if (this.validationSqlEditor) {
        this.validationSqlEditor.setValue(validationSql);
      }

      const report = MergeSqlService.buildReportFromMergedSql(mergedSql);

      this.result = {
        mergedSql,
        selectSql: "",
        validationSql,
        duplicates: [],
        report,
      };

      await IndexedDBManager.saveResults(
        mergedSql,
        "",
        validationSql,
        [],
        report,
        mergedSql
      );

      this.showResult();
      this.updateDuplicatesInsight();
      this.handleTabSwitch("report");
      this.showSuccess("Report and Validation SQL generated from merged SQL");
    } catch (error) {
      console.error("SQL mode refresh failed:", error);
      this.showError(`Failed to process merged SQL: ${error.message}`);
    } finally {
      if (sqlRefreshBtn) {
        sqlRefreshBtn.disabled = false;
      }
    }
  }

  handleSqlModeClear() {
    if (this.inputEditor) this.inputEditor.setValue("");
    if (this.validationSqlEditor) this.validationSqlEditor.setValue("");
    this.result = null;
    this.hideResult();
    this.debounceSaveResults();
  }

  getCurrentEditor() {
    if (this.inputMode === "files") {
      if (this.currentTab === "generated") {
        if (this.currentSubtab === "merged") return this.mergedEditor;
        if (this.currentSubtab === "select") return this.selectEditor;
        if (this.currentSubtab === "validation") return this.validationEditor;
      }
      return null;
    } else {
      if (this.currentTab === "validation-sql") return this.validationSqlEditor;
      return null;
    }
  }

  getCurrentDownloadSuffix() {
    if (this.inputMode === "files") {
      if (this.currentTab === "generated") {
        if (this.currentSubtab === "merged") return "-MERGED.sql";
        if (this.currentSubtab === "select") return "-SELECT.sql";
        if (this.currentSubtab === "validation") return "-VALIDATION.sql";
      }
      return null;
    } else {
      if (this.currentTab === "validation-sql") return "-VALIDATION.sql";
      return null;
    }
  }

  handleCopy() {
    const editor = this.getCurrentEditor();
    if (editor) {
      const content = editor.getValue();
      this.copyToClipboard(content);
    }
  }

  handleDownload() {
    const folderName = document.getElementById("merge-sql-folder-name")?.value || "MERGED";
    const suffix = this.getCurrentDownloadSuffix();
    if (!suffix) return;

    const fileName = `${folderName}${suffix}`;
    const editor = this.getCurrentEditor();
    if (editor) {
      const content = editor.getValue();
      if (content) {
        this.downloadFile(fileName, content);
        this.showSuccess(`Downloaded ${fileName}`);
      }
    }
  }

  handleDownloadAll() {
    const folderName = document.getElementById("merge-sql-folder-name")?.value || "MERGED";
    const downloadedFiles = [];

    if (this.mergedEditor) {
      const mergedContent = this.mergedEditor.getValue();
      if (mergedContent) {
        this.downloadFile(`${folderName}-MERGED.sql`, mergedContent);
        downloadedFiles.push("MERGED");
      }
    }

    setTimeout(() => {
      if (this.selectEditor) {
        const selectContent = this.selectEditor.getValue();
        if (selectContent) {
          this.downloadFile(`${folderName}-SELECT.sql`, selectContent);
          downloadedFiles.push("SELECT");
        }
      }

      if (this.validationEditor) {
        const validationContent = this.validationEditor.getValue();
        if (validationContent) {
          this.downloadFile(`${folderName}-VALIDATION.sql`, validationContent);
          downloadedFiles.push("VALIDATION");
        }
      }

      if (downloadedFiles.length > 0) {
        this.showSuccess(`Downloaded ${downloadedFiles.length} file${downloadedFiles.length > 1 ? "s" : ""}`);
      }
    }, 500);
  }

  downloadFile(fileName, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  showResult() {
    const emptyState = document.getElementById("merge-sql-result-empty");
    const resultActions = document.getElementById("merge-sql-result-actions");
    const clearBtn = document.getElementById("merge-sql-clear-btn");
    const reportActionsButtons = document.getElementById("merge-sql-report-actions-buttons");

    if (emptyState) emptyState.style.display = "none";
    if (resultActions) resultActions.classList.add("visible");
    if (clearBtn) clearBtn.style.display = "block";
    if (reportActionsButtons) reportActionsButtons.classList.toggle("visible", this.currentTab === "report");
  }

  hideResult() {
    const emptyState = document.getElementById("merge-sql-result-empty");
    const resultActions = document.getElementById("merge-sql-result-actions");
    const clearBtn = document.getElementById("merge-sql-clear-btn");
    const insights = document.getElementById("merge-sql-insights");
    const reportActionsButtons = document.getElementById("merge-sql-report-actions-buttons");

    if (emptyState) emptyState.style.display = "flex";
    if (resultActions) resultActions.classList.remove("visible");
    if (clearBtn) clearBtn.style.display = "none";
    if (insights) insights.style.display = "none";
    if (reportActionsButtons) reportActionsButtons.classList.remove("visible");
  }

  updateDuplicatesInsight() {
    const insights = document.getElementById("merge-sql-insights");
    const insightTitle = document.getElementById("merge-sql-insight-title");
    const duplicatesText = document.getElementById("merge-sql-duplicates-text");
    const viewDuplicatesBtn = document.getElementById("merge-sql-view-duplicates");
    const viewReportBtn = document.getElementById("merge-sql-view-report");

    const hasDuplicates = this.result && this.result.duplicates.length > 0;
    const hasDangerous = this.result?.report?.dangerousStatements?.length > 0;
    const hasReport = this.result && this.result.report;

    // Show insight panel if there are duplicates or dangerous statements
    if (!hasDuplicates && !hasDangerous) {
      if (insights) insights.style.display = "none";
      return;
    }

    if (insights) {
      insights.style.display = "flex";
      insights.classList.remove("insights-warning", "insights-danger");
      insights.classList.add(hasDangerous ? "insights-danger" : "insights-warning");
    }

    const messages = [];
    if (hasDuplicates) {
      messages.push(`${this.result.duplicates.length} duplicate${this.result.duplicates.length === 1 ? "" : "s"}`);
    }
    if (hasDangerous) {
      messages.push(`${this.result.report.dangerousStatements.length} dangerous statement${this.result.report.dangerousStatements.length === 1 ? "" : "s"}`);
    }

    if (insightTitle) {
      insightTitle.textContent = hasDangerous ? "Issues Detected" : "Duplicate Queries Detected";
    }

    if (duplicatesText) {
      duplicatesText.textContent = `${messages.join(", ")} detected`;
    }

    if (viewDuplicatesBtn) viewDuplicatesBtn.style.display = hasDuplicates ? "" : "none";

    if (hasReport && viewReportBtn) {
      viewReportBtn.style.display = "";
    }
  }

  showDuplicatesModal() {
    const modal = document.getElementById("merge-sql-duplicates-modal");
    const list = document.getElementById("merge-sql-duplicates-list");

    if (!this.result || !this.result.duplicates.length) return;

    let html = "";
    for (const dup of this.result.duplicates) {
      html += `
        <div class="duplicate-item">
          <div class="duplicate-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            Found in ${dup.files.length} files
          </div>
          <div class="duplicate-files">
            ${dup.files.map((f) => `<span class="duplicate-file-tag">${this.escapeHtml(f)}</span>`).join("")}
          </div>
          <pre class="duplicate-statement">${this.escapeHtml(dup.statement.slice(0, 500))}${dup.statement.length > 500 ? "..." : ""}</pre>
        </div>
      `;
    }

    if (list) list.innerHTML = html;
    if (modal) modal.style.display = "flex";
  }

  hideDuplicatesModal() {
    const modal = document.getElementById("merge-sql-duplicates-modal");
    if (modal) modal.style.display = "none";
  }

  renderReport() {
    if (!this.result?.report) return;

    this.renderSummaryTab();
    this.renderTableDetailTab();
  }

  renderSummaryTab() {
    const dangerousContainer = document.getElementById("merge-sql-report-dangerous");
    const statementsContainer = document.getElementById("merge-sql-report-statements");
    const squadsContainer = document.getElementById("merge-sql-report-squads");
    const featuresContainer = document.getElementById("merge-sql-report-features");
    const authorsContainer = document.getElementById("merge-sql-report-authors");

    const { statementCounts, squadCounts, featureCounts, nonSystemAuthors, dangerousStatements } = this.result.report;

    // Dangerous statements (hidden when empty)
    if (dangerousContainer) {
      if (dangerousStatements && dangerousStatements.length > 0) {
        let dangerousHtml = `<h4>Dangerous Statements</h4>`;
        for (const item of dangerousStatements) {
          const typeLabel = item.type === "DELETE" ? "DELETE" : item.type === "MERGE_DELETE" ? "MERGE DELETE" : "UPDATE NO WHERE";
          const badgeClass = item.type === "DELETE" || item.type === "MERGE_DELETE" ? "delete" : "update-no-where";
          dangerousHtml += `<div class="report-danger-item">
            <span class="report-file-tag">${this.escapeHtml(item.fileName)}</span>
            <span class="report-type-badge report-type-badge--${badgeClass}">${typeLabel}</span>
            <pre class="report-danger-statement">${this.escapeHtml(item.statement.slice(0, 300))}${item.statement.length > 300 ? "..." : ""}</pre>
          </div>`;
        }
        dangerousContainer.innerHTML = dangerousHtml;
        dangerousContainer.style.display = "";
      } else {
        dangerousContainer.innerHTML = "";
        dangerousContainer.style.display = "none";
      }
    }

    // All Tables Summary (with sticky header)
    if (statementsContainer) {
      if (statementCounts.length > 0) {
        let tableHtml = `<div class="report-sticky-header">
          <h4>All Tables Summary</h4>
          <div class="report-sticky-header-columns">
            <span>Table</span><span>INSERT</span><span>MERGE</span><span>UPDATE</span><span>Total</span>
          </div>
        </div>
        <table class="report-table report-table-no-header">
          <tbody>`;
        for (const row of statementCounts) {
          tableHtml += `<tr>
            <td>${this.escapeHtml(row.table.toUpperCase())}</td>
            <td>${row.insert}</td>
            <td>${row.merge}</td>
            <td>${row.update}</td>
            <td>${row.total}</td>
          </tr>`;
        }
        tableHtml += `</tbody></table>`;
        statementsContainer.innerHTML = tableHtml;
      } else {
        statementsContainer.innerHTML = `<h4>All Tables Summary</h4><div class="report-success">No DML statements found</div>`;
      }
    }

    // Per-Squad Summary — full squad detail
    if (squadsContainer) {
      squadsContainer.innerHTML = this.buildSquadDetailHtml("Per-Squad Summary");
    }

    // Per-Feature Summary (Grouped by Squad)
    if (featuresContainer) {
      if (featureCounts && featureCounts.length > 0) {
        const squadGroups = new Map();
        const noSquadFeatures = [];
        for (const row of featureCounts) {
          if (row.squad) {
            const key = row.squad.toUpperCase();
            if (!squadGroups.has(key)) squadGroups.set(key, { displayName: row.squad, features: [] });
            squadGroups.get(key).features.push(row);
          } else {
            noSquadFeatures.push(row);
          }
        }

        let featuresHtml = `<h4>Per-Feature Summary</h4>`;
        const sortedSquadKeys = Array.from(squadGroups.keys()).sort();
        for (const key of sortedSquadKeys) {
          const group = squadGroups.get(key);
          featuresHtml += `<div class="report-squad-group"><h5>${this.escapeHtml(group.displayName)}</h5>
            <table class="report-table">
              <thead><tr><th>Feature</th><th>INSERT</th><th>MERGE</th><th>UPDATE</th><th>Total</th></tr></thead>
              <tbody>`;
          for (const row of group.features) {
            featuresHtml += `<tr>
              <td>${this.escapeHtml(row.feature)}</td>
              <td>${row.insert}</td>
              <td>${row.merge}</td>
              <td>${row.update}</td>
              <td>${row.total}</td>
            </tr>`;
          }
          featuresHtml += `</tbody></table></div>`;
        }

        if (noSquadFeatures.length > 0) {
          featuresHtml += `<div class="report-squad-group"><h5>Other</h5>
            <table class="report-table">
              <thead><tr><th>Feature</th><th>INSERT</th><th>MERGE</th><th>UPDATE</th><th>Total</th></tr></thead>
              <tbody>`;
          for (const row of noSquadFeatures) {
            featuresHtml += `<tr>
              <td>${this.escapeHtml(row.feature)}</td>
              <td>${row.insert}</td>
              <td>${row.merge}</td>
              <td>${row.update}</td>
              <td>${row.total}</td>
            </tr>`;
          }
          featuresHtml += `</tbody></table></div>`;
        }

        featuresContainer.innerHTML = featuresHtml;
      } else {
        featuresContainer.innerHTML = `<h4>Per-Feature Summary</h4><div class="report-success">No feature metadata found in file names</div>`;
      }
    }

    // Non-SYSTEM Authors
    if (authorsContainer) {
      if (nonSystemAuthors.length > 0) {
        let authorsHtml = `<h4>Non-SYSTEM Authors</h4>`;
        for (const item of nonSystemAuthors) {
          authorsHtml += `<div class="report-warning-item">
            <span class="report-file-tag">${this.escapeHtml(item.fileName)}</span>
            <span class="report-field-label">${this.escapeHtml(item.field)}</span>
            <span class="report-value">${this.escapeHtml(item.value)}</span>
          </div>`;
        }
        authorsContainer.innerHTML = authorsHtml;
      } else {
        authorsContainer.innerHTML = `<h4>Non-SYSTEM Authors</h4><div class="report-success">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          No issues found — all CREATED_BY/UPDATED_BY values are SYSTEM
        </div>`;
      }
    }
  }

  renderTableDetailTab() {
    const tableSquadsContainer = document.getElementById("merge-sql-report-table-squads");
    const { tableSquadCounts, tableSquadFeatureCounts } = this.result.report;

    if (!tableSquadsContainer) return;

    if (!tableSquadCounts || tableSquadCounts.length === 0) {
      tableSquadsContainer.innerHTML = `<h4>Table Detail</h4><div class="report-success">No table+squad data found</div>`;
      return;
    }

    // Build feature lookup: table|squad -> features[]
    const featureLookup = new Map();
    if (tableSquadFeatureCounts) {
      for (const row of tableSquadFeatureCounts) {
        const key = `${row.table.toUpperCase()}|${row.squad.toUpperCase()}`;
        if (!featureLookup.has(key)) featureLookup.set(key, []);
        featureLookup.get(key).push(row);
      }
    }

    // Group by table
    const tableGroups = new Map();
    for (const row of tableSquadCounts) {
      const key = row.table.toUpperCase();
      if (!tableGroups.has(key)) tableGroups.set(key, []);
      tableGroups.get(key).push(row);
    }

    let html = `<h4>Table Detail</h4>`;
    let rowIndex = 0;

    for (const [tableKey, rows] of tableGroups) {
      html += `<div class="report-squad-group"><h5>${this.escapeHtml(rows[0].table.toUpperCase())}</h5>
<table class="report-table report-table-expandable">
           <thead><tr><th>Squad</th><th>INSERT</th><th>MERGE</th><th>UPDATE</th><th>Total</th></tr></thead>
           <tbody>`;

      const totals = { insert: 0, merge: 0, update: 0, total: 0 };
      for (const row of rows) {
        totals.insert += row.insert;
        totals.merge += row.merge;
        totals.update += row.update;
        totals.total += row.total;

        const featureKey = `${row.table.toUpperCase()}|${row.squad.toUpperCase()}`;
        const features = featureLookup.get(featureKey) || [];
        const rowId = `table-detail-row-${rowIndex++}`;

        html += `<tr class="row-expandable" data-row-id="${rowId}">
          <td>
            <span class="row-expand-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
            ${this.escapeHtml(row.squad)}
          </td>
<td>${row.insert}</td>
           <td>${row.merge}</td>
           <td>${row.update}</td>
           <td>${row.total}</td>
         </tr>
         <tr class="row-feature-details" id="${rowId}">
           <td colspan="5">
            <div class="feature-details-content">`;

        if (features.length > 0) {
          for (const f of features) {
            const featureName = f.feature || "Feature not Mentioned";
            html += `<div class="feature-item">
              <span class="${f.feature ? "feature-name" : "feature-not-mentioned"}">${this.escapeHtml(featureName)}</span>
              <span>— ${f.total} statement${f.total !== 1 ? "s" : ""}</span>
            </div>`;
          }
        } else {
          html += `<div class="feature-item"><span class="feature-not-mentioned">Feature not Mentioned</span></div>`;
        }

        html += `</div></td></tr>`;
      }

      html += `</tbody><tfoot><tr class="report-table-total">
        <td>Total</td>
        <td>${totals.insert}</td>
        <td>${totals.merge}</td>
        <td>${totals.update}</td>
        <td>${totals.total}</td>
      </tr></tfoot></table></div>`;
    }

    tableSquadsContainer.innerHTML = html;
    this.bindTableDetailEvents();
  }

  bindTableDetailEvents() {
    const expandableRows = document.querySelectorAll(".report-table-expandable .row-expandable");
    expandableRows.forEach((row) => {
      row.addEventListener("click", () => {
        const rowId = row.dataset.rowId;
        const detailRow = document.getElementById(rowId);
        if (detailRow) {
          row.classList.toggle("expanded");
          detailRow.classList.toggle("visible");
        }
      });
    });
  }

  buildSquadDetailHtml(title = "Squad Detail") {
    const { squadTableCounts, squadCounts } = this.result.report;

    if (!squadTableCounts || squadTableCounts.length === 0) {
      return `<h4>${title}</h4><div class="report-success">No squad data found</div>`;
    }

    // Group by squad
    const squadGroups = new Map();
    for (const row of squadTableCounts) {
      const key = row.squad.toUpperCase();
      if (!squadGroups.has(key)) squadGroups.set(key, { displayName: row.squad, tables: [] });
      squadGroups.get(key).tables.push(row);
    }

    // Get squad totals from squadCounts
    const squadTotals = new Map();
    if (squadCounts) {
      for (const s of squadCounts) {
        squadTotals.set(s.squad.toUpperCase(), s);
      }
    }

    let html = `<h4>${title}</h4>`;
    const sortedSquadKeys = Array.from(squadGroups.keys()).sort();

    for (const key of sortedSquadKeys) {
      const group = squadGroups.get(key);
      const totals = squadTotals.get(key) || { total: 0 };
      const tableCount = group.tables.length;

      html += `<div class="squad-detail-group">
        <div class="squad-detail-header">
          <h5>${this.escapeHtml(group.displayName)}</h5>
          <div class="squad-detail-stats">
            <span class="squad-detail-stat">
              <span class="squad-detail-stat-value">${tableCount}</span> table${tableCount !== 1 ? "s" : ""}
            </span>
            <span class="squad-detail-stat">
              <span class="squad-detail-stat-value">${totals.total}</span> statement${totals.total !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <table class="report-table">
          <thead><tr><th>Table</th><th>INSERT</th><th>MERGE</th><th>UPDATE</th><th>Total</th></tr></thead>
          <tbody>`;

      for (const row of group.tables) {
        html += `<tr>
          <td>${this.escapeHtml(row.table.toUpperCase())}</td>
          <td>${row.insert}</td>
          <td>${row.merge}</td>
          <td>${row.update}</td>
          <td>${row.total}</td>
        </tr>`;
      }

      html += `</tbody></table></div>`;
    }

    return html;
  }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  updateUI() {
    this.renderFileList();
    this.updateMergeButton();
    this.updateSortButtons();
    this.updateFileCount();
    this.updateClearFilesButton();
  }

  updateClearFilesButton() {
    const clearFilesBtn = document.getElementById("merge-sql-clear-files-btn");
    if (!clearFilesBtn) return;

    clearFilesBtn.style.display = this.files.length > 0 ? "block" : "none";
  }

  updateFileCount() {
    const fileCountBadge = document.getElementById("merge-sql-file-count");
    if (fileCountBadge) {
      if (this.files.length > 0) {
        fileCountBadge.textContent = `${this.files.length} file${this.files.length === 1 ? "" : "s"}`;
        fileCountBadge.style.display = "";
      } else {
        fileCountBadge.style.display = "none";
      }
    }
  }

  renderFileList() {
    const emptyState = document.getElementById("merge-sql-empty-state");
    const fileItems = document.getElementById("merge-sql-file-items");

    if (this.files.length === 0) {
      if (emptyState) emptyState.style.display = "flex";
      if (fileItems) fileItems.innerHTML = "";
      return;
    }

    if (emptyState) emptyState.style.display = "none";

    const isManual = this.sortOrder === "manual";
    const groups = MergeSqlService.groupFilesByTable(this.files);

    const sortedTableNames = this.getSortedTableNames(groups);

    let html = "";
    for (const tableName of sortedTableNames) {
      const fileGroup = groups.get(tableName);
      if (!fileGroup || fileGroup.length === 0) continue;

      const isExpanded = this.expandedTables.has(tableName);

      html += `<div class="table-card${isManual ? " table-card-draggable" : ""}" data-table-name="${this.escapeHtml(tableName)}">`;

      html += `<div class="table-card-header">`;
      if (isManual) {
        html += `<div class="table-card-drag-handle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="9" cy="5" r="1"></circle>
              <circle cx="9" cy="12" r="1"></circle>
              <circle cx="9" cy="19" r="1"></circle>
              <circle cx="15" cy="5" r="1"></circle>
              <circle cx="15" cy="12" r="1"></circle>
              <circle cx="15" cy="19" r="1"></circle>
            </svg>
          </div>`;
      }
      html += `<button class="table-card-toggle" data-table-name="${this.escapeHtml(tableName)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toggle-chevron${isExpanded ? "" : " toggle-chevron-collapsed"}">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>`;
      html += `<span class="table-card-title">${this.escapeHtml(tableName)}</span>`;
      html += `<span class="table-card-count">${fileGroup.length} file${fileGroup.length !== 1 ? "s" : ""}</span>`;
      html += `</div>`;

      html += `<div class="table-card-body${isExpanded ? "" : " table-card-body-collapsed"}">`;
      for (const file of fileGroup) {
        const isEdited = file.editedContent !== null;
        html += `<div class="file-item${isEdited ? " is-edited" : ""}" data-id="${file.id}">
            <div class="file-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </div>
            <div class="file-info">
              <div class="file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
            </div>
            <button class="btn btn-ghost btn-xs btn-edit-file" data-id="${file.id}" title="View / Edit">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
              </svg>
            </button>
            <button class="btn btn-ghost btn-xs btn-remove" data-id="${file.id}" title="Remove">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>`;
      }
      html += `</div></div>`;
    }

    if (fileItems) {
      fileItems.innerHTML = html;
      this.bindFileItemEvents();
      this.bindCardEvents();

      if (isManual) {
        this.bindCardDragEvents();
      }
    }
  }

  getSortedTableNames(groups) {
    const allNames = [...groups.keys()];
    if (this.sortOrder === "manual" && this.tableOrder.length > 0) {
      const ordered = [];
      const seen = new Set();
      for (const name of this.tableOrder) {
        if (groups.has(name) && !seen.has(name)) {
          ordered.push(name);
          seen.add(name);
        }
      }
      for (const name of allNames) {
        if (!seen.has(name)) {
          ordered.push(name);
        }
      }
      return ordered;
    }
    return allNames.sort((a, b) => {
      const cmp = a.toLowerCase().localeCompare(b.toLowerCase());
      return this.sortOrder === "desc" ? -cmp : cmp;
    });
  }

  bindFileItemEvents() {
    const fileItemsContainer = document.getElementById("merge-sql-file-items");
    const fileItems = fileItemsContainer?.querySelectorAll(".file-item");

    if (!fileItems) return;

    fileItems.forEach((item) => {
      const editBtn = item.querySelector(".btn-edit-file");
      if (editBtn) {
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const fileId = editBtn.dataset.id;
          this.openFileInEditor(fileId);
        });
      }

      const removeBtn = item.querySelector(".btn-remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const fileId = removeBtn.dataset.id;
          this.removeFile(fileId);
        });
      }
    });
  }

  bindCardEvents() {
    const toggles = document.querySelectorAll("#merge-sql-file-items .table-card-toggle");
    toggles.forEach((toggle) => {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const tableName = toggle.dataset.tableName;
        if (this.expandedTables.has(tableName)) {
          this.expandedTables.delete(tableName);
        } else {
          this.expandedTables.add(tableName);
        }
        this.saveStateToIndexedDB();
        this.renderFileList();
      });
    });
  }

  bindCardDragEvents() {
    const container = document.getElementById("merge-sql-file-items");
    if (!container) return;

    const dragHandles = container.querySelectorAll(".table-card-drag-handle");
    dragHandles.forEach((handle) => {
      handle.addEventListener("mousedown", (e) => this.handleCardDragStart(e));
    });

    container.addEventListener("mousemove", (e) => this.handleCardDragMove(e));
    container.addEventListener("mouseup", (e) => this.handleCardDragEnd(e));
    container.addEventListener("mouseleave", (e) => this.handleCardDragEnd(e));
  }

  handleCardDragStart(e) {
    e.preventDefault();
    const card = e.target.closest(".table-card");
    if (!card) return;

    this.draggedCard = card;
    this.dragCardStartY = e.clientY;
    card.classList.add("dragging");
  }

  handleCardDragMove(e) {
    if (!this.draggedCard) return;

    const container = document.getElementById("merge-sql-file-items");
    const cards = container?.querySelectorAll(".table-card:not(.dragging)");

    if (!cards) return;

    cards.forEach((card) => card.classList.remove("drag-over"));

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (e.clientY > rect.top && e.clientY < rect.bottom) {
        card.classList.add("drag-over");
        break;
      }
    }
  }

  handleCardDragEnd(e) {
    if (!this.draggedCard) return;

    const container = document.getElementById("merge-sql-file-items");
    const dragOverCard = container?.querySelector(".table-card.drag-over");

    if (dragOverCard && dragOverCard !== this.draggedCard) {
      const draggedTableName = this.draggedCard.dataset.tableName;
      const targetTableName = dragOverCard.dataset.tableName;

      const draggedIdx = this.tableOrder.indexOf(draggedTableName);
      const targetIdx = this.tableOrder.indexOf(targetTableName);

      if (draggedIdx !== -1 && targetIdx !== -1) {
        this.tableOrder.splice(draggedIdx, 1);
        this.tableOrder.splice(targetIdx, 0, draggedTableName);
      } else if (draggedIdx !== -1) {
        this.tableOrder.splice(draggedIdx, 1);
        this.tableOrder.push(draggedTableName);
      }

      this.applySorting();
      this.saveStateToIndexedDB();
      this.saveFilesToIndexedDB();
    }

    this.draggedCard.classList.remove("dragging");
    container?.querySelectorAll(".table-card").forEach((el) => el.classList.remove("drag-over"));
    this.draggedCard = null;
    this.renderFileList();
  }

  updateMergeButton() {
    const mergeBtn = document.getElementById("merge-sql-btn");
    if (mergeBtn) {
      mergeBtn.disabled = this.files.length === 0;
    }
  }

  formatReportAsText() {
    if (!this.result?.report) return "No report data available.";

    const report = this.result.report;
    const lines = [];

    const subtab = this.currentSubtab === "table-detail" ? "table-detail" : "summary";

    if (subtab === "summary") {
      lines.push("📊 *Merge SQL Report — Summary*");
      lines.push("");

      if (report.dangerousStatements && report.dangerousStatements.length > 0) {
        lines.push("⚠️ *Dangerous Statements*");
        for (const item of report.dangerousStatements) {
          const typeLabel = item.type === "DELETE" ? "DELETE" : item.type === "MERGE_DELETE" ? "MERGE DELETE" : "UPDATE NO WHERE";
          lines.push(`*${item.fileName}* [${typeLabel}]`);
          lines.push(`\`${item.statement.slice(0, 200)}${item.statement.length > 200 ? "..." : ""}\``);
        }
        lines.push("");
      }

      if (report.statementCounts && report.statementCounts.length > 0) {
        lines.push(`📋 *All Tables Summary* (${report.statementCounts.length} table${report.statementCounts.length !== 1 ? "s" : ""})`);
        lines.push("");
        for (const row of report.statementCounts) {
          lines.push(`*${row.table.toUpperCase()}*`);
          lines.push(`INSERT: ${row.insert} | MERGE: ${row.merge} | UPDATE: ${row.update} | Total: ${row.total}`);
          lines.push("");
        }
      }

      if (report.squadCounts && report.squadCounts.length > 0) {
        lines.push("📋 *Per-Squad Summary*");
        lines.push("");
        for (const row of report.squadCounts) {
          lines.push(`*${row.squad}* — ${row.total} statement${row.total !== 1 ? "s" : ""}`);
          lines.push(`INSERT: ${row.insert} | MERGE: ${row.merge} | UPDATE: ${row.update} | Total: ${row.total}`);
          lines.push("");
        }
      }

      if (report.featureCounts && report.featureCounts.length > 0) {
        lines.push("📋 *Per-Feature Summary*");
        lines.push("");
        const squadGroups = new Map();
        const noSquadFeatures = [];
        for (const row of report.featureCounts) {
          if (row.squad) {
            const key = row.squad.toUpperCase();
            if (!squadGroups.has(key)) squadGroups.set(key, { displayName: row.squad, features: [] });
            squadGroups.get(key).features.push(row);
          } else {
            noSquadFeatures.push(row);
          }
        }
        const sortedSquadKeys = Array.from(squadGroups.keys()).sort();
        for (const key of sortedSquadKeys) {
          const group = squadGroups.get(key);
          lines.push(`*${group.displayName}*`);
          for (const row of group.features) {
            lines.push(`${row.feature || "Feature not Mentioned"} → INS: ${row.insert} | MRG: ${row.merge} | UPD: ${row.update} | Tot: ${row.total}`);
          }
          lines.push("");
        }
        if (noSquadFeatures.length > 0) {
          lines.push("*Other*");
          for (const row of noSquadFeatures) {
            lines.push(`${row.feature || "Feature not Mentioned"} → INS: ${row.insert} | MRG: ${row.merge} | UPD: ${row.update} | Tot: ${row.total}`);
          }
          lines.push("");
        }
      }

      if (report.nonSystemAuthors && report.nonSystemAuthors.length > 0) {
        lines.push("⚠️ *Non-SYSTEM Authors*");
        for (const item of report.nonSystemAuthors) {
          lines.push(`${item.fileName} — ${item.field}: ${item.value}`);
        }
        lines.push("");
      } else {
        lines.push("✅ *Non-SYSTEM Authors* — All values are SYSTEM");
        lines.push("");
      }

    } else if (subtab === "table-detail") {
      lines.push("📊 *Merge SQL Report — Table Detail*");
      lines.push("");

      if (report.tableSquadCounts && report.tableSquadCounts.length > 0) {
        const featureLookup = new Map();
        if (report.tableSquadFeatureCounts) {
          for (const row of report.tableSquadFeatureCounts) {
            const key = `${row.table.toUpperCase()}|${row.squad.toUpperCase()}`;
            if (!featureLookup.has(key)) featureLookup.set(key, []);
            featureLookup.get(key).push(row);
          }
        }

        const tableGroups = new Map();
        for (const row of report.tableSquadCounts) {
          const key = row.table.toUpperCase();
          if (!tableGroups.has(key)) tableGroups.set(key, []);
          tableGroups.get(key).push(row);
        }

        for (const [tableKey, rows] of tableGroups) {
          lines.push(`*${rows[0].table.toUpperCase()}*`);
          const totals = { insert: 0, merge: 0, update: 0, total: 0 };
          for (const row of rows) {
            totals.insert += row.insert;
            totals.merge += row.merge;
            totals.update += row.update;
            totals.total += row.total;
            lines.push(`${row.squad} → INS: ${row.insert} | MRG: ${row.merge} | UPD: ${row.update} | Tot: ${row.total}`);

            const featureKey = `${row.table.toUpperCase()}|${row.squad.toUpperCase()}`;
            const features = featureLookup.get(featureKey) || [];
            for (const f of features) {
              const featureName = f.feature || "Feature not Mentioned";
              lines.push(`  ${featureName} — ${f.total} statement${f.total !== 1 ? "s" : ""}`);
            }
          }
          lines.push(`_Total: INS: ${totals.insert} | MRG: ${totals.merge} | UPD: ${totals.update} | Tot: ${totals.total}_`);
          lines.push("");
        }
      } else {
        lines.push("No table+squad data found");
      }

    }

    return lines.join("\n");
  }

  async handleCopyReportText() {
    if (!this.result?.report) {
      this.showError("No report data to copy");
      return;
    }
    const text = this.formatReportAsText();
    await this.copyToClipboard(text);
  }

  getActiveReportElement() {
    if (this.currentSubtab === "table-detail") {
      return document.getElementById("merge-sql-report-table-detail");
    }
    return document.getElementById("merge-sql-report-summary");
  }

  async captureReportImage() {
    const el = this.getActiveReportElement();
    if (!el) {
      this.showError("No report content to capture");
      return null;
    }

    const reportContent = el.querySelector(".report-content") || el;

    const previouslyCollapsed = reportContent.querySelectorAll(".row-feature-details");
    previouslyCollapsed.forEach((row) => row.classList.add("temp-visible", "visible"));
    const expandableRows = reportContent.querySelectorAll(".row-expandable");
    expandableRows.forEach((row) => row.classList.add("temp-expanded", "expanded"));

    const originalOverflow = reportContent.style.overflow;
    const originalHeight = reportContent.style.height;
    const originalMaxHeight = reportContent.style.maxHeight;
    reportContent.style.overflow = "visible";
    reportContent.style.height = "auto";
    reportContent.style.maxHeight = "none";

    const computedBg = window.getComputedStyle(reportContent).backgroundColor;
    const bgColor = (computedBg && computedBg !== "rgba(0, 0, 0, 0)") ? computedBg : "#ffffff";

    try {
      const canvas = await html2canvas(reportContent, {
        backgroundColor: bgColor,
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: reportContent.scrollWidth,
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.className = document.documentElement.className;
          const dataTheme = document.documentElement.getAttribute("data-theme");
          if (dataTheme) clonedDoc.documentElement.setAttribute("data-theme", dataTheme);
        },
      });
      return canvas;
    } finally {
      previouslyCollapsed.forEach((row) => {
        row.classList.remove("temp-visible", "visible");
      });
      expandableRows.forEach((row) => {
        row.classList.remove("temp-expanded", "expanded");
      });
      reportContent.style.overflow = originalOverflow;
      reportContent.style.height = originalHeight;
      reportContent.style.maxHeight = originalMaxHeight;
    }
  }

  async handleCopyReportImage() {
    if (!this.result?.report) {
      this.showError("No report data to capture");
      return;
    }

    try {
      const canvas = await this.captureReportImage();
      if (!canvas) return;

      canvas.toBlob(async (blob) => {
        if (!blob) {
          this.showError("Failed to generate image");
          return;
        }
        try {
          const { Image } = await import("@tauri-apps/api/image");
          const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
          const pngBytes = new Uint8Array(await blob.arrayBuffer());
          const tauriImage = await Image.fromBytes(pngBytes);
          await writeImage(tauriImage);
          this.showSuccess("Report image copied to clipboard!");
        } catch (clipboardError) {
          console.error("Clipboard image write failed:", clipboardError);
          this.showError("Failed to copy image to clipboard. Try Download instead.");
        }
      }, "image/png");
    } catch (error) {
      console.error("Image capture failed:", error);
      this.showError("Failed to capture report image");
    }
  }

  async handleDownloadReportImage() {
    if (!this.result?.report) {
      this.showError("No report data to download");
      return;
    }

    try {
      const canvas = await this.captureReportImage();
      if (!canvas) return;

      const folderName = document.getElementById("merge-sql-folder-name")?.value || "MERGED";
      const subtabLabel = this.currentSubtab === "table-detail" ? "TableDetail" : "Summary";
      const fileName = `${folderName}-Report-${subtabLabel}.png`;

      await new Promise((resolve) => {
        canvas.toBlob(async (blob) => {
          if (!blob) {
            this.showError("Failed to generate image");
            resolve();
            return;
          }
          try {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const { writeFile } = await import("@tauri-apps/plugin-fs");
            const savePath = await save({
              filters: [{ name: "PNG Image", extensions: ["png"] }],
              defaultPath: fileName,
            });
            if (savePath) {
              await writeFile(savePath, new Uint8Array(await blob.arrayBuffer()));
              this.showSuccess(`Downloaded ${fileName}`);
            }
          } catch (saveError) {
            console.error("Image save failed:", saveError);
            this.showError("Failed to save report image");
          }
          resolve();
        }, "image/png");
      });
    } catch (error) {
      console.error("Image download failed:", error);
      this.showError("Failed to download report image");
    }
  }
}
