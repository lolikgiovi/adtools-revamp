import Handsontable from "handsontable";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import { BaseTool } from "../../core/BaseTool.js";
import { createOracleEditor } from "../../core/MonacoOracle.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import { LockeyUpdateTemplate } from "./template.js";
import { analyzeLedger, generateInsertSql, validateBatch } from "./service.js";
import "./styles.css";

const DRAFT_STORAGE_KEY = "tool:lockey-update:draft";
const TAB_STORAGE_KEY = "tool:lockey-update:tab";
const CONNECTION_STORAGE_KEY = "tool:lockey-update:connection";
const QUICK_QUERY_AUDIT_KEY = "tool:quick-query:audit-user";
const ORACLE_CONNECTIONS_KEY = "config.oracle.connections";
const HISTORY_LIMIT = 500;
const VERSION_FETCH_LIMIT = 5000;
const UPDATE_FETCH_LIMIT = 20000;

const VERSION_QUERY = `
  SELECT LANGUAGE_PACK_VERSION_ID, RELEASE_ID, LANGUAGE_PACK_VERSION,
         CREATED_BY, CREATED_TIME, UPDATED_BY, UPDATED_TIME
  FROM LOCALIZATION.LANGUAGE_PACK_VERSION
  ORDER BY LANGUAGE_PACK_VERSION DESC
`;

const UPDATE_QUERY = `
  SELECT u.LANGUAGE_PACK_UPDATE_ID, u.LANGUAGE_PACK_VERSION_ID, u.LOCALIZATION_KEY,
         u.ID_VALUE, u.EN_VALUE, u.CREATED_BY, u.CREATED_TIME, u.UPDATED_BY, u.UPDATED_TIME
  FROM LOCALIZATION.LANGUAGE_PACK_UPDATE u
  JOIN LOCALIZATION.LANGUAGE_PACK_VERSION v ON v.LANGUAGE_PACK_VERSION_ID = u.LANGUAGE_PACK_VERSION_ID
  ORDER BY v.LANGUAGE_PACK_VERSION DESC, u.LOCALIZATION_KEY
`;

function blankRow() {
  return { key: "", idValue: "", enValue: "" };
}

function quickQueryAuditUser() {
  try {
    const preference = JSON.parse(localStorage.getItem(QUICK_QUERY_AUDIT_KEY) || "null");
    if (preference?.mode === "custom" && typeof preference.customAuditUser === "string") {
      const custom = preference.customAuditUser.trim().toUpperCase();
      if (custom) return custom;
    }
    if (preference?.mode === "system") return "SYSTEM";
  } catch (_) {
    // Storage can be unavailable or contain an older, invalid value.
  }
  return "SYSTEM";
}

function normalizeOracleRow(row) {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    normalized[String(key).toUpperCase()] = value;
  });
  return normalized;
}

export class LockeyUpdate extends BaseTool {
  constructor(eventBus) {
    super({ id: "lockey-update", eventBus, isHeavyTool: true });
    this.ledger = { versions: [], updates: [] };
    this.ledgerLoaded = false;
    this.analysis = analyzeLedger(this.ledger);
    this.sourceWarnings = [];
    this.draft = { releaseId: "", auditUser: "SYSTEM", rows: [blankRow()] };
    this.historyFilter = "";
    this.releaseFilter = "";
    this.connections = [];
    this.lastSql = "";
    this.lastResult = null;
    this.fetching = false;
    this.saveTimer = null;
    this.activeTab = "create";
    this.el = {};
    this.tabButtons = [];
    this.grid = null;
    this.sqlEditor = null;
    this.gridHeightValue = 0;
    this.resizeObserver = null;
    this.oracleService = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return LockeyUpdateTemplate;
  }

