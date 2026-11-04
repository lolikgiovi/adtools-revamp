// HTML Template counts format, minify and copy as Tool Uses; opening the VTL variables panel is a supporting event.
// Ways it could go wrong: extracting VTL variables counts a use (overcount); format, minify or copy stop counting (undercount).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("monaco-editor/esm/vs/editor/editor.main.js", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/html/html.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/language/html/monaco.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({ default: class {} }));
vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({ default: class {} }));
vi.mock("monaco-editor/esm/vs/language/html/html.worker?worker", () => ({ default: class {} }));
vi.mock("../minify.worker.js?worker", () => ({ default: class {} }));

const { UsageTracker } = await import("../../../core/UsageTracker.js");
const { HTMLTemplateTool } = await import("../main.js");

afterEach(() => vi.restoreAllMocks());

describe("HTML Template usage counting", () => {
  it("counts format, minify and copy but not VTL extraction", () => {
    const uses = [];
    vi.spyOn(UsageTracker, "trackToolUse").mockImplementation((id, action) => uses.push(`${id}:${action}`));
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const tool = Object.create(HTMLTemplateTool.prototype);
    for (const event of ["format_action", "minify_action", "copy_html", "vtl_extract"]) tool.trackAnalytics(event, {});
    expect(uses).toEqual(["html-template:format", "html-template:minify", "html-template:copy"]);
  });
});
