// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";

function createUuidUi({ open = false, output = "previous-uuid" } = {}) {
  const ui = Object.create(QuickQueryUI.prototype);
  const popover = document.createElement("div");
  popover.classList.toggle("hidden", !open);

  ui.elements = {
    quickQueryUuidButton: document.createElement("button"),
    quickQueryUuidPopover: popover,
    quickQueryUuidQuantity: document.createElement("input"),
    quickQueryUuidOutput: Object.assign(document.createElement("textarea"), { value: output }),
  };
  ui.trackQuickQueryEvent = vi.fn();
  ui.getCurrentQuickQueryContext = vi.fn(() => ({}));
  ui.generateQuickQueryUuids = vi.fn();

  return ui;
}

describe("Quick Query UUID generator", () => {
  it("generates a fresh UUID whenever the generator is reopened", () => {
    const ui = createUuidUi();

    ui.openUuidGenerator();

    expect(ui.generateQuickQueryUuids).toHaveBeenCalledWith({ track: false });
  });

  it("generates again when Generate UUID is clicked while the popover is open", () => {
    const ui = createUuidUi({ open: true });

    ui.toggleUuidGenerator({ stopPropagation: vi.fn() });

    expect(ui.generateQuickQueryUuids).toHaveBeenCalledOnce();
    expect(ui.elements.quickQueryUuidPopover.classList.contains("hidden")).toBe(false);
  });
});
