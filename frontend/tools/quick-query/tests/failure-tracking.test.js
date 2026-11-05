import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { UsageTracker } from "../../../core/UsageTracker.js";
import { QuickQueryUI } from "../main.js";

// Quick Query records a failure when a generation the user starts produces no SQL.
// Ways it could go wrong: a failed generation records nothing; a cancelled one counts as a failure;
// a stale request that lost to a newer one is reported; the error message leaks.
afterEach(() => vi.restoreAllMocks());

function ui(generate) {
  const failures = [];
  vi.spyOn(UsageTracker, "trackFailure").mockImplementation((id, action, error) => failures.push([id, action, failureName(error)]));
  const instance = Object.assign(Object.create(QuickQueryUI.prototype), {
    queryExecutionService: { generateQuery: generate },
    elements: {},
    processedFiles: [],
    editor: { setValue: vi.fn() },
    _showProgress: vi.fn(),
    _hideProgress: vi.fn(),
    _updateProgress: vi.fn(),
    showError: vi.fn(),
    scheduleActiveTabDraftSave: vi.fn(),
  });
  return { instance, failures };
}
const failureName = (error) => (typeof error === "string" ? error : error?.message);

describe("Quick Query failures", () => {
  it("records a failed generation under its query type", async () => {
    const { instance, failures } = ui(vi.fn().mockRejectedValue(new Error("Primary key missing")));
    await instance._generateQuery("APP.CONFIG", "merge", [], [["h"], ["v"]]);
    expect(failures).toEqual([["quick-query", "merge", "Primary key missing"]]);
  });

  it("does not record a cancelled generation", async () => {
    const { instance, failures } = ui(vi.fn().mockRejectedValue(new Error("Generation cancelled")));
    await instance._generateQuery("APP.CONFIG", "insert", [], [["h"], ["v"]]);
    expect(failures).toEqual([]);
  });

  it("records input that fails validation before generation as invalid_input", async () => {
    const { instance, failures } = ui(vi.fn());
    Object.assign(instance, {
      elements: { tableNameInput: { value: "" } },
      getQueryTypeValue: () => "update",
    });
    await instance.handleGenerateQuery();
    expect(failures).toEqual([["quick-query", "update", "invalid_input"]]);
  });
});
