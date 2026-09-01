import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  buildSummary,
  buildTicketBundle,
  buildTicketPreview,
  createDefaultGlobalDefaults,
  createDiscoveryRequest,
  formatFieldValue,
  labelsForStream,
  mergeGlobalDefaults,
  mandatoryLabels,
  normalizeBaseUrl,
  normalizeIssueKey,
  normalizeProjectKey,
  normalizeLabels,
  resolveFeatureConfiguration,
  splitValues,
} from "../service.js";

describe("Ticket Template service", () => {
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

  it("resolves sparse feature overrides over complete global defaults", () => {
    const defaults = mergeGlobalDefaults({
      shared: { priorityId: "4", squadId: "squad-global" },
      people: { streams: { ios: { developer: "global-dev", developerLead: "global-lead" } } },
    });
    const effective = resolveFeatureConfiguration(defaults, {
      featureLabels: ["feature-one"],
      overrides: {
        shared: { squadId: "squad-feature" },
        people: { streams: { ios: { developer: "feature-dev" } } },
        dateRule: { deadlineOffsetDays: 5 },
      },
    });

    expect(effective.shared).toMatchObject({ priorityId: "4", squadId: "squad-feature" });
    expect(effective.people.streams.ios).toMatchObject({ developer: "feature-dev", developerLead: "global-lead" });
    expect(effective.dateRule).toEqual({ startOffsetDays: 0, deadlineOffsetDays: 5 });
    expect(effective.featureLabels).toEqual(["feature-one"]);
  });

  it("uses the same stream, summary, and label rules for preview and Jira bundles", () => {
    const defaults = createDefaultGlobalDefaults();
    const preview = buildTicketPreview({
      streams: ["ios", "android"],
      summaries: { mobile: "Build transfer flow" },
      globalDefaults: defaults,
      featureLabels: ["transfer"],
      parentKey: "EVDEV-123",
    });
    const bundle = buildTicketBundle({
      streams: ["ios", "android"],
      summaries: { mobile: "Build transfer flow" },
      issueTypeIds: { ios: "fe", android: "fe" },
      globalDefaults: defaults,
      featureLabels: ["transfer"],
      shared: {
        adStoryPointId: "3",
        squadId: "1",
        releaseId: "2",
        startDate: "2026-09-01",
        deadline: "2026-09-04",
        taskTriggerId: "5",
      },
      people: {
        common: { saAdLead: "lead", saAdSubLeads: "sublead" },
        streams: {
          ios: { developer: "ios-dev", developerLead: "ios-lead", developerSubLeads: "ios-sub" },
          android: { developer: "android-dev", developerLead: "android-lead", developerSubLeads: "android-sub" },
        },
      },
    });

    expect(bundle.map(({ summary, labels }) => ({ summary, labels }))).toEqual(preview.map(({ summary, labels }) => ({ summary, labels })));
    expect(bundle[0]).toMatchObject({ summary: "[iOS] Build transfer flow", developer: "ios-dev" });
    expect(bundle[1].summary).toBe("[Android] Build transfer flow");
  });

  it("enforces mutually exclusive stream modes at the module interface", () => {
    expect(() => buildTicketPreview({ streams: ["be", "ios"] })).toThrow("either FE or BE");
    expect(() => buildTicketPreview({ streams: ["web", "android"] })).toThrow("Web is a standalone");
  });
});
