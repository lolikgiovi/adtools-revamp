// Failure cases: ordinary links hit a denied shell command; a tool's native opener
// and the shell body listener both open one click; browser links stop working.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CheckImageTool } from "../../tools/image-checker/main.js";
import { RunBatch } from "../../tools/run-batch/main.js";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../Runtime.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../Runtime.js", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../KeychainMigration.js", () => ({ ensureUnifiedKeychain: vi.fn().mockResolvedValue(undefined) }));

const shellScript = readFileSync("frontend/core/tests/fixtures/tauri-shell-init.txt", "utf8");
const capabilities = JSON.parse(readFileSync("tauri/capabilities/default.json", "utf8"));

beforeEach(() => {
  document.body.replaceWith(document.createElement("body"));
  localStorage.clear();
  isTauri.mockReturnValue(true);
  invoke.mockResolvedValue(undefined);
  window.__TAURI_INTERNALS__ = { invoke: vi.fn().mockResolvedValue(undefined) };
  new Function("window", "document", shellScript)(window, document);
});

afterEach(() => {
  document.body.replaceWith(document.createElement("body"));
  delete window.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("desktop external link routing with the Tauri shell listener", () => {
  it.each(["https://example.com/build/42", "http://jenkins.example/build/42", "mailto:help@example.com"])(
    "permits an ordinary external link: %s",
    (url) => {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.innerHTML = "<span>Open</span>";
      document.body.append(link);
      link.firstChild.click();
      expect(window.__TAURI_INTERNALS__.invoke).toHaveBeenCalledExactlyOnceWith("plugin:shell|open", { path: url }, undefined);
      expect(capabilities.permissions).toContain("shell:allow-open");
    },
  );

  it("opens an image once, without the body listener invoking a second opener", async () => {
    const tool = new CheckImageTool();
    tool.showImageDetails({ url: "https://cdn.example/image.png", width: 600, height: 377, sizeBytes: 301000 }, "image");
    document.querySelector(".image-details-actions a").click();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledExactlyOnceWith("open_url", { url: "https://cdn.example/image.png" }));
    expect(window.__TAURI_INTERNALS__.invoke).not.toHaveBeenCalled();
    document.querySelector(".close-modal-button").click();
  });

  it("opens a Run Batch build once, without the body listener invoking a second opener", async () => {
    const tool = new RunBatch();
    tool.container = document.createElement("div");
    tool.container.innerHTML = tool.render();
    document.body.append(tool.container);
    tool.service = {
      hasToken: vi.fn().mockResolvedValue(true),
      loadJenkinsUrl: vi.fn(() => "https://jenkins.example"),
      getEnvChoices: vi.fn().mockResolvedValue(["uat"]),
    };
    await tool.onMount();
    try {
      const link = tool.container.querySelector("#rb-build-link");
      link.href = "https://jenkins.example/build/42";
      link.click();
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledExactlyOnceWith("open_url", { url: link.href }));
      expect(window.__TAURI_INTERNALS__.invoke).not.toHaveBeenCalled();
    } finally {
      tool.onUnmount();
    }
  });
});
