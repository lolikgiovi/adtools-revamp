// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

describe("Monaco standard capabilities", () => {
  let editor;
  let createOracleEditor;

  beforeAll(async () => {
    globalThis.CSS ??= {};
    globalThis.CSS.escape ??= (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    window.matchMedia = vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      backingStorePixelRatio: 1,
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
      measureText: vi.fn(() => ({ width: 8 })),
      webkitBackingStorePixelRatio: 1,
    }));
    ({ createOracleEditor } = await import("../MonacoOracle.js"));
  }, 30000);

  afterEach(() => {
    editor?.dispose();
    editor = undefined;
    document.body.replaceChildren();
  });

  it("registers the standard Find and Replace actions", () => {
    const container = document.createElement("div");
    document.body.append(container);

    editor = createOracleEditor(container, { automaticLayout: false });

    expect(editor.getAction("actions.find")).not.toBeNull();
    expect(editor.getAction("editor.action.startFindReplaceAction")).not.toBeNull();
  });
});
