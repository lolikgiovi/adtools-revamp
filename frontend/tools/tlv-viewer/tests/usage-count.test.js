// TLV Viewer counts a Tool Use only when the user asks for a parse.
// Ways it could go wrong: reopening the tool re-parses saved input and counts again (overcount);
// an explicit parse, shortcut or paste never counts (undercount).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { TLVViewerService } from "../service.js";
import { TLVViewer } from "../main.js";

let uses;

beforeEach(() => {
  localStorage.clear();
  uses = [];
  vi.spyOn(UsageTracker, "trackToolUse").mockImplementation((tool, action) => uses.push(`${tool}:${action}`));
  vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const tool = new TLVViewer(null);
  tool.mount(container);
  return { tool, container };
}

describe("TLV Viewer usage counting", () => {
  it("does not count the automatic re-parse of saved input when the tool opens", () => {
    localStorage.setItem("tool:tlv-viewer:input", TLVViewerService.buildQrisSample());
    localStorage.setItem("tool:tlv-viewer:format", "qris");

    const first = mount();
    first.tool.unmount();
    mount();

    expect(uses).toEqual([]);
  });

  it("counts each explicit parse from the button and the shortcut", () => {
    const { container } = mount();
    container.querySelector("#tlv-input").value = TLVViewerService.buildQrisSample();

    container.querySelector("#tlv-parse-btn").click();
    container.querySelector("#tlv-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }));

    expect(uses).toEqual(["tlv-viewer:parse", "tlv-viewer:parse"]);
  });
});

describe("TLV Viewer sample data", () => {
  it("does not count loading a sample", () => {
    const { container } = mount();
    container.querySelector("#tlv-sample-btn").click();
    container.querySelector("#tlv-sample-ber-btn").click();
    expect(uses).toEqual([]);
  });
});

// Failures: a parse the user asks for that cannot read the input is recorded; restored input that fails is not.
describe("TLV Viewer failures", () => {
  it("records a failed explicit parse, not a failed restore", () => {
    const failures = [];
    vi.spyOn(UsageTracker, "trackFailure").mockImplementation((id, action, error) => failures.push([id, action, error]));
    localStorage.setItem("tool:tlv-viewer:input", "ZZ-not-tlv");
    localStorage.setItem("tool:tlv-viewer:format", "ber-hex");
    const { container } = mount();
    expect(failures).toEqual([]);
    container.querySelector("#tlv-parse-btn").click();
    expect(failures).toEqual([["tlv-viewer", "parse", "invalid_input"]]);
  });
});
