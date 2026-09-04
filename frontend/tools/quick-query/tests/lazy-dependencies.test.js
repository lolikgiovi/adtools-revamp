// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const lazyState = vi.hoisted(() => ({ zipModules: 0, zipInstances: 0, workerModules: 0, workerInstances: 0, terminated: 0 }));

vi.mock("jszip", () => {
  lazyState.zipModules += 1;
  return {
    default: class FakeZip {
      constructor() {
        lazyState.zipInstances += 1;
      }

      file() {}

      async generateAsync() {
        return new Blob(["zip"]);
      }
    },
  };
});

vi.mock("../../html-editor/minify.worker.js?worker", () => {
  lazyState.workerModules += 1;
  return {
    default: class FakeMinifyWorker {
      constructor() {
        lazyState.workerInstances += 1;
      }

      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: { success: true, result: "<p>minified</p>" } }));
      }

      terminate() {
        lazyState.terminated += 1;
      }
    },
  };
});

import { QuickQueryUI } from "../main.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.URL.createObjectURL;
  delete globalThis.URL.revokeObjectURL;
  document.body.innerHTML = "";
});

describe("Quick Query lazy dependencies", () => {
  it("loads JSZip only for split downloads and reuses the module", async () => {
    const ui = Object.assign(Object.create(QuickQueryUI.prototype), {
      splitDownloadPromise: null,
      _splitState: { chunks: ["SELECT 1"], mode: "size", value: 90, tableName: "example" },
      eventBus: { emit: vi.fn() },
      elements: { errorMessages: document.createElement("div") },
    });
    globalThis.URL.createObjectURL = vi.fn(() => "blob:split");
    globalThis.URL.revokeObjectURL = vi.fn();

    expect(lazyState.zipModules).toBe(0);
    await ui._downloadChunksAsZip();
    expect(lazyState.zipModules).toBe(1);
    expect(lazyState.zipInstances).toBe(1);

    await ui._downloadChunksAsZip();
    expect(lazyState.zipModules).toBe(1);
    expect(lazyState.zipInstances).toBe(2);
  });

  it("loads and terminates a separate minify worker per operation", async () => {
    const ui = Object.assign(Object.create(QuickQueryUI.prototype), { minifyOperationPromise: null });

    expect(lazyState.workerModules).toBe(0);
    await expect(ui._minifyHtmlWithWorker("<p>input</p>")).resolves.toBe("<p>minified</p>");
    await expect(ui._minifyHtmlWithWorker("<p>input 2</p>")).resolves.toBe("<p>minified</p>");

    expect(lazyState.workerModules).toBe(1);
    expect(lazyState.workerInstances).toBe(2);
    expect(lazyState.terminated).toBe(2);
  });

  it("coalesces duplicate split-download actions", async () => {
    const ui = Object.assign(Object.create(QuickQueryUI.prototype), { splitDownloadPromise: null });
    const release = {};
    release.promise = new Promise((resolve) => {
      release.resolve = resolve;
    });
    const internal = vi.spyOn(ui, "_downloadChunksAsZipInternal").mockReturnValue(release.promise);

    const first = ui._downloadChunksAsZip();
    const second = ui._downloadChunksAsZip();
    expect(internal).toHaveBeenCalledOnce();
    release.resolve();
    await Promise.all([first, second]);
  });
});
