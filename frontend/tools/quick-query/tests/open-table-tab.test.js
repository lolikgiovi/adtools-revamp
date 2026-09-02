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

function createUi(tabs = []) {
  const ui = Object.create(QuickQueryUI.prototype);
  ui.ready = Promise.resolve();
  ui.tabs = tabs;
  ui.elements = { tableNameInput: { value: "" } };
  ui.saveActiveTabDraft = vi.fn();
  ui.switchTab = vi.fn();
  ui.createNewTab = vi.fn(async () => ({ id: "new-tab" }));
  ui.handleLoadSchema = vi.fn(async () => false);
  return ui;
}

describe("Quick Query table commands", () => {
  it("reuses a matching tab instead of creating one", async () => {
    const existing = { id: "existing-tab", tableName: "CONFIG.APP_CONFIG" };
    const ui = createUi([existing]);

    await ui.openTableTab("config.app_config");

    expect(ui.switchTab).toHaveBeenCalledWith(existing.id);
    expect(ui.createNewTab).not.toHaveBeenCalled();
  });

  it("creates and prefills a tab when no matching tab exists", async () => {
    const ui = createUi();

    await ui.openTableTab("config.app_config");

    expect(ui.createNewTab).toHaveBeenCalledOnce();
    expect(ui.elements.tableNameInput.value).toBe("CONFIG.APP_CONFIG");
  });
});
