import { BaseTool } from "../../core/BaseTool.js";
import { JenkinsRunnerTemplate } from "./template.js";
import { JenkinsRunnerService } from "./service.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";
import { listen } from "@tauri-apps/api/event";
import { ensureMonacoWorkers, setupMonacoOracle, createOracleEditor } from "../../core/MonacoOracle.js";

export class JenkinsRunner extends BaseTool {
  constructor(eventBus) {
    super({
      id: "jenkins-runner",
      name: "Jenkins Query Runner",
      description: "Run read-only SQL via a Jenkins job and stream logs",
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

    // Map backend error strings to friendly guidance
    const toFriendlyError = (e) => {
      const s = String(e || "").toLowerCase();
      if (s.includes("user") && s.includes("invalid") && s.includes("empty")) {
        return "Set Jenkins Username on Settings first";
      }
      if (s.includes("http 401") || s.includes("unauthorized")) {
        return "Check Jenkins Username and Token in Settings";
      }
      return String(e || "Unknown error");
    };

    // Log helpers scoped to this tool instance
    const appendLog = (text) => {
      logsEl.textContent += text;
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
      fontSize: 12,
      tabSize: 2,
      insertSpaces: true,
    });

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
          const ts = it.timestamp ? new Date(it.timestamp).toLocaleString() : "";
          const build = it.buildNumber ? `#${it.buildNumber}` : "";
          const buildLinkHtml = it.buildUrl ? `<a href="${it.buildUrl}" target="_blank" rel="noopener">Open</a>` : "";
          const escTitle = sqlSummary.replace(/"/g, "&quot;");
          return `<tr><td>${ts}</td><td>${it.job || ""}</td><td>${
            it.env || ""
          }</td><td title="${escTitle}">${short}</td><td>${build} ${buildLinkHtml}</td><td><button class="jr-history-load" data-index="${i}">Load</button></td></tr>`;
        })
        .join("");
      if (historyList) historyList.innerHTML = rows || '<tr><td colspan="6">No history yet.</td></tr>';
    };

    // Tab switching
    const switchToRun = () => {
      if (!runTabBtn || !historyTabBtn || !runTab || !historyTab) return;
      runTabBtn.classList.add("active");
      runTabBtn.setAttribute("aria-selected", "true");
      historyTabBtn.classList.remove("active");
      historyTabBtn.setAttribute("aria-selected", "false");
      runTab.style.display = "grid";
      historyTab.style.display = "none";
    };
    const switchToHistory = () => {
      if (!runTabBtn || !historyTabBtn || !runTab || !historyTab) return;
      runTabBtn.classList.remove("active");
      runTabBtn.setAttribute("aria-selected", "false");
      historyTabBtn.classList.add("active");
      historyTabBtn.setAttribute("aria-selected", "true");
      runTab.style.display = "none";
      historyTab.style.display = "block";
      renderHistory();
    };
    if (runTabBtn) runTabBtn.addEventListener("click", switchToRun);
    if (historyTabBtn) historyTabBtn.addEventListener("click", switchToHistory);

    if (historyList)
      historyList.addEventListener("click", (e) => {
        const t = e.target;
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

    // Initial env load if URL and job valid
    if (this.state.jenkinsUrl && jobInput.value.trim().length) {
      if (validateJobName()) refreshEnvChoices();
    }

    runBtn.addEventListener("click", async () => {
      const baseUrl = this.state.jenkinsUrl;
      const job = jobInput.value.trim();
      const env = envSelect.value;
      const sql = this.editor ? this.editor.getValue().trim() : "";

      if (!baseUrl || !job || !env) {
        this.showError("Select Jenkins URL, enter Job, and choose ENV");
        return;
      }
      if (!allowedJobs.has(job)) {
        this.showError("Invalid job name. Allowed: tester-execute-query or tester-execute-query-new.");
        return;
      }
      if (sql.length < 5) {
        this.showError("SQL looks too short. Provide a valid SELECT.");
        return;
      }
      const lowered = sql.toLowerCase();
      for (const kw of ["insert", "update", "delete", "alter", "drop", "truncate"]) {
        if (lowered.includes(kw)) {
          this.showError("Only read-only queries allowed");
          return;
        }
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
            this.showError(String(err));
            runBtn.disabled = false;
            return;
          }
          setTimeout(poll, 2000);
        };
        poll();
      } catch (err) {
        statusEl.textContent = "Trigger failed";
        this.showError(toFriendlyError(err));
        runBtn.disabled = false;
      }
    });
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
  }
}
