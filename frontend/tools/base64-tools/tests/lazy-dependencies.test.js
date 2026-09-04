// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const zipState = vi.hoisted(() => ({ instances: 0 }));

vi.mock("jszip", () => ({
  default: class FakeZip {
    constructor() {
      zipState.instances += 1;
    }

    file() {}

    async generateAsync() {
      return new Blob(["zip"]);
    }
  },
}));

import { Base64Tools } from "../main.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Base64Tools lazy dependencies", () => {
  it("does not load JSZip until a ZIP download and reuses it", async () => {
    const tool = new Base64Tools();
    const container = document.createElement("div");
    container.innerHTML = `
      <div id="encode-processed-files" style="display: block"></div>
      <div id="encode-processed-container"><div class="file-card"></div></div>
    `;
    document.body.appendChild(container);
    tool.container = container;
    tool.selectedFiles = new Map([["file-1", { file: new File(["hello"], "hello.txt", { type: "text/plain" }), mode: "encode" }]]);
    tool.downloadBlob = vi.fn();
    tool.showSuccess = vi.fn();
    tool.showError = vi.fn();

    expect(zipState.instances).toBe(0);

    await tool.downloadResult("encode");
    expect(zipState.instances).toBe(1);

    await tool.downloadResult("encode");
    expect(zipState.instances).toBe(2);
  });

  it("coalesces duplicate downloads while the first action is pending", async () => {
    const tool = Object.assign(Object.create(Base64Tools.prototype), { activeDownloadPromises: new Map() });
    const release = {};
    release.promise = new Promise((resolve) => {
      release.resolve = resolve;
    });
    const operation = vi.spyOn(tool, "_downloadResult").mockImplementation(() => release.promise);

    const first = tool.downloadResult("encode");
    const second = tool.downloadResult("encode");
    expect(operation).toHaveBeenCalledOnce();

    release.resolve();
    await Promise.all([first, second]);
  });
});
