// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Base64Tools } from "../main.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Base64Tools single-file text decoding", () => {
  it("shows decoded text directly instead of presenting a download card", async () => {
    const tool = new Base64Tools();
    const container = document.createElement("div");
    container.innerHTML = `
      <div id="decode-processed-files" style="display: none">
        <div id="decode-processed-container"></div>
      </div>
      <textarea id="decode-output"></textarea>
      <button id="decode-copy-btn"></button>
      <button id="decode-download-btn">Download</button>
    `;
    document.body.appendChild(container);

    const output = container.querySelector("#decode-output");
    Object.defineProperty(output, "scrollHeight", { configurable: true, value: 900 });
    output.getBoundingClientRect = vi.fn(() => ({ top: 400 }));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(1000);

    tool.container = container;
    tool.selectedFiles = new Map([
      ["file-1", { file: new File(["SGVsbG8sIHdvcmxkIQ=="], "message.txt", { type: "text/plain" }), mode: "decode" }],
    ]);
    tool.processFileForMultiple = vi.fn().mockResolvedValue("Hello, world!");
    tool.trackAnalytics = vi.fn();

    await tool.processMultipleFiles("decode");

    expect(output.value).toBe("Hello, world!");
    expect(output.style.display).toBe("block");
    expect(output.style.height).toBe("576px");
    expect(output.style.maxHeight).toBe("576px");
    expect(output.style.overflowY).toBe("auto");
    expect(container.querySelector("#decode-processed-files").style.display).toBe("none");
    expect(container.querySelector("#decode-processed-container").children).toHaveLength(0);
  });
});
