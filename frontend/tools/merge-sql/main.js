/**
 * Merge SQL Tool
 * Merges multiple SQL files into combined MERGE/INSERT/UPDATE and SELECT files
 */

import * as monaco from "monaco-editor";
import "./styles.css";
import { BaseTool } from "../../core/BaseTool.js";
import { getIconSvg } from "./icon.js";
import { MergeSqlTemplate } from "./template.js";
import { MergeSqlService } from "./service.js";
import { ensureMonacoWorkers, setupMonacoOracle } from "../../core/MonacoOracle.js";

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
    this.mergedEditor = null;
    this.selectEditor = null;
    this.currentTab = "merged";
    this.result = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return MergeSqlTemplate;
  }

  async onMount() {
    this.initMonaco();
    this.bindEvents();
    this.updateUI();
  }

  onUnmount() {
    if (this.mergedEditor) {
      this.mergedEditor.dispose();
      this.mergedEditor = null;
    }
    if (this.selectEditor) {
      this.selectEditor.dispose();
      this.selectEditor = null;
    }
  }

  initMonaco() {
    ensureMonacoWorkers();
    setupMonacoOracle();

    const mergedContainer = document.getElementById("merge-sql-merged-editor");
    const selectContainer = document.getElementById("merge-sql-select-editor");

    const editorOptions = {
      language: "sql",
      theme: "vs-dark",
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      automaticLayout: true,
      readOnly: false,
      padding: { top: 12, bottom: 12 },
    };

    if (mergedContainer) {
      this.mergedEditor = monaco.editor.create(mergedContainer, {
        ...editorOptions,
        value: "",
      });
    }

    if (selectContainer) {
      this.selectEditor = monaco.editor.create(selectContainer, {
        ...editorOptions,
        value: "",
      });
    }
  }

  bindEvents() {
    const addFilesBtn = document.getElementById("merge-sql-add-files");
    const addFolderBtn = document.getElementById("merge-sql-add-folder");
    const fileInput = document.getElementById("merge-sql-file-input");
    const folderInput = document.getElementById("merge-sql-folder-input");
    const mergeBtn = document.getElementById("merge-sql-btn");
    const clearBtn = document.getElementById("merge-sql-clear-btn");
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
    const fileListContainer = document.getElementById("merge-sql-file-list");

    if (addFilesBtn) {
      addFilesBtn.addEventListener("click", () => fileInput?.click());
    }

    if (addFolderBtn) {
      addFolderBtn.addEventListener("click", () => folderInput?.click());
    }

    if (fileInput) {
      fileInput.addEventListener("change", (e) => this.handleFileSelect(e));
    }

    if (folderInput) {
      folderInput.addEventListener("change", (e) => this.handleFolderSelect(e));
    }

    if (mergeBtn) {
      mergeBtn.addEventListener("click", () => this.handleMerge());
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => this.handleClearAll());
    }

    if (copyBtn) {
      copyBtn.addEventListener("click", () => this.handleCopy());
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => this.handleDownload());
    }

    if (downloadAllBtn) {
      downloadAllBtn.addEventListener("click", () => this.handleDownloadAll());
    }

    if (sortAscBtn) {
      sortAscBtn.addEventListener("click", () => this.handleSort("asc"));
    }

    if (sortDescBtn) {
      sortDescBtn.addEventListener("click", () => this.handleSort("desc"));
    }

    if (sortManualBtn) {
      sortManualBtn.addEventListener("click", () => this.handleSort("manual"));
    }

    if (resultTabs) {
      resultTabs.addEventListener("click", (e) => {
        const tab = e.target.closest(".result-tab");
        if (tab) {
          this.handleTabSwitch(tab.dataset.tab);
        }
      });
    }

    if (viewDuplicatesBtn) {
      viewDuplicatesBtn.addEventListener("click", () => this.showDuplicatesModal());
    }

    if (closeDuplicatesBtn) {
      closeDuplicatesBtn.addEventListener("click", () => this.hideDuplicatesModal());
    }

    if (duplicatesCloseBtn) {
      duplicatesCloseBtn.addEventListener("click", () => this.hideDuplicatesModal());
    }

    if (fileListContainer) {
      fileListContainer.addEventListener("dragover", (e) => this.handleDragOver(e));
      fileListContainer.addEventListener("drop", (e) => this.handleDrop(e));
      fileListContainer.addEventListener("dragleave", (e) => this.handleDragLeave(e));
    }

    const container = document.querySelector(".merge-sql-container");
    if (container) {
      container.addEventListener("dragover", (e) => {
        e.preventDefault();
        container.classList.add("drag-active");
      });
      container.addEventListener("dragleave", (e) => {
        if (!container.contains(e.relatedTarget)) {
          container.classList.remove("drag-active");
        }
      });
      container.addEventListener("drop", (e) => {
        e.preventDefault();
        container.classList.remove("drag-active");
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

  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const items = e.dataTransfer?.items;
    if (!items) return;

    const files = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && file.name.toLowerCase().endsWith(".sql")) {
          files.push(file);
        }
      }
    }

    this.addFiles(files);
  }

  addFiles(files) {
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".sql")) continue;

      const exists = this.files.some((f) => f.name === file.name && f.file.size === file.size);
      if (exists) continue;

      this.files.push({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        name: file.name,
      });
    }

    this.applySorting();
    this.updateUI();
  }

  removeFile(fileId) {
    this.files = this.files.filter((f) => f.id !== fileId);
    this.updateUI();
  }

  handleSort(order) {
    this.sortOrder = order;
    this.applySorting();
    this.updateSortButtons();
    this.renderFileList();
  }

  applySorting() {
    if (this.sortOrder !== "manual") {
      this.files = MergeSqlService.sortFiles(this.files, this.sortOrder);
    }
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

  handleTabSwitch(tab) {
    this.currentTab = tab;

    const tabs = document.querySelectorAll(".result-tab");
    tabs.forEach((t) => t.classList.remove("active"));
    document.querySelector(`.result-tab[data-tab="${tab}"]`)?.classList.add("active");

    const mergedContent = document.getElementById("merge-sql-merged-content");
    const selectContent = document.getElementById("merge-sql-select-content");

    if (mergedContent) mergedContent.classList.toggle("active", tab === "merged");
    if (selectContent) selectContent.classList.toggle("active", tab === "select");

    if (tab === "merged" && this.mergedEditor) {
      this.mergedEditor.layout();
    } else if (tab === "select" && this.selectEditor) {
      this.selectEditor.layout();
    }
  }

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
      const parsedFiles = [];

      for (const fileItem of this.files) {
        const content = await MergeSqlService.readFileContent(fileItem.file);
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

      this.showResult();
      this.updateDuplicatesInsight();
      this.showSuccess("SQL files merged successfully!");
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

  handleClearAll() {
    this.files = [];
    this.result = null;
    if (this.mergedEditor) this.mergedEditor.setValue("");
    if (this.selectEditor) this.selectEditor.setValue("");
    this.hideResult();
    this.updateUI();
  }

  handleCopy() {
    const editor = this.currentTab === "merged" ? this.mergedEditor : this.selectEditor;
    if (editor) {
      const content = editor.getValue();
      this.copyToClipboard(content);
    }
  }

  handleDownload() {
    const folderName = document.getElementById("merge-sql-folder-name")?.value || "MERGED";
    const suffix = this.currentTab === "merged" ? "-MERGED.sql" : "-SELECT.sql";
    const fileName = `${folderName}${suffix}`;

    const editor = this.currentTab === "merged" ? this.mergedEditor : this.selectEditor;
    if (editor) {
      const content = editor.getValue();
      this.downloadFile(fileName, content);
    }
  }

  handleDownloadAll() {
    const folderName = document.getElementById("merge-sql-folder-name")?.value || "MERGED";

    if (this.mergedEditor) {
      const mergedContent = this.mergedEditor.getValue();
      if (mergedContent) {
        this.downloadFile(`${folderName}-MERGED.sql`, mergedContent);
      }
    }

    setTimeout(() => {
      if (this.selectEditor) {
        const selectContent = this.selectEditor.getValue();
        if (selectContent) {
          this.downloadFile(`${folderName}-SELECT.sql`, selectContent);
        }
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

    if (emptyState) emptyState.style.display = "none";
    if (resultActions) resultActions.style.display = "flex";
    if (clearBtn) clearBtn.style.display = "block";
  }

  hideResult() {
    const emptyState = document.getElementById("merge-sql-result-empty");
    const resultActions = document.getElementById("merge-sql-result-actions");
    const clearBtn = document.getElementById("merge-sql-clear-btn");
    const insights = document.getElementById("merge-sql-insights");

    if (emptyState) emptyState.style.display = "flex";
    if (resultActions) resultActions.style.display = "none";
    if (clearBtn) clearBtn.style.display = "none";
    if (insights) insights.style.display = "none";
  }

  updateDuplicatesInsight() {
    const insights = document.getElementById("merge-sql-insights");
    const duplicatesText = document.getElementById("merge-sql-duplicates-text");

    if (!this.result || this.result.duplicates.length === 0) {
      if (insights) insights.style.display = "none";
      return;
    }

    if (insights) insights.style.display = "flex";
    if (duplicatesText) {
      duplicatesText.textContent = `${this.result.duplicates.length} duplicate ${this.result.duplicates.length === 1 ? "query" : "queries"} found across files`;
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

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  updateUI() {
    this.renderFileList();
    this.updateMergeButton();
    this.updateSortButtons();
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

    let html = "";
    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      const metadata = MergeSqlService.parseFileName(file.name);
      const size = this.formatFileSize(file.file.size);

      html += `
        <div class="file-item" draggable="true" data-id="${file.id}" data-index="${i}">
          <div class="drag-handle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="9" cy="5" r="1"></circle>
              <circle cx="9" cy="12" r="1"></circle>
              <circle cx="9" cy="19" r="1"></circle>
              <circle cx="15" cy="5" r="1"></circle>
              <circle cx="15" cy="12" r="1"></circle>
              <circle cx="15" cy="19" r="1"></circle>
            </svg>
          </div>
          <div class="file-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
          <div class="file-info">
            <div class="file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
            <div class="file-meta">${size}${metadata ? ` • ${metadata.squadName}` : ""}</div>
          </div>
          <button class="btn btn-ghost btn-xs btn-remove" data-id="${file.id}" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;
    }

    if (fileItems) {
      fileItems.innerHTML = html;
      this.bindFileItemEvents();
    }
  }

  bindFileItemEvents() {
    const fileItems = document.querySelectorAll(".file-item");

    fileItems.forEach((item) => {
      const removeBtn = item.querySelector(".btn-remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const fileId = removeBtn.dataset.id;
          this.removeFile(fileId);
        });
      }

      item.addEventListener("dragstart", (e) => this.handleItemDragStart(e, item));
      item.addEventListener("dragend", (e) => this.handleItemDragEnd(e, item));
      item.addEventListener("dragover", (e) => this.handleItemDragOver(e, item));
      item.addEventListener("drop", (e) => this.handleItemDrop(e, item));
    });
  }

  handleItemDragStart(e, item) {
    if (this.sortOrder !== "manual") return;
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.dataset.id);
  }

  handleItemDragEnd(e, item) {
    item.classList.remove("dragging");
    document.querySelectorAll(".file-item").forEach((el) => el.classList.remove("drag-over"));
  }

  handleItemDragOver(e, item) {
    if (this.sortOrder !== "manual") return;
    e.preventDefault();
    e.stopPropagation();

    const dragging = document.querySelector(".file-item.dragging");
    if (!dragging || dragging === item) return;

    item.classList.add("drag-over");
  }

  handleItemDrop(e, item) {
    if (this.sortOrder !== "manual") return;
    e.preventDefault();
    e.stopPropagation();

    item.classList.remove("drag-over");

    const draggedId = e.dataTransfer.getData("text/plain");
    const targetId = item.dataset.id;

    if (draggedId === targetId) return;

    const draggedIndex = this.files.findIndex((f) => f.id === draggedId);
    const targetIndex = this.files.findIndex((f) => f.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const [draggedFile] = this.files.splice(draggedIndex, 1);
    this.files.splice(targetIndex, 0, draggedFile);

    this.renderFileList();
  }

  updateMergeButton() {
    const mergeBtn = document.getElementById("merge-sql-btn");
    if (mergeBtn) {
      mergeBtn.disabled = this.files.length === 0;
    }
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
