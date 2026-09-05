import { imageCheckerTemplate } from "./template.js";
import { ImageCheckerService, BaseUrlService } from "./service.js";
import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import { IMAGE_CHECK_CONCURRENCY, runWithConcurrency } from "./concurrency.js";
import "./styles.css";

const SAVED_REFERENCES_STORAGE_KEY = "image_checker_saved_references";
const IMAGE_CHECK_HISTORY_STORAGE_KEY = "image_checker_history";
const SETTINGS_FOCUS_STORAGE_KEY = "settings.focus";
const MAX_REFERENCE_HISTORY = 24;

class CheckImageTool extends BaseTool {
  constructor(eventBus) {
    super({ id: "check-image", eventBus });
    this.baseUrlService = new BaseUrlService();
    this.imageCheckerService = new ImageCheckerService(this.baseUrlService);
    this.root = null;
    this.elements = null;
    this.checkRunId = 0;
    this.timeoutCells = new Map();
    this.completedCells = new Set();
    this.savedReferences = [];
    this.referenceHistory = [];
    this.activeReferenceKey = null;
    this.activeReferenceIdentifier = null;
    this.isChecking = false;
    this.statusFilter = "all";
    this.runProgress = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return `<div class="check-image-tool" id="check-image-tool-root"></div>`;
  }

  onMount() {
    this.root = this.container.querySelector("#check-image-tool-root");
    this.initializeUi();
    this.bindElements();
    this.setupEventListeners();
  }

  onUnmount() {
    this.checkRunId += 1;
    this.timeoutCells.clear();
    this.completedCells.clear();
    this.runProgress = null;
    this.isChecking = false;
    this.root = null;
    this.elements = null;
  }

  /* ──────────────── UI wiring ──────────────── */
  initializeUi() {
    this.root.innerHTML = imageCheckerTemplate;
  }

  bindElements() {
    this.elements = {
      batchImagePathsInput: this.root.querySelector("#batchImagePathsInput"),
      pasteButton: this.root.querySelector("#pasteButton"),
      checkImageButton: this.root.querySelector("#checkImageButton"),
      clearButton: this.root.querySelector("#clearButton"),
      envSelector: this.root.querySelector("#envSelector"),
      retryAllTimeoutsBtn: this.root.querySelector("#retryAllTimeoutsBtn"),
      cancelCheckButton: this.root.querySelector("#cancelCheckButton"),
      environmentStatus: this.root.querySelector("#environmentStatus"),
      configureEnvironmentsButton: this.root.querySelector("#configureEnvironmentsButton"),
      inputMeta: this.root.querySelector("#inputMeta"),
      inputValidationMessage: this.root.querySelector("#inputValidationMessage"),
      savedReferencesButton: this.root.querySelector("#savedReferencesButton"),
      savedReferencesCount: this.root.querySelector("#savedReferencesCount"),
      closeSavedReferencesButton: this.root.querySelector("#closeSavedReferencesButton"),
      referenceLibrary: this.root.querySelector("#referenceLibrary"),
      savedReferencesList: this.root.querySelector("#savedReferencesList"),
      savedReferencesListCount: this.root.querySelector("#savedReferencesListCount"),
      recentReferencesList: this.root.querySelector("#recentReferencesList"),
      recentReferencesListCount: this.root.querySelector("#recentReferencesListCount"),
      referenceEditor: this.root.querySelector("#referenceEditor"),
      referenceEditorHeading: this.root.querySelector("#referenceEditorHeading"),
      referenceEditorPath: this.root.querySelector("#referenceEditorPath"),
      referenceEditorForm: this.root.querySelector("#referenceEditorForm"),
      referenceEditorCancel: this.root.querySelector("#referenceEditorCancel"),
      referenceLabelInput: this.root.querySelector("#referenceLabelInput"),
      referenceNoteInput: this.root.querySelector("#referenceNoteInput"),
      checkProgress: this.root.querySelector("#checkProgress"),
      progressLabel: this.root.querySelector("#progressLabel"),
      progressCount: this.root.querySelector("#progressCount"),
      progressBar: this.root.querySelector("#progressBar"),
      progressTrack: this.root.querySelector(".progress-track"),
      resultsEmptyState: this.root.querySelector("#resultsEmptyState"),
      resultsContainer: this.root.querySelector("#resultsContainer"),
    };
  }

