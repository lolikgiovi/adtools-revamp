import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/Runtime.js";

export class RunBatchService {
  loadJenkinsUrl() {
    try {
      const raw = localStorage.getItem("config.jenkins.url");
      return raw || "";
    } catch (_) {
      return "";
    }
  }

  loadUsername() {
    try {
      return localStorage.getItem("config.jenkins.username") || "";
    } catch (_) {
      return "";
    }
  }

  async hasToken() {
    if (!isTauri()) return false;
    try {
      const username = this.loadUsername();
      return await invoke("has_jenkins_token", { username });
    } catch (_) {
      return false;
    }
  }

  async getEnvChoices(baseUrl) {
    if (!isTauri()) {
      // Return mock data for web development/testing
      return ["dev1", "dev2", "sit1", "sit2", "uat", "prod"];
    }
    const username = this.loadUsername();
    return await invoke("jenkins_get_env_choices", { baseUrl, job: "tester-batch-manual-trigger", username });
  }

  async triggerBatchJob(baseUrl, env, batchName, jobName) {
    if (!isTauri()) throw new Error("Batch job is only available in the desktop app.");
    const username = this.loadUsername();
    return await invoke("jenkins_trigger_batch_job", { baseUrl, env, batchName, jobName, username });
  }

  async pollQueue(baseUrl, queueUrl) {
    if (!isTauri()) throw new Error("Job execution is only available in the desktop app.");
    const username = this.loadUsername();
    const [buildNumber, executableUrl] = await invoke("jenkins_poll_queue_for_build", {
      baseUrl,
      queueUrl,
      username,
    });
    return { buildNumber, executableUrl };
  }

  async streamLogs(baseUrl, buildNumber) {
    if (!isTauri()) throw new Error("Log streaming is only available in the desktop app.");
    const username = this.loadUsername();
    await invoke("jenkins_stream_logs", { baseUrl, job: "tester-batch-manual-trigger", buildNumber, username });
  }
}
