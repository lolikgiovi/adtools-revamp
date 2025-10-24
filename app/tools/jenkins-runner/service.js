import { invoke } from '@tauri-apps/api/core';

export class JenkinsRunnerService {
  loadBaseUrls() {
    try {
      const raw = localStorage.getItem('config.baseUrls');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(p => p && p.key && p.value) : [];
    } catch (_) {
      return [];
    }
  }

  async hasToken() {
    try { return await invoke('has_jenkins_token'); } catch (_) { return false; }
  }

  async getEnvChoices(baseUrl, job) {
    return await invoke('jenkins_get_env_choices', { baseUrl, job });
  }

  async triggerJob(baseUrl, job, env, sqlText) {
    const queueUrl = await invoke('jenkins_trigger_job', { baseUrl, job, env, sql_text: sqlText });
    return queueUrl;
  }

  async pollQueue(baseUrl, queueUrl) {
    const [buildNumber, executableUrl] = await invoke('jenkins_poll_queue_for_build', { base_url: baseUrl, queue_url: queueUrl });
    return { buildNumber, executableUrl };
  }

  async streamLogs(baseUrl, job, buildNumber) {
    await invoke('jenkins_stream_logs', { base_url: baseUrl, job, build_number: buildNumber });
  }
}