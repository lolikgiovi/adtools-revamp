import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";

// Failure cases: warning at/below the limit, missing warning above it, blocking generation,
// losing other warnings, and stale styling after attachments change or tabs reload.
function createUi(sizes) {
  document.body.innerHTML = '<div id="files"></div><div id="warnings"></div>';
  const ui = Object.create(QuickQueryUI.prototype);
  ui.elements = {
    fileItemsContainer: document.getElementById("files"),
    warningMessages: document.getElementById("warnings"),
    tableNameInput: { value: "TEST.DOCUMENTS" },
    defaultSysdateToggle: { checked: false },
  };
  ui.processedFiles = sizes.map((size, index) => ({ name: `file${index}.txt`, size }));
  return ui;
}

describe("Quick Query attachment size warnings", () => {
  it("marks only files strictly above 300 KB and refreshes from current attachments", () => {
    const ui = createUi([300 * 1000 - 1, 300 * 1000, 300 * 1000 + 1]);
    ui._renderAttachmentsList();
    const cards = [...ui.elements.fileItemsContainer.children];
    expect(cards.map((card) => card.classList.contains("file-button-oversized"))).toEqual([false, false, true]);
    expect(cards[2].textContent).toContain("Exceeds 300 KB");
    expect(cards[2].getAttribute("aria-label")).toContain("Exceeds 300 KB");
    ui.processedFiles = [{ name: "small.txt", size: 100 }];
    ui._renderAttachmentsList();
    expect(ui.elements.fileItemsContainer.querySelector(".file-button-oversized")).toBeNull();
  });

  it.each([300 * 1000, 300 * 1000 + 1, 305000])("warns appropriately on Generate and continues for %i bytes", async (size) => {
    const ui = createUi([size]);
    ui.flushPendingDataAutosave = vi.fn();
    ui.getQueryTypeValue = () => "insert";
    ui.schemaTable = { getData: () => [["id", "NUMBER", "No"]] };
    ui.dataTable = { getData: () => [["id"], [1]] };
    ui.excelImportService = { hasData: () => false };
    ui.storageService = { saveSchema: vi.fn() };
    ui._detectHtmlInData = () => ({ hasHtml: false });
    ui.isConfigIdUpdate = () => false;
    ui._generateQuery = vi.fn();
    await ui.handleGenerateQuery();
    expect(ui._generateQuery).toHaveBeenCalledOnce();
    expect(ui.elements.warningMessages.textContent.includes("300 KB")).toBe(size > 300 * 1000);
  });

  it("displays Finder-style decimal KB and warns for a 305,000-byte file", () => {
    const ui = createUi([305000]);
    ui._renderAttachmentsList();
    expect(ui.elements.fileItemsContainer.querySelector(".file-size").textContent).toBe("305.00 KB");
    expect(ui.elements.fileItemsContainer.querySelector(".file-button-oversized")).not.toBeNull();
  });

  it("preserves other warnings and avoids duplicate size messages", () => {
    const ui = createUi([400 * 1000]);
    ui.showWarning("Duplicate keys detected");
    ui._showAttachmentSizeWarning();
    ui._showAttachmentSizeWarning();
    expect(ui.elements.warningMessages.textContent).toContain("Duplicate keys detected");
    expect(ui.elements.warningMessages.querySelectorAll(".qq-attachment-size-warning")).toHaveLength(1);
  });
});
