// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { JenkinsRunner } from "../main.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Run Query suggestion listener lifecycle", () => {
  it("removes only its stored document callback on hard unmount", () => {
    const listener = vi.fn();
    const runner = Object.assign(Object.create(JenkinsRunner.prototype), {
      _cleanupSplitResources: vi.fn(),
      _sidebarUnsubs: [],
      _suggestionsDocumentListener: listener,
      editor: null,
      templateEditor: null,
    });
    const removeSpy = vi.spyOn(document, "removeEventListener");

    runner.onUnmount();
    runner.onUnmount();

    expect(removeSpy).toHaveBeenCalledWith("click", listener);
    expect(removeSpy.mock.calls.filter(([eventName, callback]) => eventName === "click" && callback === listener)).toHaveLength(1);
    expect(runner._suggestionsDocumentListener).toBeNull();
  });
});
