import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";

function createChoiceUi() {
  document.body.innerHTML = `
    <button id="generate">Generate</button>
    <div id="backdrop" class="hidden" aria-hidden="true"></div>
    <div id="modal" class="hidden">
      <button id="close">Close</button>
      <p id="description"></p>
      <button id="content">Embed content</button>
      <button id="filename">Keep filename</button>
    </div>`;
  const ui = Object.create(QuickQueryUI.prototype);
  ui.elements = {
    blobAttachmentOverlay: document.getElementById("backdrop"),
    blobAttachmentModal: document.getElementById("modal"),
    blobAttachmentDescription: document.getElementById("description"),
    blobAttachmentContentButton: document.getElementById("content"),
    blobAttachmentFilenameButton: document.getElementById("filename"),
    closeBlobAttachmentModalButton: document.getElementById("close"),
  };
  document.getElementById("generate").focus();
  return ui;
}

describe("Quick Query BLOB attachment choice", () => {
  it("offers content and returns focus after selection", async () => {
    const ui = createChoiceUi();
    const choice = ui._showBlobAttachmentChoice(6);

    expect(ui.elements.blobAttachmentDescription.textContent).toContain("6 attached files");
    expect(document.activeElement).toBe(ui.elements.blobAttachmentContentButton);
    ui.elements.blobAttachmentContentButton.click();

    await expect(choice).resolves.toBe("content");
    expect(document.activeElement.id).toBe("generate");
    expect(ui.elements.blobAttachmentModal.classList.contains("hidden")).toBe(true);
  });

  it("supports filename selection and Escape cancellation", async () => {
    const ui = createChoiceUi();
    const filenameChoice = ui._showBlobAttachmentChoice(1);
    ui.elements.blobAttachmentFilenameButton.click();
    await expect(filenameChoice).resolves.toBe("filename");

    const cancelledChoice = ui._showBlobAttachmentChoice(1);
    ui.elements.blobAttachmentModal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(cancelledChoice).resolves.toBeNull();
    expect(ui._blobChoicePending).toBe(false);
  });

  it("prompts during generation only for a referenced BLOB attachment", async () => {
    const ui = createChoiceUi();
    ui.elements.tableNameInput = { value: "TEST.DOCUMENTS" };
    ui.elements.defaultSysdateToggle = { checked: true };
    ui.getQueryTypeValue = () => "merge";
    ui.flushPendingDataAutosave = vi.fn();
    ui.schemaTable = { getData: () => [["id", "NUMBER", "No", "", "", "Yes"], ["document", "BLOB", "Yes"]] };
    ui.dataTable = { getData: () => [["id", "document"], ["1", "file.pdf"]] };
    ui.excelImportService = { hasData: () => false };
    ui.storageService = { saveSchema: vi.fn() };
    ui._detectHtmlInData = () => ({ hasHtml: false });
    ui.processedFiles = [{ name: "file.pdf", processedFormats: { base64: "data:application/pdf;base64,AA==" } }];
    ui._showBlobAttachmentChoice = vi.fn(async () => "filename");
    ui._generateQuery = vi.fn();

    await ui.handleGenerateQuery();
    expect(ui._showBlobAttachmentChoice).toHaveBeenCalledWith(1);
    expect(ui._generateQuery).toHaveBeenCalledWith(
      "TEST.DOCUMENTS", "merge", expect.any(Array), expect.any(Array), "manual",
      { defaultSysdate: true, blobAttachmentMode: "filename" },
    );

    ui.dataTable.getData = () => [["id", "document"], ["1", "missing.pdf"]];
    await ui.handleGenerateQuery();
    expect(ui._showBlobAttachmentChoice).toHaveBeenCalledTimes(1);
    expect(ui._generateQuery).toHaveBeenLastCalledWith(
      "TEST.DOCUMENTS", "merge", expect.any(Array), expect.any(Array), "manual", { defaultSysdate: true },
    );
  });
});
