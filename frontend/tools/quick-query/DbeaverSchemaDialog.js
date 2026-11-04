import Handsontable from "handsontable";
import {
  DBEAVER_SCHEMA_HEADERS,
  convertDbeaverSchemaRows,
  isDbeaverSchemaRows,
  normalizeDbeaverSchemaRows,
} from "./services/SchemaImportService.js";

export function openDbeaverSchemaDialog({ root, onConvert, onFailure }) {
  const trigger = document.activeElement;
  const dialog = document.createElement("dialog");
  const titleId = `dbeaver-import-${crypto.randomUUID()}`;
  dialog.className = "qq-dbeaver-dialog app-overlay-surface";
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.innerHTML = `
    <header class="qq-dbeaver-header">
      <h2 id="${titleId}">Paste from DBeaver</h2>
      <button type="button" class="overlay-close-button app-overlay-close" aria-label="Close">&times;</button>
    </header>
    <div class="qq-dbeaver-body">
      <p>In DBeaver’s Columns view, select the columns and choose <strong>Copy Advanced Info</strong>.
        Paste into the first cell below.</p>
      <div class="qq-dbeaver-sheet" aria-label="DBeaver columns"></div>
      <p class="qq-dbeaver-error" role="alert" hidden></p>
    </div>
    <footer class="qq-dbeaver-footer">
      <p>Conversion replaces this tab’s schema and clears its data.</p>
      <div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" data-action="convert">Convert schema</button>
      </div>
    </footer>`;
  root.append(dialog);
  const sheet = dialog.querySelector(".qq-dbeaver-sheet");
  const error = dialog.querySelector(".qq-dbeaver-error");
  const convert = dialog.querySelector('[data-action="convert"]');
  let table;
  let closed = false;
  const reportError = (failure) => {
    error.textContent = failure.message;
    error.hidden = false;
    onFailure?.(failure);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    table?.destroy();
    dialog.close();
    dialog.remove();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  dialog.querySelector('[aria-label="Close"]').addEventListener("click", close);
  dialog.querySelector('[data-action="cancel"]').addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", close);
  convert.addEventListener("click", () => {
    table.getActiveEditor()?.finishEditing();
    try {
      const rows = convertDbeaverSchemaRows([DBEAVER_SCHEMA_HEADERS, ...table.getData()]);
      onConvert(rows);
      close();
    } catch (failure) {
      reportError(failure);
    }
  });
  try {
    dialog.showModal();
    table = new Handsontable(sheet, {
      data: [Array(7).fill("")],
      colHeaders: DBEAVER_SCHEMA_HEADERS,
      columns: DBEAVER_SCHEMA_HEADERS.map(() => ({ type: "text" })),
      colWidths: [200, 46, 170, 95, 85, 170, 180],
      minRows: 8,
      minSpareRows: 1,
      maxCols: 7,
      rowHeaders: false,
      rowHeights: 28,
      height: Math.max(140, Math.min(360, window.innerHeight - 340)),
      width: "100%",
      stretchH: "all",
      autoWrapRow: false,
      autoWrapCol: false,
      manualColumnResize: true,
      licenseKey: "non-commercial-and-evaluation",
      themeName: "ht-theme-main",
      beforePaste: (data) => {
        if (!isDbeaverSchemaRows(data)) return;
        try {
          table.loadData(normalizeDbeaverSchemaRows(data));
        } catch (failure) {
          reportError(failure);
        }
        return false;
      },
      afterChange: () => {
        error.hidden = true;
      },
    });
    table.selectCell(0, 0);
    table.listen();
  } catch (failure) {
    close();
    throw failure;
  }
  return { close };
}
