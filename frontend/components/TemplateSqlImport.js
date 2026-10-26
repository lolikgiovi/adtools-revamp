import { createOracleEditor } from "../core/MonacoOracle.js";
import { OracleConnectionService } from "../core/OracleConnectionService.js";
import {
  getTemplateImportTable,
  getTemplateImportIdentity,
  normalizeImportedTemplateValue,
  parseTemplateImportQuery,
} from "../tools/velocity-template/service.js";

const IMPORT_QUERY_LIMIT = 25;

function sqlCellPreview(value, limit = 160) {
  if (value == null) return "NULL";
  let text;
  if (typeof value === "object") {
    try {
      text = normalizeImportedTemplateValue(value);
    } catch (_) {
      try {
        text = JSON.stringify(value);
      } catch (_) {
        text = String(value);
      }
    }
  } else {
    text = String(value);
  }
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

export const withTemplateSqlImport = (Base) =>
  class extends Base {
    sqlElement(id) {
      return (this.container || document).querySelector(`#${id}`);
    }

    readImportQueries() {
      try {
        const parsed = JSON.parse(localStorage.getItem(`tool:${this.id}:import-queries`) || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch (_) {
        return {};
      }
    }

    rememberImportQuery(sql, connection) {
      const source = getTemplateImportTable(sql);
      if (!source) return null;
      const queries = this.readImportQueries();
      queries[source.qualifiedTable] = {
        sql,
        connection: connection?.name || "",
        updatedAt: Date.now(),
      };
      const retained = Object.entries(queries)
        .sort((left, right) => (right[1]?.updatedAt || 0) - (left[1]?.updatedAt || 0))
        .slice(0, IMPORT_QUERY_LIMIT);
      try {
        localStorage.setItem(`tool:${this.id}:import-queries`, JSON.stringify(Object.fromEntries(retained)));
      } catch (_) {}
      return source;
    }

    restoreImportQuery() {
      const queries = this.readImportQueries();
      const source = this.activeDocument?.sourceIdentity;
      const activeKey = source?.table ? [source.schema, source.table].filter(Boolean).join(".") : "";
      const fallbackKey = Object.entries(queries).sort((left, right) => (right[1]?.updatedAt || 0) - (left[1]?.updatedAt || 0))[0]?.[0];
      const tableKey = activeKey ? (queries[activeKey] ? activeKey : "") : fallbackKey;
      const saved = tableKey ? queries[tableKey] : null;
      if (!saved?.sql) return null;
      if (this._sqlImportEditor?.getValue() !== saved.sql) this._sqlImportEditor?.setValue(saved.sql);
      const connectionSelect = this.sqlElement("velocitySqlConnection");
      if (saved.connection && [...(connectionSelect?.options || [])].some((option) => option.value === saved.connection)) {
        connectionSelect.value = saved.connection;
      }
      return { tableKey, ...saved };
    }

    loadOracleConnections() {
      try {
        const connections = JSON.parse(localStorage.getItem("config.oracle.connections") || "[]");
        return Array.isArray(connections) ? connections.filter((item) => item?.name && item?.connect_string) : [];
      } catch (_) {
        return [];
      }
    }

    openSqlImport() {
      const connections = this.loadOracleConnections();
      if (!connections.length) {
        this.showError("No Oracle connections configured. Add one in Settings first.");
        return;
      }
      this._sqlImportConnections = connections;
      const select = this.sqlElement("velocitySqlConnection");
      select.replaceChildren(
        ...connections.map((connection) => {
          const option = document.createElement("option");
          option.value = connection.name;
          option.textContent = `${connection.name} (${connection.connect_string})`;
          return option;
        }),
      );
      const dialog = this.sqlElement("velocitySqlImportDialog");
      this.sqlElement("velocitySqlImportError").hidden = true;
      this.sqlElement("velocitySqlImportOverlay").hidden = false;
      dialog.hidden = false;
      if (!this._sqlImportEditor) {
        this._sqlImportEditor = createOracleEditor(this.sqlElement("velocitySqlQuery"), {
          value: "SELECT * FROM SCHEMA.TEMPLATE_TABLE WHERE TEMPLATE_ID = 1",
          automaticLayout: true,
          scrollbar: { alwaysConsumeMouseWheel: true },
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          ariaLabel: "Oracle SELECT query",
        });
      } else {
        this._sqlImportEditor.layout();
      }
      const saved = this.restoreImportQuery();
      this.setSqlImportHint(saved ? `Restored the last query for ${saved.tableKey}.` : "");
      let currentSql = "";
      try {
        currentSql = parseTemplateImportQuery(this._sqlImportEditor?.getValue());
      } catch (_) {
        // Keep the editor value; results cannot apply until the query parses again.
      }
      if (currentSql !== this._sqlImportSql) this.resetSqlImportResults();
      const activeSource = this.activeDocument?.sourceIdentity;
      const activeTable = activeSource?.table ? [activeSource.schema, activeSource.table].filter(Boolean).join(".") : "";
      const fetchedTable = getTemplateImportTable(this._sqlImportSql)?.qualifiedTable || "";
      if (activeTable && fetchedTable && activeTable !== fetchedTable) this.resetSqlImportResults();
      this._sqlImportEditor.focus();
    }

    closeSqlImport() {
      const dialog = this.sqlElement("velocitySqlImportDialog");
      if (dialog) dialog.hidden = true;
      this.sqlElement("velocitySqlImportOverlay").hidden = true;
      this.sqlElement("btnImportVelocitySql")?.focus();
    }

    showSqlImportError(error) {
      const output = this.sqlElement("velocitySqlImportError");
      output.textContent = error?.message || String(error);
      output.hidden = false;
    }

    setSqlImportHint(message = "") {
      const hint = this.sqlElement("velocitySqlQueryHint");
      if (!hint) return;
      hint.textContent = message;
      hint.hidden = !message;
    }

    resetSqlImportResults() {
      this._sqlImportRows = [];
      this._sqlImportColumns = [];
      this._sqlImportRowIndex = 0;
      this._sqlImportSql = "";
      this.sqlElement("velocitySqlRowTable")?.replaceChildren();
      const count = this.sqlElement("velocitySqlRowCount");
      if (count) count.textContent = "";
      const identity = this.sqlElement("velocitySqlRowIdentity");
      if (identity) identity.textContent = "";
      this.sqlElement("velocitySqlField")?.replaceChildren();
      const preview = this.sqlElement("velocitySqlPreview");
      if (preview) preview.value = "";
      this.sqlElement("velocitySqlSelection").hidden = true;
      this.sqlElement("btnApplyVelocitySqlImport").disabled = true;
    }

    renderSqlImportRows() {
      const container = this.sqlElement("velocitySqlRowTable");
      if (!container) return;
      const columns = this._sqlImportColumns;
      const rows = this._sqlImportRows;
      this._sqlImportRowIndex = Math.max(0, Math.min(this._sqlImportRowIndex, rows.length - 1));
      const table = document.createElement("table");
      table.className = "vtl-import-grid";
      table.setAttribute("role", "grid");
      table.setAttribute("aria-label", "Query results");
      const headRow = table.createTHead().insertRow();
      const numberHead = document.createElement("th");
      numberHead.scope = "col";
      numberHead.className = "vtl-import-row-number";
      numberHead.textContent = "#";
      headRow.append(numberHead);
      columns.forEach((column) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = column;
        cell.title = column;
        headRow.append(cell);
      });
      const body = table.createTBody();
      rows.forEach((row, rowIndex) => {
        const tr = body.insertRow();
        tr.dataset.rowIndex = String(rowIndex);
        tr.tabIndex = 0;
        tr.setAttribute("aria-selected", String(rowIndex === this._sqlImportRowIndex));
        if (rowIndex === this._sqlImportRowIndex) tr.classList.add("is-selected");
        const numberCell = document.createElement("th");
        numberCell.scope = "row";
        numberCell.className = "vtl-import-row-number";
        numberCell.textContent = String(rowIndex + 1);
        tr.append(numberCell);
        columns.forEach((column, columnIndex) => {
          const cell = document.createElement("td");
          cell.dataset.columnIndex = String(columnIndex);
          cell.textContent = sqlCellPreview(row[columnIndex]);
          cell.title = sqlCellPreview(row[columnIndex], 600);
          if (row[columnIndex] == null) cell.classList.add("is-null");
          tr.append(cell);
        });
      });
      container.replaceChildren(table);
      const count = this.sqlElement("velocitySqlRowCount");
      if (count) {
        count.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${columns.length} field${columns.length === 1 ? "" : "s"}`;
      }
      this.updateSqlImportIdentity();
    }

    selectSqlImportRow(index, { columnIndex, focus = false } = {}) {
      if (!this._sqlImportRows.length) return;
      const next = Math.max(0, Math.min(Number(index) || 0, this._sqlImportRows.length - 1));
      this._sqlImportRowIndex = next;
      (this.container || document).querySelectorAll("#velocitySqlRowTable tbody tr").forEach((row) => {
        const selected = Number(row.dataset.rowIndex) === next;
        row.classList.toggle("is-selected", selected);
        row.setAttribute("aria-selected", String(selected));
      });
      if (Number.isInteger(columnIndex)) this.sqlElement("velocitySqlField").value = String(columnIndex);
      if (focus) (this.container || document).querySelector(`#velocitySqlRowTable tbody tr[data-row-index="${next}"]`)?.focus();
      this.updateSqlImportIdentity();
      this.updateSqlImportPreview();
    }

    updateSqlImportIdentity() {
      const output = this.sqlElement("velocitySqlRowIdentity");
      if (!output) return;
      const identity = getTemplateImportIdentity(
        this._sqlImportEditor?.getValue() || "",
        this._sqlImportColumns,
        this._sqlImportRows[this._sqlImportRowIndex] || [],
      );
      output.textContent = Object.entries(identity?.identifiers || {})
        .map(([name, value]) => `${name}=${value}`)
        .join(" · ");
    }

    handleSqlImportGridKeydown(event) {
      const row = event.target.closest?.("tr[data-row-index]");
      if (!row) return;
      const current = Number(row.dataset.rowIndex);
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectSqlImportRow(current);
        return;
      }
      const next = {
        ArrowDown: current + 1,
        ArrowUp: current - 1,
        Home: 0,
        End: this._sqlImportRows.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      this.selectSqlImportRow(next, { focus: true });
    }

    updateSqlImportPreview() {
      const rowIndex = this._sqlImportRowIndex;
      const columnIndex = Number(this.sqlElement("velocitySqlField")?.value || 0);
      const preview = this.sqlElement("velocitySqlPreview");
      const apply = this.sqlElement("btnApplyVelocitySqlImport");
      try {
        const value = normalizeImportedTemplateValue(this._sqlImportRows[rowIndex]?.[columnIndex]);
        preview.value = value;
        apply.disabled = false;
      } catch (error) {
        preview.value = "";
        apply.disabled = true;
        this.showSqlImportError(error);
      }
    }

    async fetchSqlImportFields() {
      const fetchButton = this.sqlElement("btnFetchVelocitySql");
      const error = this.sqlElement("velocitySqlImportError");
      error.hidden = true;
      const connection = this._sqlImportConnections?.find((item) => item.name === this.sqlElement("velocitySqlConnection")?.value);
      if (!connection) return this.showSqlImportError("Select an Oracle connection.");
      try {
        const sql = parseTemplateImportQuery(this._sqlImportEditor?.getValue());
        fetchButton.disabled = true;
        fetchButton.textContent = "Fetching…";
        const result = await OracleConnectionService.queryViaSidecar(connection.name, connection, sql, 100);
        if (!Array.isArray(result?.columns) || !Array.isArray(result?.rows)) throw new Error("Oracle returned an unexpected result.");
        if (!result.rows.length) throw new Error("The query returned no rows.");
        if (!result.columns.length) throw new Error("The query returned no fields.");
        this._sqlImportColumns = result.columns.map(String);
        this._sqlImportRows = result.rows;
        this._sqlImportRowIndex = 0;
        this._sqlImportSql = sql;
        const fieldSelect = this.sqlElement("velocitySqlField");
        fieldSelect.replaceChildren(
          ...this._sqlImportColumns.map((column, index) => {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = column;
            return option;
          }),
        );
        this.renderSqlImportRows();
        const selection = this.sqlElement("velocitySqlSelection");
        selection.hidden = false;
        selection.scrollIntoView({ block: "nearest" });
        const source = this.rememberImportQuery(sql, connection);
        this.setSqlImportHint(source ? `Saved this query for ${source.qualifiedTable}.` : "");
        this.updateSqlImportPreview();
      } catch (fetchError) {
        this.resetSqlImportResults();
        this.setSqlImportHint("");
        this.showSqlImportError(fetchError);
      } finally {
        fetchButton.disabled = false;
        fetchButton.textContent = "Fetch fields";
      }
    }
  };
