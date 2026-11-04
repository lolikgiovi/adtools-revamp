// JSON Tools counts one Tool Use per successful process; using that output is a supporting event.
// Ways it could go wrong: copying or exporting the result counts a second use (overcount);
// the process itself stops counting (undercount); the copy stops being recorded for outcome reports.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("monaco-editor/esm/vs/editor/editor.main.js", () => ({}));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({ default: class {} }));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({ default: class {} }));

const { UsageTracker } = await import("../../../core/UsageTracker.js");
const { JSONTools } = await import("../main.js");

afterEach(() => vi.restoreAllMocks());

describe("JSON Tools usage counting", () => {
  it("counts a prettify followed by copy and export as one use", () => {
    const uses = [];
    const events = [];
    vi.spyOn(UsageTracker, "trackToolUse").mockImplementation((tool, action) => uses.push(`${tool}:${action}`));
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation((tool, event) => events.push(`${tool}:${event}`));
    const tool = Object.assign(Object.create(JSONTools.prototype), { inputSource: "typed", currentTab: "prettify" });

    tool.trackProcessSuccess("prettify", '{"a":1}', '{\n  "a": 1\n}');
    tool.trackOutputUsed("copy_output");
    tool.trackOutputUsed("export_excel");

    expect(uses).toEqual(["json-tools:prettify"]);
    expect(events.filter((event) => event === "json-tools:output_used")).toHaveLength(2);
  });
});
