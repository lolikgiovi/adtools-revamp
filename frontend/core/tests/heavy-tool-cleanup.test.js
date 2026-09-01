// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("../MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQuery } from "../../tools/quick-query/main.js";
import { CompareConfigTool } from "../../tools/compare-config/main.js";
import { JenkinsRunner } from "../../tools/run-query/main.js";

const { terminateDiffWorker } = vi.hoisted(() => ({ terminateDiffWorker: vi.fn() }));
vi.mock("../../tools/compare-config/lib/diff-worker-manager.js", () => ({
  getDiffWorkerManager: () => ({ terminate: terminateDiffWorker }),
}));

describe("real heavy-tool cleanup hooks", () => {
  it("releases editors, workers, subscriptions, and retained data", () => {
    const destroy = vi.fn();
    const quickQuery = Object.assign(Object.create(QuickQuery.prototype), { ui: { destroy } });
    quickQuery.onUnmount();
    expect(destroy).toHaveBeenCalledWith({ flush: true });
    expect(quickQuery.ui).toBeNull();

    const unsubscribe = vi.fn();
    const cleanup = vi.fn();
    const compareConfig = Object.assign(Object.create(CompareConfigTool.prototype), {
      _documentListenerCleanups: [cleanup],
      _sidecarStatusUnsubscribe: unsubscribe,
      results: { unified: { rows: [1] } },
      unified: { sourceA: { data: [1] }, sourceB: { data: [2] } },
    });
    compareConfig.onUnmount();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(terminateDiffWorker).toHaveBeenCalledOnce();
    expect(compareConfig.results).toEqual({ unified: null });
    expect(compareConfig.unified.sourceA.data).toBeNull();

    const disposeEditor = vi.fn();
    const splitCleanup = vi.fn();
    const runner = Object.assign(Object.create(JenkinsRunner.prototype), {
      _cleanupSplitResources: splitCleanup,
      _sidebarUnsubs: [],
      editor: { dispose: disposeEditor },
      templateEditor: null,
    });
    runner.onUnmount();
    expect(splitCleanup).toHaveBeenCalledWith({ hideIndicator: true });
    expect(disposeEditor).toHaveBeenCalledOnce();
    expect(runner.editor).toBeNull();
  });
});
