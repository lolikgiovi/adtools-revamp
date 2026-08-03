import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  buildSummary,
  createDefaultGlobalDefaults,
  createDiscoveryRequest,
  formatFieldValue,
  labelsForStream,
  mandatoryLabels,
  normalizeBaseUrl,
  normalizeIssueKey,
  normalizeProjectKey,
  normalizeLabels,
  splitValues,
} from "../service.js";

describe("Ticket Template Create service", () => {
  it("normalizes the Jira connection and issue URLs", () => {
    expect(normalizeBaseUrl("https://jira.example.com/")).toBe("https://jira.example.com");
    expect(normalizeProjectKey(" evdev ")).toBe("EVDEV");
    expect(normalizeIssueKey("https://jira.example.com/browse/EVDEV-350443")).toBe("EVDEV-350443");
  });

  it("rejects insecure remote Jira URLs and malformed issue keys", () => {
    expect(() => normalizeBaseUrl("http://jira.example.com")).toThrow("HTTPS");
    expect(() => normalizeIssueKey("EVDEV-not-a-number")).toThrow("Invalid Jira issue key");
  });

  it("builds a bounded discovery request for the configured issue types", () => {
    expect(
      createDiscoveryRequest({
        baseUrl: "https://jira.example.com",
        projectKey: "EVDEV",
        allowInvalidTls: true,
        sampleIssues: [{ key: "EVDEV-1" }, { key: "https://jira.example.com/browse/EVDEV-2" }],
      }),
    ).toEqual({
      baseUrl: "https://jira.example.com",
      projectKey: "EVDEV",
      sampleIssueKeys: ["EVDEV-1", "EVDEV-2"],
      issueTypeNames: ["BE-Sub-Task", "FE-Sub-Task"],
      allowInvalidTls: true,
    });
  });

  it("formats Jira option values for compact display", () => {
    expect(formatFieldValue({ id: "1", value: "Android" })).toBe("Android");
    expect(formatFieldValue([{ name: "API" }, { name: "Mobile" }])).toBe("API, Mobile");
  });

  it("builds enforced FE and BE summary prefixes and labels", () => {
    expect(buildSummary("ios", "Common handling")).toBe("[iOS] Common handling");
    expect(buildSummary("android", "Mobile screen")).toBe("[Android] Mobile screen");
    expect(buildSummary("web", "Dashboard screen")).toBe("[Web] Dashboard screen");
    expect(buildSummary("be", "POST service/v1/endpoint", "API")).toBe("[API] POST service/v1/endpoint");
    expect(mandatoryLabels("be", "Consumer")).toEqual(["ad_dev_task", "be_consumer"]);
    expect(mandatoryLabels("ios")).toEqual(["ad_dev_task", "fe_ios"]);
    expect(mandatoryLabels("web")).toEqual(["ad_dev_task", "fe_web"]);
  });

  it("normalizes reusable lists and calendar-day defaults", () => {
    expect(splitValues("alpha, beta\nalpha")).toEqual(["alpha", "beta"]);
    expect(normalizeLabels("feature_name, beta_2\nfeature_name")).toEqual(["feature_name", "beta_2"]);
    expect(addDaysIso("2026-07-27", 3)).toBe("2026-07-30");
  });

  it("combines editable global and feature labels by stream", () => {
    const defaults = createDefaultGlobalDefaults();
    defaults.labels.common = ["ad_dev_task"];
    defaults.labels.android = ["fe_android", "global_android"];
    expect(labelsForStream(defaults, "android", "API", ["feature_name", "global_android"])).toEqual([
      "ad_dev_task",
      "fe_android",
      "global_android",
      "feature_name",
    ]);
    expect(labelsForStream(defaults, "be", "Service", ["feature_name"])).toContain("be_service");
  });
});
