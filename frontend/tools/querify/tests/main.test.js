// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { QuerifyTool } from "../main.js";

vi.mock("../../../core/MonacoOracle.js", () => ({
  createOracleEditor: () => ({
    dispose: () => {},
    layout: () => {},
    setValue: () => {},
  }),
  ensureMonacoWorkers: () => {},
  setupMonacoOracle: () => {},
}));

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: {
    trackEvent: () => {},
  },
}));

describe("QuerifyTool lifecycle", () => {
  it("constructs without running DOM event binding during BaseTool init", () => {
    expect(() => new QuerifyTool()).not.toThrow();
  });
});
