import { BaseTool } from "../../core/BaseTool.js";
import { JenkinsRunnerTemplate } from "./template.js";
import { JenkinsRunnerService } from "./service.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";
import { UsageTracker } from "../../core/UsageTracker.js";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../core/Runtime.js";
import { invoke } from "@tauri-apps/api/core";
import { ensureMonacoWorkers, setupMonacoOracle, createOracleEditor } from "../../core/MonacoOracle.js";

export class JenkinsRunner extends BaseTool {
  constructor(eventBus) {
    super({
      id: "jenkins-runner",
      name: "Jenkins Query Runner",
      description: "Run Oracle SQL Query via Jenkins job and stream the build logs",
      icon: "jenkins",
      category: "config",
      eventBus,
    });
    this.service = new JenkinsRunnerService();
    this.state = {
      jenkinsUrl: "",
      envChoices: [],
      queueUrl: null,
      buildNumber: null,
      executableUrl: null,
    };
    this._logUnsubscribes = [];
    this.editor = null;
    this.templateEditor = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return JenkinsRunnerTemplate;
  }

  async onMount() {
    const baseUrlInput = this.container.querySelector("#jenkins-baseurl");
    const jobInput = this.container.querySelector("#jenkins-job");
    const envSelect = this.container.querySelector("#jenkins-env");
    const sqlEditorContainer = this.container.querySelector("#jenkins-sql-editor");
    const sqlPreviewEl = this.container.querySelector("#jenkins-sql-preview");
    const runBtn = this.container.querySelector("#jenkins-run");
    const statusEl = this.container.querySelector('[data-role="status"]');
    const hintEl = this.container.querySelector('[data-role="hint"]');
    const logsEl = this.container.querySelector("#jenkins-logs");
    const buildLink = this.container.querySelector("#jenkins-build-link");
    const jobErrorEl = this.container.querySelector("#jenkins-job-error");
    const envErrorEl = this.container.querySelector("#jenkins-env-error");
    const buildNumEl = this.container.querySelector("#jenkins-build-number");
    const runTabBtn = this.container.querySelector("#jr-tab-run-btn");
    const historyTabBtn = this.container.querySelector("#jr-tab-history-btn");
    const runTab = this.container.querySelector("#jr-tab-run");
    const historyTab = this.container.querySelector("#jr-tab-history");
    const historyList = this.container.querySelector("#jr-history-list");
    const templatesTabBtn = this.container.querySelector("#jr-tab-templates-btn");
    const templatesTab = this.container.querySelector("#jr-tab-templates");
    const templateNameInput = this.container.querySelector("#jr-template-name");
    const templateNameErrorEl = this.container.querySelector("#jr-template-name-error");
    const templateJobSelect = this.container.querySelector("#jr-template-job");
    const templateEnvSelect = this.container.querySelector("#jr-template-env");
    const templateEnvErrorEl = this.container.querySelector("#jr-template-env-error");
    const templateSqlEditorContainer = this.container.querySelector("#jr-template-sql-editor");
    const templateListEl = this.container.querySelector("#jr-template-list");
    const templateSearchInput = this.container.querySelector("#jr-template-search");
    const templateSortSelect = this.container.querySelector("#jr-template-sort");
    const templateHintEl = this.container.querySelector("#jr-template-hint");
    const templateCreateBtn = this.container.querySelector("#jr-template-create-btn");
    const filterEnvSelect = this.container.querySelector("#jr-template-filter-env");
    // Tags filter UI
    const filterTagsContainer = this.container.querySelector("#jr-template-filter-tags");
    const filterTagsInput = this.container.querySelector("#jr-tags-filter-input");
    const filterTagsSelectedEl = this.container.querySelector("#jr-tags-filter-selected");
    const filterTagsSuggestionsEl = this.container.querySelector("#jr-tags-filter-suggestions");
    const templateModal = this.container.querySelector("#jr-template-modal");
    const templateModalOverlay = this.container.querySelector("#jr-template-modal-overlay");
    const templateModalTitle = this.container.querySelector("#jr-template-modal-title");
    const templateModalCloseBtn = this.container.querySelector("#jr-template-modal-close");
    const templateModalSaveBtn = this.container.querySelector("#jr-template-modal-save");
    const templateModalCancelBtn = this.container.querySelector("#jr-template-modal-cancel");
    // Tags modal UI
    const templateTagsContainer = this.container.querySelector("#jr-template-tags");
    const templateTagsInput = this.container.querySelector("#jr-template-tags-input");
    const templateTagsSelectedEl = this.container.querySelector("#jr-template-tags-selected");
    const templateTagsSuggestionsEl = this.container.querySelector("#jr-template-tags-suggestions");
    const templateTagsErrorEl = this.container.querySelector("#jr-template-tags-error");
    const templateTagsHintEl = this.container.querySelector("#jr-template-tags-hint");

    // Map backend error strings to friendly guidance
    const toFriendlyError = (e) => {
      const s = String(e || "").toLowerCase();
      if (s.includes("user") && s.includes("invalid") && s.includes("empty")) {
        return "Set Jenkins Username on Settings first";
      }
      if (s.includes("http 401") || s.includes("unauthorized")) {
        return "Check Jenkins Username and Token in Settings";
      }
      // Network/request errors when fetching Jenkins job or env details
      if (s.includes("error sending request") && s.includes("/api/json")) {
        return "Error fetching ENV type. Check your internal network connection and Jenkins availability.";
      }
      return String(e || "Unknown error");
    };

    const escHtml = (s) =>
      String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    // Debounce helper
    const debounce = (fn, ms = 150) => {
      let t = null;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
      };
    };

