// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityTracker } from "../CapabilityTracker.js";
import { UsageTracker } from "../UsageTracker.js";
import { EventBus } from "../EventBus.js";
import { capabilities } from "../../config/capabilities.js";
import toolsConfig from "../../config/tools.json";

// Failure modes: offscreen/hidden/disabled controls count as available exposure; repeated scans
// inflate reach; an import-dialog click is treated as successful import; outcomes leak data;
// existing outcome + success ledger double count; observer/listeners survive disposal; tools lack a catalogue.
let tracker, bus, spy, observer;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback) {
        this.callback = callback;
        observer = this;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  bus = new EventBus();
  spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
  document.body.innerHTML =
    '<main class="main-content"><div data-tool-root="quick-query"><button id="importExcel">Import Excel</button></div></main>';
  tracker = new CapabilityTracker(bus);
  bus.emit("page:changed", { page: "tool", toolId: "quick-query" });
});
afterEach(() => {
  tracker.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("capability adoption signals", () => {
  it("catalogues meaningful capabilities for every registered tool", () => {
    for (const tool of toolsConfig.tools)
      expect(
        capabilities.some((item) => item.tool === tool.id),
        tool.id,
      ).toBe(true);
    expect(new Set(capabilities.map((item) => `${item.tool}:${item.id}`)).size).toBe(capabilities.length);
  });
  it("separates discovering Excel import from actually importing data", () => {
    document.querySelector("button").click();
    expect(spy).toHaveBeenCalledWith("quick-query", "capability_opened", expect.objectContaining({ capability: "import_excel" }));
    expect(spy.mock.calls.some((call) => call[1] === "capability_succeeded")).toBe(false);
    bus.emit("usage:event", {
      featureId: "quick-query",
      action: "excel_import_result",
      meta: { outcome: "success", row_count: 20, file_name: "rates.xlsx", table_name: "APP.CONFIG", message: "SECRET" },
    });
    expect(spy).toHaveBeenCalledWith(
      "quick-query",
      "capability_succeeded",
      expect.objectContaining({ capability: "import_excel", row_count: 20 }),
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET");
  });
  it("requires sustained visible exposure and deduplicates within the visit", () => {
    const target = document.querySelector("button");
    observer.callback([{ target, isIntersecting: true, intersectionRatio: 0.6 }]);
    vi.advanceTimersByTime(999);
    expect(spy.mock.calls.some((call) => call[1] === "capability_exposed")).toBe(false);
    vi.advanceTimersByTime(1);
    observer.callback([{ target, isIntersecting: true, intersectionRatio: 0.6 }]);
    vi.advanceTimersByTime(2000);
    expect(spy.mock.calls.filter((call) => call[1] === "capability_exposed")).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(
      "quick-query",
      "capability_exposed",
      expect.objectContaining({ capability: "import_excel", available: true }),
    );
  });
  it("cancels pending exposure when a control leaves the viewport or the document hides", () => {
    const target = document.querySelector("button");
    observer.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]);
    vi.advanceTimersByTime(500);
    observer.callback([{ target, isIntersecting: false, intersectionRatio: 0 }]);
    vi.advanceTimersByTime(2000);
    expect(spy.mock.calls.some((call) => call[1] === "capability_exposed")).toBe(false);
  });
  it("does not turn failed imports into adoption, or duplicate successful tool-use outcomes", () => {
    bus.emit("usage:event", {
      featureId: "quick-query",
      action: "oracle_import_result",
      meta: { outcome: "failed", reason: "query_rejected" },
    });
    expect(spy).toHaveBeenCalledWith(
      "quick-query",
      "capability_failed",
      expect.objectContaining({ capability: "import_oracle_rows", reason: "query_rejected" }),
    );
    bus.emit("usage:event", { featureId: "quick-query", action: "schema_load", meta: { automatic: true } });
    expect(spy.mock.calls.some((call) => call[1] === "capability_succeeded")).toBe(false);
    bus.emit("usage:toolUse", { tool_id: "velocity-template", action: "render", meta: { input: "SECRET" } });
    bus.emit("usage:event", { featureId: "velocity-template", action: "render_result", meta: { outcome: "valid" } });
    expect(spy.mock.calls.filter((call) => call[1] === "capability_succeeded")).toHaveLength(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET");
  });
  // Failure modes: settings visits disappear; configuration is misreported as completion;
  // failed renders count as success; ignored outcome mappings leak unsupported stages.
  it("tracks settings capability visits and project outcomes without tool-use totals", () => {
    bus.emit("page:changed", { page: "settings" });
    expect(spy).toHaveBeenCalledWith("settings", "capability_visit", expect.objectContaining({ schema_version: 1 }));
    bus.emit("usage:event", { featureId: "settings", action: "project_create_result", meta: { outcome: "success" } });
    expect(spy).toHaveBeenCalledWith("settings", "capability_succeeded", expect.objectContaining({ capability: "create_project" }));
    bus.emit("usage:event", { featureId: "settings", action: "project_switch_result", meta: { outcome: "blocked" } });
    expect(spy).toHaveBeenCalledWith("settings", "capability_blocked", expect.objectContaining({ capability: "switch_project" }));
  });
  it("maps existing saved-batch and character mode events to meaningful stages", () => {
    bus.emit("usage:event", { featureId: "run-batch", action: "config_saved", meta: {} });
    expect(spy).toHaveBeenCalledWith("run-batch", "capability_succeeded", expect.objectContaining({ capability: "saved_batches" }));
    bus.emit("usage:event", { featureId: "char-counter", action: "mode_changed", meta: { mode: "rows" } });
    expect(spy).toHaveBeenCalledWith("char-counter", "capability_configured", expect.objectContaining({ capability: "per_row" }));
  });
  it("records PlantUML failures without counting them as render completions", () => {
    bus.emit("usage:event", { featureId: "plantuml", action: "render_result", meta: { outcome: "failure", reason: "render_error" } });
    expect(spy).toHaveBeenCalledWith("plantuml", "capability_failed", expect.objectContaining({ capability: "local_render" }));
    expect(spy.mock.calls.some((call) => call[1] === "capability_succeeded")).toBe(false);
  });
  it("does not emit capability events for non-stage context mappings", () => {
    bus.emit("usage:event", { featureId: "quick-query", action: "query_generated", meta: { row_count: 4 } });
    expect(spy.mock.calls.some((call) => call[1] === "capability_context")).toBe(false);
  });
});