  setupEventListeners() {
    this.elements.checkImageButton.addEventListener("click", () => {
      this.checkImages();
      this.saveValues();
    });
    this.elements.clearButton.addEventListener("click", () => {
      this.clearResults();
      this.clearSavedValues();
      this.elements.batchImagePathsInput.value = "";
      this.clearInputValidation();
      this.updateInputMeta();
      this.updateCheckButtonState();
      this.elements.batchImagePathsInput.focus();
    });
    this.elements.pasteButton.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        const textarea = this.elements.batchImagePathsInput;
        const currentVal = textarea.value.trim();
        textarea.value = currentVal ? currentVal + "\n" + text : text;
        this.saveValues();
        this.updateInputMeta();
        this.updateCheckButtonState();
        this.clearInputValidation();
        textarea.focus();
      } catch (err) {
        this.showInputValidation("Clipboard access was blocked. Paste the identifiers directly into the field.");
        console.error("Failed to read clipboard:", err);
      }
    });

    this.elements.batchImagePathsInput.addEventListener("input", () => {
      this.saveValues();
      this.updateInputMeta();
      this.updateCheckButtonState();
      this.clearInputValidation();
    });

    // Batch mode shortcut: support both macOS and Windows/Linux conventions.
    this.elements.batchImagePathsInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.checkImages();
        this.saveValues();
      }
    });

    // Retry all timeouts button
    this.elements.retryAllTimeoutsBtn.addEventListener("click", () => {
      this.retryAllTimeouts();
    });

    this.elements.cancelCheckButton?.addEventListener("click", () => this.cancelCheck());
    this.elements.configureEnvironmentsButton?.addEventListener("click", () => this.openEnvironmentSettings());

    this.elements.savedReferencesButton?.addEventListener("click", () => this.toggleReferenceLibrary());
    this.elements.closeSavedReferencesButton?.addEventListener("click", () => this.toggleReferenceLibrary(false));
    this.elements.referenceEditorCancel?.addEventListener("click", () => this.closeReferenceEditor());
    this.elements.referenceEditorForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveReferenceFromEditor();
    });

    this.elements.resultsContainer?.addEventListener("click", (event) => {
      const referenceButton = event.target.closest("[data-reference-action]");
      if (referenceButton) {
        event.stopPropagation();
        if (referenceButton.dataset.referenceAction === "edit") {
          this.openReferenceEditor(referenceButton.dataset.identifier);
        }
        return;
      }

      const filterButton = event.target.closest("[data-result-filter]");
      if (filterButton) {
        this.setResultFilter(filterButton.dataset.resultFilter);
      }
    });

    this.populateEnvSelector();
    this.loadSavedValues();
    this.loadReferenceData();
    this.updateInputMeta();
    this.updateCheckButtonState();
  }

  /**
   * Populate the environment selector dropdown with configured environments
   */
  populateEnvSelector() {
    const selector = this.elements.envSelector;
    if (!selector) return;

    // Clear existing options except "All"
    selector.innerHTML = '<option value="all">All Environments</option>';

    // Get all configured environments
    const baseUrls = this.imageCheckerService.baseUrlService.getAllUrls();

    // Add each environment as an option
    baseUrls.forEach((env, index) => {
      const option = document.createElement("option");
      option.value = index.toString();
      option.textContent = env.name || `Environment ${index + 1}`;
      selector.appendChild(option);
    });

    this.updateEnvironmentStatus();
  }

  /**
   * Get the selected environments based on dropdown selection
   * @returns {Array} Array of { name, url } objects
   */
  getSelectedEnvironments() {
    const selector = this.elements.envSelector;
    const allUrls = this.imageCheckerService.baseUrlService.getAllUrls();

    if (!selector || selector.value === "all") {
      return allUrls;
    }

    const selectedIndex = parseInt(selector.value, 10);
    if (selectedIndex >= 0 && selectedIndex < allUrls.length) {
      return [allUrls[selectedIndex]];
    }

    return allUrls;
  }

  /* ──────────────── Core actions ──────────────── */
  async checkImages() {
    await this.checkBatchImages();
  }

  async checkBatchImages() {
    const { imagePaths, duplicateCount } = this.getInputEntries();
    if (imagePaths.length === 0) {
      this.showInputValidation("Add at least one image ID or content path to start a check.");
      this.elements.batchImagePathsInput?.focus();
      return;
    }

    const baseUrls = this.getSelectedEnvironments();
    if (baseUrls.length === 0) {
      this.showInputValidation("No environments are configured. Add one in Settings, then try again.");
      return;
    }

    this.clearInputValidation();
    this.recordReferenceHistory(imagePaths);

    try {
      UsageTracker.trackEvent("check-image", "check_start", { images: imagePaths.length, envs: baseUrls.length });
    } catch (_) {
      // Analytics should never block an image check.
    }

    const runId = this.beginCheckRun();
    this.isChecking = true;
    this.runProgress = {
      completed: 0,
      total: imagePaths.length * baseUrls.length,
      runId,
    };
    this.setCheckingState(true);
    this.renderProgressiveTable(imagePaths, baseUrls, runId);

    try {
      await this.fetchAllCellsProgressively(imagePaths, baseUrls, runId);
    } finally {
      if (this.isCheckRunCurrent(runId)) {
        this.setCheckingState(false);
        this.renderRunSummary(imagePaths.length, baseUrls.length, duplicateCount);
      }
    }
  }

  beginCheckRun() {
    this.checkRunId += 1;
    this.timeoutCells.clear();
    if (!this.completedCells) this.completedCells = new Set();
    this.completedCells.clear();
    this.statusFilter = "all";
    return this.checkRunId;
  }

  isCheckRunCurrent(runId) {
    return runId === this.checkRunId && Boolean(this.root && this.elements?.resultsContainer);
  }

  getInputEntries() {
    const rawInput = this.elements?.batchImagePathsInput?.value || "";
    const seen = new Set();
    const imagePaths = [];
    let duplicateCount = 0;

    rawInput.split(/\r?\n/).forEach((line) => {
      const path = line.trim();
      if (!path) return;

      const key = this.getReferenceKey(path);
      if (seen.has(key)) {
        duplicateCount += 1;
        return;
      }

      seen.add(key);
      imagePaths.push(path);
    });

    return { imagePaths, duplicateCount };
  }

  getReferenceKey(identifier) {
    const value = String(identifier || "").trim();
    if (!value) return "";

    try {
      return this.imageCheckerService.normalizeInput(value).toLowerCase();
    } catch (_) {
      return value.toLowerCase();
    }
  }

  formatImageIdentifier(identifier) {
    const value = String(identifier || "").trim();
    const uuidMatch = value.match(/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(?:\.png)?$/i);
    return uuidMatch ? uuidMatch[0].replace(/\.png$/i, "") : value;
  }

  getSavedReference(identifier) {
    const key = this.getReferenceKey(identifier);
    return (this.savedReferences || []).find((reference) => reference.key === key) || null;
  }

  createImagePathCell(path) {
    const cell = document.createElement("td");
    cell.className = "image-path-cell";
    cell.dataset.imageIdentifier = path;
    cell.title = path;

    const reference = this.getSavedReference(path);
    const content = document.createElement("div");
    content.className = "image-id-cell-content";

    if (reference) {
      const label = document.createElement("span");
      label.className = "image-reference-label";
      label.textContent = reference.label;
      content.appendChild(label);
    }

    const identifier = document.createElement("code");
    identifier.className = "image-id-value";
    identifier.textContent = this.formatImageIdentifier(path);
    content.appendChild(identifier);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "reference-action-button";
    action.dataset.referenceAction = "edit";
    action.dataset.identifier = path;
    action.textContent = reference ? "Edit label" : "Save as label";
    action.setAttribute("aria-label", `${reference ? "Edit" : "Save"} reference for ${this.formatImageIdentifier(path)}`);
    content.appendChild(action);

    cell.appendChild(content);
    return cell;
  }

  setEmptyStateVisible(visible) {
    if (this.elements?.resultsEmptyState) {
      this.elements.resultsEmptyState.hidden = !visible;
    }
  }

  clearInputValidation() {
    const message = this.elements?.inputValidationMessage;
    if (!message) return;
    message.hidden = true;
    message.textContent = "";
    message.className = "input-validation-message";
  }

  showInputValidation(message, type = "error") {
    const validation = this.elements?.inputValidationMessage;
    if (!validation) return;
    validation.hidden = false;
    validation.className = `input-validation-message ${type}`;
    validation.textContent = message;
  }

  updateInputMeta() {
    const meta = this.elements?.inputMeta;
    if (!meta) return;

    const { imagePaths, duplicateCount } = this.getInputEntries();
    if (imagePaths.length === 0) {
      meta.textContent = "Paste one identifier per line.";
      return;
    }

    const identifierLabel = imagePaths.length === 1 ? "identifier" : "identifiers";
    const details = [`${imagePaths.length} ${identifierLabel}`];
    if (duplicateCount > 0) {
      details.push(`${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} will be skipped`);
    }
    meta.textContent = details.join(" · ");
  }

  updateCheckButtonState() {
    const button = this.elements?.checkImageButton;
    if (!button) return;
    button.disabled = this.isChecking || this.getInputEntries().imagePaths.length === 0;
  }

  updateEnvironmentStatus() {
    const status = this.elements?.environmentStatus;
    const count = this.imageCheckerService.baseUrlService.getAllUrls().length;
    const isEmpty = count === 0;

    if (status) {
      status.className = `environment-status ${isEmpty ? "is-empty" : ""}`;
      status.hidden = !isEmpty;
    }
    if (this.elements?.envSelector) this.elements.envSelector.disabled = isEmpty;
    if (this.elements?.configureEnvironmentsButton) this.elements.configureEnvironmentsButton.hidden = !isEmpty;
  }

  openEnvironmentSettings() {
    try {
      localStorage.setItem(SETTINGS_FOCUS_STORAGE_KEY, "config.baseUrls");
    } catch (_) {}

    if (window.app?.router?.navigate) {
      window.app.router.navigate("settings");
      return;
    }
    if (this.eventBus) {
      this.eventBus.emit("route:change", { path: "settings" });
      return;
    }
    this.showError("Open Settings to configure CDN Base URLs.");
  }

  setCheckingState(isChecking) {
    this.isChecking = isChecking;
    const button = this.elements?.checkImageButton;
    const cancelButton = this.elements?.cancelCheckButton;

    if (button) {
      button.textContent = isChecking ? "Checking…" : "Check images";
    }
    if (cancelButton) cancelButton.hidden = !isChecking;
    if (this.elements?.checkProgress) this.elements.checkProgress.hidden = !isChecking;
    this.updateCheckButtonState();
  }

  updateProgress(runId) {
    if (!this.isCheckRunCurrent(runId) || !this.runProgress || this.runProgress.runId !== runId) return;

    const completed = this.completedCells.size;
    const total = this.runProgress.total;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (this.elements?.progressLabel) {
      this.elements.progressLabel.textContent = completed >= total ? "Check complete" : "Checking images";
    }
    if (this.elements?.progressCount) this.elements.progressCount.textContent = `${completed} / ${total}`;
    if (this.elements?.progressBar) this.elements.progressBar.style.transform = `scaleX(${progressPercent / 100})`;
    if (this.elements?.progressTrack) {
      this.elements.progressTrack.setAttribute("aria-valuemax", String(total));
      this.elements.progressTrack.setAttribute("aria-valuenow", String(completed));
    }
  }

  markCellComplete(cellId, runId) {
    if (!this.isCheckRunCurrent(runId) || !this.runProgress || this.runProgress.runId !== runId) return;
    if (!this.completedCells) this.completedCells = new Set();
    if (this.completedCells.has(cellId)) return;
    this.completedCells.add(cellId);
    this.updateProgress(runId);
  }

  /**
   * Render the table structure with loading spinners in each cell
   */
  renderProgressiveTable(imagePaths, baseUrls, runId = null) {
    if (runId === null) runId = this.beginCheckRun();
    if (!this.isCheckRunCurrent(runId)) return;
    this.clearResults({ invalidate: false });
    this.timeoutCells.clear();
    this.setEmptyStateVisible(false);
    const resultsContainer = this.elements.resultsContainer;

    const resultsWrapper = document.createElement("div");
    resultsWrapper.className = "results-wrapper batch-results";

    const summary = document.createElement("div");
    summary.className = "image-checker-run-summary";
    summary.id = "runSummary";
    summary.setAttribute("aria-live", "polite");
    summary.innerHTML = `
      <div class="run-summary-copy">
        <strong>Checking images</strong>
        <span class="run-summary-detail">Results will appear as each environment responds.</span>
      </div>
      <div class="run-summary-counts">
        <span class="summary-count summary-count-found"><strong>0</strong> found</span>
        <span class="summary-count summary-count-issues"><strong>0</strong> issues</span>
      </div>
    `;
    resultsWrapper.appendChild(summary);

    const tableContainer = document.createElement("div");
    tableContainer.className = "batch-results-table-container";

    const table = document.createElement("table");
    table.className = "batch-results-table";
    table.id = "progressive-results-table";

    // Create table header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    let th = document.createElement("th");
    th.textContent = "Image ID";
    th.scope = "col";
    headerRow.appendChild(th);

    baseUrls.forEach((env) => {
      th = document.createElement("th");
      th.textContent = env.name || "Unknown";
      th.scope = "col";
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body with loading states
    const tbody = document.createElement("tbody");

    imagePaths.forEach((path, rowIndex) => {
      const row = document.createElement("tr");

      row.appendChild(this.createImagePathCell(path));

      // Loading cells for each environment
      baseUrls.forEach((env, colIndex) => {
        const td = document.createElement("td");
        td.className = "status-cell loading";
        td.id = `cell-${rowIndex}-${colIndex}`;
        td.setAttribute("aria-label", `Checking ${env.name || "environment"}`);
        td.innerHTML = `
          <div class="cell-loading-spinner">
            <div class="cell-skeleton" aria-hidden="true"></div>
            <span class="loading-text">Checking</span>
          </div>
        `;
        row.appendChild(td);
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    resultsWrapper.appendChild(tableContainer);

    // Add note
    const note = document.createElement("div");
    note.className = "batch-results-note";
    note.textContent = "Select a preview to inspect dimensions and open the source image.";
    resultsWrapper.appendChild(note);

    resultsContainer.appendChild(resultsWrapper);
  }

  /**
   * Fetch all cells progressively and update them as results come in
   */
  async fetchAllCellsProgressively(imagePaths, baseUrls, runId = this.checkRunId) {
    if (!this.isCheckRunCurrent(runId)) return;
    const tasks = [];
    const startTime = Date.now();

    imagePaths.forEach((path, rowIndex) => {
      const normalized = this.imageCheckerService.normalizeInput(path);

      baseUrls.forEach((env, colIndex) => {
        tasks.push(() => this.fetchAndUpdateCell(path, normalized, env, rowIndex, colIndex, runId));
      });
    });

    // Wait for all to complete (for analytics)
    try {
      await runWithConcurrency(tasks, IMAGE_CHECK_CONCURRENCY);
      if (!this.isCheckRunCurrent(runId)) return;

      // Track check completion for performance insights
      const durationMs = Date.now() - startTime;
      const timeoutCount = this.timeoutCells.size;
      const totalCells = imagePaths.length * baseUrls.length;
      const successCells = this.root.querySelectorAll(".status-cell.success").length;
      const failedCells = totalCells - successCells - timeoutCount;

      UsageTracker.trackEvent("check-image", "check_complete", {
        image_count: imagePaths.length,
        env_count: baseUrls.length,
        success_count: successCells,
        failed_count: failedCells,
        timeout_count: timeoutCount,
        duration_ms: durationMs,
      });
      UsageTracker.trackToolUse("check-image", "check", {
        image_count: imagePaths.length,
        env_count: baseUrls.length,
        success_count: successCells,
        failed_count: failedCells,
        timeout_count: timeoutCount,
        duration_ms: durationMs,
      });
    } catch (error) {
      console.error("Error during progressive fetch:", error);
    }
  }

  renderRunSummary(imageCount, environmentCount, duplicateCount = 0) {
    const summary = this.root?.querySelector("#runSummary");
    if (!summary) return;

    const totalCells = imageCount * environmentCount;
    const found = this.root.querySelectorAll(".status-cell.success").length;
    const timeouts = this.root.querySelectorAll(".status-cell.timeout").length;
    const errors = this.root.querySelectorAll(".status-cell.error").length;
    const issueCount = timeouts + errors;
    const visibleResultCount = this.root.querySelectorAll(".batch-results-table tbody tr").length;

    summary.innerHTML = `
      <div class="run-summary-copy">
        <strong>${imageCount} image${imageCount === 1 ? "" : "s"} checked</strong>
        <span class="run-summary-detail">${found} of ${totalCells} environment checks found an image${duplicateCount ? ` · ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped` : ""}</span>
      </div>
      <div class="run-summary-actions">
        <div class="run-summary-counts">
          <span class="summary-count summary-count-found"><strong>${found}</strong> found</span>
          <span class="summary-count summary-count-issues"><strong>${issueCount}</strong> issue${issueCount === 1 ? "" : "s"}</span>
        </div>
        <div class="result-filter-group" role="group" aria-label="Filter image results">
          <button class="result-filter is-active" type="button" data-result-filter="all" aria-pressed="true">All <span>${visibleResultCount}</span></button>
          <button class="result-filter" type="button" data-result-filter="issues" aria-pressed="false">Issues only <span>${this.countIssueRows()}</span></button>
        </div>
      </div>
    `;
    this.statusFilter = "all";
    this.updateProgress(this.runProgress?.runId);
  }

  countIssueRows() {
    return [...(this.root?.querySelectorAll(".batch-results-table tbody tr") || [])].filter((row) =>
      row.querySelector(".status-cell.error, .status-cell.timeout"),
    ).length;
  }

  setResultFilter(filter) {
    if (!this.root || !["all", "issues"].includes(filter)) return;
    this.statusFilter = filter;

    this.root.querySelectorAll("[data-result-filter]").forEach((button) => {
      const isActive = button.dataset.resultFilter === filter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    this.root.querySelectorAll(".batch-results-table tbody tr").forEach((row) => {
      const hasIssue = Boolean(row.querySelector(".status-cell.error, .status-cell.timeout"));
      row.hidden = filter === "issues" && !hasIssue;
    });
  }

  cancelCheck() {
    if (!this.isChecking) return;

    this.checkRunId += 1;
    this.isChecking = false;
    this.timeoutCells.clear();
    this.completedCells.clear();

    this.root?.querySelectorAll(".status-cell.loading").forEach((cell) => {
      cell.className = "status-cell canceled";
      cell.innerHTML =
        '<span class="status-badge"><span class="status-dot" aria-hidden="true"></span><span class="error-text">Canceled</span></span>';
      cell.setAttribute("aria-label", "Check canceled");
    });

    this.setCheckingState(false);
    this.updateRetryAllButtonVisibility();
    this.showInputValidation("Check canceled. You can update the identifiers and run it again.", "info");
  }

  /**
   * Fetch a single image and update its cell
   */
  async fetchAndUpdateCell(originalPath, normalizedPath, env, rowIndex, colIndex, runId = this.checkRunId) {
    if (!this.isCheckRunCurrent(runId)) return;
    const cellId = `cell-${rowIndex}-${colIndex}`;
    const cell = this.root.querySelector(`#${cellId}`);
    if (!cell) return;

    try {
      const result = await this.imageCheckerService.checkImage(env.url, normalizedPath);
      if (!this.isCheckRunCurrent(runId)) return;
      result.name = env.name;
      this.updateCellWithResult(cell, result, originalPath, env, rowIndex, colIndex, runId);
    } catch (error) {
      if (!this.isCheckRunCurrent(runId)) return;
      this.updateCellWithError(cell, error.message, originalPath, env, rowIndex, colIndex, runId);
    }
  }

  /**
   * Update a cell with the check result
   */
  updateCellWithResult(cell, result, originalPath, env, rowIndex, colIndex, runId = this.checkRunId) {
    if (!this.isCheckRunCurrent(runId)) return;
    const cellId = `cell-${rowIndex}-${colIndex}`;
    cell.className = `status-cell ${result.exists ? "success" : result.timeout ? "timeout" : "error"}`;

    // Remove from timeout tracking if it was there (in case of retry success)
    this.timeoutCells.delete(cellId);

    if (result.exists) {
      const container = document.createElement("div");
      container.className = "status-cell-content";

      const miniPreview = document.createElement("div");
      miniPreview.className = "mini-image-preview";
      const img = document.createElement("img");
      img.src = result.url;
      img.alt = `Preview for ${this.formatImageIdentifier(originalPath)}`;
      miniPreview.appendChild(img);

      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "status-preview-button";
      previewButton.title = "View image details";
      previewButton.setAttribute("aria-label", `View ${this.formatImageIdentifier(originalPath)} in ${env.name || "this environment"}`);
      previewButton.appendChild(miniPreview);
      previewButton.addEventListener("click", () => this.showImageDetails(result, originalPath));
      container.appendChild(previewButton);

      const sizeInfo = document.createElement("div");
      sizeInfo.className = "image-size-info";
      sizeInfo.textContent = `${result.width}×${result.height}`;
      container.appendChild(sizeInfo);

      cell.innerHTML = "";
      cell.appendChild(container);
      cell.title = `Dimensions: ${result.width}×${result.height}\nAspect Ratio: ${result.aspectRatio}:1\nURL: ${result.url}`;
      cell.setAttribute("aria-label", `${env.name || "Environment"}: image found, ${result.width} by ${result.height}`);
    } else if (result.timeout) {
      this.timeoutCells.set(cellId, { originalPath, env, rowIndex, colIndex, runId });

      cell.innerHTML = `
        <div class="cell-timeout-content">
          <span class="status-badge"><span class="status-dot" aria-hidden="true"></span><span class="timeout-text">Timed out</span></span>
          <button class="retry-button">Retry</button>
        </div>
      `;
      cell.title = "Request timed out after 3 attempts";
      cell.setAttribute("aria-label", `${env.name || "Environment"}: request timed out`);
      const retryBtn = cell.querySelector(".retry-button");
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.retryCell(originalPath, env, rowIndex, colIndex, runId);
      });
    } else {
      cell.innerHTML = `
        <div class="cell-error-content">
          <span class="status-badge"><span class="status-dot" aria-hidden="true"></span><span class="error-text">Missing</span></span>
        </div>
      `;
      cell.title = result.error || "Image not found";
      cell.setAttribute("aria-label", `${env.name || "Environment"}: image missing`);
    }

    this.markCellComplete(cellId, runId);
    // Update retry all button visibility
    this.updateRetryAllButtonVisibility();
  }

  /**
   * Update the visibility of the "Retry All Timeouts" button
   */
  updateRetryAllButtonVisibility() {
    const retryAllBtn = this.elements?.retryAllTimeoutsBtn;
    if (retryAllBtn) {
      const hasTimeouts = this.timeoutCells.size > 0;
      retryAllBtn.hidden = !hasTimeouts;
      retryAllBtn.textContent = `Retry All Timeouts (${this.timeoutCells.size})`;
    }
  }

  /**
   * Retry all cells that timed out
   */
  async retryAllTimeouts() {
    if (this.timeoutCells.size === 0) return;
    const runId = this.checkRunId;
    if (!this.isCheckRunCurrent(runId)) return;

    // Track retry action
    const retryCount = this.timeoutCells.size;

    // Get all timeout cells and clear the map (they'll be re-added if they timeout again)
    const cellsToRetry = Array.from(this.timeoutCells.values());
    this.timeoutCells.clear();
    this.updateRetryAllButtonVisibility();

    // Retry all timeout cells in parallel
    const retryTasks = cellsToRetry.map(
      ({ originalPath, env, rowIndex, colIndex }) =>
        () =>
          this.retryCell(originalPath, env, rowIndex, colIndex, runId),
    );

    await runWithConcurrency(retryTasks, IMAGE_CHECK_CONCURRENCY);
    if (!this.isCheckRunCurrent(runId)) return;

    // Track retry completion for UX analysis
    UsageTracker.trackEvent("check-image", "retry_all", {
      retry_count: retryCount,
      still_timeout: this.timeoutCells.size,
    });
  }

  /**
   * Update a cell with an error state
   */
  updateCellWithError(cell, errorMessage, originalPath, env, rowIndex, colIndex, runId = this.checkRunId) {
    if (!this.isCheckRunCurrent(runId)) return;
    cell.className = "status-cell error";
    cell.innerHTML = `
      <div class="cell-error-content">
        <span class="status-badge"><span class="status-dot" aria-hidden="true"></span><span class="error-text">Error</span></span>
        <button class="retry-button">Retry</button>
      </div>
    `;
    cell.title = `Error: ${errorMessage}`;
    cell.setAttribute("aria-label", `${env.name || "Environment"}: request error`);
    const retryBtn = cell.querySelector(".retry-button");
    retryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.retryCell(originalPath, env, rowIndex, colIndex, runId);
    });
    this.markCellComplete(`cell-${rowIndex}-${colIndex}`, runId);
  }

  /**
   * Retry fetching a specific cell
   */
  async retryCell(originalPath, env, rowIndex, colIndex, runId = this.checkRunId) {
    if (!this.isCheckRunCurrent(runId)) return;
    const cellId = `cell-${rowIndex}-${colIndex}`;
    const cell = this.root.querySelector(`#${cellId}`);
    if (!cell) return;

    // Show loading state
    cell.className = "status-cell loading";
    cell.innerHTML = `
      <div class="cell-loading-spinner">
        <div class="cell-skeleton" aria-hidden="true"></div>
        <span class="loading-text">Retrying</span>
      </div>
    `;

    const normalized = this.imageCheckerService.normalizeInput(originalPath);
    await this.fetchAndUpdateCell(originalPath, normalized, env, rowIndex, colIndex, runId);
  }

  readStoredArray(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  loadReferenceData() {
    this.savedReferences = this.readStoredArray(SAVED_REFERENCES_STORAGE_KEY).filter(
      (reference) => reference && reference.key && reference.identifier && reference.label,
    );
    this.referenceHistory = this.readStoredArray(IMAGE_CHECK_HISTORY_STORAGE_KEY).filter(
      (reference) => reference && reference.key && reference.identifier,
    );
    this.renderReferenceLibrary();
  }

  persistReferenceData() {
    try {
      localStorage.setItem(SAVED_REFERENCES_STORAGE_KEY, JSON.stringify(this.savedReferences));
      localStorage.setItem(IMAGE_CHECK_HISTORY_STORAGE_KEY, JSON.stringify(this.referenceHistory));
    } catch (error) {
      this.showError("Could not save image references in this browser.");
      console.error("Error saving image references:", error);
    }
  }

  recordReferenceHistory(imagePaths) {
    const nextHistory = [];
    const seen = new Set();
    const addHistoryEntry = (entry) => {
      if (!entry?.key || seen.has(entry.key)) return;
      seen.add(entry.key);
      nextHistory.push(entry);
    };

    imagePaths.forEach((identifier) => {
      addHistoryEntry({
        key: this.getReferenceKey(identifier),
        identifier,
        checkedAt: Date.now(),
      });
    });
    this.referenceHistory.forEach(addHistoryEntry);

    this.referenceHistory = nextHistory.slice(0, MAX_REFERENCE_HISTORY);
    this.persistReferenceData();
    this.renderReferenceLibrary();
  }

  renderReferenceLibrary() {
    const savedCount = this.savedReferences.length;
    const historyCount = this.referenceHistory.length;

    if (this.elements?.savedReferencesCount) this.elements.savedReferencesCount.textContent = String(savedCount);
    if (this.elements?.savedReferencesListCount) this.elements.savedReferencesListCount.textContent = String(savedCount);
    if (this.elements?.recentReferencesListCount) this.elements.recentReferencesListCount.textContent = String(historyCount);

    const savedList = this.elements?.savedReferencesList;
    if (savedList) {
      savedList.innerHTML = "";
      if (savedCount === 0) {
        savedList.innerHTML = '<p class="reference-list-empty">Save a label from a result to keep it here.</p>';
      } else {
        this.savedReferences.forEach((reference) => savedList.appendChild(this.createReferenceListItem(reference, "saved")));
      }
    }

    const recentList = this.elements?.recentReferencesList;
    if (recentList) {
      recentList.innerHTML = "";
      if (historyCount === 0) {
        recentList.innerHTML = '<p class="reference-list-empty">Checked identifiers will appear here.</p>';
      } else {
        this.referenceHistory.forEach((reference) => recentList.appendChild(this.createReferenceListItem(reference, "recent")));
      }
    }
  }

  createReferenceListItem(reference, type) {
    const item = document.createElement("article");
    item.className = "reference-list-item";

    const content = document.createElement("div");
    content.className = "reference-list-item-content";

    const savedReference = type === "recent" ? this.getSavedReference(reference.identifier) : reference;
    const label = document.createElement("strong");
    label.className = "reference-list-item-label";
    label.textContent = savedReference?.label || (type === "recent" ? "Recent identifier" : reference.label);
    content.appendChild(label);

    const identifier = document.createElement("code");
    identifier.className = "reference-list-item-identifier";
    identifier.textContent = this.formatImageIdentifier(reference.identifier);
    identifier.title = reference.identifier;
    content.appendChild(identifier);

    if (savedReference?.note) {
      const note = document.createElement("span");
      note.className = "reference-list-item-note";
      note.textContent = savedReference.note;
      content.appendChild(note);
    }
    item.appendChild(content);

    const actions = document.createElement("div");
    actions.className = "reference-list-item-actions";

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "reference-list-action";
    useButton.textContent = "Use";
    useButton.addEventListener("click", () => this.appendInputValue(reference.identifier));
    actions.appendChild(useButton);

    if (type === "saved") {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "reference-list-action";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => this.openReferenceEditor(reference.identifier));
      actions.appendChild(editButton);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "reference-list-action reference-list-action-danger";
      deleteButton.textContent = "Remove";
      deleteButton.addEventListener("click", () => this.deleteSavedReference(reference.key));
      actions.appendChild(deleteButton);
    }

    item.appendChild(actions);
    return item;
  }

  appendInputValue(identifier) {
    const textarea = this.elements?.batchImagePathsInput;
    if (!textarea) return;

    const currentEntries = this.getInputEntries().imagePaths;
    if (currentEntries.some((entry) => this.getReferenceKey(entry) === this.getReferenceKey(identifier))) {
      this.showSuccess("That identifier is already in the input.");
      textarea.focus();
      return;
    }

    const currentValue = textarea.value.trim();
    textarea.value = currentValue ? `${currentValue}\n${identifier}` : identifier;
    this.saveValues();
    this.updateInputMeta();
    this.updateCheckButtonState();
    this.clearInputValidation();
    textarea.focus();
  }

  toggleReferenceLibrary(forceOpen) {
    const library = this.elements?.referenceLibrary;
    if (!library) return;

    const open = typeof forceOpen === "boolean" ? forceOpen : library.hidden;
    library.hidden = !open;
    this.elements.savedReferencesButton?.setAttribute("aria-expanded", String(open));
    if (open) this.renderReferenceLibrary();
  }

  openReferenceEditor(identifier) {
    if (!identifier || !this.elements?.referenceEditor) return;

    const existing = this.getSavedReference(identifier);
    this.activeReferenceKey = this.getReferenceKey(identifier);
    this.activeReferenceIdentifier = identifier;
    this.elements.referenceEditor.hidden = false;
    this.elements.referenceEditorHeading.textContent = existing ? "Edit image reference" : "Save image reference";
    this.elements.referenceEditorPath.textContent = identifier;
    this.elements.referenceLabelInput.value = existing?.label || "";
    this.elements.referenceNoteInput.value = existing?.note || "";

    this.elements.referenceEditor.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    this.elements.referenceLabelInput.focus();
  }

  closeReferenceEditor() {
    if (!this.elements?.referenceEditor) return;
    this.elements.referenceEditor.hidden = true;
    this.activeReferenceKey = null;
    this.activeReferenceIdentifier = null;
  }

  saveReferenceFromEditor() {
    const label = this.elements?.referenceLabelInput?.value.trim();
    const identifier = this.activeReferenceIdentifier;
    if (!label || !identifier) {
      this.elements?.referenceLabelInput?.focus();
      return;
    }

    const now = Date.now();
    const existingIndex = this.savedReferences.findIndex((reference) => reference.key === this.activeReferenceKey);
    const existing = existingIndex >= 0 ? this.savedReferences[existingIndex] : null;
    const nextReference = {
      id: existing?.id || `${now}-${Math.random().toString(36).slice(2)}`,
      key: this.activeReferenceKey,
      identifier,
      label,
      note: this.elements.referenceNoteInput?.value.trim() || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (existingIndex >= 0) this.savedReferences[existingIndex] = nextReference;
    else this.savedReferences.unshift(nextReference);

    this.persistReferenceData();
    this.renderReferenceLibrary();
    this.refreshRenderedReferenceCells();
    this.closeReferenceEditor();
    this.showSuccess(existing ? "Image reference updated." : "Image reference saved.");
  }

  deleteSavedReference(key) {
    this.savedReferences = this.savedReferences.filter((reference) => reference.key !== key);
    this.persistReferenceData();
    this.renderReferenceLibrary();
    this.refreshRenderedReferenceCells();
    this.showSuccess("Image reference removed.");
  }

  refreshRenderedReferenceCells() {
    this.root?.querySelectorAll(".image-path-cell[data-image-identifier]").forEach((oldCell) => {
      const replacement = this.createImagePathCell(oldCell.dataset.imageIdentifier);
      oldCell.parentElement?.replaceChild(replacement, oldCell);
    });
  }

  /* ──────────────── Rendering ──────────────── */
  displayResults(results) {
    this.clearResults();

    if (results.length === 0) {
      this.showError("No results found. Please check your input and try again.");
      return;
    }

    const resultsContainer = this.elements.resultsContainer;

    // Create a container for all results
    const resultsWrapper = document.createElement("div");
    resultsWrapper.className = "results-wrapper";

    // Add summary at the top
    const summary = document.createElement("div");
    summary.className = "image-checker-results-summary";
    const existingCount = results.filter((r) => r.exists).length;
    summary.innerHTML = `
      <h4>Summary</h4>
      <p>Found in ${existingCount} of ${results.length} environments</p>
    `;
    resultsWrapper.appendChild(summary);

    // Add each result
    results.forEach((result) => {
      const resultCard = document.createElement("div");
      resultCard.className = `result-card ${result.exists ? "success" : "error"}`;

      let content = `
        <h4>${result.name || "Unknown"}</h4>
        <p class="status ${result.exists ? "success" : "error"}">
          ${result.exists ? "✅ Image Found" : "❌ Image Not Found"}
        </p>
        <p><a href="${result.url || "#"}" target="_blank">${result.url ? "Image URL" : "N/A"}</a></p>
      `;

      if (result.exists) {
        content += `
          <p><strong>Dimension:</strong> ${result.width}×${result.height} (${result.aspectRatio}:1)</p>
        `;

        // Add image preview
        content += `<div class="image-preview"><img src="${result.url}" alt="Image Preview" /></div>`;
      } else if (result.status) {
        content += `<p><strong>Status:</strong> ${result.status} ${result.statusText}</p>`;
      } else if (result.error) {
        content += `<p><strong>Error:</strong> ${result.error}</p>`;
      }

      resultCard.innerHTML = content;
      resultsWrapper.appendChild(resultCard);
    });

    resultsContainer.appendChild(resultsWrapper);
  }

  displayBatchResults(batchResults) {
    this.clearResults();

    if (batchResults.length === 0) {
      this.showError("No results found. Please check your input and try again.");
      return;
    }

    const resultsContainer = this.elements.resultsContainer;
    this.setEmptyStateVisible(false);
    const resultsWrapper = document.createElement("div");
    resultsWrapper.className = "results-wrapper batch-results";

    // Create a table for the results
    const tableContainer = document.createElement("div");
    tableContainer.className = "batch-results-table-container";

    // Get all unique environment names from the first result
    const environments = batchResults[0]?.results.map((r) => r.name) || [];

    const table = document.createElement("table");
    table.className = "batch-results-table";

    // Create table header
    const thead = document.createElement("thead");
    let headerRow = document.createElement("tr");

    // Add image identifier column
    let th = document.createElement("th");
    th.textContent = "Image ID";
    headerRow.appendChild(th);

    // Add environment columns with fixed width
    environments.forEach((env) => {
      th = document.createElement("th");
      th.textContent = env || "Unknown";
      th.style.width = "200px"; // Match the width in CSS
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement("tbody");

    // Add a row for each image
    batchResults.forEach((imageResult) => {
      const row = document.createElement("tr");

      // Add image path cell with UUID only
      let td = document.createElement("td");
      td.className = "image-path-cell";

      // Extract UUID from path if possible
      const uuidMatch = imageResult.path.match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\.png)?$/i);
      td.textContent = uuidMatch ? uuidMatch[1] : imageResult.path;
      td.title = imageResult.path; // Keep full path as tooltip
      row.appendChild(td);

      // Add status cells for each environment
      imageResult.results.forEach((result) => {
        td = document.createElement("td");
        td.className = `status-cell ${result.exists ? "success" : "error"}`;

        if (result.exists) {
          // Create a container for the content
          const container = document.createElement("div");
          container.style.textAlign = "center";
          container.style.height = "100%";
          container.style.display = "flex";
          container.style.flexDirection = "column";
          container.style.justifyContent = "center";
          container.style.alignItems = "center";

          // Create a mini image preview instead of check mark
          const miniPreview = document.createElement("div");
          miniPreview.className = "mini-image-preview";
          const img = document.createElement("img");
          img.src = result.url;
          img.alt = "Image Preview";
          miniPreview.appendChild(img);
          container.appendChild(miniPreview);

          // Add size information below the image
          const sizeInfo = document.createElement("div");
          sizeInfo.className = "image-size-info";
          sizeInfo.textContent = `${result.width}×${result.height}`;
          container.appendChild(sizeInfo);

          td.appendChild(container);
        } else {
          const statusIcon = document.createElement("span");
          statusIcon.className = "status-icon";
          statusIcon.textContent = "❌";
          td.appendChild(statusIcon);
        }

        // Add tooltip with more details
        if (result.exists) {
          td.title = `Dimensions: ${result.width}×${result.height}\nAspect Ratio: ${result.aspectRatio}:1\nURL: ${result.url}`;

          // Make the cell clickable to view details
          td.addEventListener("click", () => {
            this.showImageDetails(result, imageResult.path);
          });
          td.style.cursor = "pointer";
        } else if (result.error) {
          td.title = `Error: ${result.error}`;
        } else {
          td.title = "Image not found";
        }

        row.appendChild(td);
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    resultsWrapper.appendChild(tableContainer);

    // Add a note about clicking on cells
    const note = document.createElement("div");
    note.className = "batch-results-note";
    note.textContent = "Click on an image preview to view full details";
    resultsWrapper.appendChild(note);

    resultsContainer.appendChild(resultsWrapper);
  }

  /* ──────────────── Modal ──────────────── */
  showImageDetails(result, imagePath) {
    const modal = document.createElement("div");
    modal.className = "image-details-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "imageDetailsHeading");

    const modalContent = document.createElement("div");
    modalContent.className = "image-details-content";

    const closeButton = document.createElement("button");
    closeButton.className = "close-modal-button";
    closeButton.textContent = "×";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close image details");

    const closeModal = () => {
      modal.remove();
      document.removeEventListener("keydown", handleKeydown);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") closeModal();
    };
    closeButton.addEventListener("click", closeModal);

    const heading = document.createElement("h3");
    heading.id = "imageDetailsHeading";
    heading.textContent = "Image details";
    modalContent.appendChild(heading);

    const details = [
      ["Image ID", imagePath],
      ["Environment", result.name || "Unknown"],
      ["Dimensions", `${result.width}×${result.height} (${result.aspectRatio}:1)`],
    ];
    details.forEach(([label, value]) => {
      const detail = document.createElement("p");
      const detailLabel = document.createElement("strong");
      detailLabel.textContent = `${label}: `;
      detail.appendChild(detailLabel);
      detail.appendChild(document.createTextNode(value));
      modalContent.appendChild(detail);
    });

    const actions = document.createElement("div");
    actions.className = "image-details-actions";
    const openLink = document.createElement("a");
    openLink.href = result.url;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.className = "btn btn-secondary btn-sm";
    openLink.textContent = "Open image";
    actions.appendChild(openLink);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "btn btn-ghost btn-sm";
    copyButton.textContent = "Copy URL";
    copyButton.addEventListener("click", () => this.copyToClipboard(result.url, copyButton));
    actions.appendChild(copyButton);
    modalContent.appendChild(actions);

    const preview = document.createElement("div");
    preview.className = "image-preview large";
    const previewImage = document.createElement("img");
    previewImage.src = result.url;
    previewImage.alt = `Preview for ${this.formatImageIdentifier(imagePath)}`;
    preview.appendChild(previewImage);
    modalContent.appendChild(preview);
    modalContent.appendChild(closeButton);
    modal.appendChild(modalContent);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    document.body.appendChild(modal);
    document.addEventListener("keydown", handleKeydown);
    closeButton.focus();
  }

  /* ──────────────── Status helpers ──────────────── */
  showLoading() {
    this.setEmptyStateVisible(false);
    this.elements.resultsContainer.innerHTML = '<div class="check-image-loading">Checking images…</div>';
  }

  showError(message) {
    this.setEmptyStateVisible(false);
    if (this.elements?.resultsContainer) {
      const banner = document.createElement("div");
      banner.className = "check-image-error-banner";
      banner.textContent = message;
      this.elements.resultsContainer.innerHTML = "";
      this.elements.resultsContainer.appendChild(banner);
    }
  }

  clearResults({ invalidate = true } = {}) {
    if (invalidate) this.checkRunId += 1;
    this.timeoutCells.clear();
    if (this.elements?.resultsContainer) {
      this.elements.resultsContainer.innerHTML = "";
      this.setEmptyStateVisible(true);
    }
    this.updateRetryAllButtonVisibility();
  }

  /* ──────────────── Persistence ──────────────── */
  saveValues() {
    const values = {
      batchImagePaths: this.elements.batchImagePathsInput.value,
    };
    localStorage.setItem("image_checker_last_value", JSON.stringify(values));
  }

  loadSavedValues() {
    try {
      const savedValues = localStorage.getItem("image_checker_last_value");
      if (savedValues) {
        const values = JSON.parse(savedValues);
        this.elements.batchImagePathsInput.value = values.batchImagePaths || "";
      }
    } catch (error) {
      console.error("Error loading saved values:", error);
    }
  }

  clearSavedValues() {
    localStorage.removeItem("image_checker_last_value");
  }
}

export { CheckImageTool };
