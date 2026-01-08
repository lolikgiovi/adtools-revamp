import { BaseTool } from "../../core/BaseTool.js";
import { RunBatchTemplate } from "./template.js";
import { RunBatchService } from "./service.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";
import { UsageTracker } from "../../core/UsageTracker.js";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../core/Runtime.js";
import { invoke } from "@tauri-apps/api/core";

export class RunBatch extends BaseTool {
  constructor(eventBus) {
    super({
      id: "run-batch",
      name: "Run Batch",
      description: "Trigger Jenkins batch jobs with configurable parameters",
      icon: "jenkins",
      category: "jenkins",
      eventBus,
    });
    this.service = new RunBatchService();
    this.state = {
      jenkinsUrl: "",
      envChoices: [],
      queueUrl: null,
      buildNumber: null,
      executableUrl: null,
    };
    this._logUnsubscribes = [];
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return RunBatchTemplate;
  }

  async onMount() {
    const envSelect = this.container.querySelector("#rb-env");
    const batchNameInput = this.container.querySelector("#rb-batch-name");
    const jobNameInput = this.container.querySelector("#rb-job-name");
    const runBtn = this.container.querySelector("#rb-run-btn");
    const saveBtn = this.container.querySelector("#rb-save-btn");
    const statusEl = this.container.querySelector('[data-role="status"]');
    const logsEl = this.container.querySelector("#rb-logs");
    const buildLink = this.container.querySelector("#rb-build-link");
    const buildNumEl = this.container.querySelector("#rb-build-number");
    const envErrorEl = this.container.querySelector("#rb-env-error");
    const savedListEl = this.container.querySelector("#rb-saved-list");
    const configSearchInput = this.container.querySelector("#rb-config-search");

    // Tab elements
    const tabRunBtn = this.container.querySelector("#rb-tab-run-btn");
    const tabHistoryBtn = this.container.querySelector("#rb-tab-history-btn");
    const tabRunPanel = this.container.querySelector("#rb-tab-run");
    const tabHistoryPanel = this.container.querySelector("#rb-tab-history");
    const historyListEl = this.container.querySelector("#rb-history-list");
    const historyEmptyEl = this.container.querySelector("#rb-history-empty");

    // Modal elements
    const saveModal = this.container.querySelector("#rb-save-modal");
    const saveModalOverlay = this.container.querySelector("#rb-save-modal-overlay");
    const saveModalClose = this.container.querySelector("#rb-save-modal-close");
    const saveModalCancel = this.container.querySelector("#rb-save-modal-cancel");
    const saveModalConfirm = this.container.querySelector("#rb-save-modal-confirm");
    const configNameInput = this.container.querySelector("#rb-config-name");
    const configNameError = this.container.querySelector("#rb-config-name-error");
    const configConfluLinkInput = this.container.querySelector("#rb-config-conflu-link");

    const confirmModal = this.container.querySelector("#rb-confirm-modal");
    const confirmClose = this.container.querySelector("#rb-confirm-close");
    const confirmCancel = this.container.querySelector("#rb-confirm-cancel-btn");
    const confirmDelete = this.container.querySelector("#rb-confirm-delete-btn");
    const confirmMessage = this.container.querySelector("#rb-confirm-message");

    // Edit modal elements
    const editModal = this.container.querySelector("#rb-edit-modal");
    const editModalClose = this.container.querySelector("#rb-edit-modal-close");
    const editModalCancel = this.container.querySelector("#rb-edit-modal-cancel");
    const editModalConfirm = this.container.querySelector("#rb-edit-modal-confirm");
    const editConfigIdInput = this.container.querySelector("#rb-edit-config-id");
    const editConfigNameInput = this.container.querySelector("#rb-edit-config-name");
    const editConfigNameError = this.container.querySelector("#rb-edit-config-name-error");
    const editBatchNameInput = this.container.querySelector("#rb-edit-batch-name");
    const editJobNameInput = this.container.querySelector("#rb-edit-job-name");
    const editConfluLinkInput = this.container.querySelector("#rb-edit-conflu-link");

    const hasToken = await this.service.hasToken();

    // Load Jenkins URL
    this.state.jenkinsUrl = this.service.loadJenkinsUrl();
    if (!this.state.jenkinsUrl) {
      statusEl.textContent = "Configure Jenkins URL in Settings first.";
    } else if (!hasToken) {
      statusEl.textContent = "No Jenkins token found. Add it in Settings.";
    }

    // Error mapping
    const errorMapping = (e) => {
      const s = String(e || "").toLowerCase();
      if (s.includes("user") && s.includes("invalid") && s.includes("empty")) {
        return "Set Jenkins Username on Settings first";
      }
      if (s.includes("http 401") || s.includes("unauthorized")) {
        return "Check Jenkins Username and Token in Settings";
      }
      if (s.includes("error sending request") && s.includes("/api/json")) {
        return "Error fetching ENV. Check your network connection.";
      }
      return String(e || "Unknown error");
    };

    // Log helpers
    const stripAnsi = (s) => String(s).replace(/\u001B\[[0-9;?]*[ -\/]*[@-~]|\u001B[@-_][0-?]*[ -\/]*[@-~]/g, "");
    const removeControl = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    const sanitizeLog = (s) => removeControl(stripAnsi(s)).replace(/\r/g, "\n");

    const appendLog = (text) => {
      logsEl.textContent += sanitizeLog(text);
      logsEl.scrollTop = logsEl.scrollHeight;
    };

    const clearLogListeners = () => {
      try {
        for (const un of this._logUnsubscribes) un();
      } catch (_) {}
      this._logUnsubscribes = [];
    };

    const subscribeToLogs = async () => {
      clearLogListeners();
      this._logUnsubscribes.push(
        await listen("jenkins:log", (ev) => {
          const data = ev?.payload || {};
          const chunk = typeof data === "string" ? data : data.chunk || "";
          appendLog(chunk);
        })
      );
      this._logUnsubscribes.push(
        await listen("jenkins:log-error", (ev) => {
          const msg = String(ev?.payload || "Log stream error");
          this.showError(msg);
          statusEl.textContent = "Log stream error";
        })
      );
      this._logUnsubscribes.push(
        await listen("jenkins:log-complete", () => {
          statusEl.textContent = "Complete";
          try {
            UsageTracker.trackEvent("run-batch", "run_success", { buildNumber: this.state.buildNumber || null });
          } catch (_) {}
        })
      );
    };

    // Open external URL
    const openExternalUrl = async (url) => {
      if (!url) return;
      if (isTauri()) {
        try {
          await invoke("open_url", { url });
          return;
        } catch (_) {}
      }
      try {
        const win = window.open(url, "_blank", "noopener,noreferrer");
        if (win) win.opener = null;
      } catch (_) {}
    };

    // Wire build link
    if (buildLink && !buildLink.dataset.externalHooked) {
      buildLink.dataset.externalHooked = "true";
      buildLink.addEventListener("click", (e) => {
        const href = buildLink.getAttribute("href") || "";
        if (!href || href === "#") {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        openExternalUrl(href);
      });
    }

    // Storage keys
    const STORAGE_KEY = "tool:run-batch:savedConfigs";

    const loadSavedConfigs = () => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      } catch (_) {
        return [];
      }
    };

    const saveSavedConfigs = (configs) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
      } catch (_) {}
    };

    const renderSavedConfigs = (searchFilter = "") => {
      let configs = loadSavedConfigs();

      // Filter by search term
      if (searchFilter) {
        configs = configs.filter((cfg) => {
          const searchable = `${cfg.name || ""} ${cfg.batchName || ""} ${cfg.jobName || ""}`.toLowerCase();
          return searchable.includes(searchFilter);
        });
      }

      if (configs.length === 0) {
        savedListEl.innerHTML = searchFilter
          ? '<p class="rb-empty-message">No matching configurations</p>'
          : '<p class="rb-empty-message">No saved configurations yet</p>';
        return;
      }
      savedListEl.innerHTML = configs
        .map((cfg) => {
          const hasConfluLink = cfg.confluenceLink && cfg.confluenceLink.trim();
          const nameHtml = hasConfluLink
            ? `<a href="#" class="rb-saved-name rb-conflu-link" data-conflu="${escHtml(cfg.confluenceLink)}">${escHtml(cfg.name)}</a>`
            : `<span class="rb-saved-name">${escHtml(cfg.name)}</span>`;
          return `
        <div class="rb-saved-card" data-id="${cfg.id}">
          <div class="rb-saved-info">
            ${nameHtml}
            <span class="rb-saved-details">${escHtml(cfg.batchName)} / ${escHtml(cfg.jobName)}</span>
          </div>
          <div class="rb-saved-actions">
            <button class="btn btn-sm-xs rb-load-btn" data-id="${cfg.id}">Load</button>
            <button class="btn btn-danger btn-sm-xs rb-delete-btn" data-id="${cfg.id}">Delete</button>
          </div>
        </div>
      `;
        })
        .join("");

      // Wire up confluence links to open in native browser
      savedListEl.querySelectorAll(".rb-conflu-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const url = link.dataset.conflu;
          if (url) openExternalUrl(url);
        });
      });

      // Wire up card click to open edit modal
      savedListEl.querySelectorAll(".rb-saved-card").forEach((card) => {
        card.addEventListener("click", (e) => {
          // Ignore if clicking on buttons or links
          if (e.target.closest(".rb-saved-actions") || e.target.closest(".rb-conflu-link")) return;
          const id = card.dataset.id;
          const cfg = configs.find((c) => c.id === id);
          if (cfg) openEditModal(cfg);
        });
      });

      // Wire up load/delete buttons
      savedListEl.querySelectorAll(".rb-load-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const cfg = configs.find((c) => c.id === id);
          if (cfg) {
            batchNameInput.value = cfg.batchName || "";
            jobNameInput.value = cfg.jobName || "";
            toggleRunEnabled();
            try {
              UsageTracker.trackEvent("run-batch", "config_loaded", { configId: id });
            } catch (_) {}
          }
        });
      });

      savedListEl.querySelectorAll(".rb-delete-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          openConfirmModal(id);
        });
      });
    };

    const escHtml = (s) =>
      String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    // Toggle run button enabled state
    const toggleRunEnabled = () => {
      const hasEnv = !!envSelect.value;
      const hasUrl = !!this.state.jenkinsUrl;
      const hasBatch = !!batchNameInput.value.trim();
      const hasJob = !!jobNameInput.value.trim();
      runBtn.disabled = !(hasEnv && hasUrl && hasBatch && hasJob);
    };

    // Load ENV choices
    const refreshEnvChoices = async (retry = 0) => {
      const baseUrl = this.state.jenkinsUrl;
      if (!baseUrl) {
        envErrorEl.style.display = "block";
        envErrorEl.textContent = "Configure Jenkins URL in Settings first";
        return;
      }
      try {
        statusEl.textContent = "Loading environments…";
        envSelect.disabled = true;
        const choices = await this.service.getEnvChoices(baseUrl);
        this.state.envChoices = Array.isArray(choices) ? choices : [];

        if (this.state.envChoices.length === 0) {
          envErrorEl.style.display = "block";
          envErrorEl.textContent = "No environments found. Check if job exists and has ENVIRONMENT parameter.";
          envSelect.innerHTML = '<option value="">No environments</option>';
          statusEl.textContent = "No environments available";
        } else {
          envSelect.innerHTML = this.state.envChoices.map((c) => `<option value="${c}">${c}</option>`).join("");
          envErrorEl.style.display = "none";
          statusEl.textContent = "Ready";
        }
      } catch (err) {
        statusEl.textContent = `Failed to load environments${retry ? ` (attempt ${retry + 1})` : ""}`;
        envErrorEl.style.display = "block";
        envErrorEl.textContent = errorMapping(err);
        if (retry < 2) {
          setTimeout(() => refreshEnvChoices(retry + 1), 1500);
        }
      } finally {
        envSelect.disabled = false;
        toggleRunEnabled();
      }
    };

    // Input event listeners
    [batchNameInput, jobNameInput, envSelect].forEach((el) => {
      el.addEventListener("input", toggleRunEnabled);
      el.addEventListener("change", toggleRunEnabled);
    });

    // Run batch job
    runBtn.addEventListener("click", async () => {
      const env = envSelect.value;
      const batchName = batchNameInput.value.trim();
      const jobName = jobNameInput.value.trim();

      if (!env || !batchName || !jobName) {
        statusEl.textContent = "Please fill all fields";
        return;
      }

      logsEl.textContent = "";
      buildLink.style.display = "none";
      buildNumEl.style.display = "none";
      runBtn.disabled = true;

      try {
        statusEl.textContent = "Triggering batch job…";
        UsageTracker.trackEvent("run-batch", "run_started", { env, batchName, jobName });

        await subscribeToLogs();

        const queueUrl = await this.service.triggerBatchJob(this.state.jenkinsUrl, env, batchName, jobName);
        this.state.queueUrl = queueUrl;

        statusEl.textContent = "Waiting for build to start…";

        // Poll queue for build number
        let buildNumber = null;
        let executableUrl = null;
        for (let i = 0; i < 60; i++) {
          const result = await this.service.pollQueue(this.state.jenkinsUrl, queueUrl);
          if (result.buildNumber) {
            buildNumber = result.buildNumber;
            executableUrl = result.executableUrl;
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }

        if (!buildNumber) {
          throw new Error("Timed out waiting for build to start");
        }

        this.state.buildNumber = buildNumber;
        this.state.executableUrl = executableUrl;

        buildNumEl.textContent = `#${buildNumber}`;
        buildNumEl.style.display = "inline";
        if (executableUrl) {
          buildLink.href = executableUrl;
          buildLink.style.display = "inline";
        }

        statusEl.textContent = `Streaming logs for build #${buildNumber}…`;
        await this.service.streamLogs(this.state.jenkinsUrl, buildNumber);
      } catch (err) {
        statusEl.textContent = "Error: " + errorMapping(err);
        this.showError(errorMapping(err));
        UsageTracker.trackEvent("run-batch", "run_error", { error: String(err) });
      } finally {
        runBtn.disabled = false;
        toggleRunEnabled();
      }
    });

    // Save modal logic
    let _pendingDeleteId = null;

    const openSaveModal = () => {
      configNameInput.value = "";
      configNameError.style.display = "none";
      if (configConfluLinkInput) configConfluLinkInput.value = "";
      saveModalOverlay.style.display = "block";
      saveModal.style.display = "flex";
      configNameInput.focus();
    };

    const closeSaveModal = () => {
      saveModalOverlay.style.display = "none";
      saveModal.style.display = "none";
    };

    saveBtn.addEventListener("click", () => {
      if (!batchNameInput.value.trim() || !jobNameInput.value.trim()) {
        statusEl.textContent = "Enter batch and job name before saving";
        return;
      }
      openSaveModal();
    });

    saveModalClose.addEventListener("click", closeSaveModal);
    saveModalCancel.addEventListener("click", closeSaveModal);
    saveModalOverlay.addEventListener("click", closeSaveModal);

    saveModalConfirm.addEventListener("click", () => {
      const name = configNameInput.value.trim();
      if (!name) {
        configNameError.textContent = "Name is required";
        configNameError.style.display = "block";
        return;
      }

      const configs = loadSavedConfigs();
      if (configs.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        configNameError.textContent = "A config with this name already exists";
        configNameError.style.display = "block";
        return;
      }

      const confluenceLink = configConfluLinkInput ? configConfluLinkInput.value.trim() : "";

      const newConfig = {
        id: crypto.randomUUID(),
        name,
        batchName: batchNameInput.value.trim(),
        jobName: jobNameInput.value.trim(),
        confluenceLink,
        createdAt: new Date().toISOString(),
      };

      configs.push(newConfig);
      saveSavedConfigs(configs);
      renderSavedConfigs();
      closeSaveModal();
      statusEl.textContent = "Configuration saved";

      try {
        UsageTracker.trackEvent("run-batch", "config_saved", { configId: newConfig.id });
      } catch (_) {}
    });

    // Confirm delete modal
    const openConfirmModal = (id) => {
      _pendingDeleteId = id;
      saveModalOverlay.style.display = "block";
      confirmModal.style.display = "flex";
    };

    const closeConfirmModal = () => {
      saveModalOverlay.style.display = "none";
      confirmModal.style.display = "none";
      _pendingDeleteId = null;
    };

    confirmClose.addEventListener("click", closeConfirmModal);
    confirmCancel.addEventListener("click", closeConfirmModal);

    confirmDelete.addEventListener("click", () => {
      if (_pendingDeleteId) {
        const configs = loadSavedConfigs().filter((c) => c.id !== _pendingDeleteId);
        saveSavedConfigs(configs);
        renderSavedConfigs();
        try {
          UsageTracker.trackEvent("run-batch", "config_deleted", { configId: _pendingDeleteId });
        } catch (_) {}
      }
      closeConfirmModal();
    });

    // Edit modal handlers
    const openEditModal = (cfg) => {
      if (!cfg) return;
      editConfigIdInput.value = cfg.id || "";
      editConfigNameInput.value = cfg.name || "";
      editBatchNameInput.value = cfg.batchName || "";
      editJobNameInput.value = cfg.jobName || "";
      editConfluLinkInput.value = cfg.confluenceLink || "";
      editConfigNameError.style.display = "none";
      saveModalOverlay.style.display = "block";
      editModal.style.display = "flex";
      editConfigNameInput.focus();
    };

    const closeEditModal = () => {
      saveModalOverlay.style.display = "none";
      editModal.style.display = "none";
    };

    editModalClose.addEventListener("click", closeEditModal);
    editModalCancel.addEventListener("click", closeEditModal);

    editModalConfirm.addEventListener("click", () => {
      const id = editConfigIdInput.value;
      const name = editConfigNameInput.value.trim();
      const batchName = editBatchNameInput.value.trim();
      const jobName = editJobNameInput.value.trim();
      const confluenceLink = editConfluLinkInput.value.trim();

      if (!name) {
        editConfigNameError.textContent = "Name is required";
        editConfigNameError.style.display = "block";
        return;
      }
      if (!batchName || !jobName) {
        editConfigNameError.textContent = "Batch Name and Job Name are required";
        editConfigNameError.style.display = "block";
        return;
      }

      const configs = loadSavedConfigs();
      const existingWithSameName = configs.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== id);
      if (existingWithSameName) {
        editConfigNameError.textContent = "A config with this name already exists";
        editConfigNameError.style.display = "block";
        return;
      }

      const idx = configs.findIndex((c) => c.id === id);
      if (idx !== -1) {
        configs[idx] = {
          ...configs[idx],
          name,
          batchName,
          jobName,
          confluenceLink,
          updatedAt: new Date().toISOString(),
        };
        saveSavedConfigs(configs);
        renderSavedConfigs();
        closeEditModal();
        statusEl.textContent = "Configuration updated";
        try {
          UsageTracker.trackEvent("run-batch", "config_updated", { configId: id });
        } catch (_) {}
      }
    });

    // Tab switching
    const switchTab = (tabName) => {
      const isRun = tabName === "run";
      tabRunBtn.classList.toggle("active", isRun);
      tabRunBtn.setAttribute("aria-selected", isRun.toString());
      tabHistoryBtn.classList.toggle("active", !isRun);
      tabHistoryBtn.setAttribute("aria-selected", (!isRun).toString());
      tabRunPanel.style.display = isRun ? "flex" : "none";
      tabHistoryPanel.style.display = isRun ? "none" : "flex";
    };

    tabRunBtn.addEventListener("click", () => switchTab("run"));
    tabHistoryBtn.addEventListener("click", () => {
      switchTab("history");
      renderHistory();
    });

    // Search filter for saved configs
    let searchTerm = "";
    configSearchInput.addEventListener("input", () => {
      searchTerm = configSearchInput.value.trim().toLowerCase();
      renderSavedConfigs(searchTerm);
    });

    // Update renderSavedConfigs to accept search filter
    const originalRenderSavedConfigs = renderSavedConfigs;

    // History storage
    const HISTORY_KEY = "tool:run-batch:history";
    const loadHistory = () => {
      try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      } catch (_) {
        return [];
      }
    };

    const saveHistory = (history) => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch (_) {}
    };

    const addHistoryEntry = (entry) => {
      const history = loadHistory();
      history.unshift(entry);
      // Keep only last 50 entries
      if (history.length > 50) history.length = 50;
      saveHistory(history);
    };

    const renderHistory = () => {
      const history = loadHistory();
      if (history.length === 0) {
        historyListEl.innerHTML = "";
        historyEmptyEl.style.display = "block";
        return;
      }
      historyEmptyEl.style.display = "none";
      historyListEl.innerHTML = history
        .map(
          (h) => `
        <tr data-id="${h.id}">
          <td>${escHtml(h.time || "")}</td>
          <td>${escHtml(h.configName || h.batchName || "")}</td>
          <td>${escHtml(h.env || "")}</td>
          <td>${escHtml(h.status || "")}</td>
          <td>
            ${h.buildUrl ? `<a href="#" class="rb-history-link" data-url="${escHtml(h.buildUrl)}">View Build</a>` : "-"}
          </td>
        </tr>
      `
        )
        .join("");

      historyListEl.querySelectorAll(".rb-history-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          openExternalUrl(link.dataset.url);
        });
      });
    };

    // Initialize
    await refreshEnvChoices();
    renderSavedConfigs();

    try {
      UsageTracker.trackFeature("run-batch");
    } catch (_) {}
  }

  onUnmount() {
    try {
      for (const un of this._logUnsubscribes) un();
    } catch (_) {}
    this._logUnsubscribes = [];
  }

  onDeactivate() {
    this.onUnmount();
  }
}
