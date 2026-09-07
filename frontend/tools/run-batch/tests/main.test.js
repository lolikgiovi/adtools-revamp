// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../../../core/KeychainMigration.js", () => ({
  ensureUnifiedKeychain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: {
    enrichErrorMeta: vi.fn((_error, meta) => meta),
    trackEvent: vi.fn(),
    trackToolUse: vi.fn(),
  },
}));

import { RunBatch } from "../main.js";

const SAVED_CONFIGS_KEY = "tool:run-batch:savedConfigs";
const LAST_ENVIRONMENT_KEY = "tool:run-batch:lastEnvironment";

async function mountRunBatch(environments = ["dev1", "sit1", "uat"]) {
  const tool = new RunBatch();
  tool.container = document.createElement("div");
  tool.container.innerHTML = tool.render();
  tool.service = {
    hasToken: vi.fn().mockResolvedValue(true),
    loadJenkinsUrl: vi.fn(() => "https://jenkins.example.com"),
    getEnvChoices: vi.fn().mockResolvedValue(environments),
  };

  await tool.onMount();
  return tool;
}

describe("Run Batch saved state", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("restores and updates the last selected environment", async () => {
    localStorage.setItem(LAST_ENVIRONMENT_KEY, "sit1");
    const tool = await mountRunBatch();
    const environmentSelect = tool.container.querySelector("#rb-env");

    expect(environmentSelect.value).toBe("sit1");

    environmentSelect.value = "uat";
    environmentSelect.dispatchEvent(new Event("change"));

    expect(localStorage.getItem(LAST_ENVIRONMENT_KEY)).toBe("uat");
  });

  it("stores the selected environment with a saved config", async () => {
    const tool = await mountRunBatch();
    const container = tool.container;

    container.querySelector("#rb-env").value = "sit1";
    container.querySelector("#rb-batch-name").value = "campaign-batch";
    container.querySelector("#rb-job-name").value = "campaign-job";
    container.querySelector("#rb-save-btn").click();
    container.querySelector("#rb-config-name").value = "SIT campaign";
    container.querySelector("#rb-save-modal-confirm").click();

    expect(JSON.parse(localStorage.getItem(SAVED_CONFIGS_KEY))).toEqual([
      expect.objectContaining({
        name: "SIT campaign",
        environment: "sit1",
        batchName: "campaign-batch",
        jobName: "campaign-job",
      }),
    ]);
    expect(localStorage.getItem(LAST_ENVIRONMENT_KEY)).toBe("sit1");
  });

  it("restores a saved config's environment and remembers it as the last environment", async () => {
    localStorage.setItem(
      SAVED_CONFIGS_KEY,
      JSON.stringify([
        {
          id: "saved-sit-config",
          name: "SIT campaign",
          environment: "sit1",
          batchName: "campaign-batch",
          jobName: "campaign-job",
        },
      ]),
    );
    const tool = await mountRunBatch();

    tool.container.querySelector(".rb-load-btn").click();

    expect(tool.container.querySelector("#rb-env").value).toBe("sit1");
    expect(tool.container.querySelector("#rb-batch-name").value).toBe("campaign-batch");
    expect(tool.container.querySelector("#rb-job-name").value).toBe("campaign-job");
    expect(localStorage.getItem(LAST_ENVIRONMENT_KEY)).toBe("sit1");
  });
});
