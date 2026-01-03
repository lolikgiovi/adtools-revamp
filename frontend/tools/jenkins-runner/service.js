import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../core/Runtime.js';

export class JenkinsRunnerService {
  loadJenkinsUrl() {
    try {
      const raw = localStorage.getItem('config.jenkins.url');
      return raw || '';
    } catch (_) {
      return '';
    }
  }

  async hasToken() {
    if (!isTauri()) return false;
    try {
      return await invoke('has_jenkins_token');
    } catch (_) {
      return false;
    }
  }

  async getEnvChoices(baseUrl, job) {
    if (!isTauri()) {
      // Return mock data for web development/testing
      if (job === 'tester-execute-query') {
        return ['UAT', 'PROD'];
      }
      return ['DEV', 'SIT', 'UAT'];
    }
    return await invoke('jenkins_get_env_choices', { baseUrl, job });
  }

  async triggerJob(baseUrl, job, env, sqlText) {
    if (!isTauri()) throw new Error('Job execution is only available in the desktop app.');
    return await invoke('jenkins_trigger_job', { baseUrl, job, env, sqlText });
  }

  async pollQueue(baseUrl, queueUrl) {
    if (!isTauri()) throw new Error('Job execution is only available in the desktop app.');
    const [buildNumber, executableUrl] = await invoke('jenkins_poll_queue_for_build', {
      baseUrl,
      queueUrl,
    });
    return { buildNumber, executableUrl };
  }

  async streamLogs(baseUrl, job, buildNumber) {
    if (!isTauri()) throw new Error('Log streaming is only available in the desktop app.');
    await invoke('jenkins_stream_logs', { baseUrl, job, buildNumber });
  }
}