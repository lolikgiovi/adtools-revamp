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

// Failures: a process the user starts that produces nothing is recorded with a bounded category.
// Ways it could go wrong: invalid JSON is not recorded; the editor text leaks into the failure; it counts as a use.
describe("JSON Tools failures", () => {
  it("records invalid JSON as an invalid_input failure without content", () => {
    const failures = [];
    vi.spyOn(UsageTracker, "trackToolUse").mockImplementation(() => {});
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    vi.spyOn(UsageTracker, "trackFailure").mockImplementation((id, action, error) => failures.push([id, action, error]));
    const tool = Object.assign(Object.create(JSONTools.prototype), {
      inputSource: "typed",
      currentTab: "extract-keys",
      editor: { getValue: () => '{"secret": ' },
      showError: vi.fn(),
    });
    tool.prettifyJSON();
    expect(failures).toEqual([["json-tools", "prettify", "invalid_input"]]);
  });
});