  onMount() {
    this.cacheElements();
    this.restoreDraft();
    this.restoreActiveTab();
    this.bindEvents();
    this.loadConnections();
    this.syncInputs();
    this.initializeGrid();
    this.initializeEditor();
    this.setActiveTab(this.activeTab);
    this.renderAll();

    try {
      UsageTracker.trackEvent("lockey-update", "mount");
    } catch (_) {
      // Analytics must never interrupt the tool.
    }
  }

  onActivate() {
    if (this.el.connection) this.loadConnections();
  }

  onWarmResume() {
    this.resizeGrid();
    this.sqlEditor?.layout?.();
  }

  onUnmount() {
    clearTimeout(this.saveTimer);
    this.persistDraft();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.handleWindowResize);
    this.grid?.destroy();
    this.grid = null;
    this.sqlEditor?.dispose();
    this.sqlEditor = null;
    this.lastSql = "";
    this.el = {};
  }

  cacheElements() {
    const elements = {
      connection: "lu-connection",
      fetchOracle: "lu-fetch-oracle",
      sourceError: "lu-source-error",
      createPanel: "lu-create-panel",
      historyPanel: "lu-history-panel",
      releaseOptions: "lu-release-options",
      releaseId: "lu-release-id",
      auditUser: "lu-audit-user",
      grid: "lu-grid",
      validation: "lu-validation",
      copySql: "lu-copy-sql",
      downloadSql: "lu-download-sql",
      sqlEditor: "lu-sql-editor",
      historySummary: "lu-history-summary",
      dataWarnings: "lu-data-warnings",
      search: "lu-search",
      releaseFilter: "lu-release-filter",
      historyCount: "lu-history-count",
      historyBody: "lu-history-body",
      historyEmpty: "lu-history-empty",
      historyNote: "lu-history-note",
    };

    Object.entries(elements).forEach(([key, id]) => {
      this.el[key] = this.container.querySelector(`#${id}`);
    });
    this.tabButtons = Array.from(this.container.querySelectorAll(".lu-tab"));
  }

  bindEvents() {
    this.tabButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveTab(button.dataset.tab));
    });

    this.el.fetchOracle?.addEventListener("click", () => this.loadFromOracle());
    this.el.connection?.addEventListener("change", () => {
      try {
        if (this.el.connection.value) localStorage.setItem(CONNECTION_STORAGE_KEY, this.el.connection.value);
      } catch (_) {
        // Storage is optional.
      }
    });

    this.el.releaseId?.addEventListener("input", () => {
      this.draft.releaseId = this.el.releaseId.value;
      this.scheduleDraftSave();
      this.renderPreview();
    });
    this.el.releaseId?.addEventListener("blur", () => {
      const trimmed = this.el.releaseId.value.trim();
      if (trimmed === this.el.releaseId.value) return;
      this.el.releaseId.value = trimmed;
      this.draft.releaseId = trimmed;
      this.scheduleDraftSave();
      this.renderPreview();
    });

    this.el.auditUser?.addEventListener("input", () => {
      this.draft.auditUser = this.el.auditUser.value;
      this.scheduleDraftSave();
      this.renderPreview();
    });
    this.el.auditUser?.addEventListener("blur", () => {
      const normalized = this.el.auditUser.value.trim().toUpperCase();
      if (normalized === this.el.auditUser.value) return;
      this.el.auditUser.value = normalized;
      this.draft.auditUser = normalized;
      this.scheduleDraftSave();
      this.renderPreview();
    });

    this.el.search?.addEventListener("input", () => {
      this.historyFilter = this.el.search.value;
      this.renderHistory();
    });
    this.el.releaseFilter?.addEventListener("change", () => {
      this.releaseFilter = this.el.releaseFilter.value;
      this.renderHistory();
    });

    this.el.copySql?.addEventListener("click", () => this.copySql());
    this.el.downloadSql?.addEventListener("click", () => this.downloadSql());

    this.handleWindowResize = () => this.resizeGrid();
    window.addEventListener("resize", this.handleWindowResize);
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.resizeGrid());
      this.resizeObserver.observe(this.el.grid);
    }
  }

  initializeGrid() {
    if (!this.el.grid) return;
    const data = this.draft.rows.map((row) => [row.key, row.enValue, row.idValue]);

    this.grid = new Handsontable(this.el.grid, {
      data,
      colHeaders: ["Localization Key", "EN_VALUE", "ID_VALUE"],
      columns: [{ data: 0 }, { data: 1 }, { data: 2 }],
      rowHeaders: true,
      minSpareRows: 1,
      rowHeights: 20,
      autoRowSize: false,
      contextMenu: true,
      manualColumnResize: true,
      stretchH: "all",
      height: this.gridHeight(),
      licenseKey: "non-commercial-and-evaluation",
      themeName: "ht-theme-main",
      className: "lu-handsontable",
      afterChange: (changes, source) => {
        if (source === "loadData" || !this.grid) return;
        this.syncGridToDraft();
      },
      afterCreateRow: () => {
        if (this.grid) this.syncGridToDraft();
      },
      afterRemoveRow: () => {
        if (this.grid) this.syncGridToDraft();
      },
    });
    this.gridHeightValue = this.gridHeight();
  }

  initializeEditor() {
    if (!this.el.sqlEditor) return;
    this.sqlEditor = createOracleEditor(this.el.sqlEditor, {
      value: "Choose a release and add localization keys to generate SQL.",
      readOnly: true,
      fontSize: 10.5,
      wordWrap: "on",
      scrollBeyondLastLine: false,
      scrollbar: { alwaysConsumeMouseWheel: true },
      minimap: { enabled: false },
      renderLineHighlight: "none",
      contextmenu: false,
    });
  }

  setSqlText(text) {
    if (!this.sqlEditor) return;
    if (this.sqlEditor.getValue() === text) return;
    const scrollTop = this.sqlEditor.getScrollTop();
    this.sqlEditor.setValue(text);
    this.sqlEditor.setScrollTop(scrollTop);
  }

  gridHeight() {
    const container = this.el.grid;
    if (!container) return 360;
    const measured = Math.floor(container.getBoundingClientRect().height);
    return Math.max(280, measured || 360);
  }

  resizeGrid() {
    if (!this.grid) return;
    const height = this.gridHeight();
    if (height === this.gridHeightValue) return;
    this.gridHeightValue = height;
    this.grid.updateSettings({ height });
  }

  syncGridToDraft() {
    const data = this.grid?.getData?.() || [];
    this.draft.rows = data.map((row) => ({
      key: String(row?.[0] ?? ""),
      enValue: String(row?.[1] ?? ""),
      idValue: String(row?.[2] ?? ""),
    }));
    this.scheduleDraftSave();
    this.renderPreview();
  }

  syncInputs() {
    if (this.el.releaseId) this.el.releaseId.value = this.draft.releaseId;
    if (this.el.auditUser) this.el.auditUser.value = this.draft.auditUser;
  }

  restoreDraft() {
    this.draft.auditUser = quickQueryAuditUser();
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "null");
      if (saved && typeof saved === "object") {
        this.draft.releaseId = typeof saved.releaseId === "string" ? saved.releaseId.trim() : "";
        if (typeof saved.auditUser === "string" && saved.auditUser.trim()) {
          this.draft.auditUser = saved.auditUser.trim().toUpperCase();
        }
        if (Array.isArray(saved.rows)) {
          this.draft.rows = saved.rows.map((row) => ({
            key: String(row?.key ?? ""),
            idValue: String(row?.idValue ?? ""),
            enValue: String(row?.enValue ?? ""),
          }));
        }
      }
    } catch (_) {
      // Ignore malformed drafts.
    }
    if (!this.draft.auditUser) this.draft.auditUser = "SYSTEM";
    if (this.draft.rows.length === 0) this.draft.rows = [blankRow()];
  }

  restoreActiveTab() {
    try {
      const saved = localStorage.getItem(TAB_STORAGE_KEY);
      if (saved === "create" || saved === "history") this.activeTab = saved;
    } catch (_) {
      // Storage is optional.
    }
  }

  setActiveTab(tab) {
    if (tab !== "create" && tab !== "history") return;
    this.activeTab = tab;

    this.tabButtons.forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });

    [
      [this.el.createPanel, "create"],
      [this.el.historyPanel, "history"],
    ].forEach(([panel, name]) => {
      if (!panel) return;
      const active = name === tab;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });

    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch (_) {
      // Storage is optional.
    }

    if (tab === "create") {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          this.resizeGrid();
          this.sqlEditor?.layout?.();
        });
      } else {
        this.resizeGrid();
        this.sqlEditor?.layout?.();
      }
    }
  }

  scheduleDraftSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persistDraft(), 300);
  }

  persistDraft() {
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ releaseId: this.draft.releaseId, auditUser: this.draft.auditUser, rows: this.draft.rows }),
      );
    } catch (_) {
      // Storage is optional.
    }
  }

  loadConnections() {
    let connections = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(ORACLE_CONNECTIONS_KEY) || "[]");
      if (Array.isArray(parsed)) {
        connections = parsed.filter((connection) => connection?.name && connection?.connect_string);
      }
    } catch (_) {
      connections = [];
    }
    this.connections = connections;

    if (!this.el.connection) return;
    this.el.connection.replaceChildren();

    if (connections.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No environments";
      this.el.connection.appendChild(option);
      this.el.connection.disabled = true;
      if (this.el.fetchOracle) {
        this.el.fetchOracle.disabled = true;
        this.el.fetchOracle.title = "Add an Oracle connection in Settings first";
      }
      return;
    }

    connections.forEach((connection) => {
      const option = document.createElement("option");
      option.value = connection.name;
      option.textContent = connection.name;
      this.el.connection.appendChild(option);
    });

    let saved = "";
    try {
      saved = localStorage.getItem(CONNECTION_STORAGE_KEY) || "";
    } catch (_) {
      saved = "";
    }
    if (saved && connections.some((connection) => connection.name === saved)) {
      this.el.connection.value = saved;
    }
    this.el.connection.disabled = false;
    if (this.el.fetchOracle) this.el.fetchOracle.disabled = false;
  }

  async loadFromOracle() {
    if (this.fetching) return;
    const connectionName = this.el.connection?.value;
    const connection = this.connections.find((entry) => entry.name === connectionName);
    if (!connection) {
      this.setSourceError("Choose an environment first.");
      return;
    }

    this.fetching = true;
    this.setSourceError("");
    this.setFetchBusy(true);
    try {
      const OracleConnectionService = this.oracleService || (await import("../../core/OracleConnectionService.js")).OracleConnectionService;
      const started = await OracleConnectionService.ensureSidecarStarted();
      if (!started) throw new Error("Oracle sidecar did not start. Check the connection indicator and try again.");

      const config = { name: connection.name, connect_string: connection.connect_string };
      const [versionResult, updateResult] = await Promise.all([
        OracleConnectionService.queryAsDictViaSidecar(connection.name, config, VERSION_QUERY, VERSION_FETCH_LIMIT),
        OracleConnectionService.queryAsDictViaSidecar(connection.name, config, UPDATE_QUERY, UPDATE_FETCH_LIMIT),
      ]);

      const versions = (versionResult.rows || []).map(normalizeOracleRow);
      const updates = (updateResult.rows || []).map(normalizeOracleRow);
      const warnings = [];
      if ((versionResult.row_count || 0) >= VERSION_FETCH_LIMIT) {
        warnings.push(`Version fetch hit the ${VERSION_FETCH_LIMIT.toLocaleString()} row limit.`);
      }
      if ((updateResult.row_count || 0) >= UPDATE_FETCH_LIMIT) {
        warnings.push(`Update fetch hit the ${UPDATE_FETCH_LIMIT.toLocaleString()} row limit.`);
      }

      this.applyLedger(versions, updates, warnings);
      this.showSuccess(`Loaded ${versions.length} version(s) and ${updates.length} update(s) from ${connection.name}.`);
    } catch (error) {
      const message = this.errorMessage(error);
      this.setSourceError(message);
      this.showError(message);
    } finally {
      this.fetching = false;
      this.setFetchBusy(false);
    }
  }

  applyLedger(versions, updates, warnings = []) {
    this.ledger = { versions, updates };
    this.ledgerLoaded = true;
    this.sourceWarnings = warnings;
    this.renderAll();
  }

  setFetchBusy(busy) {
    if (this.el.fetchOracle) {
      this.el.fetchOracle.disabled = busy || this.connections.length === 0;
      this.el.fetchOracle.textContent = busy ? "Loading…" : "Load from Oracle";
    }
    if (this.el.connection) this.el.connection.disabled = busy || this.connections.length === 0;
  }

  renderAll() {
    this.analysis = analyzeLedger(this.ledger);
    this.renderReleaseOptions();
    this.renderHistorySummary();
    this.renderDataWarnings();
    this.renderReleaseFilter();
    this.renderHistory();
    this.renderPreview();
  }

  renderReleaseOptions() {
    if (!this.el.releaseOptions) return;
    this.el.releaseOptions.replaceChildren();
    this.analysis.releases.forEach((release) => {
      const option = document.createElement("option");
      option.value = release;
      this.el.releaseOptions.appendChild(option);
    });
  }

  renderHistorySummary() {
    if (!this.el.historySummary) return;
    if (!this.ledgerLoaded) {
      this.el.historySummary.textContent = "No localization data loaded.";
      return;
    }
    const versions = this.analysis.versions.length;
    const updates = this.analysis.updates.length;
    this.el.historySummary.textContent =
      `${versions} version${versions === 1 ? "" : "s"} · ${updates} update row${updates === 1 ? "" : "s"}` +
      ` · highest v${this.analysis.maxVersion}`;
  }

  renderDataWarnings() {
    if (!this.el.dataWarnings) return;
    const messages = [...this.sourceWarnings];
    const analysis = this.analysis;

    if (this.ledgerLoaded) {
      if (analysis.duplicateVersionNumbers.length > 0) {
        messages.push(`Duplicate version numbers: ${analysis.duplicateVersionNumbers.join(", ")}.`);
      }
      if (analysis.duplicateVersionIds.length > 0) {
        messages.push("Duplicate LANGUAGE_PACK_VERSION_ID values found.");
      }
      if (analysis.invalidVersions.length > 0) {
        messages.push(`${analysis.invalidVersions.length} version row(s) have a non-numeric version.`);
      }
      if (analysis.orphans.length > 0) {
        messages.push(`${analysis.orphans.length} update row(s) reference a missing version id.`);
      }
      if (analysis.versionsWithoutUpdates.length > 0) {
        messages.push(`${analysis.versionsWithoutUpdates.length} version row(s) have no update rows.`);
      }
    }

    this.el.dataWarnings.replaceChildren();
    if (messages.length === 0) {
      this.el.dataWarnings.hidden = true;
      return;
    }

    messages.forEach((message) => {
      const line = document.createElement("p");
      line.className = "lu-warning-line";
      line.textContent = message;
      this.el.dataWarnings.appendChild(line);
    });
    this.el.dataWarnings.hidden = false;
  }

  renderReleaseFilter() {
    if (!this.el.releaseFilter) return;
    const select = this.el.releaseFilter;
    const previous = this.releaseFilter;
    select.replaceChildren();

    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All releases";
    select.appendChild(all);

    this.analysis.releases.forEach((release) => {
      const option = document.createElement("option");
      option.value = release;
      option.textContent = release;
      select.appendChild(option);
    });

    if (previous && this.analysis.releases.includes(previous)) {
      select.value = previous;
    } else {
      this.releaseFilter = "";
      select.value = "";
    }
    select.disabled = this.analysis.releases.length === 0;
  }

  renderHistory() {
    if (!this.el.historyBody) return;
    const body = this.el.historyBody;
    const empty = this.el.historyEmpty;
    body.replaceChildren();

    if (!this.ledgerLoaded) {
      empty.hidden = false;
      empty.querySelector("strong").textContent = "No localization data";
      empty.querySelector("span").textContent = "Choose an environment and load from Oracle to inspect the version history.";
      this.el.historyCount.textContent = "";
      this.el.historyNote.textContent = "";
      return;
    }

    const term = this.historyFilter.trim().toLowerCase();
    const filtered = this.analysis.history.filter((row) => {
      if (this.releaseFilter && row.releaseId !== this.releaseFilter) return false;
      if (!term) return true;
      return (
        row.key.toLowerCase().includes(term) ||
        row.idValue.toLowerCase().includes(term) ||
        row.enValue.toLowerCase().includes(term) ||
        row.releaseId.toLowerCase().includes(term) ||
        String(row.version).includes(term)
      );
    });

    const visible = filtered.slice(0, HISTORY_LIMIT);
    this.el.historyCount.textContent = `${filtered.length.toLocaleString()} row${filtered.length === 1 ? "" : "s"}`;

    if (filtered.length === 0) {
      empty.hidden = false;
      empty.querySelector("strong").textContent = "No matching rows";
      empty.querySelector("span").textContent =
        this.analysis.history.length === 0 ? "The loaded versions have no update rows." : "Adjust the filter or release selection.";
      this.el.historyNote.textContent = "";
      return;
    }

    empty.hidden = true;
    const fragment = document.createDocumentFragment();

    visible.forEach((row) => {
      const tr = document.createElement("tr");

      const versionCell = document.createElement("td");
      versionCell.className = "lu-col-version";
      const versionStrong = document.createElement("strong");
      versionStrong.textContent = row.version >= 0 ? String(row.version) : "?";
      versionCell.appendChild(versionStrong);
      tr.appendChild(versionCell);

      const releaseCell = document.createElement("td");
      releaseCell.className = "lu-col-release";
      releaseCell.textContent = row.releaseId || "—";
      tr.appendChild(releaseCell);

      const keyCell = document.createElement("td");
      const keyCode = document.createElement("code");
      keyCode.textContent = row.key;
      keyCell.appendChild(keyCode);
      const tags = document.createElement("span");
      tags.className = "lu-change-tags";
      if (row.changes.isNewKey) {
        tags.appendChild(this.createChangeTag("new", "lu-change-new"));
      } else {
        if (row.changes.id) tags.appendChild(this.createChangeTag("ID", "lu-change-id"));
        if (row.changes.en) tags.appendChild(this.createChangeTag("EN", "lu-change-en"));
      }
      if (row.duplicateKeyInVersion) tags.appendChild(this.createChangeTag("duplicate", "lu-change-dup"));
      if (tags.childNodes.length > 0) keyCell.appendChild(tags);
      tr.appendChild(keyCell);

      const idCell = document.createElement("td");
      idCell.className = "lu-value-cell";
      idCell.textContent = row.idValue;
      idCell.title = row.idValue;
      tr.appendChild(idCell);

      const enCell = document.createElement("td");
      enCell.className = "lu-value-cell";
      enCell.textContent = row.enValue;
      enCell.title = row.enValue;
      tr.appendChild(enCell);

      const timeCell = document.createElement("td");
      timeCell.className = "lu-col-time";
      timeCell.textContent = this.formatTimestamp(row.updatedTime || row.createdTime);
      tr.appendChild(timeCell);

      fragment.appendChild(tr);
    });

    body.appendChild(fragment);
    this.el.historyNote.textContent =
      filtered.length > HISTORY_LIMIT
        ? `Showing the first ${HISTORY_LIMIT.toLocaleString()} of ${filtered.length.toLocaleString()} matching rows. Narrow the filter to see the rest.`
        : "";
  }

  createChangeTag(label, className) {
    const tag = document.createElement("span");
    tag.className = `lu-change-tag ${className}`;
    tag.textContent = label;
    return tag;
  }

  renderPreview() {
    if (!this.el.validation || !this.sqlEditor) return;

    const hasContent = Boolean(this.draft.releaseId) || this.draft.rows.some((row) => row.key || row.idValue || row.enValue);
    if (!hasContent) {
      this.lastSql = "";
      this.lastResult = null;
      this.el.validation.replaceChildren();
      this.el.validation.hidden = true;
      this.setSqlText("Choose a release and add localization keys to generate SQL.");
      this.setSqlActionsEnabled(false);
      return;
    }

    const result = validateBatch({
      releaseId: this.draft.releaseId,
      auditUser: this.draft.auditUser,
      rows: this.draft.rows,
    });
    this.lastResult = result;
    this.renderValidation(result);

    if (result.ok) {
      this.lastSql = generateInsertSql({
        releaseId: result.releaseId,
        auditUser: result.auditUser,
        rows: result.rows,
      });
      this.setSqlText(this.lastSql);
      this.setSqlActionsEnabled(true);
    } else {
      this.lastSql = "";
      this.setSqlText("Fix the validation issues to generate SQL.");
      this.setSqlActionsEnabled(false);
    }
  }

  renderValidation(result) {
    const container = this.el.validation;
    container.replaceChildren();
    if (result.errors.length === 0 && result.warnings.length === 0) {
      container.hidden = true;
      return;
    }

    result.errors.forEach((message) => {
      const line = document.createElement("p");
      line.className = "lu-validation-error";
      line.textContent = message;
      container.appendChild(line);
    });
    result.warnings.forEach((message) => {
      const line = document.createElement("p");
      line.className = "lu-validation-warning";
      line.textContent = message;
      container.appendChild(line);
    });
    container.hidden = false;
  }

  setSqlActionsEnabled(enabled) {
    if (this.el.copySql) this.el.copySql.disabled = !enabled;
    if (this.el.downloadSql) this.el.downloadSql.disabled = !enabled;
  }

  async copySql() {
    if (!this.lastSql || !this.lastResult?.ok) return;
    const copied = await this.copyToClipboard(this.lastSql, null, "INSERT SQL copied to clipboard");
    if (!copied) return;
    try {
      UsageTracker.trackToolUse("lockey-update", "copy", {
        rows: this.lastResult.rows.length,
      });
    } catch (_) {
      // Analytics must never interrupt the tool.
    }
  }

  downloadSql() {
    if (!this.lastSql || !this.lastResult?.ok) return;
    try {
      const safeRelease = String(this.lastResult.releaseId || "release").replace(/[^\w.-]+/g, "_");
      const filename = `lockey-update-${safeRelease}.sql`;
      const blob = new Blob([this.lastSql], { type: "text/sql;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      this.showSuccess(`Downloaded ${filename}`);
      try {
        UsageTracker.trackToolUse("lockey-update", "download", {
          rows: this.lastResult.rows.length,
        });
      } catch (_) {
        // Analytics must never interrupt the tool.
      }
    } catch (error) {
      this.showError(`Failed to download SQL: ${this.errorMessage(error)}`);
    }
  }

  setSourceError(message) {
    if (!this.el.sourceError) return;
    this.el.sourceError.textContent = message;
    this.el.sourceError.hidden = !message;
  }

  formatTimestamp(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  errorMessage(error) {
    if (typeof error === "string") return error;
    return error?.message || "Unexpected error.";
  }
}