    // Tag helpers
    const normalizeTag = (s) =>
      String(s || "")
        .trim()
        .toLowerCase();
    const isValidTag = (s) => /^[a-z0-9-]{1,24}$/.test(s);
    const toValidTagOrNull = (s) => {
      const t = normalizeTag(s);
      return isValidTag(t) ? t : null;
    };
    const collectAllTags = () => {
      const set = new Set();
      const arr = loadTemplates();
      for (const t of arr) {
        const tags = Array.isArray(t?.tags) ? t.tags : [];
        for (const tg of tags) {
          const tt = normalizeTag(tg);
          if (isValidTag(tt)) set.add(tt);
        }
      }
      return Array.from(set).sort();
    };
    const renderSelectedChips = (containerEl, tags, removable = true) => {
      if (!containerEl) return;
      containerEl.innerHTML = (tags || [])
        .map(
          (tg) =>
            `<span class="jr-tag" title="${escHtml(tg)}"><span>${escHtml(tg)}</span>${
              removable
                ? ` <button type="button" class="jr-tag-remove" data-tag="${escHtml(tg)}" aria-label="Remove tag ${escHtml(
                    tg
                  )}" title="Remove">×</button>`
                : ""
            }</span>`
        )
        .join("");
    };
    const renderSuggestions = (inputEl, suggestionsEl, list, activeIndex = -1) => {
      if (!suggestionsEl) return;
      if (!list || list.length === 0) {
        suggestionsEl.style.display = "none";
        suggestionsEl.innerHTML = "";
        inputEl?.setAttribute("aria-expanded", "false");
        return;
      }
      suggestionsEl.innerHTML = list
        .map(
          (s, i) =>
            `<div class="jr-suggestion" role="option" data-value="${escHtml(s)}" aria-selected="${
              i === activeIndex ? "true" : "false"
            }" tabindex="-1">${escHtml(s)}</div>`
        )
        .join("");
      suggestionsEl.style.display = "block";
      inputEl?.setAttribute("aria-expanded", "true");
    };

    // UI timestamp formatting: dd/mm/yyyy, hh:mm AM
    const formatTimestamp = (dateLike) => {
      if (!dateLike) return "";
      const d = new Date(dateLike);
      if (Number.isNaN(d.getTime())) return "";
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      if (hours === 0) hours = 12;
      const hh = String(hours).padStart(2, "0");
      return `${dd}/${mm}/${yyyy}, ${hh}:${minutes} ${ampm}`;
    };

    // Open external URL in default browser with Tauri-aware fallbacks
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

    // Wire build link to open externally in all runtimes
    if (buildLink && !buildLink.dataset.externalHooked) {
      buildLink.dataset.externalHooked = "true";
      buildLink.addEventListener("click", (e) => {
        const href = buildLink.getAttribute("href") || "";
        // Prevent navigation if href is unset
        if (!href || href === "#") {
          e.preventDefault();
          return;
        }
        // Always handle opening explicitly to ensure consistent behavior
        e.preventDefault();
        openExternalUrl(href);
      });
    }

    // Log helpers scoped to this tool instance
    // Strip ANSI escape sequences and non-printable control chars so logs render cleanly.
    const stripAnsi = (s) => String(s).replace(/\u001B\[[0-9;?]*[ -\/]*[@-~]|\u001B[@-_][0-?]*[ -\/]*[@-~]/g, "");
    const removeControl = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    // Drop content wrapped in ANSI SGR 8 (conceal) until reset (0m/28m/m)
    const removeConcealedSegments = (s) => String(s).replace(/\u001B\[8m[\s\S]*?\u001B\[(?:0|28)?m/g, "");
    const sanitizeLog = (s) => {
      const noHidden = removeConcealedSegments(s);
      const noAnsi = stripAnsi(noHidden);
      const noCtrl = removeControl(noAnsi);
      return noCtrl.replace(/\r/g, "\n");
    };

    const appendLog = (text) => {
      const safe = sanitizeLog(text);
      logsEl.textContent += safe;
      logsEl.scrollTop = logsEl.scrollHeight;
    };

    const clearLogListeners = () => {
      try {
        for (const un of this._logUnsubscribes) {
          un();
        }
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
            UsageTracker.trackEvent("jenkins-runner", "run_success", { buildNumber: this.state.buildNumber || null });
          } catch (_) {}
        })
      );
    };

    const allowedJobs = new Set(["tester-execute-query", "tester-execute-query-new"]);

    // Load Jenkins URL
    this.state.jenkinsUrl = this.service.loadJenkinsUrl();
    baseUrlInput.value = this.state.jenkinsUrl || "";
    if (!this.state.jenkinsUrl) {
      statusEl.textContent = "Configure Jenkins URL in Settings first.";
    }

    // Token presence hint
    const hasToken = await this.service.hasToken();
    if (!hasToken) {
      hintEl.style.display = "block";
      hintEl.textContent = "No Jenkins token found. Add it in Settings → Credential Management.";
    }

    const persistEnvKey = "tool:jenkins-runner:env";
    const savedEnv = localStorage.getItem(persistEnvKey) || "";

    // Persist last UI state (URL, job, env, SQL)
    const persistStateKey = "tool:jenkins-runner:lastState";
    let lastState = {};
    try {
      lastState = JSON.parse(localStorage.getItem(persistStateKey) || "{}");
    } catch (_) {
      lastState = {};
    }
    if (lastState.job && allowedJobs.has(lastState.job)) {
      jobInput.value = lastState.job;
    }

    // Initialize Monaco for Oracle SQL editor via shared setup
    ensureMonacoWorkers();
    setupMonacoOracle();
    this.editor = createOracleEditor(sqlEditorContainer, {
      value: lastState.sql || "",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 11,
      tabSize: 2,
      insertSpaces: true,
      // Disable Monaco suggestions/autocomplete in Jenkins Runner
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      wordBasedSuggestions: false,
      snippetSuggestions: "none",
      parameterHints: { enabled: false },
      inlineSuggest: { enabled: false },
      acceptSuggestionOnEnter: "off",
      tabCompletion: "off",
    });

    // Monaco for Templates (create/edit only)
    if (templateSqlEditorContainer) {
      this.templateEditor = createOracleEditor(templateSqlEditorContainer, {
        value: "",
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        fontSize: 11,
        tabSize: 2,
        insertSpaces: true,
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        wordBasedSuggestions: false,
        snippetSuggestions: "none",
        parameterHints: { enabled: false },
        inlineSuggest: { enabled: false },
        acceptSuggestionOnEnter: "off",
        tabCompletion: "off",
      });
    }

    // Ensure editors re-layout when the sidebar collapses/expands or window resizes
    const relayoutEditors = () => {
      try {
        if (this.editor && typeof this.editor.layout === "function") this.editor.layout();
      } catch (_) {}
      try {
        if (this.templateEditor && typeof this.templateEditor.layout === "function") this.templateEditor.layout();
      } catch (_) {}
    };

    // Listen for EventBus sidebar events if available
    this._sidebarUnsubs = [];
    if (this.eventBus) {
      try {
        this._sidebarUnsubs.push(this.eventBus.on("sidebar:collapsed", relayoutEditors));
        this._sidebarUnsubs.push(this.eventBus.on("sidebar:expanded", relayoutEditors));
        this._sidebarUnsubs.push(this.eventBus.on("sidebar:opened", relayoutEditors));
        this._sidebarUnsubs.push(this.eventBus.on("sidebar:closed", relayoutEditors));
      } catch (_) {}
    }
    // Also listen to DOM custom event for broader compatibility
    this._sidebarDomListener = (e) => relayoutEditors();
    document.addEventListener("sidebarStateChange", this._sidebarDomListener);
    // Window resize safety net
    this._resizeListener = () => relayoutEditors();
    window.addEventListener("resize", this._resizeListener);

    const saveLastState = (patch = {}) => {
      const base = {
        jenkinsUrl: this.state.jenkinsUrl,
        job: jobInput.value.trim(),
        env: envSelect.value,
        sql: this.editor ? this.editor.getValue() : "",
      };
      const merged = { ...lastState, ...base, ...patch };
      lastState = merged;
      try {
        localStorage.setItem(persistStateKey, JSON.stringify(merged));
      } catch (_) {}
    };
    saveLastState();

    // Validate job name
    const validateJobName = () => {
      const name = jobInput.value.trim();
      if (!allowedJobs.has(name)) {
        jobErrorEl.style.display = "block";
        jobErrorEl.textContent = "Invalid job name. Allowed: tester-execute-query or tester-execute-query-new.";
        return false;
      }
      jobErrorEl.style.display = "none";
      return true;
    };

    const toggleSubmitEnabled = () => {
      const validJob = validateJobName();
      const hasEnv = !!envSelect.value;
      const hasUrl = !!this.state.jenkinsUrl;
      const hasSql = !!(this.editor && this.editor.getValue().trim().length >= 5);
      runBtn.disabled = !(validJob && hasEnv && hasUrl && hasSql);
    };

    // SQL preview toggle when running from a template
    const showSqlPreview = (sqlText) => {
      if (!sqlPreviewEl) return;
      sqlPreviewEl.textContent = String(sqlText || "");
      sqlPreviewEl.style.display = "block";
      if (sqlEditorContainer) sqlEditorContainer.style.display = "none";
    };
    const hideSqlPreview = () => {
      if (!sqlPreviewEl) return;
      sqlPreviewEl.style.display = "none";
      if (sqlEditorContainer) sqlEditorContainer.style.display = "block";
    };

    const refreshEnvChoices = async (retry = 0) => {
      logsEl.textContent = "";
      buildLink.style.display = "none";
      if (buildNumEl) {
        buildNumEl.style.display = "none";
        buildNumEl.textContent = "";
      }
      this.state.executableUrl = null;
      const baseUrl = this.state.jenkinsUrl;
      const job = jobInput.value.trim();
      if (!baseUrl || !job) return;
      try {
        statusEl.textContent = "Loading ENV choices…";
        envSelect.classList.add("jr-loading");
        envSelect.disabled = true;
        const choices = await this.service.getEnvChoices(baseUrl, job);
        this.state.envChoices = Array.isArray(choices) ? choices : [];
        envSelect.innerHTML = this.state.envChoices.map((c) => `<option value="${c}">${c}</option>`).join("");

        if (savedEnv && this.state.envChoices.includes(savedEnv)) {
          envSelect.value = savedEnv;
        } else if (lastState.env && this.state.envChoices.includes(lastState.env)) {
          envSelect.value = lastState.env;
        }
        envErrorEl.style.display = "none";
        statusEl.textContent = "Ready";
      } catch (err) {
        const msg = `Failed to load environments${retry ? ` (attempt ${retry + 1})` : ""}`;
        statusEl.textContent = msg;
        envErrorEl.style.display = "block";
        envErrorEl.textContent = toFriendlyError(err);
        if (retry < 2) {
          setTimeout(() => refreshEnvChoices(retry + 1), 1500);
        }
      } finally {
        envSelect.classList.remove("jr-loading");
        envSelect.disabled = false;
        toggleSubmitEnabled();
      }
    };

    // Templates: storage and rendering
    const persistTemplatesKey = "tool:jenkins-runner:templates";
    const loadTemplates = () => {
      try {
        const raw = localStorage.getItem(persistTemplatesKey) || "[]";
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (_) {
        return [];
      }
    };
    const saveTemplates = (arr) => {
      try {
        localStorage.setItem(persistTemplatesKey, JSON.stringify(arr));
      } catch (_) {}
    };
    const findTemplateByName = (name) => {
      const arr = loadTemplates();
      return arr.find((t) => (t?.name || "") === name) || null;
    };

    // Modal state
    this.state.modalOpen = false;
    this._modalPrevFocusEl = null;
    const clearTemplateForm = () => {
      if (templateNameInput) templateNameInput.value = "";
      if (templateJobSelect) templateJobSelect.value = "tester-execute-query-new";
      if (templateEnvSelect) templateEnvSelect.innerHTML = "";
      if (this.templateEditor) this.templateEditor.setValue("");
      if (templateNameErrorEl) templateNameErrorEl.style.display = "none";
      if (templateEnvErrorEl) templateEnvErrorEl.style.display = "none";
      this.state.editingTemplateName = null;
    };

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    let focusTrapHandler = null;
    const activateFocusTrap = (container) => {
      const all = Array.from(container.querySelectorAll(focusableSelector)).filter((el) => !el.hasAttribute("disabled"));
      const first = all[0];
      const last = all[all.length - 1];
      if (first) first.focus();
      focusTrapHandler = (e) => {
        if (e.key === "Tab") {
          if (all.length === 0) return;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        } else if (e.key === "Escape") {
          closeTemplateModal(true);
        }
      };
      container.addEventListener("keydown", focusTrapHandler);
    };
    const deactivateFocusTrap = (container) => {
      if (focusTrapHandler) {
        container.removeEventListener("keydown", focusTrapHandler);
        focusTrapHandler = null;
      }
    };

    // Modal tags state
    let modalTags = [];

    const openTemplateModal = (mode = "create", tpl = null) => {
      if (!templateModal || !templateModalOverlay) return;
      this.state.modalOpen = true;
      this._modalPrevFocusEl = document.activeElement;
      templateModalOverlay.style.display = "block";
      templateModal.style.display = "flex";
      if (templateModalTitle) templateModalTitle.textContent = mode === "edit" ? "Edit Template" : "Create Template";
      if (mode === "edit" && tpl) {
        this.state.editingTemplateName = tpl.name || null;
        if (templateNameInput) templateNameInput.value = tpl.name || "";
        if (templateJobSelect) templateJobSelect.value = tpl.job || "tester-execute-query";
        refreshTemplateEnvChoices().then(() => {
          if (templateEnvSelect) templateEnvSelect.value = tpl.env || "";
        });
        if (this.templateEditor) this.templateEditor.setValue(tpl.sql || "");
        // Set tags for edit
        modalTags = Array.from(new Set((Array.isArray(tpl?.tags) ? tpl.tags : []).map((x) => normalizeTag(x)).filter(isValidTag)));
      } else {
        clearTemplateForm();
        refreshTemplateEnvChoices();
        modalTags = [];
      }
      // Initialize modal tags UI
      if (templateTagsSelectedEl) renderSelectedChips(templateTagsSelectedEl, modalTags, true);
      if (templateTagsInput) templateTagsInput.value = "";
      if (templateTagsErrorEl) templateTagsErrorEl.style.display = "none";
      activateFocusTrap(templateModal);
    };

    const closeTemplateModal = (clear = true) => {
      if (!templateModal || !templateModalOverlay) return;
      this.state.modalOpen = false;
      templateModalOverlay.style.display = "none";
      templateModal.style.display = "none";
      deactivateFocusTrap(templateModal);
      if (clear) clearTemplateForm();
      if (this._modalPrevFocusEl && typeof this._modalPrevFocusEl.focus === "function") {
        this._modalPrevFocusEl.focus();
      }
    };

    const refreshTemplateEnvChoices = async (retry = 0) => {
      if (!templateEnvSelect) return;
      const baseUrl = this.state.jenkinsUrl;
      const job = templateJobSelect ? templateJobSelect.value.trim() : "";
      if (!baseUrl) {
        if (templateHintEl) templateHintEl.textContent = "Configure Jenkins URL in Settings first.";
        return;
      }
      if (!job || !allowedJobs.has(job)) {
        if (templateEnvErrorEl) {
          templateEnvErrorEl.style.display = "block";
          templateEnvErrorEl.textContent = "Select a valid Job type first.";
        }
        return;
      }
      try {
        if (templateEnvErrorEl) templateEnvErrorEl.style.display = "none";
        if (templateHintEl) templateHintEl.textContent = "Loading ENV choices…";
        templateEnvSelect.classList.add("jr-loading");
        templateEnvSelect.disabled = true;
        const choices = await this.service.getEnvChoices(baseUrl, job);
        const envs = Array.isArray(choices) ? choices : [];
        templateEnvSelect.innerHTML = envs.map((c) => `<option value="${c}">${c}</option>`).join("");
        if (templateHintEl) templateHintEl.textContent = "";
      } catch (err) {
        if (templateEnvErrorEl) {
          templateEnvErrorEl.style.display = "block";
          templateEnvErrorEl.textContent = toFriendlyError(err);
        }
        if (retry < 2) setTimeout(() => refreshTemplateEnvChoices(retry + 1), 1500);
      } finally {
        templateEnvSelect.classList.remove("jr-loading");
        templateEnvSelect.disabled = false;
      }
    };

    this.state.editingTemplateName = null;

    const validateTemplateForm = () => {
      let ok = true;
      const name = (templateNameInput?.value || "").trim();
      const job = (templateJobSelect?.value || "").trim();
      const env = (templateEnvSelect?.value || "").trim();
      const sql = this.templateEditor ? this.templateEditor.getValue().trim() : "";

      if (!name) {
        ok = false;
        if (templateNameErrorEl) {
          templateNameErrorEl.style.display = "block";
          templateNameErrorEl.textContent = "Template name is required.";
        }
      } else {
        if (templateNameErrorEl) templateNameErrorEl.style.display = "none";
      }
      if (!allowedJobs.has(job)) {
        ok = false;
      }
      if (!env) {
        ok = false;
        if (templateEnvErrorEl) {
          templateEnvErrorEl.style.display = "block";
          templateEnvErrorEl.textContent = "Select ENV.";
        }
      } else {
        if (templateEnvErrorEl) templateEnvErrorEl.style.display = "none";
      }
      if (!sql || sql.length < 5) {
        ok = false;
        this.showError("SQL query is required and must be at least 5 characters.");
      }

      // uniqueness check if creating new or renaming
      const existing = findTemplateByName(name);
      if (!this.state.editingTemplateName && existing) {
        ok = false;
        if (templateNameErrorEl) {
          templateNameErrorEl.style.display = "block";
          templateNameErrorEl.textContent = "Template name must be unique.";
        }
      }
      if (this.state.editingTemplateName && this.state.editingTemplateName !== name && existing) {
        ok = false;
        if (templateNameErrorEl) {
          templateNameErrorEl.style.display = "block";
          templateNameErrorEl.textContent = "Another template already uses this name.";
        }
      }
      return ok;
    };

    const renderTemplates = () => {
      if (!templateListEl) return;
      const q = (templateSearchInput?.value || "").toLowerCase();
      const sort = templateSortSelect?.value || "updated_desc";
      let arr = loadTemplates();
      // Apply filters
      const envFilter = filterEnvSelect?.value || "all";
      if (envFilter !== "all") arr = arr.filter((t) => t.env === envFilter);
      // Tag filter (ALL selected tags must be present)
      const selectedTags = Array.isArray(this.state.filterTagsSelected) ? this.state.filterTagsSelected : [];
      if (selectedTags.length > 0) {
        // Build tag index for performance: tag => Set(name)
        const tagIndex = new Map();
        for (const t of arr) {
          const tags = Array.isArray(t?.tags) ? t.tags : [];
          for (const tg of tags) {
            const key = normalizeTag(tg);
            if (!isValidTag(key)) continue;
            if (!tagIndex.has(key)) tagIndex.set(key, new Set());
            tagIndex.get(key).add(t.name);
          }
        }
        // Intersect sets for all selected tags
        let candidate = null;
        for (const tg of selectedTags) {
          const set = tagIndex.get(tg) || new Set();
          candidate = candidate ? new Set([...candidate].filter((x) => set.has(x))) : new Set(set);
          if (candidate.size === 0) break;
        }
        if (candidate) arr = arr.filter((t) => candidate.has(t.name));
      }
      if (q) {
        arr = arr.filter(
          (t) =>
            [t.name, t.job, t.env].some((v) =>
              String(v || "")
                .toLowerCase()
                .includes(q)
            ) ||
            String(t.sql || "")
              .toLowerCase()
              .includes(q)
        );
      }
      // Populate env filter based on available templates
      if (filterEnvSelect) {
        const current = filterEnvSelect.value;
        const envs = Array.from(new Set(arr.map((t) => t.env).filter(Boolean))).sort();
        filterEnvSelect.innerHTML =
          '<option value="all">All Env</option>' + envs.map((e) => `<option value="${escHtml(e)}">${escHtml(e)}</option>`).join("");
        if ([...filterEnvSelect.options].some((o) => o.value === current)) {
          filterEnvSelect.value = current;
        }
      }
      // Sort: pinned first, then apply selected sort within groups
      const compareBySort = (a, b) => {
        if (sort === "name_asc") return String(a.name).localeCompare(String(b.name));
        if (sort === "name_desc") return String(b.name).localeCompare(String(a.name));
        if (sort === "updated_asc") return new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0);
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      };
      arr.sort((a, b) => {
        const pinA = a && a.pinned ? 1 : 0;
        const pinB = b && b.pinned ? 1 : 0;
        if (pinB !== pinA) return pinB - pinA; // pinned first
        return compareBySort(a, b);
      });

      const cards = arr
        .map((t) => {
          const updatedTs = t.updatedAt || t.createdAt || null;
          const updated = formatTimestamp(updatedTs);
          const sqlRaw = String(t.sql || "");
          const sqlOneLine = sqlRaw.replace(/\s+/g, " ").trim();
          const sqlShort = sqlOneLine.length > 120 ? sqlOneLine.slice(0, 117) + "..." : sqlOneLine;
          const sqlTitle = escHtml(sqlOneLine);
          const nameTitle = escHtml(String(t.name || ""));
          const envHtml = escHtml(String(t.env || ""));
          const pinned = !!t.pinned;
          const tags = Array.isArray(t?.tags) ? t.tags.map((x) => normalizeTag(x)).filter(isValidTag) : [];
          const maxShow = 3;
          const shown = tags.slice(0, maxShow);
          const hidden = tags.slice(maxShow);
          const tagsHtml =
            shown.map((tg) => `<span class="jr-tag-badge" title="${escHtml(tg)}">${escHtml(tg)}</span>`).join(" ") +
            (hidden.length ? ` <span class="jr-tag-badge" title="${escHtml(hidden.join(", "))}">+${hidden.length}</span>` : "");
          return /* html */ `
            <div class="jr-template-card" data-name="${escHtml(t.name)}" tabindex="0">
              <div class="jr-card-name" title="${nameTitle}">
                ${pinned ? '<span class="jr-pin" aria-label="Pinned" title="Pinned">★</span>' : ""}
                <span class="jr-soft-label"></span> ${escHtml(t.name)}
              </div>
              <div class="jr-card-meta">
                ${tags.length ? tagsHtml : ""}
                ${envHtml ? `<span class="jr-chip" title="Environment">${envHtml}</span>` : ""}
                <span class="jr-card-updated">${updated}</span>
              </div>
              <div class="jr-card-preview" title="${sqlTitle}"><span class="jr-soft-label"></span> ${escHtml(sqlShort)}</div>
              <div class="jr-card-actions">
                <button class="btn btn-sm-xs jr-template-pin" data-name="${escHtml(t.name)}">${pinned ? "Unpin" : "Pin"}</button>
                <button class="btn btn-sm-xs jr-template-run" data-name="${escHtml(t.name)}">Run</button>
                <button class="btn btn-sm-xs jr-template-edit" data-name="${escHtml(t.name)}">View/Edit</button>
                <button class="btn btn-sm-xs jr-template-delete" data-name="${escHtml(t.name)}">Delete</button>
              </div>
            </div>`;
        })
        .join("");
      templateListEl.innerHTML = cards || '<div class="jr-empty">No templates saved yet.</div>';
    };

    baseUrlInput.addEventListener("input", () => {
      statusEl.textContent = "Jenkins URL is managed in Settings.";
      saveLastState({ jenkinsUrl: this.state.jenkinsUrl });
    });

    jobInput.addEventListener("change", () => {
      validateJobName();
      toggleSubmitEnabled();
      saveLastState({ job: jobInput.value.trim() });
      if (allowedJobs.has(jobInput.value.trim())) refreshEnvChoices();
    });

    envSelect.addEventListener("change", () => {
      localStorage.setItem(persistEnvKey, envSelect.value || "");
      saveLastState({ env: envSelect.value });
      toggleSubmitEnabled();
    });

    // Track SQL changes in Monaco
    this._sqlPersistTimer = null;
    this.editor.onDidChangeModelContent(() => {
      clearTimeout(this._sqlPersistTimer);
      this._sqlPersistTimer = setTimeout(() => {
        toggleSubmitEnabled();
        saveLastState({ sql: this.editor.getValue() });
      }, 200);
    });

    // History persistence and rendering
    const persistHistoryKey = "tool:jenkins-runner:history";
    const loadHistory = () => {
      try {
        const raw = localStorage.getItem(persistHistoryKey) || "[]";
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (_) {
        return [];
      }
    };
    const saveHistory = (arr) => {
      try {
        localStorage.setItem(persistHistoryKey, JSON.stringify(arr));
      } catch (_) {}
    };
    const renderHistory = () => {
      const arr = loadHistory();
      const rows = arr
        .map((it, i) => {
          const sqlSummary = (it.sql || "").split("\n")[0];
          const short = sqlSummary.length > 120 ? sqlSummary.slice(0, 117) + "..." : sqlSummary;
          const ts = formatTimestamp(it.timestamp);
          const build = it.buildNumber ? `#${it.buildNumber}` : "";
          const buildLinkHtml = it.buildUrl ? `<a href="${it.buildUrl}" target="_blank" rel="noopener">Open</a>` : "";
          const escTitle = sqlSummary.replace(/"/g, "&quot;");
          return `<tr><td class="jr-timestamp">${ts}</td><td>${
            it.env || ""
          }</td><td title="${escTitle}">${short}</td><td>${build} ${buildLinkHtml}</td><td><button class="btn btn-sm-xs jr-history-load" data-index="${i}">Load</button></td></tr>`;
        })
        .join("");
      if (historyList) historyList.innerHTML = rows || '<tr><td colspan="5">No history yet.</td></tr>';
    };

    // Tab switching
    const switchToRun = () => {
      if (!runTabBtn || !historyTabBtn || !runTab || !historyTab) return;

      runTabBtn.classList.add("active");
      runTabBtn.setAttribute("aria-selected", "true");
      historyTabBtn.classList.remove("active");
      historyTabBtn.setAttribute("aria-selected", "false");
      if (templatesTabBtn) templatesTabBtn.classList.remove("active");
      if (templatesTabBtn) templatesTabBtn.setAttribute("aria-selected", "false");
      runTab.style.display = "grid";
      historyTab.style.display = "none";
      if (templatesTab) templatesTab.style.display = "none";
      hideSqlPreview();
      // Ensure Monaco editor recalculates dimensions when Run tab becomes visible
      try {
        // Use microtask to run after style changes apply
        Promise.resolve().then(() => {
          if (this.editor && typeof this.editor.layout === "function") this.editor.layout();
        });
      } catch (_) {}
    };
    const switchToHistory = () => {
      if (!runTabBtn || !historyTabBtn || !runTab || !historyTab) return;

      runTabBtn.classList.remove("active");
      runTabBtn.setAttribute("aria-selected", "false");
      historyTabBtn.classList.add("active");
      historyTabBtn.setAttribute("aria-selected", "true");
      if (templatesTabBtn) templatesTabBtn.classList.remove("active");
      if (templatesTabBtn) templatesTabBtn.setAttribute("aria-selected", "false");
      runTab.style.display = "none";
      historyTab.style.display = "block";
      if (templatesTab) templatesTab.style.display = "none";
      renderHistory();
    };
    const switchToTemplates = () => {
      if (!runTabBtn || !historyTabBtn || !runTab || !historyTab || !templatesTabBtn || !templatesTab) return;

      runTabBtn.classList.remove("active");
      runTabBtn.setAttribute("aria-selected", "false");
      historyTabBtn.classList.remove("active");
      historyTabBtn.setAttribute("aria-selected", "false");
      templatesTabBtn.classList.add("active");
      templatesTabBtn.setAttribute("aria-selected", "true");
      runTab.style.display = "none";
      historyTab.style.display = "none";
      templatesTab.style.display = "block";
    };
    if (runTabBtn) runTabBtn.addEventListener("click", switchToRun);
    if (historyTabBtn) historyTabBtn.addEventListener("click", switchToHistory);
    if (templatesTabBtn) templatesTabBtn.addEventListener("click", switchToTemplates);

    if (historyList)
      historyList.addEventListener("click", (e) => {
        const t = e.target;
        // Handle clicks on history "Open" links to ensure external opening in Tauri/web
        const link = t && (t.closest ? t.closest("a") : null);
        if (link && link.href) {
          e.preventDefault();
          openExternalUrl(link.href);
          return;
        }

        // Handle loading a past entry back into the Run tab
        if (t && t.classList && t.classList.contains("jr-history-load")) {
          const idx = Number(t.getAttribute("data-index"));

          const arr = loadHistory();
          const it = arr[idx];
          if (!it) return;
          if (it.job && allowedJobs.has(it.job)) {
            jobInput.value = it.job;
          }
          if (it.env && this.state.envChoices.includes(it.env)) {
            envSelect.value = it.env;
          }
          if (this.editor) {
            this.editor.setValue(it.sql || "");
          }
          saveLastState({ job: jobInput.value.trim(), env: envSelect.value, sql: this.editor ? this.editor.getValue() : "" });
          switchToRun();
          toggleSubmitEnabled();
        }
      });

    // Templates: list interactions
    if (templateListEl)
      templateListEl.addEventListener("click", (e) => {
        const t = e.target;
        if (!t || !t.classList) return;
        const name = t.getAttribute("data-name");
        if (!name) return;
        const tpl = findTemplateByName(name);
        if (!tpl) return;
        if (t.classList.contains("jr-template-pin")) {
          // Toggle pinned state and persist
          const arr = loadTemplates();
          const idx = arr.findIndex((x) => (x?.name || "") === tpl.name);
          if (idx >= 0) {
            const prev = arr[idx] || {};
            arr[idx] = { ...prev, pinned: !prev.pinned, updatedAt: prev.updatedAt || prev.createdAt || new Date().toISOString() };
            saveTemplates(arr);
            renderTemplates();
            this.showSuccess(arr[idx].pinned ? "Template pinned." : "Template unpinned.");
          }
          return;
        }
        if (t.classList.contains("jr-template-run")) {
          // Populate Run tab and inject SQL into Monaco editor for editing
          if (tpl.job && allowedJobs.has(tpl.job)) {
            jobInput.value = tpl.job;
          }
          if (tpl.env) {
            // If env exists in current choices, set, else attempt refresh then set
            if (this.state.envChoices.includes(tpl.env)) {
              envSelect.value = tpl.env;
            } else {
              // Attempt to refresh env choices for the selected job, then set
              refreshEnvChoices().then(() => {
                if (this.state.envChoices.includes(tpl.env)) envSelect.value = tpl.env;
              });
            }
          }
          if (this.editor) {
            this.editor.setValue(tpl.sql || "");
            // Place cursor at start and focus editor to allow immediate editing
            try {
              this.editor.setPosition({ lineNumber: 1, column: 1 });
              this.editor.focus();
            } catch (_) {}
          }
          switchToRun();
          // Ensure preview stays hidden; editing occurs in Monaco
          saveLastState({ job: jobInput.value.trim(), env: envSelect.value, sql: this.editor ? this.editor.getValue() : "" });
          toggleSubmitEnabled();
          try {
            UsageTracker.trackFeature("jenkins-runner", "template_run_click", {
              name: tpl.name,
              job: tpl.job,
              env: tpl.env,
              sql_len: (tpl.sql || "").length,
            });
          } catch (_) {}
        } else if (t.classList.contains("jr-template-edit")) {
          // Open modal for editing
          openTemplateModal("edit", tpl);
        } else if (t.classList.contains("jr-template-delete")) {
          const confirmed = window.confirm(`Delete template "${tpl.name}"?`);
          if (!confirmed) return;
          const arr = loadTemplates();
          const idx = arr.findIndex((x) => (x?.name || "") === tpl.name);
          if (idx >= 0) {
            arr.splice(idx, 1);
            saveTemplates(arr);
            renderTemplates();
            this.showSuccess("Template deleted.");
          }
        }
      });

    // Templates: modal handlers
    if (templateModalSaveBtn)
      templateModalSaveBtn.addEventListener("click", () => {
        if (!validateTemplateForm()) return;
        const name = (templateNameInput?.value || "").trim();
        const job = (templateJobSelect?.value || "").trim();
        const env = (templateEnvSelect?.value || "").trim();
        const sql = this.templateEditor ? this.templateEditor.getValue().trim() : "";
        // Validate and normalize tags before saving
        const tags = Array.from(new Set(modalTags.map((x) => normalizeTag(x)).filter(isValidTag)));
        let arr = loadTemplates();
        const now = new Date().toISOString();
        const existingIdx = arr.findIndex((t) => (t?.name || "") === (this.state.editingTemplateName || name));
        if (existingIdx >= 0) {
          const prev = arr[existingIdx];
          arr[existingIdx] = {
            ...prev,
            name,
            job,
            env,
            sql,
            tags,
            version: Number(prev.version || 1) + 1,
            updatedAt: now,
          };
          saveTemplates(arr);
          this.showSuccess("Template updated.");
        } else {
          arr.push({ name, job, env, sql, tags, version: 1, createdAt: now, updatedAt: now, pinned: false });
          saveTemplates(arr);
          this.showSuccess("Template saved.");
        }
        this.state.editingTemplateName = name;
        renderTemplates();
        closeTemplateModal(true);
      });

    if (templateModalCancelBtn) templateModalCancelBtn.addEventListener("click", () => closeTemplateModal(true));
    if (templateModalCloseBtn) templateModalCloseBtn.addEventListener("click", () => closeTemplateModal(true));
    if (templateModalOverlay)
      templateModalOverlay.addEventListener("click", (e) => {
        if (e.target === templateModalOverlay) closeTemplateModal(true);
      });

    if (templateCreateBtn) templateCreateBtn.addEventListener("click", () => openTemplateModal("create", null));

    if (templateSearchInput) templateSearchInput.addEventListener("input", renderTemplates);
    if (templateSortSelect) templateSortSelect.addEventListener("change", renderTemplates);
    if (filterEnvSelect) filterEnvSelect.addEventListener("change", renderTemplates);

    // ===== Tags modal control wiring =====
    const focusTemplateTagsInput = () => templateTagsInput && templateTagsInput.focus();
    if (templateTagsContainer && templateTagsInput && templateTagsSelectedEl && templateTagsSuggestionsEl) {
      let templateTagsActiveIndex = -1;
      const updateSuggestions = debounce(() => {
        const all = collectAllTags();
        const q = normalizeTag(templateTagsInput.value);
        templateTagsContainer.classList.add("jr-loading");
        templateTagsContainer.setAttribute("aria-busy", "true");
        const filtered = all.filter((t) => (!q || t.includes(q)) && !modalTags.includes(t)).slice(0, 50);
        templateTagsActiveIndex = filtered.length ? 0 : -1;
        renderSuggestions(templateTagsContainer, templateTagsSuggestionsEl, filtered, templateTagsActiveIndex);
        templateTagsContainer.classList.remove("jr-loading");
        templateTagsContainer.removeAttribute("aria-busy");
      }, 150);

      const addTag = (raw) => {
        const t = toValidTagOrNull(raw);
        if (!t) {
          if (templateTagsErrorEl) {
            templateTagsErrorEl.style.display = "block";
            templateTagsErrorEl.textContent = "Tags must be 1–24 chars, lowercase letters/digits/dash.";
          }
          return;
        }
        if (!modalTags.includes(t)) {
          modalTags.push(t);
          renderSelectedChips(templateTagsSelectedEl, modalTags, true);
          if (templateTagsErrorEl) templateTagsErrorEl.style.display = "none";
        }
        if (templateTagsInput) templateTagsInput.value = "";
        renderSuggestions(templateTagsContainer, templateTagsSuggestionsEl, []);
        focusTemplateTagsInput();
      };

      templateTagsInput.addEventListener("input", updateSuggestions);
      templateTagsInput.addEventListener("keydown", (e) => {
        if (e.key === "," || e.key === "Enter") {
          e.preventDefault();
          // If suggestion is open and active, pick it; else add raw
          const items = Array.from(templateTagsSuggestionsEl.querySelectorAll(".jr-suggestion"));
          if (items.length && templateTagsActiveIndex >= 0 && templateTagsActiveIndex < items.length) {
            addTag(items[templateTagsActiveIndex].getAttribute("data-value"));
          } else {
            addTag(templateTagsInput.value.replace(/,$/, ""));
          }
        } else if (e.key === "Backspace" && !templateTagsInput.value && modalTags.length) {
          modalTags.pop();
          renderSelectedChips(templateTagsSelectedEl, modalTags, true);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          let items = Array.from(templateTagsSuggestionsEl.querySelectorAll(".jr-suggestion"));
          if (!items.length) {
            // Open suggestions based on current query (empty => all tags)
            const all = collectAllTags();
            const q = normalizeTag(templateTagsInput.value);
            const filtered = all
              .filter((t) => (!q || t.includes(q)) && !modalTags.includes(t))
              .slice(0, 50);
            templateTagsActiveIndex = filtered.length ? 0 : -1;
            renderSuggestions(templateTagsContainer, templateTagsSuggestionsEl, filtered, templateTagsActiveIndex);
          } else {
            templateTagsActiveIndex = Math.min(items.length - 1, templateTagsActiveIndex + 1);
            renderSuggestions(
              templateTagsContainer,
              templateTagsSuggestionsEl,
              items.map((i) => i.getAttribute("data-value")),
              templateTagsActiveIndex
            );
          }
        } else if (e.key === "ArrowUp") {
          const items = Array.from(templateTagsSuggestionsEl.querySelectorAll(".jr-suggestion"));
          if (items.length) {
            e.preventDefault();
            templateTagsActiveIndex = Math.max(0, templateTagsActiveIndex - 1);
            renderSuggestions(
              templateTagsContainer,
              templateTagsSuggestionsEl,
              items.map((i) => i.getAttribute("data-value")),
              templateTagsActiveIndex
            );
          }
        } else if (e.key === "Escape") {
          renderSuggestions(templateTagsContainer, templateTagsSuggestionsEl, []);
        }
      });
      templateTagsSuggestionsEl.addEventListener("click", (e) => {
        const t = e.target.closest(".jr-suggestion");
        if (!t) return;
        const val = t.getAttribute("data-value");
        addTag(val);
      });
      templateTagsSelectedEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.target.closest(".jr-tag-remove");
        if (!btn) return;
        const val = btn.getAttribute("data-tag");
        const idx = modalTags.indexOf(val);
        if (idx >= 0) {
          modalTags.splice(idx, 1);
          renderSelectedChips(templateTagsSelectedEl, modalTags, true);
        }
      });
    }

    // ===== Tags filter control wiring =====
    this.state.filterTagsSelected = [];
    const rerenderAfterFilterChange = () => {
      renderSelectedChips(filterTagsSelectedEl, this.state.filterTagsSelected, true);
      renderTemplates();
    };
    if (filterTagsContainer && filterTagsInput && filterTagsSelectedEl && filterTagsSuggestionsEl) {
      let filterTagsActiveIndex = -1;
      const updateFilterSuggestions = debounce(() => {
        const all = collectAllTags();
        const q = normalizeTag(filterTagsInput.value);
        filterTagsContainer.classList.add("jr-loading");
        filterTagsContainer.setAttribute("aria-busy", "true");
        const filtered = all.filter((t) => (!q || t.includes(q)) && !this.state.filterTagsSelected.includes(t)).slice(0, 100);
        filterTagsActiveIndex = filtered.length ? 0 : -1;
        renderSuggestions(filterTagsContainer, filterTagsSuggestionsEl, filtered, filterTagsActiveIndex);
        filterTagsContainer.classList.remove("jr-loading");
        filterTagsContainer.removeAttribute("aria-busy");
      }, 150);

      const addFilterTag = (raw) => {
        const t = toValidTagOrNull(raw);
        if (!t) return; // silent ignore for filter
        if (!this.state.filterTagsSelected.includes(t)) {
          this.state.filterTagsSelected.push(t);
          rerenderAfterFilterChange();
        }
        filterTagsInput.value = "";
        renderSuggestions(filterTagsContainer, filterTagsSuggestionsEl, []);
        filterTagsInput.focus();
      };
      filterTagsInput.addEventListener("input", updateFilterSuggestions);
      filterTagsInput.addEventListener("keydown", (e) => {
        if (e.key === "," || e.key === "Enter") {
          e.preventDefault();
          const items = Array.from(filterTagsSuggestionsEl.querySelectorAll(".jr-suggestion"));
          if (items.length && filterTagsActiveIndex >= 0 && filterTagsActiveIndex < items.length) {
            addFilterTag(items[filterTagsActiveIndex].getAttribute("data-value"));
          } else {
            addFilterTag(filterTagsInput.value.replace(/,$/, ""));
          }
        } else if (e.key === "Backspace" && !filterTagsInput.value && this.state.filterTagsSelected.length) {
          this.state.filterTagsSelected.pop();
          rerenderAfterFilterChange();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          let items = Array.from(filterTagsSuggestionsEl.querySelectorAll(".jr-suggestion"));
          if (!items.length) {
            // Open suggestions based on current query (empty => all tags)
            const all = collectAllTags();
            const q = normalizeTag(filterTagsInput.value);
            const filtered = all
              .filter((t) => (!q || t.includes(q)) && !this.state.filterTagsSelected.includes(t))
              .slice(0, 100);
            filterTagsActiveIndex = filtered.length ? 0 : -1;
            renderSuggestions(filterTagsContainer, filterTagsSuggestionsEl, filtered, filterTagsActiveIndex);
          } else {
            filterTagsActiveIndex = Math.min(items.length - 1, filterTagsActiveIndex + 1);
            renderSuggestions(
              filterTagsContainer,
              filterTagsSuggestionsEl,
              items.map((i) => i.getAttribute("data-value")),
              filterTagsActiveIndex
            );
          }
        } else if (e.key === "ArrowUp") {
          const items = Array.from(filterTagsSuggestionsEl.querySelectorAll(".jr-suggestion"));
          if (items.length) {
            e.preventDefault();
            filterTagsActiveIndex = Math.max(0, filterTagsActiveIndex - 1);
            renderSuggestions(
              filterTagsContainer,
              filterTagsSuggestionsEl,
              items.map((i) => i.getAttribute("data-value")),
              filterTagsActiveIndex
            );
          }
        } else if (e.key === "Escape") {
          renderSuggestions(filterTagsContainer, filterTagsSuggestionsEl, []);
        }
      });
      filterTagsSuggestionsEl.addEventListener("click", (e) => {
        const t = e.target.closest(".jr-suggestion");
        if (!t) return;
        addFilterTag(t.getAttribute("data-value"));
      });
      filterTagsSelectedEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.target.closest(".jr-tag-remove");
        if (!btn) return;
        const val = btn.getAttribute("data-tag");
        const idx = this.state.filterTagsSelected.indexOf(val);
        if (idx >= 0) {
          this.state.filterTagsSelected.splice(idx, 1);
          rerenderAfterFilterChange();
        }
      });
    }

    // Dismiss suggestions when clicking outside inputs/suggestion containers
    document.addEventListener("click", (e) => {
      const target = e.target;
      // Modal tags suggestions
      if (templateTagsContainer && templateTagsSuggestionsEl) {
        if (!templateTagsContainer.contains(target)) {
          renderSuggestions(templateTagsContainer, templateTagsSuggestionsEl, []);
        }
      }
      // Filter tags suggestions
      if (filterTagsContainer && filterTagsSuggestionsEl) {
        if (!filterTagsContainer.contains(target)) {
          renderSuggestions(filterTagsContainer, filterTagsSuggestionsEl, []);
        }
      }
    });

    if (templateJobSelect)
      templateJobSelect.addEventListener("change", () => {
        if (!allowedJobs.has(templateJobSelect.value.trim())) return;
        refreshTemplateEnvChoices();
      });

    // Initial env load for Templates if URL present
    if (this.state.jenkinsUrl && templateJobSelect && allowedJobs.has(templateJobSelect.value.trim())) {
      refreshTemplateEnvChoices();
    }
    // Initial render of templates list
    renderTemplates();

    // Initial env load if URL and job valid
    if (this.state.jenkinsUrl && jobInput.value.trim().length) {
      if (validateJobName()) refreshEnvChoices();
    }

    runBtn.addEventListener("click", async () => {
      const baseUrl = this.state.jenkinsUrl;
      const job = jobInput.value.trim();
      const env = envSelect.value;
      const sql = this.editor ? this.editor.getValue().trim() : "";
      try {
        UsageTracker.trackFeature("jenkins-runner", "run_click", { job, env, sql_len: sql.length });
      } catch (_) {}

      if (!baseUrl || !job || !env) {
        this.showError("Select Jenkins URL, enter Job, and choose ENV");
        return;
      }
      if (!allowedJobs.has(job)) {
        this.showError("Invalid job name. Allowed: tester-execute-query or tester-execute-query-new.");
        return;
      }

      runBtn.disabled = true;
      try {
        statusEl.textContent = "Triggering job…";
        logsEl.textContent = "";
        buildLink.style.display = "none";
        if (buildNumEl) {
          buildNumEl.style.display = "none";
          buildNumEl.textContent = "";
        }

        // Save last state and append history entry
        saveLastState();
        const newEntry = { timestamp: new Date().toISOString(), job, env, sql, buildNumber: null, buildUrl: null };
        const hist = loadHistory();
        hist.push(newEntry);
        saveHistory(hist);

        const queueUrl = await this.service.triggerJob(baseUrl, job, env, sql);
        this.state.queueUrl = queueUrl;

        statusEl.textContent = "Queued. Polling…";

        let attempts = 0;
        const poll = async () => {
          attempts++;
          try {
            const { buildNumber, executableUrl } = await this.service.pollQueue(baseUrl, queueUrl);
            if (buildNumber) {
              this.state.buildNumber = buildNumber;
              this.state.executableUrl = executableUrl;
              if (buildNumEl) {
                buildNumEl.textContent = String(buildNumber);
                buildNumEl.style.display = "inline-flex";
              }
              if (executableUrl) {
                buildLink.href = executableUrl;
                buildLink.style.display = "inline-block";
              }

              // Update latest history entry with build info
              const arr = loadHistory();
              if (arr.length) {
                const last = arr[arr.length - 1];
                last.buildNumber = buildNumber;
                last.buildUrl = executableUrl || last.buildUrl;
                saveHistory(arr);
              }

              statusEl.textContent = `Build #${buildNumber} started. Streaming logs…`;
              await subscribeToLogs();
              await this.service.streamLogs(baseUrl, job, buildNumber);
              runBtn.disabled = false;
              renderHistory();
              return;
            }
            if (attempts > 30) {
              statusEl.textContent = "Polling timeout";

              runBtn.disabled = false;
              return;
            }
          } catch (err) {
            statusEl.textContent = "Polling error";
            try {
              UsageTracker.trackEvent("jenkins-runner", "run_error", { message: String(err || "") });
            } catch (_) {}
            this.showError(String(err));
            runBtn.disabled = false;
            return;
          }
          setTimeout(poll, 2000);
        };
        poll();
      } catch (err) {
        statusEl.textContent = "Trigger failed";
        try {
          UsageTracker.trackEvent("jenkins-runner", "run_error", { message: String(toFriendlyError(err) || ""), job, env });
        } catch (_) {}
        this.showError(toFriendlyError(err));
        runBtn.disabled = false;
      }
    });
  }

  onUnmount() {
    try {
      if (this._sidebarUnsubs && Array.isArray(this._sidebarUnsubs)) {
        this._sidebarUnsubs.forEach((off) => {
          try {
            typeof off === "function" && off();
          } catch (_) {}
        });
        this._sidebarUnsubs = [];
      }
      if (this._sidebarDomListener) {
        document.removeEventListener("sidebarStateChange", this._sidebarDomListener);
        this._sidebarDomListener = null;
      }
      if (this._resizeListener) {
        window.removeEventListener("resize", this._resizeListener);
        this._resizeListener = null;
      }
      if (this.editor && typeof this.editor.dispose === "function") {
        try {
          this.editor.dispose();
        } catch (_) {}
        this.editor = null;
      }
      if (this.templateEditor && typeof this.templateEditor.dispose === "function") {
        try {
          this.templateEditor.dispose();
        } catch (_) {}
        this.templateEditor = null;
      }
    } catch (_) {}
  }

  onDeactivate() {
    // Cleanup listeners
    try {
      for (const un of this._logUnsubscribes) {
        un();
      }
    } catch (_) {}
    this._logUnsubscribes = [];
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    if (this.templateEditor) {
      this.templateEditor.dispose();
      this.templateEditor = null;
    }
  }
}
