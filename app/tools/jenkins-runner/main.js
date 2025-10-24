import { BaseTool } from "../../core/BaseTool.js";
import { JenkinsRunnerTemplate } from "./template.js";
import { JenkinsRunnerService } from "./service.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";
import { listen } from "@tauri-apps/api/event";

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
  }

  getIconSvg() { return getIconSvg(); }

  render() { return JenkinsRunnerTemplate; }

  async onMount() {
    const baseUrlInput = this.container.querySelector('#jenkins-baseurl');
    const jobInput = this.container.querySelector('#jenkins-job');
    const envSelect = this.container.querySelector('#jenkins-env');
    const sqlInput = this.container.querySelector('#jenkins-sql');
    const runBtn = this.container.querySelector('#jenkins-run');
    const statusEl = this.container.querySelector('[data-role="status"]');
    const hintEl = this.container.querySelector('[data-role="hint"]');
    const logsEl = this.container.querySelector('#jenkins-logs');
    const buildLink = this.container.querySelector('#jenkins-build-link');
    const jobErrorEl = this.container.querySelector('#jenkins-job-error');
    const envErrorEl = this.container.querySelector('#jenkins-env-error');

    const allowedJobs = new Set(['TESTER-EXECUTE-QUERY','TESTER-EXECUTE-QUERY-NEW']);

    // Load Jenkins URL
    this.state.jenkinsUrl = this.service.loadJenkinsUrl();
    baseUrlInput.value = this.state.jenkinsUrl || '';
    if (!this.state.jenkinsUrl) {
      statusEl.textContent = 'Configure Jenkins URL in Settings first.';
    }

    // Token presence hint
    const hasToken = await this.service.hasToken();
    if (!hasToken) {
      hintEl.style.display = 'block';
      hintEl.textContent = 'No Jenkins token found. Add it in Settings → Credential Management.';
    }

    const persistEnvKey = 'tool:jenkins-runner:env';
    const savedEnv = localStorage.getItem(persistEnvKey) || '';

    const validateJobName = () => {
      const name = jobInput.value.trim();
      if (!allowedJobs.has(name)) {
        jobErrorEl.style.display = 'block';
        jobErrorEl.textContent = 'Invalid job name. Allowed: TESTER-EXECUTE-QUERY or TESTER-EXECUTE-QUERY-NEW.';
        return false;
      }
      jobErrorEl.style.display = 'none';
      return true;
    };

    const toggleSubmitEnabled = () => {
      const validJob = validateJobName();
      const hasEnv = !!envSelect.value;
      const hasUrl = !!this.state.jenkinsUrl;
      const hasSql = sqlInput.value.trim().length >= 5;
      runBtn.disabled = !(validJob && hasEnv && hasUrl && hasSql);
    };

    const refreshEnvChoices = async (retry = 0) => {
      logsEl.textContent = '';
      buildLink.style.display = 'none';
      this.state.executableUrl = null;
      const baseUrl = this.state.jenkinsUrl;
      const job = jobInput.value.trim();
      if (!baseUrl || !job) return;
      try {
        statusEl.textContent = 'Loading ENV choices…';
        envSelect.classList.add('jr-loading');
        envSelect.disabled = true;
        const choices = await this.service.getEnvChoices(baseUrl, job);
        this.state.envChoices = Array.isArray(choices) ? choices : [];
        envSelect.innerHTML = this.state.envChoices.map(c => `<option value="${c}">${c}</option>`).join('');
        if (savedEnv && this.state.envChoices.includes(savedEnv)) {
          envSelect.value = savedEnv;
        }
        envErrorEl.style.display = 'none';
        statusEl.textContent = 'Ready';
      } catch (err) {
        const msg = `Failed to load environments${retry ? ` (attempt ${retry+1})` : ''}`;
        statusEl.textContent = msg;
        envErrorEl.style.display = 'block';
        envErrorEl.textContent = String(err);
        if (retry < 2) {
          setTimeout(() => refreshEnvChoices(retry + 1), 1500);
        }
      } finally {
        envSelect.classList.remove('jr-loading');
        envSelect.disabled = false;
        toggleSubmitEnabled();
      }
    };

    baseUrlInput.addEventListener('input', () => {
      // Read-only; guide user
      statusEl.textContent = 'Jenkins URL is managed in Settings.';
    });

    jobInput.addEventListener('input', () => {
      validateJobName();
      toggleSubmitEnabled();
      if (allowedJobs.has(jobInput.value.trim())) refreshEnvChoices();
    });

    envSelect.addEventListener('change', () => {
      localStorage.setItem(persistEnvKey, envSelect.value || '');
      toggleSubmitEnabled();
    });
    sqlInput.addEventListener('input', toggleSubmitEnabled);

    const appendLog = (text) => {
      logsEl.textContent += text;
      logsEl.scrollTop = logsEl.scrollHeight;
    };

    const clearLogListeners = () => {
      for (const un of this._logUnsubscribes) { try { un(); } catch (_) {} }
      this._logUnsubscribes = [];
    };

    const subscribeToLogs = async () => {
      clearLogListeners();
      this._logUnsubscribes.push(
        await listen('jenkins:log', (ev) => {
          const data = ev?.payload || {};
          const chunk = typeof data === 'string' ? data : (data.chunk || '');
          appendLog(chunk);
        })
      );
      this._logUnsubscribes.push(
        await listen('jenkins:log-error', (ev) => {
          const msg = String(ev?.payload || 'Log stream error');
          this.showError(msg);
          statusEl.textContent = 'Log stream error';
        })
      );
      this._logUnsubscribes.push(
        await listen('jenkins:log-complete', () => {
          statusEl.textContent = 'Complete';
        })
      );
    };

    // Initial env load if URL and job valid
    if (this.state.jenkinsUrl && jobInput.value.trim().length) {
      if (validateJobName()) refreshEnvChoices();
    }

    runBtn.addEventListener('click', async () => {
      const baseUrl = this.state.jenkinsUrl;
      const job = jobInput.value.trim();
      const env = envSelect.value;
      const sql = sqlInput.value.trim();

      if (!baseUrl || !job || !env) {
        this.showError('Select Jenkins URL, enter Job, and choose ENV');
        return;
      }
      if (!allowedJobs.has(job)) {
        this.showError('Invalid job name. Allowed: TESTER-EXECUTE-QUERY or TESTER-EXECUTE-QUERY-NEW.');
        return;
      }
      if (sql.length < 5) {
        this.showError('SQL looks too short. Provide a valid SELECT.');
        return;
      }
      const lowered = sql.toLowerCase();
      for (const kw of ['insert','update','delete','alter','drop','truncate']) {
        if (lowered.includes(kw)) { this.showError('Only read-only queries allowed'); return; }
      }

      runBtn.disabled = true;
      try {
        statusEl.textContent = 'Triggering job…';
        logsEl.textContent = '';
        buildLink.style.display = 'none';
        const queueUrl = await this.service.triggerJob(baseUrl, job, env, sql);
        this.state.queueUrl = queueUrl;
        statusEl.textContent = 'Queued. Polling…';

        let attempts = 0;
        const poll = async () => {
          attempts++;
          try {
            const { buildNumber, executableUrl } = await this.service.pollQueue(baseUrl, queueUrl);
            if (buildNumber) {
              this.state.buildNumber = buildNumber;
              this.state.executableUrl = executableUrl;
              if (executableUrl) {
                buildLink.href = executableUrl;
                buildLink.style.display = 'inline-block';
              }
              statusEl.textContent = `Build #${buildNumber} started. Streaming logs…`;
              await subscribeToLogs();
              await this.service.streamLogs(baseUrl, job, buildNumber);
              runBtn.disabled = false;
              return;
            }
            if (attempts > 30) { statusEl.textContent = 'Polling timeout'; runBtn.disabled = false; return; }
          } catch (err) {
            statusEl.textContent = 'Polling error';
            this.showError(String(err));
            runBtn.disabled = false;
            return;
          }
          setTimeout(poll, 2000);
        };
        poll();
      } catch (err) {
        statusEl.textContent = 'Trigger failed';
        this.showError(String(err));
        runBtn.disabled = false;
      }
    });
  }

  onDeactivate() {
    // Cleanup listeners
    try { for (const un of this._logUnsubscribes) { un(); } } catch (_) {}
    this._logUnsubscribes = [];
  }
}