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

function createUuidUi({ open = false, output = "previous-uuid", mockGenerate = true } = {}) {
  const ui = Object.create(QuickQueryUI.prototype);
  const popover = document.createElement("div");
  popover.classList.toggle("hidden", !open);

  ui.elements = {
    quickQueryUuidButton: document.createElement("button"),
    quickQueryUuidPopover: popover,
    quickQueryUuidQuantity: document.createElement("input"),
    quickQueryUuidOutput: Object.assign(document.createElement("textarea"), { value: output }),
    quickQueryUuidCopyButton: document.createElement("button"),
    quickQueryUuidStatus: document.createElement("p"),
  };
  ui.trackQuickQueryEvent = vi.fn();
  ui.getCurrentQuickQueryContext = vi.fn(() => ({}));
  if (mockGenerate) {
    ui.generateQuickQueryUuids = vi.fn();
  }
  ui.uuidAnalyticsSession = { generated_count: 0, copied_count: 0 };

  return ui;
}

describe("Quick Query UUID generator", () => {
  it("generates a fresh UUID whenever the generator is reopened", () => {
    const ui = createUuidUi();

    ui.openUuidGenerator();

    expect(ui.generateQuickQueryUuids).toHaveBeenCalledWith({ track: false, autoCopy: false });
  });

  it("generates again when Generate UUID is clicked while the popover is open", () => {
    const ui = createUuidUi({ open: true });

    ui.toggleUuidGenerator({ stopPropagation: vi.fn() });

    expect(ui.generateQuickQueryUuids).toHaveBeenCalledOnce();
    expect(ui.elements.quickQueryUuidPopover.classList.contains("hidden")).toBe(false);
  });

  it("copies generated UUIDs and reports the copied count", async () => {
    const ui = createUuidUi({ output: "", mockGenerate: false });
    ui.elements.quickQueryUuidQuantity.value = "50";
    ui.copyToClipboard = vi.fn().mockResolvedValue(true);
    ui.createUuid = vi.fn(() => "generated-uuid");

    await ui.generateQuickQueryUuids();

    expect(ui.copyToClipboard).toHaveBeenCalledOnce();
    expect(ui.copyToClipboard.mock.calls[0][0]).toContain("generated-uuid");
    expect(ui.elements.quickQueryUuidStatus.textContent).toBe("50 UUIDs copied to clipboard");
    expect(ui.uuidAnalyticsSession.generated_count).toBe(50);
    expect(ui.uuidAnalyticsSession.copied_count).toBe(50);
  });
});
