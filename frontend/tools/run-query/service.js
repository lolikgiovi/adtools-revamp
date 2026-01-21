import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/Runtime.js";

export class JenkinsRunnerService {
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

  async getEnvChoices(baseUrl, job) {
    if (!isTauri()) {
      // Return mock data for web development/testing
      if (job === "tester-execute-query") {
        return ["UAT", "PROD"];
      }
      return ["DEV", "SIT", "UAT"];
    }
    const username = this.loadUsername();
    return await invoke("jenkins_get_env_choices", { baseUrl, job, username });
  }

  async triggerJob(baseUrl, job, env, sqlText) {
    if (!isTauri()) throw new Error("Job execution is only available in the desktop app.");
    const username = this.loadUsername();
    return await invoke("jenkins_trigger_job", { baseUrl, job, env, sqlText, username });
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

  async streamLogs(baseUrl, job, buildNumber) {
    if (!isTauri()) throw new Error("Log streaming is only available in the desktop app.");
    const username = this.loadUsername();
    await invoke("jenkins_stream_logs", { baseUrl, job, buildNumber, username });
  }
}
