import { BaseTool } from "../../core/BaseTool.js";
import { JenkinsRunnerTemplate } from "./template.js";
import { JenkinsRunnerService } from "./service.js";
import { getIconSvg } from "./icon.js";
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
      baseUrls: [],
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
    const baseUrlSelect = this.container.querySelector('#jenkins-baseurl');
    const jobInput = this.container.querySelector('#jenkins-job');
    const envSelect = this.container.querySelector('#jenkins-env');
    const sqlInput = this.container.querySelector('#jenkins-sql');
    const runBtn = this.container.querySelector('#jenkins-run');
    const statusEl = this.container.querySelector('[data-role="status"]');
    const hintEl = this.container.querySelector('[data-role="hint"]');
    const logsEl = this.container.querySelector('#jenkins-logs');
    const buildLink = this.container.querySelector('#jenkins-build-link');

    // Load base URLs
    this.state.baseUrls = this.service.loadBaseUrls();
    baseUrlSelect.innerHTML = this.state.baseUrls.map(p => `<option value="${p.value}">${p.key}</option>`).join('');
    if (this.state.baseUrls.length === 0) {
      statusEl.textContent = 'Configure Base URLs in Settings first.';
    }

    // Token presence hint
    const hasToken = await this.service.hasToken();
    if (!hasToken) {
      hintEl.style.display = 'block';
      hintEl.textContent = 'No Jenkins token found. Add it in Settings → Credential Management.';
    }

    const refreshEnvChoices = async () => {
      logsEl.textContent = '';
      buildLink.style.display = 'none';
      this.state.executableUrl = null;
      const baseUrl = baseUrlSelect.value;
      const job = jobInput.value.trim();
      if (!baseUrl || !job) return;
      try {
        statusEl.textContent = 'Loading ENV choices…';
        const choices = await this.service.getEnvChoices(baseUrl, job);
        this.state.envChoices = Array.isArray(choices) ? choices : [];
        envSelect.innerHTML = this.state.envChoices.map(c => `<option value="${c}">${c}</option>`).join('');
        statusEl.textContent = 'Ready';
      } catch (err) {
        statusEl.textContent = 'Failed to load choices';
        this.showError(String(err));
      }
    };

    baseUrlSelect.addEventListener('change', refreshEnvChoices);
    jobInput.addEventListener('input', () => {
      if (jobInput.value.trim().length > 0) refreshEnvChoices();
    });

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

    runBtn.addEventListener('click', async () => {
      const baseUrl = baseUrlSelect.value;
      const job = jobInput.value.trim();
      const env = envSelect.value;
      const sql = sqlInput.value.trim();

      if (!baseUrl || !job || !env) {
        this.showError('Select Base URL, enter Job, and choose ENV');
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
              subscribeToLogs();
              await this.service.streamLogs(baseUrl, job, buildNumber);
              return;
            }
            if (attempts > 30) { statusEl.textContent = 'Polling timeout'; return; }
          } catch (err) {
            statusEl.textContent = 'Polling error';
            this.showError(String(err));
            return;
          }
          setTimeout(poll, 2000);
        };
        poll();
      } catch (err) {
        statusEl.textContent = 'Trigger failed';
        this.showError(String(err));
      }
    });
  }

  onDeactivate() {
    // Cleanup listeners
    try { for (const un of this._logUnsubscribes) { un(); } } catch (_) {}
    this._logUnsubscribes = [];
  }
}