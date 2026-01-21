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
import { ensureUnifiedKeychain } from "../../core/KeychainMigration.js";

export class JenkinsRunner extends BaseTool {
  constructor(eventBus) {
    super({
      id: "run-query",
      name: "Jenkins Query Runner",
      description: "Run Oracle SQL Query via Jenkins job and stream the build logs",
      icon: "jenkins-query",
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
    this._beforeUnloadHandler = null;
  }

  /**
   * Centralized cleanup for split execution resources.
   * Called when split execution ends (success, error, cancel, timeout).
   * Does NOT interrupt active execution - only cleans up after it ends.
   *
   * @param {Object} options - Cleanup options
   * @param {boolean} options.hideIndicator - If true, also hide the global split indicator.
   *                                          Default false to preserve completed state visibility.
   */
  _cleanupSplitResources({ hideIndicator = false } = {}) {
    // Clear log listeners
    try {
      for (const un of this._logUnsubscribes) {
        if (typeof un === "function") un();
      }
    } catch (_) {}
    this._logUnsubscribes = [];

    // Remove beforeunload handler
    if (this._beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }

    // Only hide global indicator if explicitly requested (e.g., on unmount or orphan cleanup)
    // Do NOT hide after completion - user should see "✓ Complete" until they dismiss
    if (hideIndicator) {
      const globalEl = document.getElementById("jr-global-split-indicator");
      if (globalEl) {
        globalEl.style.display = "none";
      }
    }
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return JenkinsRunnerTemplate;
  }

  /**
   * One-time migration: read Jenkins username from macOS Keychain and store to localStorage.
   * After migration, the username is read from localStorage, token stays in keychain.
   */
  async #migrateJenkinsUsername() {
    console.log("[RunQuery] Checking Jenkins username migration...");

    // Skip if already migrated (username exists in localStorage)
    const existingUsername = localStorage.getItem("config.jenkins.username");
    if (existingUsername) {
      console.log("[RunQuery] Migration skipped: username already in localStorage");
      return;
    }

    // Skip if not running in Tauri
    if (!isTauri()) {
      console.log("[RunQuery] Migration skipped: not running in Tauri");
      return;
    }

    try {
      // Read username from keychain via Tauri command
      console.log("[RunQuery] Attempting to read username from keychain...");
      const keychainUsername = await invoke("get_jenkins_username");
      if (keychainUsername && typeof keychainUsername === "string" && keychainUsername.trim()) {
        // Store to localStorage
        localStorage.setItem("config.jenkins.username", keychainUsername.trim());
        console.log("[RunQuery] Migrated Jenkins username from keychain to localStorage");
      } else {
        console.log("[RunQuery] No username found in keychain");
      }
    } catch (err) {
      // Silent fail - user may not have any credentials yet
      console.debug("[RunQuery] No Jenkins username in keychain to migrate:", err);
    }
  }

  // Receive route data passed by App.showTool and inject into editor
  onRouteData(data) {
    try {
      const sql = (data && (data.sql || data.query)) || "";
      if (!sql) return;
      // Mark source as quick-query when receiving SQL via route
      this._querySource = "quick-query";
      // If editor is ready, set immediately; otherwise stash for onMount
      if (this.editor && typeof this.editor.setValue === "function") {
        this.editor.setValue(sql);
      } else {
        this._pendingSql = sql;
      }
    } catch (err) {
      console.error("Failed to apply route data to Jenkins Runner:", err);
    }
  }

  async onMount() {
    // Clean up any orphaned global split indicator from previous sessions
    // (only if no split execution is currently in progress)
    if (!this.state?.split?.started || this.state?.split?.completed) {
      const orphanedIndicator = document.getElementById("jr-global-split-indicator");
      if (orphanedIndicator && orphanedIndicator.parentNode) {
        orphanedIndicator.parentNode.removeChild(orphanedIndicator);
      }
    }

    // Migrate Jenkins username from keychain to localStorage (one-time)
    await this.#migrateJenkinsUsername();

    // Migrate to unified keychain (reduces password prompts after app updates)
    await ensureUnifiedKeychain();

    const baseUrlInput = this.container.querySelector("#jenkins-baseurl");
    const jobInput = this.container.querySelector("#jenkins-job");
    const envSelect = this.container.querySelector("#jenkins-env");
    const sqlEditorContainer = this.container.querySelector("#jenkins-sql-editor");
    const sqlPreviewEl = this.container.querySelector("#jenkins-sql-preview");
    const runBtn = this.container.querySelector("#jenkins-run");
    const statusEl = this.container.querySelector('[data-role="status"]');
    const logsEl = this.container.querySelector("#jenkins-logs");
    const buildLink = this.container.querySelector("#jenkins-build-link");
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
    // Confirm modal elements
    const confirmModal = this.container.querySelector("#jr-confirm-modal");
    const confirmMsgEl = this.container.querySelector("#jr-confirm-message");
    const confirmDeleteBtn = this.container.querySelector("#jr-confirm-delete-btn");
    const confirmCancelBtn = this.container.querySelector("#jr-confirm-cancel-btn");
    const confirmCloseBtn = this.container.querySelector("#jr-confirm-close");
    // Split modal elements
    const splitModal = this.container.querySelector("#jr-split-modal");
    const splitModalOverlay = this.container.querySelector("#jr-split-modal-overlay");
    const splitModalCloseBtn = this.container.querySelector("#jr-split-modal-close");
    const splitMinimizeBtn = this.container.querySelector("#jr-split-minimize");
    const splitMinimizedEl = this.container.querySelector("#jr-split-minimized");
    const splitMinimizedText = this.container.querySelector("#jr-split-minimized-text");
    const splitMaximizeBtn = this.container.querySelector("#jr-split-maximize");
    const splitCancelBtn = this.container.querySelector("#jr-split-cancel");
    const splitExecuteAllBtn = this.container.querySelector("#jr-split-execute-all");
    const splitChunksList = this.container.querySelector("#jr-split-chunks-list");
    const splitChunkLabel = this.container.querySelector("#jr-split-chunk-label");
    const splitProgressEl = this.container.querySelector("#jr-split-progress");
    const splitResultsEl = this.container.querySelector("#jr-split-results");
    const splitMiniLogsEl = this.container.querySelector("#jr-split-mini-log");
    const splitPrevBtn = this.container.querySelector("#jr-split-prev");
    const splitNextBtn = this.container.querySelector("#jr-split-next");
    const splitEditorContainer = this.container.querySelector("#jr-split-editor");
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
    const errorMapping = (e) => {
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

    // Validate that the SQL ends statements with semicolons (outside quotes/comments)
    // Returns { ok: true } or { ok: false, line: number, message: string }
    const validateSemicolons = (sql) => {
      const src = String(sql || "").replace(/\r\n/g, "\n");
      let inSingle = false;
      let inDouble = false;
      let inLineComment = false;
      let inBlockComment = false;
      let line = 1;
      let hadContentSinceSemicolon = false;
      let lastContentLine = 1;
      for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        const next = i + 1 < src.length ? src[i + 1] : "";
        // Track newlines early
        if (ch === "\n") line++;
        // Handle existing comment modes
        if (inLineComment) {
          if (ch === "\n") inLineComment = false;
          continue;
        }
        if (inBlockComment) {
          if (ch === "*" && next === "/") {
            inBlockComment = false;
            i++; // skip '/'
          }
          continue;
        }
        // Start comments if not in quotes
        if (!inSingle && !inDouble) {
          if (ch === "-" && next === "-") {
            inLineComment = true;
            i++; // skip second '-'
            continue;
          }
          if (ch === "/" && next === "*") {
            inBlockComment = true;
            i++; // skip '*'
            continue;
          }
        }
        // Toggle quotes (Oracle uses '' to escape, not \')
        if (!inDouble && ch === "'") {
          if (inSingle && next === "'") {
            i++; // skip escaped quote ''
          } else {
            inSingle = !inSingle;
          }
          continue;
        }
        if (!inSingle && ch === '"') {
          if (inDouble && next === '"') {
            i++; // skip escaped quote ""
          } else {
            inDouble = !inDouble;
          }
          continue;
        }
        // Only evaluate statement/content outside quotes/comments
        if (!inSingle && !inDouble) {
          if (ch === ";") {
            hadContentSinceSemicolon = false;
            continue;
          }
          if (!/\s/.test(ch)) {
            hadContentSinceSemicolon = true;
            lastContentLine = line;
          }
        }
      }
      if (hadContentSinceSemicolon) {
        return { ok: false, line: lastContentLine, message: `Missing semicolon at end of statement (line ${lastContentLine}).` };
      }
      return { ok: true };
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
      // Mirror logs to split modal mini log when active (use fresh DOM lookup)
      try {
        if (this.state && this.state.split && this.state.split.started) {
          const miniLog = document.getElementById("jr-split-mini-log");
          if (miniLog) {
            miniLog.textContent += safe;
            miniLog.scrollTop = miniLog.scrollHeight;
          }
        }
      } catch (_) {}
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
          // Detect oversize error surfaced by Jenkins job
          try {
            const s = String(chunk || "").toLowerCase();
            if (s.includes("argument list too long")) {
              this.state.lastRunArgListTooLong = true;
              statusEl.textContent = "Query too long. Detected 'Argument list too long'.";
            }
          } catch (_) {}
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
            UsageTracker.trackEvent("run-query", "run_success", { buildNumber: this.state.buildNumber || null });
          } catch (_) {}
        })
      );
    };

    const allowedJobs = new Set(["tester-execute-query", "tester-execute-query-new"]);
    const DEFAULT_JOB = "tester-execute-query-new";
    const hasToken = await this.service.hasToken();

    // Load Jenkins URL
    this.state.jenkinsUrl = this.service.loadJenkinsUrl();
    if (baseUrlInput) {
      baseUrlInput.value = this.state.jenkinsUrl || "";
    }
    if (!this.state.jenkinsUrl) {
      statusEl.textContent = "Configure Jenkins URL in Settings first.";
    } else if (!hasToken) {
      statusEl.textContent = "No Jenkins token found. Add it in Settings → Credential Management.";
    }

    const persistEnvKey = "tool:run-query:env";
    const savedEnv = localStorage.getItem(persistEnvKey) || "";

    // Persist last UI state (URL, job, env, SQL)
    const persistStateKey = "tool:run-query:lastState";
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

    // Apply any pending SQL routed from Quick Query or session storage
    try {
      const injected = this._pendingSql || null;
      if (injected && this.editor && typeof this.editor.setValue === "function") {
        this.editor.setValue(injected);
        this._pendingSql = null;
      } else {
        const sess = sessionStorage.getItem("jenkinsRunner.injectSql") || "";
        if (sess && this.editor && typeof this.editor.setValue === "function") {
          this.editor.setValue(sess);
          sessionStorage.removeItem("jenkinsRunner.injectSql");
        }
      }
    } catch (_) {}

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

    const toggleSubmitEnabled = () => {
      const hasEnv = !!envSelect.value;
      const hasUrl = !!this.state.jenkinsUrl;
      const hasSql = !!(this.editor && this.editor.getValue().trim().length >= 5);
      runBtn.disabled = !(hasEnv && hasUrl && hasSql);
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
        envErrorEl.textContent = errorMapping(err);
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
    const persistTemplatesKey = "tool:run-query:templates";
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
      if (templateEnvSelect) templateEnvSelect.innerHTML = "";
      if (this.templateEditor) this.templateEditor.setValue("");
      if (templateNameErrorEl) templateNameErrorEl.style.display = "none";
      if (templateEnvErrorEl) templateEnvErrorEl.style.display = "none";
      this.state.editingTemplateName = null;
    };

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    let focusTrapHandler = null;
    const activateFocusTrap = (container, onEscape) => {
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
          if (typeof onEscape === "function") onEscape();
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
      activateFocusTrap(templateModal, () => closeTemplateModal(true));
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

    // Confirm modal state/handlers
    let _confirmHandler = null;
    const openConfirmModal = (message, onConfirm) => {
      if (!confirmModal || !templateModalOverlay) return;
      this._modalPrevFocusEl = document.activeElement;
      if (confirmMsgEl) confirmMsgEl.textContent = String(message || "Are you sure?");
      templateModalOverlay.style.display = "block";
      confirmModal.style.display = "flex";
      _confirmHandler = typeof onConfirm === "function" ? onConfirm : null;
      activateFocusTrap(confirmModal, () => closeConfirmModal());
    };
    const closeConfirmModal = () => {
      if (!confirmModal || !templateModalOverlay) return;
      confirmModal.style.display = "none";
      templateModalOverlay.style.display = "none";
      deactivateFocusTrap(confirmModal);
      _confirmHandler = null;
      // Revert labels if they were customized for Split warning
      const titleEl = this.container.querySelector("#jr-confirm-modal-title");
      if (titleEl && titleEl.textContent === "Large Query Detected") {
        titleEl.textContent = "Confirm Deletion";
      }
      if (confirmDeleteBtn && confirmDeleteBtn.textContent === "Confirm Split") {
        confirmDeleteBtn.textContent = "Delete";
        confirmDeleteBtn.className = "btn btn-danger btn-sm-xs";
      }
      if (this._modalPrevFocusEl && typeof this._modalPrevFocusEl.focus === "function") this._modalPrevFocusEl.focus();
    };

    if (confirmDeleteBtn)
      confirmDeleteBtn.addEventListener("click", () => {
        const fn = _confirmHandler;
        closeConfirmModal();
        if (typeof fn === "function") fn();
      });
    if (confirmCancelBtn) confirmCancelBtn.addEventListener("click", () => closeConfirmModal());
    if (confirmCloseBtn) confirmCloseBtn.addEventListener("click", () => closeConfirmModal());

    // ===== Split size warning (uses confirm modal) =====
    const openSplitSizeWarning = (onConfirm) => {
      const titleEl = this.container.querySelector("#jr-confirm-modal-title");
      if (titleEl) titleEl.textContent = "Large Query Detected";
      if (confirmDeleteBtn) {
        confirmDeleteBtn.textContent = "Confirm Split";
        confirmDeleteBtn.className = "btn btn-primary btn-sm-xs";
      }
      if (confirmCancelBtn) confirmCancelBtn.textContent = "Cancel";
      openConfirmModal("Your query size is larger than Jenkins threshold (90 KB), split query into chunks?", () => {
        closeConfirmModal();
        if (typeof onConfirm === "function") onConfirm();
      });
    };

    // ===== Split modal state & helpers =====
    this.splitEditor = null;
    // Preserve split state if execution is running OR completed (navigated away and back)
    const shouldPreserveState = this.state.split?.started || this.state.split?.completed;
    // Track if we need to restore modal after mount
    const shouldRestoreModal = shouldPreserveState && this.state.split?.minimized;
    if (!shouldPreserveState) {
      this.state.split = {
        chunks: [],
        sizes: [],
        index: 0,
        statuses: [],
        started: false,
        cancelRequested: false,
        minimized: false,
        completed: false,
      };
    }

    const bytesToKB = (n) => `${Math.round((Number(n || 0) / 1024) * 10) / 10} KB`;

    const renderSplitChunksList = () => {
      if (!splitChunksList) return;
      splitChunksList.innerHTML = "";
      const { chunks, sizes, index, statuses } = this.state.split;
      chunks.forEach((chunk, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "button");
        li.setAttribute("tabindex", "0");
        li.className = i === index ? "active" : "";
        const name = document.createElement("span");
        name.textContent = `Chunk ${i + 1}`;
        const size = document.createElement("span");
        size.className = "jr-chunk-size";
        size.textContent = bytesToKB(sizes[i] || calcUtf8Bytes(chunk));
        if (statuses[i]) {
          const st = document.createElement("span");
          st.className = "jr-chunk-size";
          st.textContent = ` · ${statuses[i]}`;
          size.appendChild(st);
        }
        li.appendChild(name);
        li.appendChild(size);
        li.addEventListener("click", () => {
          this.state.split.index = i;
          updateSplitCurrentView();
        });
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.state.split.index = i;
            updateSplitCurrentView();
          }
        });
        splitChunksList.appendChild(li);
      });
      // Also update the minimized indicator if visible
      if (this.state.split.minimized) {
        updateMinimizedText();
      }
    };

    const updateSplitCurrentView = () => {
      const { chunks, index } = this.state.split;
      if (splitChunkLabel) splitChunkLabel.textContent = `Chunk ${index + 1} of ${chunks.length}`;
      if (this.splitEditor && chunks[index] != null) {
        this.splitEditor.setValue(chunks[index]);
        try {
          this.splitEditor.layout();
        } catch (_) {}
      }
      renderSplitChunksList();
    };

    const openSplitModal = (chunks) => {
      if (!splitModal || !splitModalOverlay) return;
      this.state.split.chunks = chunks.slice();
      this.state.split.sizes = chunks.map((c) => calcUtf8Bytes(c));
      this.state.split.index = 0;
      this.state.split.statuses = new Array(chunks.length).fill("");
      this.state.split.started = false;
      this.state.split.cancelRequested = false;
      this.state.split.minimized = false;
      this.state.split.completed = false;
      // Hide minimized indicator if visible
      if (splitMinimizedEl) splitMinimizedEl.style.display = "none";
      // Reset cancel button text
      if (splitCancelBtn) splitCancelBtn.textContent = "Cancel";
      this._modalPrevFocusEl = document.activeElement;
      splitModalOverlay.style.display = "block";
      splitModal.style.display = "flex";
      activateFocusTrap(splitModal, () => closeSplitModal());
      if (splitEditorContainer && !this.splitEditor) {
        this.splitEditor = createOracleEditor(splitEditorContainer, {
          value: chunks[0] || "",
          automaticLayout: true,
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          fontSize: 11,
          tabSize: 2,
          insertSpaces: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
        });
      }
      if (splitMiniLogsEl) {
        splitMiniLogsEl.textContent = "";
      }
      // Reset Execute All button for new split session
      if (splitExecuteAllBtn) {
        splitExecuteAllBtn.textContent = "Execute All";
        splitExecuteAllBtn.disabled = false;
      }
      updateSplitCurrentView();
    };

    const closeSplitModal = () => {
      if (!splitModal || !splitModalOverlay) return;
      splitModalOverlay.style.display = "none";
      splitModal.style.display = "none";
      this.state.split.minimized = false;
      if (splitMinimizedEl) splitMinimizedEl.style.display = "none";
      // Hide global indicator too
      if (this._globalSplitIndicator) this._globalSplitIndicator.style.display = "none";
      deactivateFocusTrap(splitModal);
      if (this._modalPrevFocusEl && typeof this._modalPrevFocusEl.focus === "function") this._modalPrevFocusEl.focus();
    };

    // Create or get global minimized indicator that persists across navigation
    const getOrCreateGlobalIndicator = () => {
      let el = document.getElementById("jr-global-split-indicator");
      if (!el) {
        el = document.createElement("div");
        el.id = "jr-global-split-indicator";
        el.className = "jr-split-minimized";
        el.setAttribute("role", "status");
        el.innerHTML = `
          <div class="jr-split-minimized-content" style="cursor:pointer;">
            <span class="jr-split-minimized-icon">⏳</span>
            <span class="jr-global-split-text">Running...</span>
          </div>
          <button class="btn btn-sm-xs">Show</button>
        `;
        el.style.display = "none";
        document.body.appendChild(el);
      }
      return el;
    };

    // Minimize split modal to floating indicator
    const minimizeSplitModal = () => {
      if (!splitModal || !splitModalOverlay) return;
      this.state.split.minimized = true;
      splitModalOverlay.style.display = "none";
      splitModal.style.display = "none";
      deactivateFocusTrap(splitModal);
      // Show global indicator
      const globalEl = getOrCreateGlobalIndicator();
      globalEl.style.display = "flex";
      globalEl.classList.remove("completed");
      this._globalSplitIndicator = globalEl;
      // Bind click to restore
      const self = this;
      globalEl.onclick = () => {
        // Navigate using hash (same as Router.navigate)
        window.location.hash = "run-query";
        // Wait for navigation and DOM to be ready, then restore modal
        setTimeout(() => {
          self.state.split.minimized = false;
          if (self._globalSplitIndicator) self._globalSplitIndicator.style.display = "none";
          // Get fresh DOM references after navigation
          const modal = document.getElementById("jr-split-modal");
          const overlay = document.getElementById("jr-split-modal-overlay");
          const editorContainer = document.getElementById("jr-split-editor");
          const chunksList = document.getElementById("jr-split-chunks-list");
          const chunkLabel = document.getElementById("jr-split-chunk-label");
          if (modal && overlay) {
            overlay.style.display = "block";
            modal.style.display = "flex";

            // Recreate editor if needed
            const { chunks, index, statuses } = self.state.split;
            if (!self.splitEditor && editorContainer && chunks.length > 0) {
              self.splitEditor = createOracleEditor(editorContainer, {
                value: chunks[index] || "",
                automaticLayout: true,
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                fontSize: 11,
              });
            } else if (self.splitEditor && chunks[index]) {
              self.splitEditor.setValue(chunks[index]);
            }

            // Helper to update view when clicking a chunk
            const updateChunkView = (newIndex) => {
              self.state.split.index = newIndex;
              if (chunkLabel) chunkLabel.textContent = `Chunk ${newIndex + 1} of ${chunks.length}`;
              if (self.splitEditor && chunks[newIndex]) {
                self.splitEditor.setValue(chunks[newIndex]);
              }
              // Update active states
              chunksList?.querySelectorAll("li").forEach((li, i) => {
                li.className = i === newIndex ? "active" : "";
              });
            };

            // Re-render chunks list with click handlers
            if (chunksList) {
              chunksList.innerHTML = "";
              chunks.forEach((chunk, i) => {
                const li = document.createElement("li");
                li.setAttribute("role", "button");
                li.setAttribute("tabindex", "0");
                li.className = i === index ? "active" : "";
                const name = document.createElement("span");
                name.textContent = `Chunk ${i + 1}`;
                const size = document.createElement("span");
                size.className = "jr-chunk-size";
                size.textContent = statuses[i] ? ` · ${statuses[i]}` : "";
                li.appendChild(name);
                li.appendChild(size);
                // Add click handler
                li.addEventListener("click", () => updateChunkView(i));
                li.addEventListener("keydown", (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    updateChunkView(i);
                  }
                });
                chunksList.appendChild(li);
              });
            }
            if (chunkLabel) chunkLabel.textContent = `Chunk ${index + 1} of ${chunks.length}`;

            // Restore button states based on execution state
            const execBtn = document.getElementById("jr-split-execute-all");
            const cancelBtn = document.getElementById("jr-split-cancel");
            const { started, completed } = self.state.split;
            if (execBtn) {
              if (completed) {
                execBtn.textContent = "✓ Execution Complete";
                execBtn.disabled = true;
              } else if (started) {
                execBtn.disabled = true;
              }
            }
            if (cancelBtn && completed) {
              cancelBtn.textContent = "Dismiss";
            }
          }
        }, 200);
      };
      updateMinimizedText();
    };

    // Restore full split modal from minimized state
    const maximizeSplitModal = () => {
      if (!splitModal || !splitModalOverlay) return;
      this.state.split.minimized = false;
      if (splitMinimizedEl) splitMinimizedEl.style.display = "none";
      if (this._globalSplitIndicator) this._globalSplitIndicator.style.display = "none";
      splitModalOverlay.style.display = "block";
      splitModal.style.display = "flex";
      activateFocusTrap(splitModal, () => closeSplitModal());

      // Recreate split editor if it was disposed (happens when navigating away)
      const { chunks, index } = this.state.split;
      if (!this.splitEditor && splitEditorContainer && chunks.length > 0) {
        this.splitEditor = createOracleEditor(splitEditorContainer, {
          value: chunks[index] || "",
          automaticLayout: true,
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          fontSize: 11,
          tabSize: 2,
          insertSpaces: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
        });
      }

      // Re-render chunks list and current view
      renderSplitChunksList();
      updateSplitCurrentView();

      // Restore button states based on execution state
      const { started, completed } = this.state.split;
      if (splitExecuteAllBtn) {
        if (completed) {
          splitExecuteAllBtn.textContent = "✓ Execution Complete";
          splitExecuteAllBtn.disabled = true;
        } else if (started) {
          splitExecuteAllBtn.disabled = true;
        }
      }
      if (splitCancelBtn && completed) {
        splitCancelBtn.textContent = "Dismiss";
      }

      if (this.splitEditor) {
        try {
          this.splitEditor.layout();
        } catch (_) {}
      }
    };

    // Update the minimized indicator text (both local and global)
    const updateMinimizedText = () => {
      if (!this.state.split) return;
      const { chunks, statuses, started } = this.state.split;
      const total = chunks.length;
      const doneCount = statuses.filter((s) => s === "success" || s === "failed" || s === "error" || s === "timeout").length;
      let text = "";
      let done = false;
      if (!started) {
        text = `${total} chunks ready`;
      } else if (doneCount >= total) {
        const ok = statuses.filter((s) => s === "success").length;
        text = `✓ Complete: ${ok}/${total}`;
        done = true;
      } else {
        text = `Running Query Chunk: ${doneCount + 1}/${total}...`;
      }
      // Update local
      if (splitMinimizedText) splitMinimizedText.textContent = text;
      if (splitMinimizedEl) {
        if (done) splitMinimizedEl.classList.add("completed");
        else splitMinimizedEl.classList.remove("completed");
      }
      // Update global
      if (this._globalSplitIndicator) {
        const gtxt = this._globalSplitIndicator.querySelector(".jr-global-split-text");
        if (gtxt) gtxt.textContent = text;
        if (done) this._globalSplitIndicator.classList.add("completed");
        else this._globalSplitIndicator.classList.remove("completed");
      }
    };

    const refreshTemplateEnvChoices = async (retry = 0) => {
      if (!templateEnvSelect) return;
      const baseUrl = this.state.jenkinsUrl;
      const job = DEFAULT_JOB;
      if (!baseUrl) {
        if (templateHintEl) templateHintEl.textContent = "Configure Jenkins URL in Settings first.";
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
          templateEnvErrorEl.textContent = errorMapping(err);
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
          const sqlTitle = escHtml(sqlRaw.replace(/\s+/g, " ").trim());
          const sqlSnippet = (() => {
            const trimmed = sqlRaw.trim().replace(/\r\n/g, "\n");
            const lines = trimmed.split("\n");
            const maxLines = 3;
            let out = lines.slice(0, maxLines).join("\n");
            if (lines.length > maxLines) out += " ..."; // explicit triple-dot ellipsis when truncated by line count
            return out;
          })();
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
              <div class="jr-card-preview" title="${sqlTitle}"><span class="jr-soft-label"></span><pre class="jr-card-snippet">${escHtml(
            sqlSnippet
          )}</pre></div>
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

    if (baseUrlInput) {
      baseUrlInput.addEventListener("input", () => {
        statusEl.textContent = "Jenkins URL is managed in Settings.";
        saveLastState({ jenkinsUrl: this.state.jenkinsUrl });
      });
    }

    jobInput.addEventListener("change", () => {
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
    const persistHistoryKey = "tool:run-query:history";
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
      // Helper: build preview from SQL per rules
      const makePreview = (sqlRaw) => {
        try {
          let s = String(sqlRaw || "");
          // Remove SET DEFINE OFF; (case-insensitive, leading spaces allowed)
          s = s.replace(/^\s*SET\s+DEFINE\s+OFF;?\s*$/gim, "");
          // Replace empty lines with a single space, collapse to one line
          const lines = s.split(/\r?\n/);
          const joined = lines
            .map((ln) => {
              const t = ln.trim();
              return t.length === 0 ? " " : t;
            })
            .join(" ");
          const oneLine = joined.replace(/\s+/g, " ").trim();
          const maxHistoryPreviewChars = 70;
          return oneLine.length > maxHistoryPreviewChars ? oneLine.slice(0, maxHistoryPreviewChars - 3) + "..." : oneLine;
        } catch (_) {
          return "";
        }
      };
      // Sort by time DESC while preserving original indices for actions
      const sorted = arr
        .map((it, i) => ({ it, i }))
        .sort((a, b) => {
          const ta = new Date(a.it.timestamp || 0).getTime();
          const tb = new Date(b.it.timestamp || 0).getTime();
          return tb - ta;
        });
      const rows = sorted
        .map(({ it, i }) => {
          const preview = makePreview(it.sql || "");
          const ts = formatTimestamp(it.timestamp);
          const build = it.buildNumber ? `#${it.buildNumber}` : "";
          const buildLinkHtml = it.buildUrl ? `<a href="${it.buildUrl}" target="_blank" rel="noopener">Open</a>` : "";
          const escTitle = preview.replace(/"/g, "&quot;");
          return `<tr><td class="jr-timestamp">${ts}</td><td>${
            it.env || ""
          }</td><td title="${escTitle}">${preview}</td><td>${build} ${buildLinkHtml}</td><td>
            <div class="jr-col-center">
              <button class="btn btn-sm-xs jr-history-load" data-index="${i}">Load</button>
              <button class="btn btn-sm-xs jr-history-save-template" data-index="${i}">Save as Template</button>
            </div>
          </td></tr>`;
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

        // Handle saving a past entry as a template
        if (t && t.classList && t.classList.contains("jr-history-save-template")) {
          const idx = Number(t.getAttribute("data-index"));

          const arr = loadHistory();
          const it = arr[idx];
          if (!it) return;

          // Switch to Templates tab and open create modal
          switchToTemplates();
          openTemplateModal("create");

          // Inject the query into the modal's Monaco editor
          if (this.templateEditor) {
            try {
              this.templateEditor.setValue(it.sql || "");
            } catch (_) {}
          }

          // Derive template name from first "INTO schema.table" occurrence
          try {
            const sql = String(it.sql || "");
            const match = sql.match(/\bINTO\s+([a-z0-9_]+\.[a-z0-9_]+)\b/i);
            const derivedName = match ? match[1] : "";
            if (templateNameInput && derivedName) {
              templateNameInput.value = derivedName;
              if (templateNameErrorEl) templateNameErrorEl.style.display = "none";
            }
          } catch (_) {}

          // Bring ENV from History into the Template modal (after choices refresh)
          try {
            const targetEnv = it.env || "";
            refreshTemplateEnvChoices().then(() => {
              if (templateEnvSelect && targetEnv) {
                templateEnvSelect.value = targetEnv;
              }
            });
          } catch (_) {}

          // Track usage of Save as Template action
          try {
            UsageTracker.track("jenkins_runner.history.save_as_template");
          } catch (_) {}
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
          // Mark source as template for tracking
          this._querySource = "template";
          switchToRun();
          // Ensure preview stays hidden; editing occurs in Monaco
          saveLastState({ job: jobInput.value.trim(), env: envSelect.value, sql: this.editor ? this.editor.getValue() : "" });
          toggleSubmitEnabled();
          try {
            UsageTracker.trackFeature("run-query", "template_run_click", {
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
          // Open custom confirmation modal before deleting
          openConfirmModal(`Delete template "${tpl.name}"? This action cannot be undone.`, () => {
            const arr = loadTemplates();
            const idx = arr.findIndex((x) => (x?.name || "") === tpl.name);
            if (idx >= 0) {
              arr.splice(idx, 1);
              saveTemplates(arr);
              renderTemplates();
              this.showSuccess("Template deleted.");
            }
          });
        }
      });

    // Templates: modal handlers
    if (templateModalSaveBtn)
      templateModalSaveBtn.addEventListener("click", () => {
        if (!validateTemplateForm()) return;
        const name = (templateNameInput?.value || "").trim();
        const env = (templateEnvSelect?.value || "").trim();
        const sql = this.templateEditor ? this.templateEditor.getValue().trim() : "";
        // Validate and normalize tags before saving
        const tags = Array.from(new Set(modalTags.map((x) => normalizeTag(x)).filter(isValidTag)));
        let arr = loadTemplates();
        const now = new Date().toISOString();
        const existingIdx = arr.findIndex((t) => (t?.name || "") === (this.state.editingTemplateName || name));
        if (existingIdx >= 0) {
          const prev = arr[existingIdx];
          const job = prev?.job || DEFAULT_JOB; // preserve existing job if present
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
          const job = DEFAULT_JOB;
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

    // ===== Split modal controls =====
    if (splitModalCloseBtn) splitModalCloseBtn.addEventListener("click", () => closeSplitModal());
    if (splitMinimizeBtn) splitMinimizeBtn.addEventListener("click", () => minimizeSplitModal());
    if (splitMaximizeBtn) splitMaximizeBtn.addEventListener("click", () => maximizeSplitModal());
    // Also make the minimized indicator content clickable to maximize
    if (splitMinimizedEl) {
      splitMinimizedEl.querySelector(".jr-split-minimized-content")?.addEventListener("click", () => maximizeSplitModal());
    }
    // Auto-restore modal if returning from navigation while minimized
    if (shouldRestoreModal) {
      setTimeout(() => {
        maximizeSplitModal();
        // Hide global indicator since we're restoring the modal
        if (this._globalSplitIndicator) this._globalSplitIndicator.style.display = "none";
      }, 100);
    }
    if (splitCancelBtn)
      splitCancelBtn.addEventListener("click", () => {
        // If execution hasn't started or is already complete, just close the modal
        if (!this.state.split.started || this.state.split.completed) {
          closeSplitModal();
          return;
        }

        // Show confirmation when execution is in progress
        const titleEl = this.container.querySelector("#jr-confirm-modal-title");
        if (titleEl) titleEl.textContent = "Cancel Execution?";
        if (confirmDeleteBtn) {
          confirmDeleteBtn.textContent = "Confirm Cancel";
          confirmDeleteBtn.className = "btn btn-primary btn-sm-xs";
        }
        if (confirmCancelBtn) confirmCancelBtn.textContent = "Continue Execution";

        openConfirmModal(
          "This will stop queuing remaining chunks. The currently running chunk on Jenkins cannot be stopped and will complete.",
          () => {
            this.state.split.cancelRequested = true;
            closeConfirmModal();
            closeSplitModal();
          }
        );
      });
    if (splitModalOverlay)
      splitModalOverlay.addEventListener("click", (e) => {
        if (e.target === splitModalOverlay) closeSplitModal();
      });
    if (splitPrevBtn)
      splitPrevBtn.addEventListener("click", () => {
        const { index } = this.state.split;
        if (index > 0) {
          this.state.split.index = index - 1;
          updateSplitCurrentView();
        }
      });
    if (splitNextBtn)
      splitNextBtn.addEventListener("click", () => {
        const { index, chunks } = this.state.split;
        if (index < chunks.length - 1) {
          this.state.split.index = index + 1;
          updateSplitCurrentView();
        }
      });

    // ===== Tags modal control wiring =====
    const focusTemplateTagsInput = () => templateTagsInput && templateTagsInput.focus();
    if (templateTagsContainer && templateTagsInput && templateTagsSelectedEl && templateTagsSuggestionsEl) {
      let templateTagsActiveIndex = -1;
      // Focus the input when clicking anywhere in the container except on controls
      templateTagsContainer.addEventListener("mousedown", (e) => {
        const isControl = e.target.closest(".jr-tag-remove, .jr-suggestion, input");
        if (!isControl) {
          e.preventDefault();
          templateTagsInput?.focus();
        }
      });
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
            const filtered = all.filter((t) => (!q || t.includes(q)) && !modalTags.includes(t)).slice(0, 50);
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
      // Use mousedown to avoid losing the event due to focus/blur order
      templateTagsSuggestionsEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
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
      // Focus behavior for filter container
      filterTagsContainer.addEventListener("mousedown", (e) => {
        const isControl = e.target.closest(".jr-tag-remove, .jr-suggestion, input");
        if (!isControl) {
          e.preventDefault();
          filterTagsInput?.focus();
        }
      });
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
            const filtered = all.filter((t) => (!q || t.includes(q)) && !this.state.filterTagsSelected.includes(t)).slice(0, 100);
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
      // Use mousedown to ensure selection happens before outside click handlers
      filterTagsSuggestionsEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
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

    // Initial env load for Templates if URL present
    if (this.state.jenkinsUrl) {
      refreshTemplateEnvChoices();
    }
    // Initial render of templates list
    renderTemplates();
    refreshEnvChoices();

    // ===== SQL size & chunking helpers =====
    const MAX_SQL_BYTES = 90 * 1024; // 90KB limit
    const calcUtf8Bytes = (s) => {
      try {
        return new TextEncoder().encode(String(s || "")).length;
      } catch (_) {
        // Fallback for environments without TextEncoder
        return Buffer.from(String(s || ""), "utf8").length;
      }
    };

    // Split SQL into statements on semicolons, respecting quotes and comments
    const splitSqlStatementsSafely = (sql) => {
      const src = String(sql || "").replace(/\r\n/g, "\n");
      const out = [];
      let cur = "";
      let i = 0;
      let inSingle = false;
      let inDouble = false;
      let inLineComment = false; // -- comment
      let inBlockComment = false; // /* ... */
      while (i < src.length) {
        const ch = src[i];
        const next = i + 1 < src.length ? src[i + 1] : "";
        // Handle end of line comment
        if (inLineComment) {
          cur += ch;
          if (ch === "\n") inLineComment = false;
          i++;
          continue;
        }
        // Handle end of block comment
        if (inBlockComment) {
          cur += ch;
          if (ch === "*" && next === "/") {
            cur += next;
            i += 2;
            inBlockComment = false;
            continue;
          }
          i++;
          continue;
        }
        // Start of comments
        if (!inSingle && !inDouble) {
          if (ch === "-" && next === "-") {
            cur += ch + next;
            i += 2;
            inLineComment = true;
            continue;
          }
          if (ch === "/" && next === "*") {
            cur += ch + next;
            i += 2;
            inBlockComment = true;
            continue;
          }
        }
        // Toggle quotes (simple detection; does not handle all edge cases)
        if (!inDouble && ch === "'" && src[i - 1] !== "\\") {
          inSingle = !inSingle;
        } else if (!inSingle && ch === '"' && src[i - 1] !== "\\") {
          inDouble = !inDouble;
        }
        // Statement boundary only if not inside quotes/comments
        if (!inSingle && !inDouble && ch === ";") {
          cur += ch;
          out.push(cur.trim());
          cur = "";
          i++;
          continue;
        }
        cur += ch;
        i++;
      }
      if (cur.trim()) out.push(cur.trim());
      // Ensure statements end with semicolon when appropriate
      return out.map((s) => (s.endsWith(";") ? s : s + ";"));
    };

    // Pre-process statements per new rules:
    // 1) Remove any 'SET DEFINE OFF;' statements (case-insensitive)
    // 2) Remove standalone SELECT statements that contain a FROM clause
    // 3) Normalize whitespace and semicolons
    const preprocessStatements = (stmts) => {
      const out = [];
      for (let s of stmts) {
        const t = String(s || "").trim();
        // Drop statements that are SET DEFINE OFF (with or without semicolon)
        if (/^SET\s+DEFINE\s+OFF\s*;?$/i.test(t)) continue;
        // Drop standalone SELECT ... FROM statements (avoid touching subqueries in other statements)
        if (/^SELECT\b[\s\S]*?\bFROM\b[\s\S]*$/i.test(t)) continue;
        // Clean double semicolons and excessive blank lines
        let cleaned = t.replace(/;\s*;+$/g, ";").replace(/\n{3,}/g, "\n\n");
        if (!cleaned.endsWith(";")) cleaned += ";";
        out.push(cleaned);
      }
      return out;
    };

    const groupStatementsIntoChunks = (stmts, maxBytes) => {
      const HEADER = "SET DEFINE OFF;";
      const prefix = HEADER + "\n";
      const chunks = [];
      let cur = ""; // accumulate body without header
      for (const st of stmts) {
        // Ensure a single statement with header fits
        if (calcUtf8Bytes(prefix + st) > maxBytes) {
          return { chunks: [], oversizeStatement: st };
        }
        const combinedBody = cur ? cur + "\n" + st : st;
        const candidateWithHeader = prefix + combinedBody;
        if (calcUtf8Bytes(candidateWithHeader) <= maxBytes) {
          cur = combinedBody;
        } else {
          if (cur) chunks.push(prefix + cur);
          cur = st;
        }
      }
      if (cur) chunks.push(prefix + cur);
      return { chunks, oversizeStatement: null };
    };

    // Strip SQL comments for safety checks (basic; ignores edge cases in quoted strings)
    const stripSqlComments = (src) => {
      let s = String(src || "");
      // Remove block comments and line comments
      s = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
      // Remove simple quoted strings to avoid false positives (best-effort)
      s = s.replace(/'[^']*'/g, "''");
      s = s.replace(/"[^"]*"/g, '""');
      return s;
    };

    // Validate that no DROP appears and UPDATE/DELETE include WHERE (case-insensitive)
    const validateSqlSafety = (sql) => {
      try {
        const stmts = splitSqlStatementsSafely(sql);
        for (let st of stmts) {
          const cleaned = stripSqlComments(st).trim();
          if (!cleaned) continue;
          const lc = cleaned.toLowerCase();
          const norm = lc.replace(/\s+/g, " ");
          // Reject any usage of DROP anywhere in the statement
          if (/\bdrop\b/i.test(cleaned)) {
            return { ok: false, message: "DROP statements are not allowed." };
          }
          // UPDATE must have WHERE after SET
          if (/^\s*update\b/i.test(cleaned)) {
            const idxSet = norm.indexOf(" set ");
            const hasWhere = idxSet >= 0 ? norm.indexOf(" where ", idxSet) !== -1 : false;
            if (!hasWhere) {
              return { ok: false, message: "UPDATE must include a WHERE clause." };
            }
          }
          // DELETE must have WHERE
          if (/^\s*delete\b/i.test(cleaned)) {
            if (norm.indexOf(" where ") === -1) {
              return { ok: false, message: "DELETE must include a WHERE clause." };
            }
          }
        }
        return { ok: true };
      } catch (e) {
        // If safety check errors, fail closed
        return { ok: false, message: "Unable to validate SQL safety." };
      }
    };

    const waitForBuildCompletion = async (buildNumber, timeoutMs = 15 * 60 * 1000) => {
      return new Promise((resolve, reject) => {
        let unlisten = null;
        let timer = setTimeout(() => {
          try {
            if (typeof unlisten === "function") unlisten();
          } catch (_) {}
          reject(new Error("Log streaming timeout"));
        }, timeoutMs);
        listen("jenkins:log-complete", (ev) => {
          const payload = ev?.payload || {};
          const bn = typeof payload === "object" ? payload.build_number : null;
          if (Number(bn) === Number(buildNumber)) {
            clearTimeout(timer);
            try {
              if (typeof unlisten === "function") unlisten();
            } catch (_) {}
            resolve();
          }
        })
          .then((un) => {
            unlisten = un;
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
    };

    // Clear button - empties the SQL editor
    const clearBtn = this.container.querySelector("#jenkins-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (this.editor && typeof this.editor.setValue === "function") {
          this.editor.setValue("");
          this._querySource = null; // Reset source
          saveLastState({ sql: "" });
          toggleSubmitEnabled();
          statusEl.textContent = "Editor cleared";
        }
      });
    }

    // Paste button - reads clipboard and inserts into editor
    const pasteBtn = this.container.querySelector("#jenkins-paste");
    if (pasteBtn) {
      pasteBtn.addEventListener("click", async () => {
        try {
          // Use Tauri clipboard plugin if available, otherwise fallback to browser API
          let text = "";
          if (isTauri()) {
            try {
              const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
              text = (await readText()) || "";
            } catch (_) {
              // Fallback to browser clipboard API
              text = await navigator.clipboard.readText();
            }
          } else {
            text = await navigator.clipboard.readText();
          }
          if (this.editor && typeof this.editor.setValue === "function" && text) {
            this.editor.setValue(text);
            this._querySource = "paste";
            saveLastState({ sql: text });
            toggleSubmitEnabled();
            statusEl.textContent = "Pasted from clipboard";
          }
        } catch (err) {
          statusEl.textContent = "Failed to read clipboard";
          console.error("Paste failed:", err);
        }
      });
    }

    runBtn.addEventListener("click", async () => {
      const baseUrl = this.state.jenkinsUrl;
      const job = jobInput.value.trim();
      const env = envSelect.value;
      const sql = this.editor ? this.editor.getValue().trim() : "";
      const totalBytes = calcUtf8Bytes(sql);
      // Determine query source: quick-query, template, or manual
      const source = this._querySource || "manual";
      // Reset source after tracking (next run will be manual unless set again)
      this._querySource = null;
      try {
        UsageTracker.trackFeature("run-query", "run_click", { job, env, sql_len: sql.length, source });
      } catch (_) {}

      // Require statements to end with semicolon; show the line if missing
      const semi = validateSemicolons(sql);
      if (!semi.ok) {
        statusEl.textContent = semi.message;
        this.showError("Error: missing semicolon");
        return;
      }

      // Safety validation: disallow DROP and UPDATE/DELETE without WHERE
      const safety = validateSqlSafety(sql);
      if (!safety.ok) {
        statusEl.textContent = safety.message;
        this.showError("Unsafe SQL");
        return;
      }

      // If the SQL is oversize, allow the user to preview and split first
      if (totalBytes > MAX_SQL_BYTES) {
        // Prevent starting a new split while one is already in progress
        if (this.state.split?.started && !this.state.split?.completed) {
          this.showError("A split query execution is already in progress. Complete or cancel it first.");
          return;
        }
        openSplitSizeWarning(async () => {
          try {
            const stmts = splitSqlStatementsSafely(sql);
            const pre = preprocessStatements(stmts);
            const { chunks, oversizeStatement } = groupStatementsIntoChunks(pre, MAX_SQL_BYTES);
            if (oversizeStatement) {
              statusEl.textContent = "Cannot run: a single SQL statement exceeds 90KB.";
              this.showError("One statement is too large to send safely. Please reduce the statement size or run via an alternate method.");
              return;
            }
            openSplitModal(chunks);
            if (splitProgressEl) {
              if (!baseUrl || !env) {
                splitProgressEl.textContent = `Prepared ${chunks.length} chunks. Set Jenkins URL and pick ENV to enable execution.`;
                if (splitExecuteAllBtn) splitExecuteAllBtn.disabled = true;
              } else {
                splitProgressEl.textContent = `Prepared ${chunks.length} chunks. Ready to execute.`;
                if (splitExecuteAllBtn) splitExecuteAllBtn.disabled = false;
              }
            }
            const deriveChunkTitle = (sqlStr, index) => {
              try {
                const m = String(sqlStr || "").match(/\bINTO\s+([a-z0-9_]+\.[a-z0-9_]+)\b/i);
                const base = m ? m[1] : `Chunk ${index + 1}`;
                return `${base} - ${index + 1}`;
              } catch (_) {
                return `Chunk ${index + 1}`;
              }
            };
            // Bind Execute All once - reads current state at click time to avoid stale closures
            if (splitExecuteAllBtn && !splitExecuteAllBtn.dataset.bound) {
              splitExecuteAllBtn.dataset.bound = "true";
              splitExecuteAllBtn.addEventListener("click", async () => {
                // Read current state at click time (not from closure)
                const currentChunks = this.state.split.chunks;
                const currentEnv = envSelect.value;
                const currentBaseUrl = this.state.jenkinsUrl;
                const currentJob = jobInput.value.trim();

                if (!currentBaseUrl || !currentEnv) {
                  this.showError("Select Jenkins URL and ENV in the toolbar to execute.");
                  return;
                }
                try {
                  splitExecuteAllBtn.disabled = true;
                  this.state.split.started = true;
                  // Register beforeunload handler to warn user and cleanup on app close
                  if (!this._beforeUnloadHandler) {
                    this._beforeUnloadHandler = (e) => {
                      if (this.state?.split?.started && !this.state?.split?.completed) {
                        e.preventDefault();
                        e.returnValue = "Split query execution is in progress. Are you sure you want to leave?";
                        return e.returnValue;
                      }
                    };
                    window.addEventListener("beforeunload", this._beforeUnloadHandler);
                  }
                  // Initialize logs for split execution
                  logsEl.textContent = "";
                  const miniL = document.getElementById("jr-split-mini-log");
                  if (miniL) miniL.textContent = "";
                  let lastBuildUrl = null;
                  for (let idx = 0; idx < currentChunks.length; idx++) {
                    // Check if user requested cancellation
                    if (this.state.split.cancelRequested) {
                      statusEl.textContent = "Execution cancelled by user.";
                      if (splitProgressEl) splitProgressEl.textContent = `Cancelled. Completed ${idx} of ${currentChunks.length} chunks.`;
                      appendLog(`\n=== Execution cancelled. Remaining chunks not queued. ===\n`);
                      splitExecuteAllBtn.disabled = false;
                      this._cleanupSplitResources();
                      return;
                    }

                    const chunkSql = currentChunks[idx];
                    // Seed a history entry per chunk with table-derived title
                    const arrSeed = loadHistory();
                    const chunkTitle = deriveChunkTitle(chunkSql, idx);
                    arrSeed.push({
                      timestamp: new Date().toISOString(),
                      job: currentJob,
                      env: currentEnv,
                      sql: chunkSql,
                      title: chunkTitle,
                      buildNumber: null,
                      buildUrl: null,
                    });
                    const histIndex = arrSeed.length - 1;
                    saveHistory(arrSeed);
                    renderHistory();
                    this.state.split.statuses[idx] = "running";
                    renderSplitChunksList();
                    appendLog(`\n=== Running chunk ${idx + 1}/${currentChunks.length} (${bytesToKB(calcUtf8Bytes(chunkSql))}) ===\n`);
                    this.state.lastRunArgListTooLong = false;
                    const queueUrl = await this.service.triggerJob(currentBaseUrl, currentJob, currentEnv, chunkSql);
                    this.state.queueUrl = queueUrl;
                    if (splitProgressEl) splitProgressEl.textContent = `Chunk ${idx + 1}/${currentChunks.length} queued. Polling…`;
                    // Poll until build starts
                    let attempts = 0;
                    let buildNumber = null;
                    let executableUrl = null;
                    while (!buildNumber && attempts <= 30) {
                      attempts++;
                      try {
                        const res = await this.service.pollQueue(currentBaseUrl, queueUrl);
                        buildNumber = res.buildNumber || null;
                        executableUrl = res.executableUrl || null;
                        if (!buildNumber) await new Promise((r) => setTimeout(r, 2000));
                      } catch (err) {
                        if (splitProgressEl) splitProgressEl.textContent = `Polling error on chunk ${idx + 1}`;
                        this.state.split.statuses[idx] = "failed";
                        renderSplitChunksList();
                        this.showError(String(err));
                        splitExecuteAllBtn.disabled = false;
                        this._cleanupSplitResources();
                        return;
                      }
                    }
                    if (!buildNumber) {
                      if (splitProgressEl) splitProgressEl.textContent = `Polling timeout on chunk ${idx + 1}`;
                      this.state.split.statuses[idx] = "timeout";
                      renderSplitChunksList();
                      splitExecuteAllBtn.disabled = false;
                      this._cleanupSplitResources();
                      return;
                    }
                    this.state.buildNumber = buildNumber;
                    this.state.executableUrl = executableUrl;
                    if (buildNumEl) {
                      buildNumEl.textContent = String(buildNumber);
                      buildNumEl.style.display = "inline-flex";
                    }
                    if (executableUrl) {
                      buildLink.href = executableUrl;
                      buildLink.style.display = "inline-block";
                      lastBuildUrl = executableUrl;
                    }
                    // Update this chunk’s history entry with build info
                    try {
                      const arrUpdate = loadHistory();
                      if (arrUpdate[histIndex]) {
                        arrUpdate[histIndex].buildNumber = buildNumber || null;
                        arrUpdate[histIndex].buildUrl = executableUrl || arrUpdate[histIndex].buildUrl;
                        saveHistory(arrUpdate);
                        renderHistory();
                      }
                    } catch (_) {}
                    if (splitProgressEl) splitProgressEl.textContent = `Chunk ${idx + 1}/${currentChunks.length} streaming…`;
                    await subscribeToLogs();
                    await this.service.streamLogs(currentBaseUrl, currentJob, buildNumber);
                    await waitForBuildCompletion(buildNumber);
                    if (this.state.lastRunArgListTooLong) {
                      if (splitProgressEl) splitProgressEl.textContent = "Argument list too long detected.";
                      this.state.split.statuses[idx] = "error";
                      renderSplitChunksList();
                      this.showError(
                        "Jenkins reported 'Argument list too long'. Consider reducing query size or further splitting templates."
                      );
                      splitExecuteAllBtn.disabled = false;
                      this._cleanupSplitResources();
                      return;
                    }
                    this.state.split.statuses[idx] = "success";
                    renderSplitChunksList();
                    appendLog(`\n=== Chunk ${idx + 1}/${currentChunks.length} complete ===\n`);
                  }
                  renderHistory();
                  // Calculate success report
                  const successCount = this.state.split.statuses.filter((s) => s === "success").length;
                  const failedCount = this.state.split.statuses.filter((s) => s === "failed" || s === "error" || s === "timeout").length;
                  const completionMessage =
                    `✓ Execution Complete: ${successCount}/${currentChunks.length} chunks succeeded` +
                    (failedCount > 0 ? ` (${failedCount} failed)` : "") +
                    ` on ${currentEnv}`;
                  statusEl.textContent = completionMessage;
                  if (splitProgressEl) {
                    splitProgressEl.innerHTML = `<strong style="color: var(--success-color, #22c55e);">✓ All ${currentChunks.length} chunks executed successfully on ${currentEnv}</strong><br><span style="font-size: 0.85em; opacity: 0.8;">Check the History tab for individual build links.</span>`;
                  }
                  // Update button to indicate completion and prevent accidental re-run
                  splitExecuteAllBtn.textContent = "✓ Execution Complete";
                  splitExecuteAllBtn.disabled = true;
                  // Mark as completed and update cancel to dismiss
                  this.state.split.completed = true;
                  if (splitCancelBtn) splitCancelBtn.textContent = "Dismiss";
                  appendLog(
                    `\n========================================\n✓ SPLIT EXECUTION COMPLETE\n  Environment: ${currentEnv}\n  Total Chunks: ${currentChunks.length}\n  Successful: ${successCount}\n  Failed: ${failedCount}\n========================================\n`
                  );
                  // Cleanup resources after successful completion
                  this._cleanupSplitResources();
                } catch (err) {
                  splitExecuteAllBtn.disabled = false;
                  this.showError(errorMapping(err));
                  this._cleanupSplitResources();
                }
              });
            }
          } catch (err) {
            this.showError(errorMapping(err));
          }
        });
        return;
      }

      // Validate prerequisites for immediate run path
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
        logsEl.textContent = "";
        buildLink.style.display = "none";
        if (buildNumEl) {
          buildNumEl.style.display = "none";
          buildNumEl.textContent = "";
        }

        // Save state
        saveLastState();

        if (totalBytes <= MAX_SQL_BYTES) {
          // Seed history for single-run (non-split)
          const histEntry = { timestamp: new Date().toISOString(), job, env, sql, buildNumber: null, buildUrl: null };
          const hist = loadHistory();
          hist.push(histEntry);
          saveHistory(hist);
          statusEl.textContent = "Triggering job…";
          const queueUrl = await this.service.triggerJob(baseUrl, job, env, sql);
          this.state.queueUrl = queueUrl;
          statusEl.textContent = "Queued. Polling…";
          let attempts = 0;
          const pollOnce = async () => {
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
                // Update history with build
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
                await waitForBuildCompletion(buildNumber);
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
                UsageTracker.trackEvent("run-query", "run_error", UsageTracker.enrichErrorMeta(err, { context: "polling" }));
              } catch (_) {}
              this.showError(String(err));
              runBtn.disabled = false;
              return;
            }
            setTimeout(pollOnce, 2000);
          };
          await pollOnce();
        } else {
          // Oversize: ask to split, then show Split modal and allow Execute All
          openSplitSizeWarning(async () => {
            try {
              const stmts = splitSqlStatementsSafely(sql);
              const pre = preprocessStatements(stmts);
              const { chunks, oversizeStatement } = groupStatementsIntoChunks(pre, MAX_SQL_BYTES);
              if (oversizeStatement) {
                statusEl.textContent = "Cannot run: a single SQL statement exceeds 90KB.";
                this.showError(
                  "One statement is too large to send safely. Please reduce the statement size or run via an alternate method."
                );
                runBtn.disabled = false;
                return;
              }
              openSplitModal(chunks);
              if (splitProgressEl) splitProgressEl.textContent = `Prepared ${chunks.length} chunks. Ready to execute.`;
              const deriveChunkTitle = (sqlStr, index) => {
                try {
                  const m = String(sqlStr || "").match(/\bINTO\s+([a-z0-9_]+\.[a-z0-9_]+)\b/i);
                  const base = m ? m[1] : `Chunk ${index + 1}`;
                  return `${base} - ${index + 1}`;
                } catch (_) {
                  return `Chunk ${index + 1}`;
                }
              };
              // Bind Execute All once
              if (splitExecuteAllBtn && !splitExecuteAllBtn.dataset.bound) {
                splitExecuteAllBtn.dataset.bound = "true";
                splitExecuteAllBtn.addEventListener("click", async () => {
                  try {
                    splitExecuteAllBtn.disabled = true;
                    this.state.split.started = true;
                    // Initialize logs for split execution
                    logsEl.textContent = "";
                    const miniL2 = document.getElementById("jr-split-mini-log");
                    if (miniL2) miniL2.textContent = "";
                    let lastBuildUrl = null;
                    for (let idx = 0; idx < chunks.length; idx++) {
                      // Check if user requested cancellation
                      if (this.state.split.cancelRequested) {
                        statusEl.textContent = "Execution cancelled by user.";
                        if (splitProgressEl) splitProgressEl.textContent = `Cancelled. Completed ${idx} of ${chunks.length} chunks.`;
                        appendLog(`\n=== Execution cancelled. Remaining chunks not queued. ===\n`);
                        splitExecuteAllBtn.disabled = false;
                        return;
                      }

                      const chunkSql = chunks[idx];
                      // Seed a history entry per chunk with table-derived title
                      const arrSeed = loadHistory();
                      const chunkTitle = deriveChunkTitle(chunkSql, idx);
                      arrSeed.push({
                        timestamp: new Date().toISOString(),
                        job,
                        env,
                        sql: chunkSql,
                        title: chunkTitle,
                        buildNumber: null,
                        buildUrl: null,
                      });
                      const histIndex = arrSeed.length - 1;
                      saveHistory(arrSeed);
                      renderHistory();
                      this.state.split.statuses[idx] = "running";
                      renderSplitChunksList();
                      appendLog(`\n=== Running chunk ${idx + 1}/${chunks.length} (${bytesToKB(calcUtf8Bytes(chunkSql))}) ===\n`);
                      this.state.lastRunArgListTooLong = false;
                      const queueUrl = await this.service.triggerJob(baseUrl, job, env, chunkSql);
                      this.state.queueUrl = queueUrl;
                      if (splitProgressEl) splitProgressEl.textContent = `Chunk ${idx + 1}/${chunks.length} queued. Polling…`;
                      // Poll until build starts
                      let attempts = 0;
                      let buildNumber = null;
                      let executableUrl = null;
                      while (!buildNumber && attempts <= 30) {
                        attempts++;
                        try {
                          const res = await this.service.pollQueue(baseUrl, queueUrl);
                          buildNumber = res.buildNumber || null;
                          executableUrl = res.executableUrl || null;
                          if (!buildNumber) await new Promise((r) => setTimeout(r, 2000));
                        } catch (err) {
                          if (splitProgressEl) splitProgressEl.textContent = `Polling error on chunk ${idx + 1}`;
                          this.state.split.statuses[idx] = "failed";
                          renderSplitChunksList();
                          this.showError(String(err));
                          splitExecuteAllBtn.disabled = false;
                          return;
                        }
                      }
                      if (!buildNumber) {
                        if (splitProgressEl) splitProgressEl.textContent = `Polling timeout on chunk ${idx + 1}`;
                        this.state.split.statuses[idx] = "timeout";
                        renderSplitChunksList();
                        splitExecuteAllBtn.disabled = false;
                        return;
                      }
                      this.state.buildNumber = buildNumber;
                      this.state.executableUrl = executableUrl;
                      if (buildNumEl) {
                        buildNumEl.textContent = String(buildNumber);
                        buildNumEl.style.display = "inline-flex";
                      }
                      if (executableUrl) {
                        buildLink.href = executableUrl;
                        buildLink.style.display = "inline-block";
                        lastBuildUrl = executableUrl;
                      }
                      // Update this chunk’s history entry with build info
                      try {
                        const arrUpdate = loadHistory();
                        if (arrUpdate[histIndex]) {
                          arrUpdate[histIndex].buildNumber = buildNumber || null;
                          arrUpdate[histIndex].buildUrl = executableUrl || arrUpdate[histIndex].buildUrl;
                          saveHistory(arrUpdate);
                          renderHistory();
                        }
                      } catch (_) {}
                      if (splitProgressEl) splitProgressEl.textContent = `Chunk ${idx + 1}/${chunks.length} streaming…`;
                      await subscribeToLogs();
                      await this.service.streamLogs(baseUrl, job, buildNumber);
                      await waitForBuildCompletion(buildNumber);
                      if (this.state.lastRunArgListTooLong) {
                        if (splitProgressEl) splitProgressEl.textContent = "Argument list too long detected.";
                        this.state.split.statuses[idx] = "error";
                        renderSplitChunksList();
                        this.showError(
                          "Jenkins reported 'Argument list too long'. Consider reducing query size or further splitting templates."
                        );
                        splitExecuteAllBtn.disabled = false;
                        return;
                      }
                      this.state.split.statuses[idx] = "success";
                      renderSplitChunksList();
                      appendLog(`\n=== Chunk ${idx + 1}/${chunks.length} complete ===\n`);
                    }
                    renderHistory();
                    // Calculate success report
                    const successCount = this.state.split.statuses.filter((s) => s === "success").length;
                    const failedCount = this.state.split.statuses.filter((s) => s === "failed" || s === "error" || s === "timeout").length;
                    const completionMessage =
                      `✓ Execution Complete: ${successCount}/${chunks.length} chunks succeeded` +
                      (failedCount > 0 ? ` (${failedCount} failed)` : "") +
                      ` on ${env}`;
                    statusEl.textContent = completionMessage;
                    if (splitProgressEl) {
                      splitProgressEl.innerHTML = `<strong style="color: var(--success-color, #22c55e);">✓ All ${chunks.length} chunks executed successfully on ${env}</strong><br><span style="font-size: 0.85em; opacity: 0.8;">Check the History tab for individual build links.</span>`;
                    }
                    // Update button to indicate completion and prevent accidental re-run
                    splitExecuteAllBtn.textContent = "✓ Execution Complete";
                    splitExecuteAllBtn.disabled = true;
                    // Mark as completed and update cancel to dismiss
                    this.state.split.completed = true;
                    if (splitCancelBtn) splitCancelBtn.textContent = "Dismiss";
                    appendLog(
                      `\n========================================\n✓ SPLIT EXECUTION COMPLETE\n  Environment: ${env}\n  Total Chunks: ${chunks.length}\n  Successful: ${successCount}\n  Failed: ${failedCount}\n========================================\n`
                    );
                  } catch (err) {
                    splitExecuteAllBtn.disabled = false;
                    this.showError(errorMapping(err));
                  }
                });
              }
            } catch (err) {
              this.showError(errorMapping(err));
            } finally {
              runBtn.disabled = false;
            }
          });
          // Do not start execution immediately; user proceeds from Split modal
          return;
        }
      } catch (err) {
        statusEl.textContent = "Trigger failed";
        try {
          UsageTracker.trackEvent("run-query", "run_error", UsageTracker.enrichErrorMeta(err, { job, env, context: "trigger" }));
        } catch (_) {}
        this.showError(errorMapping(err));
        runBtn.disabled = false;
      }
    });
  }

  onUnmount() {
    try {
      // Clean up split execution resources (log listeners, beforeunload handler, indicator)
      // On unmount, we fully clean up including the indicator since the component is being destroyed
      this._cleanupSplitResources({ hideIndicator: true });

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

      // Remove orphaned global split indicator element from DOM
      const globalIndicator = document.getElementById("jr-global-split-indicator");
      if (globalIndicator && globalIndicator.parentNode) {
        globalIndicator.parentNode.removeChild(globalIndicator);
      }
    } catch (_) {}
  }

  onDeactivate() {
    // If split execution is running (started but not completed), preserve log listeners
    // so the async execution loop can continue in the background
    const splitRunning = this.state?.split?.started && !this.state?.split?.completed;

    // Auto-minimize split modal if execution is running (or completed) AND modal is visible
    // Check if the modal is currently visible or already minimized
    const splitModal = document.getElementById("jr-split-modal");
    const isModalVisible = splitModal && splitModal.style.display !== "none";
    const isMinimized = this.state?.split?.minimized;
    if ((splitRunning || this.state?.split?.completed) && (isModalVisible || isMinimized)) {
      this.state.split.minimized = true;
      // Create/show global indicator so user can navigate back
      let globalEl = document.getElementById("jr-global-split-indicator");
      if (!globalEl) {
        globalEl = document.createElement("div");
        globalEl.id = "jr-global-split-indicator";
        globalEl.className = "jr-split-minimized";
        globalEl.setAttribute("role", "status");
        globalEl.innerHTML = `
          <div class="jr-split-minimized-content" style="cursor:pointer;">
            <span class="jr-split-minimized-icon">⏳</span>
            <span class="jr-global-split-text">Running...</span>
          </div>
          <button class="btn btn-sm-xs">Show</button>
        `;
        document.body.appendChild(globalEl);
      }
      // Update text based on state
      const { chunks, statuses, completed } = this.state.split;
      const total = chunks?.length || 0;
      const doneCount = statuses?.filter((s) => s === "success" || s === "failed" || s === "error" || s === "timeout").length || 0;
      const textEl = globalEl.querySelector(".jr-global-split-text");
      if (textEl) {
        if (completed) {
          const ok = statuses?.filter((s) => s === "success").length || 0;
          textEl.textContent = `✓ Complete: ${ok}/${total}`;
          globalEl.classList.add("completed");
        } else {
          textEl.textContent = `Running Query Chunk: ${doneCount + 1}/${total}...`;
          globalEl.classList.remove("completed");
        }
      }
      globalEl.style.display = "flex";
      this._globalSplitIndicator = globalEl;
      // Bind click handler
      const self = this;
      globalEl.onclick = () => {
        window.location.hash = "run-query";
      };
    }

    // Cleanup listeners and beforeunload handler only if split is not running
    // When split IS running, we intentionally preserve listeners so the background
    // async loop can continue receiving log events
    if (!splitRunning) {
      this._cleanupSplitResources();
    }

    // Dispose editors to save memory regardless
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    if (this.templateEditor) {
      this.templateEditor.dispose();
      this.templateEditor = null;
    }
    if (this.splitEditor) {
      this.splitEditor.dispose();
      this.splitEditor = null;
    }
  }
}
