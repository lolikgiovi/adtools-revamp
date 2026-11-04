// Compare Config reports what a comparison found and what people did with it.
// Ways it could go wrong: the comparison use carries only the row total, not how many rows matched, differed or exist
// on one side; exporting or copying the diff goes unrecorded; a failed export or comparison is not a failure, or
// carries the error text, file name or predicate; an export with no results reports success.
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { CompareConfigService } from "../service.js";
import { CompareConfigTool } from "../main.js";
import { buildCompareConfigUseMeta } from "../lib/compare-config-analytics.js";

afterEach(() => vi.restoreAllMocks());

const result = {
  rows: [{ status: "match" }, { status: "differ" }, { status: "differ" }, { status: "only_in_env1" }],
  summary: { matches: 1, differs: 2, only_in_env1: 1, only_in_env2: 0 },
};

function tool() {
  const events = [];
  const failures = [];
  vi.spyOn(UsageTracker, "trackEvent").mockImplementation((id, event, meta) => events.push({ event, meta }));
  vi.spyOn(UsageTracker, "trackFailure").mockImplementation((id, action, error, meta) => failures.push({ action, error, meta }));
  const instance = Object.assign(Object.create(CompareConfigTool.prototype), {
    queryMode: "unified",
    results: { unified: result },
    eventBus: { emit: vi.fn() },
    showError: vi.fn(),
    showSuccess: vi.fn(),
  });
  return { instance, events, failures };
}

describe("Compare Config insight", () => {
  it("puts match, differ and one-sided counts on the comparison use", () => {
    expect(buildCompareConfigUseMeta(result, ["ID"], ["A", "B"])).toEqual({
      rows_compared: 4,
      rows_match: 1,
      rows_differ: 2,
      rows_only_a: 1,
      rows_only_b: 0,
      diff_count: 3,
      pk_fields: 1,
      compare_fields: 2,
    });
  });

  it("records an export with its format and row count, and a failed export as a failure", async () => {
    const { instance, events, failures } = tool();
    vi.spyOn(CompareConfigService, "exportComparisonResult")
      .mockResolvedValueOnce({ content: "a,b", filename: "secret-file.csv" })
      .mockRejectedValueOnce(new Error("disk full: secret-file.csv"));
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    await instance.exportResults("csv");
    await instance.exportResults("json");
    expect(events).toEqual([{ event: "diff_exported", meta: { format: "csv", row_count: 4 } }]);
    expect(failures).toEqual([{ action: "export", error: expect.any(Error), meta: { format: "json" } }]);
    expect(JSON.stringify([events, failures.map((item) => item.meta)])).not.toContain("secret");
  });

  it("does not record an export when there are no results", async () => {
    const { instance, events, failures } = tool();
    instance.results = {};
    await instance.exportResults("csv");
    expect([events, failures]).toEqual([[], []]);
  });

  it("records copying the diff predicate only when the copy succeeds", async () => {
    const { instance, events } = tool();
    instance.copyToClipboard = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await instance.copyDiffPredicate("ID IN (1, 2)", null, 3);
    await instance.copyDiffPredicate("ID IN (1, 2)", null, 3);
    expect(events).toEqual([{ event: "diff_copied", meta: { format: "predicate", row_count: 3 } }]);
  });

  it("records a failed comparison with its mode and never the message", () => {
    const { instance, failures } = tool();
    const error = new Error("ORA-00942: table SECRET.T does not exist");
    instance.reportComparisonFailure(error, "unified_oracle_excel");
    expect(failures).toEqual([{ action: "compare", error, meta: { mode: "unified_oracle_excel" } }]);
  });
});
