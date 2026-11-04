// Char Counter counts one Tool Use when the user brings text to count.
// Ways it could go wrong: opening the tool with a restored draft counts (overcount);
// typing or pasting after a restored draft never counts (undercount); every keystroke counts (overcount).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { CharCounter } from "../main.js";

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

function mount(tool = new CharCounter(null)) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  tool.mount(container);
  return { tool, container };
}

function type(container, text) {
  const input = container.querySelector("#charCounterInput");
  input.value += text;
  input.dispatchEvent(new Event("input"));
}

describe("Char Counter usage counting", () => {
  it("does not count a restored draft when the tool opens", () => {
    localStorage.setItem("tool:char-counter:text", "left over from yesterday");
    mount();
    expect(uses).toEqual([]);
  });

  it("counts once when the user edits a restored draft", () => {
    localStorage.setItem("tool:char-counter:text", "left over");
    const { container } = mount();
    type(container, " a");
    type(container, "b");
    expect(uses).toEqual(["char-counter:count"]);
  });

  it("counts typing once per session, not per keystroke", () => {
    const { container } = mount();
    for (const key of ["h", "e", "y"]) type(container, key);
    expect(uses).toEqual(["char-counter:count"]);
  });
});
