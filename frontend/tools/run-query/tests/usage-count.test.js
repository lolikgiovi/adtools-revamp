// Run Query counts one Tool Use per run the user starts.
// Ways it could go wrong: a split "Execute All" queues one Jenkins build per chunk and counts each (overcount);
// a later single run after a split stays suppressed (undercount); a retried split never counts (undercount).
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { JenkinsRunner } from "../main.js";

afterEach(() => vi.restoreAllMocks());

function runner() {
  const uses = [];
  vi.spyOn(UsageTracker, "trackToolUse").mockImplementation((tool, action) => uses.push(`${tool}:${action}`));
  const tool = Object.assign(Object.create(JenkinsRunner.prototype), { _logUnsubscribes: [], state: {} });
  return { tool, uses };
}

describe("Run Query usage counting", () => {
  it("counts a split Execute All once however many chunk builds complete", () => {
    const { tool, uses } = runner();
    tool.beginSplitRunUse();
    for (let build = 1; build <= 4; build++) tool.recordRunUse({ build_number: build });
    expect(uses).toEqual(["run-query:run"]);
  });

  it("counts single runs after a split, including one that ended without cleanup", () => {
    const { tool, uses } = runner();
    tool.beginSplitRunUse();
    tool.recordRunUse({});
    tool.beginSingleRunUse();
    tool.recordRunUse({});
    tool.beginSingleRunUse();
    tool.recordRunUse({});
    expect(uses).toEqual(["run-query:run", "run-query:run", "run-query:run"]);
  });

  it("counts each Execute All click, including a retry after cleanup", () => {
    const { tool, uses } = runner();
    tool.beginSplitRunUse();
    tool.recordRunUse({});
    tool._cleanupSplitResources();
    tool.beginSplitRunUse();
    tool.recordRunUse({});
    tool.recordRunUse({});
    expect(uses).toEqual(["run-query:run", "run-query:run"]);
  });
});
