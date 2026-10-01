import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";
import { MAIN_TEMPLATE } from "../template.js";

const styles = readFileSync("frontend/tools/quick-query/styles.css", "utf8");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Quick Query file viewer", () => {
  it("uses theme colors for the metadata footer", () => {
    const metadataRule = styles.match(/\.file-viewer-metadata\s*\{([^}]+)\}/)?.[1] || "";

    expect(metadataRule).toMatch(/background-color:\s*hsl\(var\(--background\)\)/);
    expect(metadataRule).toMatch(/border-top:\s*1px solid hsl\(var\(--border\)\)/);
  });

  it("shows only the selected content pane when switching tabs", () => {
    document.body.innerHTML = MAIN_TEMPLATE;
    const ui = Object.create(QuickQueryUI.prototype);

    ui.showFileViewer({
      name: "preview.png",
      type: "image/png",
      size: 1,
      processedFormats: { base64: "data:image/png;base64,AA==" },
    });

    document.querySelector('.qq-tab-button[data-tab="processed"]').click();

    expect(document.getElementById("originalContent").classList.contains("active")).toBe(false);
    expect(document.getElementById("processedContent").classList.contains("active")).toBe(true);
  });
});
