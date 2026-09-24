import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Quick Query Oracle import overlays", () => {
  it.each([
    ["oracleData", "closeOracleDataImport"],
    ["oracleEnv", "closeOracleEnvOverlay"],
  ])("closes %s when clicking outside its dialog content", (prefix, closeMethod) => {
    document.body.innerHTML = `
      <div id="${prefix}Overlay"></div>
      <div id="${prefix}Modal"><div class="qq-modal-content"><button>Inside</button></div></div>`;

    const ui = Object.create(QuickQueryUI.prototype);
    ui.elements = {
      [`${prefix}Overlay`]: document.getElementById(`${prefix}Overlay`),
      [`${prefix}Modal`]: document.getElementById(`${prefix}Modal`),
    };
    ui[closeMethod] = vi.fn();
    ui._handleUuidGeneratorDocumentClick = vi.fn();
    ui._handleUuidGeneratorKeydown = vi.fn();
    ui._handleDataMaximizeKeydown = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    ui.setupEventListeners();

    ui.elements[`${prefix}Modal`].querySelector("button").click();
    expect(ui[closeMethod]).not.toHaveBeenCalled();

    ui.elements[`${prefix}Modal`].click();
    expect(ui[closeMethod]).toHaveBeenCalledOnce();

    document.removeEventListener("click", ui._handleUuidGeneratorDocumentClick);
    document.removeEventListener("keydown", ui._handleUuidGeneratorKeydown);
    document.removeEventListener("keydown", ui._handleDataMaximizeKeydown);
  });
});
