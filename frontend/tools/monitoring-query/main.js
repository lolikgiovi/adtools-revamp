import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { isTauri } from "../../core/Runtime.js";
import { analyzeSql } from "./sql-analysis.js";
import { MonitoringService } from "./service.js";
import { MonitoringDraftStore } from "./store.js";
import {
  MANAGED,
  KEYS,
  PARENTS,
  LABELS,
  valueText,
  equal,
  planChanges,
  cloneBranch,
  healthFindings,
  menuFor,
  columnsFor,
  columnName,
  columnType,
  canonicalNumber,
  validateChanges,
} from "./domain.js";
import { shell, escapeHtml as esc, button } from "./template.js";
import "./styles.css";

const friendly = (name) =>
  name
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
const title = (table, row) =>
  row?.MENU_LABEL || row?.GROUP_TITLE || row?.TABLE_TITLE || row?.FIELD_TITLE || row?.COLUMN_TITLE || row?.[KEYS[table]] || LABELS[table];
const frozenStates = new Set(["Checking Latest", "Updating", "Outcome Unknown"]);

export class MonitoringQuery extends BaseTool {
  constructor(eventBus) {
    super({ id: "monitoring-query", eventBus, isHeavyTool: true });
    this.service = new MonitoringService();
    this.store = new MonitoringDraftStore();
    this.connections = this.service.connections();
    this.state = "Draft";
    this.view = "inspect";
    this.section = "summary";
    this.revision = 0;
    this.editing = false;
    this.editors = [];
    this.loadSequence = 0;
    this.persistence = Promise.resolve();
    this.persistError = null;
  }
  render() {
    return shell(this.connections, isTauri());
  }
  get frozen() {
    return frozenStates.has(this.state) || this.loading;
  }
  get operations() {
    return this.tables ? planChanges(this.baseline, this.tables) : [];
  }
  get selectedRow() {
    return this.tables?.[this.selected?.table]?.find((row) => row[KEYS[this.selected.table]] === this.selected.id);
  }
  onMount() {
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    this.container.addEventListener(
      "click",
      (event) => {
        const target = event.target.closest("[data-action]");
        if (target && !target.disabled) this.action(target.dataset.action, target).catch((error) => this.fail(error));
      },
      options,
    );
    this.container.addEventListener("change", (event) => this.onChange(event).catch((error) => this.fail(error)), options);
    this.container.addEventListener(
      "input",
      (event) => {
        if (event.target.id === "mq-search") {
          this.search = event.target.value;
          this.renderMenus();
        } else if (event.target.dataset.column) this.updateField(event.target);
      },
      options,
    );
    this.beforeUnload = (event) => {
      if (this.frozen || this.persistError) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", this.beforeUnload, options);
    if (this.tables) {
      this.container.querySelector("#mq-connection").value = String(this.connections.findIndex((c) => c.name === this.connection.name));
      this.renderAll();
    }
  }
  status(message, error = false) {
    this.message = message;
    this.messageError = error;
    const element = this.container?.querySelector(".mq-status");
    if (element) {
      element.textContent = message;
      element.dataset.error = String(error);
    }
  }
  fail(error) {
    this.status(error.message || String(error), true);
    this.showError(error.message || "Monitoring operation failed");
  }
  async onChange(event) {
    if (event.target.id === "mq-connection") {
      if (this.frozen) return;
      this.targetChanged = true;
      this.editing = false;
      this.package = null;
      this.updateControls();
      await this.persist();
      this.loadSequence++;
      this.pendingConnection = this.connections[Number(event.target.value)];
      this.status("Choose Load to inspect this connection. Existing work remains saved with its original target.");
      // Never leave a prior target editable under a newly selected profile.
      this.targetChanged = true;
      this.editing = false;
      this.renderContent();
      this.updateControls();
    } else if (event.target.dataset.column) this.updateField(event.target);
  }
  async action(action, target) {
    if (this.frozen && !["verify", "resume", "inspect", "history", "history-more", "history-diff"].includes(action)) return;
    if (action === "load") return this.load();
    if (action.startsWith("copy-sql-")) return this.copyToClipboard(valueText(this.selectedRow[action.slice(9)]));
    if (action === "select") {
      this.editing = false;
      this.view = "inspect";
      this.selected = { table: target.dataset.table, id: target.dataset.id };
      const menu = menuFor(this.tables, this.selected.table, this.selectedRow);
      if (menu) this.menuId = menu;
      this.renderAll();
      return;
    }
    if (action === "inspect") {
      this.view = "inspect";
      this.editing = false;
      this.renderContent();
      return;
    }
    if (action === "tab") {
      this.section = target.dataset.section;
      this.selected = { table: "DSH_MENU", id: this.menuId };
      this.renderContent();
      return;
    }
    if (action === "edit") {
      this.editing = true;
      this.renderContent();
      return;
    }
    if (action === "done") {
      await this.persist();
      this.editing = false;
      this.renderAll();
      return;
    }
    if (action === "add-menu") return this.add("DSH_MENU");
    if (action === "add") return this.add(target.dataset.table);
    if (action === "clone") {
      const result = cloneBranch(this.tables, this.selected.table, this.selected.id);
      this.tables = result.tables;
      this.selected.id = result.newId;
      this.menuId = menuFor(this.tables, this.selected.table, this.selectedRow);
      this.editing = true;
      this.changed();
      this.renderAll();
      return;
    }
    if (action === "remove-new") {
      if ((this.baseline[this.selected.table] || []).some((row) => row[KEYS[this.selected.table]] === this.selected.id)) return;
      const remove = (table, id) => {
        for (const [child, parent] of Object.entries(PARENTS))
          if (parent[0] === table) {
            (this.tables[child] || []).filter((row) => row[parent[1]] === id).forEach((row) => remove(child, row[KEYS[child]]));
          }
        this.tables[table] = this.tables[table].filter((row) => row[KEYS[table]] !== id);
      };
      remove(this.selected.table, this.selected.id);
      this.selected = { table: "DSH_MENU", id: this.menuId };
      if (!this.selectedRow) {
        this.menuId = this.tables.DSH_MENU[0]?.MENU_ID;
        this.selected.id = this.menuId;
      }
      this.changed();
      this.renderAll();
      return;
    }
    if (action === "health") {
      this.view = "health";
      this.renderContent();
      return;
    }
    if (action === "review") {
      this.editing = false;
      this.view = "review";
      this.renderContent();
      return;
    }
    if (action === "apply") return this.apply();
    if (action === "generate") return this.generate();
    if (action === "copy") {
      if (this.package && !this.targetChanged) await this.copyToClipboard(this.package.sql);
      return;
    }
    if (action === "download") return this.download();
    if (action === "verify") return this.verify();
    if (action === "history") return this.history();
    if (action === "history-more") return this.history(this.historyNext);
    if (action === "history-diff") return this.historyDiff(target.dataset.id);
    if (action === "clear-clob") {
      this.selectedRow[target.dataset.column] = null;
      this.changed();
      this.renderContent();
      return;
    }
    if (action === "resolve-latest" || action === "resolve-draft")
      return this.resolveConflict(Number(target.dataset.index), action === "resolve-draft");
    if (action === "resume") {
      if (!this.reconciled) throw new Error("Verify Database must resolve the submitted request before editing resumes.");
      this.state = "Draft";
      this.submission = null;
      this.reconciled = false;
      await this.persist();
      this.renderAll();
      return;
    }
    if (action === "discard") {
      // Explicit inline discard step keeps accidental clicks recoverable until the second action.
      this.view = "discard";
      this.renderContent();
      return;
    }
    if (action === "confirm-discard") {
      await this.store.remove(this.draftKey);
      this.tables = structuredClone(this.baseline);
      this.revision++;
      this.package = null;
      this.submission = null;
      this.state = "Draft";
      this.view = "inspect";
      this.editing = false;
      this.status("Local draft discarded. Oracle was not changed.");
      this.renderAll();
    }
  }
  async load() {
    const value = this.container.querySelector("#mq-connection").value;
    const connection = this.connections[Number(value)];
    if (value === "" || !connection) throw new Error("Select an Oracle connection. Add credentials in Settings if needed.");
    await this.persist();
    const sequence = ++this.loadSequence;
    this.loading = true;
    this.updateControls();
    this.status("Loading complete configuration and validating MONITORING schema…");
    try {
      const result = await this.service.load(connection);
      if (sequence !== this.loadSequence) return;
      if (result.complete !== true || !result.tables) throw new Error("Oracle read was incomplete. The existing draft was retained.");
      if (!result.writable)
        this.status(`Read-only: ${(result.issues || []).map((i) => (typeof i === "string" ? i : i.message)).join("; ")}`);
      const targetKey = JSON.stringify([
        connection.id || connection.name,
        result.identity.database,
        result.identity.service,
        result.identity.schema,
      ]);
      const stored = await this.store.latest(targetKey).catch((error) => {
        this.persistError = error.message;
        return null;
      });
      if (sequence !== this.loadSequence) return;
      this.connection = connection;
      this.targetKey = targetKey;
      this.remote = result;
      this.identity = result.identity;
      this.readAt = new Date().toISOString();
      this.baselineReadAt = this.readAt;
      this.metadata = result.metadata;
      this.fingerprint = result.fingerprint || result.schemaFingerprint;
      this.targetChanged = false;
      this.baseline = structuredClone(result.tables);
      this.tables = structuredClone(result.tables);
      this.revision = 0;
      this.state = "Draft";
      this.submission = null;
      this.package = null;
      this.conflicts = [];
      this.menuId = result.tables.DSH_MENU[0]?.MENU_ID;
      this.draftId = stored?.draftId || crypto.randomUUID();
      this.draftKey = stored?.key || JSON.stringify([targetKey, this.menuId || "new-menu", this.draftId]);
      if (stored && (stored.operations?.length || stored.submission)) {
        this.baseline = stored.baseline;
        this.tables = stored.tables;
        this.revision = stored.revision;
        this.menuId = stored.menuId || this.menuId;
        this.submission = stored.submission;
        this.package = null;
        this.baselineReadAt = stored.baselineReadAt || stored.updatedAt;
        this.lastSubmission = stored.lastSubmission || null;
        this.expectedOperations = stored.expectedOperations || null;
        this.fingerprint = stored.fingerprint;
        this.state = this.submission ? "Outcome Unknown" : "Draft";
        this.needsRefresh = true;
        this.status(
          this.submission
            ? "Outcome Unknown. A submitted request was restored. Verify Database before resuming."
            : "Local draft restored. Latest Oracle data will be checked before apply or generation.",
        );
      } else
        this.status(
          `Loaded ${result.tables.DSH_MENU.length} menus from ${this.identity.database} / ${this.identity.service}. No Oracle changes made.`,
        );
      this.selected = { table: "DSH_MENU", id: this.menuId };
      this.view = "inspect";
      this.editing = false;
      UsageTracker.trackToolUse("monitoring-query", "load", { menu_count: result.tables.DSH_MENU.length });
      await this.persist();
    } finally {
      this.loading = false;
      this.renderAll();
    }
  }
  changed() {
    if (this.state !== "Draft" && !this.persistError) this.status("Draft changed. Review Changes before updating Oracle.");
    this.revision++;
    this.package = null;
    this.expectedOperations = null;
    this.lastSubmission = null;
    this.state = "Draft";
    this.reconciled = false;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 250);
    this.updateControls();
  }
  async persist() {
    if (!this.tables || !this.draftKey) return;
    const record = structuredClone({
      key: this.draftKey,
      targetKey: this.targetKey,
      draftId: this.draftId,
      menuId: this.menuId,
      baselineReadAt: this.baselineReadAt,
      baseline: this.baseline,
      tables: this.tables,
      fingerprint: this.fingerprint,
      identity: this.identity,
      revision: this.revision,
      lastSubmission: this.lastSubmission || null,
      expectedOperations: this.expectedOperations || null,
      operations: this.operations,
      submission: this.submission || null,
      package: this.package || null,
      updatedAt: new Date().toISOString(),
    });
    this.persistence = this.persistence.catch(() => {}).then(() => this.store.put(record));
    try {
      await this.persistence;
      this.persistError = null;
      this.updateControls();
    } catch (error) {
      this.persistError = error.message;
      this.status(error.message, true);
      this.updateControls();
    }
  }
  updateControls() {
    if (!this.container) return;
    const count = this.operations.length;
    this.container.querySelector(".mq-change-count").textContent = String(count);
    this.container.querySelector(".mq-draft-status").textContent = this.persistError
      ? "Draft not saved — keep this window open"
      : this.tables
        ? `${this.state} · ${count} pending ${count === 1 ? "row" : "rows"}${count ? " · Autosaved locally" : ""}`
        : "No local draft";
    for (const action of ["add-menu", "health", "review", "history", "discard"]) {
      const element = this.container.querySelector(`[data-action="${action}"]`);
      if (element)
        element.disabled =
          !this.tables || (this.frozen && action !== "history") || this.targetChanged || (["review", "discard"].includes(action) && !count);
    }
    this.container.querySelector("#mq-connection").disabled = this.frozen || !isTauri();
    this.container.querySelector('[data-action="load"]').disabled = this.frozen || !isTauri();
    if (this.frozen || this.targetChanged) {
      this.container
        .querySelectorAll(
          '.mq-content input,.mq-content select,.mq-content textarea,.mq-content [data-action="edit"],.mq-content [data-action="clone"],.mq-content [data-action="add"]',
        )
        .forEach((el) => {
          el.disabled = true;
        });
      this.editors.forEach((item) => item.editor.updateOptions({ readOnly: true }));
    }
  }
  renderAll() {
    if (!this.container) return;
    this.renderMenus();
    this.renderContent();
    this.updateControls();
  }
  renderMenus() {
    const element = this.container?.querySelector(".mq-menu-list");
    if (!element) return;
    const menus = (this.tables?.DSH_MENU || []).filter((row) =>
      `${row.MENU_LABEL} ${row.CHANNEL_NAME} ${row.MENU_ID}`.toLowerCase().includes((this.search || "").toLowerCase()),
    );
    const groups = Map.groupBy
      ? Map.groupBy(menus, (row) => row.CHANNEL_NAME)
      : menus.reduce((map, row) => map.set(row.CHANNEL_NAME, [...(map.get(row.CHANNEL_NAME) || []), row]), new Map());
    element.innerHTML =
      [...groups]
        .map(
          ([channel, rows]) =>
            `<div class="mq-channel">${esc(channel)}</div>${rows
              .sort((a, b) => Number(valueText(a.DISPLAY_ORDER)) - Number(valueText(b.DISPLAY_ORDER)) || a.MENU_ID.localeCompare(b.MENU_ID))
              .map((row) => {
                const pending = this.operations.filter((op) => menuFor(this.tables, op.table, op.desired) === row.MENU_ID).length;
                return `<button class="mq-menu" type="button" data-action="select" data-table="DSH_MENU" data-id="${esc(row.MENU_ID)}" aria-current="${this.menuId === row.MENU_ID}" ${this.frozen || this.targetChanged ? "disabled" : ""}>
        ${row.IS_ACTIVE !== "Y" ? '<span class="mq-inactive" title="Inactive"></span>' : ""}<span class="mq-menu-label">${esc(row.MENU_LABEL)}</span>${pending ? `<span class="mq-badge">${pending}</span>` : ""}</button>`;
              })
              .join("")}`,
        )
        .join("") || '<p class="mq-hint" style="padding:12px">No menus found.</p>';
  }
  disposeEditors() {
    this.editorEpoch = (this.editorEpoch || 0) + 1;
    for (const item of this.editors) {
      item.listener?.dispose();
      const model = item.editor.getModel();
      item.editor.dispose();
      model?.dispose();
    }
    this.editors = [];
  }
  renderContent() {
    if (!this.container || !this.tables) return;
    this.disposeEditors();
    const content = this.container.querySelector(".mq-content");
    const menu = this.tables.DSH_MENU.find((row) => row.MENU_ID === this.menuId);
    const back = button("inspect", "Back to Configuration");
    if (this.view === "discard") {
      content.innerHTML = `<h2>Discard Local Draft?</h2><p>Remove ${this.operations.length} pending changes from this draft. Oracle stays unchanged.</p><div class="mq-actions">${back}${button("confirm-discard", "Discard Draft")}</div>`;
    } else if (this.view === "health") {
      const findings = healthFindings(this.tables);
      content.innerHTML = `<div class="mq-section-heading"><h2>Configuration Health</h2>${back}</div><p class="mq-hint">Schema-wide findings. Existing defects are preserved; only affected edits are validated.</p>${findings.map((f) => `<div class="mq-review-row"><button class="mq-row-link" data-action="select" data-table="${f.table}" data-id="${esc(f.id)}">${esc(f.table)} · ${esc(f.id)}</button><p>${esc(f.message)}</p></div>`).join("") || "<p>No structural findings.</p>"}`;
    } else if (this.view === "review") {
      content.innerHTML = this.reviewHtml();
    } else if (this.view === "history") {
      content.innerHTML = this.historyHtml();
    } else {
      const row = this.selectedRow;
      content.innerHTML = `<nav class="mq-breadcrumb" aria-label="Configuration breadcrumb"><span>${esc(menu?.CHANNEL_NAME || "Monitoring")}</span><span aria-hidden="true">/</span>
        <button data-action="select" data-table="DSH_MENU" data-id="${esc(this.menuId)}">${esc(menu?.MENU_LABEL || "Menus")}</button>${this.selected?.table !== "DSH_MENU" ? `<span aria-hidden="true">/</span><span>${esc(title(this.selected.table, row))}</span>` : ""}</nav>
        ${row ? this.entityHtml(row) : `<div class="mq-empty"><h2>No Menu Selected</h2><p>Add a menu to begin a local draft.</p>${button("add-menu", "Add Menu", this.frozen)}</div>`}`;
      this.mountEditors();
    }
    this.updateControls();
  }
  entityHtml(row) {
    const table = this.selected.table;
    const writable = MANAGED.includes(table);
    const existing = this.baseline[table]?.some((r) => r[KEYS[table]] === row[KEYS[table]]);
    const count = this.operations.filter((op) => op.table === table && op.desired[KEYS[table]] === row[KEYS[table]]).length;
    let html = `<div class="mq-section-heading"><h2>${esc(title(table, row))} ${count ? '<span class="mq-badge">Draft</span>' : ""}</h2><div class="mq-actions">${writable ? (this.editing ? button("done", "Done Editing") : button("edit", "Edit")) : '<span class="mq-badge">Read-only</span>'}${writable ? button("clone", "Clone") : ""}${!existing && writable ? button("remove-new", "Remove New Block") : ""}</div></div>`;
    if (table === "DSH_MENU" && !this.editing) {
      html += `<p class="mq-hint" translate="no">${esc(row.MENU_ID)} · ${row.IS_ACTIVE === "Y" ? "Active" : "Inactive"} · Display order ${esc(valueText(row.DISPLAY_ORDER))}</p>
        <div class="mq-tabs" aria-label="Menu sections">${["summary", "details", "compatibility"].map((section) => `<button class="mq-tab" data-action="tab" data-section="${section}" aria-current="${this.section === section ? "page" : "false"}">${friendly(section)}</button>`).join("")}</div>`;
      const child =
        this.section === "summary" ? "DSH_SUMMARY_GROUP" : this.section === "details" ? "DSH_DETAIL_TABLE" : "DSH_SUMMARY_QUERY";
      html += this.listHtml(
        child,
        (this.tables[child] || []).filter((item) => item.MENU_ID === this.menuId),
      );
      if (child !== "DSH_SUMMARY_QUERY")
        html += `<div class="mq-actions" style="margin-top:14px"><button class="mq-button" data-action="add" data-table="${child}">Add ${LABELS[child]}</button></div>`;
      else html += '<p class="mq-hint">Compatibility configuration is read-only until its runtime role is confirmed.</p>';
      return html;
    }
    html += `<div class="mq-form">${columnsFor(this.metadata, table)
      .map((column) => this.fieldHtml(column, row, existing))
      .join("")}</div>`;
    const child = table === "DSH_SUMMARY_GROUP" ? "DSH_SUMMARY_FIELD" : table === "DSH_DETAIL_TABLE" ? "DSH_DETAIL_COLUMN" : null;
    if (child) {
      const analysis = analyzeSql(valueText(row.SQL_TEXT));
      const missing = analysis.projectionVerified
        ? this.tables[child].filter((item) => item[PARENTS[child][1]] === row[KEYS[table]] && !analysis.aliases.includes(item.SOURCE_FIELD))
        : [];
      html += `<p class="mq-hint">Detected binds: ${esc(analysis.binds.join(", ") || "none")}. ${analysis.projectionVerified ? `Parsed output mappings: ${esc(analysis.aliases.join(", "))}.` : "Output mappings are unverified; the query projection could not be resolved confidently."} Static analysis only; runtime alias casing and bind compatibility are unverified.</p>`;
      if (missing.length)
        html += `<p class="mq-warning">Mapping warning: ${esc(missing.map((item) => item.SOURCE_FIELD).join(", "))} was not found in the parsed projection. Confirm the intended output alias.</p>`;
      const expectedBinds = table === "DSH_DETAIL_TABLE" ? ["startDate", "endDate", "offset", "limit"] : ["startDate", "endDate"];
      const extraBinds = analysis.binds.filter((bind) => !expectedBinds.includes(bind));
      if (extraBinds.length)
        html += `<p class="mq-warning">Additional binds: ${esc(extraBinds.join(", "))}. Confirm support in the monitoring runtime; no bind names were changed.</p>`;
      html += `<div class="mq-section-heading" style="margin-top:24px"><h2>${child === "DSH_SUMMARY_FIELD" ? "Fields" : "Columns"}</h2><button class="mq-button" data-action="add" data-table="${child}">Add ${LABELS[child]}</button></div>${this.listHtml(
        child,
        this.tables[child].filter((item) => item[PARENTS[child][1]] === row[KEYS[table]]),
      )}`;
    }
    return html;
  }
  listHtml(table, rows) {
    if (!rows.length) return '<p class="mq-hint">No configuration in this section yet.</p>';
    const mapping = ["DSH_SUMMARY_FIELD", "DSH_DETAIL_COLUMN"].includes(table);
    return `<div class="mq-table-wrap"><table class="mq-rows"><thead><tr><th>${mapping ? "Label" : "Query"}</th><th>${mapping ? "Mapping" : "Datasource"}</th><th>${mapping ? "Format" : "Timeout"}</th><th>Order</th></tr></thead><tbody>${rows
      .sort(
        (a, b) =>
          Number(valueText(a.DISPLAY_ORDER)) - Number(valueText(b.DISPLAY_ORDER)) ||
          String(a[KEYS[table]]).localeCompare(String(b[KEYS[table]])),
      )
      .map(
        (row) =>
          `<tr><td><button class="mq-row-link" data-action="select" data-table="${table}" data-id="${esc(row[KEYS[table]])}">${esc(title(table, row))}</button><div class="mq-hint" translate="no">${esc(row[KEYS[table]])}</div></td><td>${esc(mapping ? row.SOURCE_FIELD : this.tables.DSH_DATASOURCE.find((ds) => ds.DATASOURCE_ID === row.DATASOURCE_ID)?.DISPLAY_NAME || row.DATASOURCE_ID)}</td><td>${esc(mapping ? row.VALUE_FORMAT : valueText(row.TIMEOUT_MS))}</td><td>${esc(valueText(row.DISPLAY_ORDER))}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
  }
  fieldHtml(column, row, existing) {
    const name = columnName(column);
    const type = columnType(column);
    const table = this.selected.table;
    const immutable =
      (existing && [KEYS[table], PARENTS[table]?.[1], "DATASOURCE_ID"].includes(name)) ||
      ["CREATED_AT", "CREATED_BY", "UPDATED_AT", "UPDATED_BY"].includes(name);
    const readOnly = !this.editing || immutable || !MANAGED.includes(table) || this.frozen;
    const required = column.nullable === false || column.nullable === "N";
    const val = row[name];
    const label = `${friendly(name)}${required && !immutable ? " *" : ""}`;
    const attributes = `name="${name}" data-column="${name}" autocomplete="off" spellcheck="false" ${readOnly ? "readonly" : ""}`;
    const error = validateChanges(this.operations, this.metadata, this.tables).find(
      (e) => e.table === table && e.id === row[KEYS[table]] && e.column === name,
    );
    if (type === "CLOB")
      return `<div class="mq-field mq-full"><span id="mq-label-${name}">${label} ${val === null ? '<span class="mq-badge">NULL</span>' : ""}</span><div class="mq-actions">${button(`copy-sql-${name}`, "Copy SQL")}${!readOnly && !required ? `<button class="mq-button" data-action="clear-clob" data-column="${name}">Clear → NULL</button>` : ""}<span class="mq-hint">Full CLOB · ${new TextEncoder().encode(valueText(val)).length.toLocaleString()} bytes · Stored SQL is never executed here</span></div><div class="mq-sql" data-sql-column="${name}" aria-labelledby="mq-label-${name}"></div>${error ? `<small class="mq-error">${esc(error.message)}</small>` : ""}</div>`;
    const enums = {
      IS_ACTIVE: ["Y", "N"],
      SHOW_CHART: ["Y", "N"],
      TONE: ["ok", "fail", "pend", "info"],
      ALIGN: ["left", "right"],
      CHART_TYPE: ["bar", "line"],
    };
    let input;
    if (name === "DATASOURCE_ID" && !readOnly)
      input = `<select ${attributes}><option value="">Choose datasource…</option>${this.tables.DSH_DATASOURCE.map((ds) => `<option value="${esc(ds.DATASOURCE_ID)}" ${ds.DATASOURCE_ID === val ? "selected" : ""}>${esc(ds.DISPLAY_NAME)} (${esc(ds.DATASOURCE_ID)})</option>`).join("")}</select>`;
    else if (enums[name] && !readOnly)
      input = `<select ${attributes}>${!required ? '<option value="">NULL</option>' : ""}${enums[name].map((value) => `<option ${value === val ? "selected" : ""}>${value}</option>`).join("")}</select>`;
    else
      input = `<input ${attributes} type="text" ${type === "NUMBER" ? 'inputmode="decimal"' : ""} value="${esc(valueText(val))}" ${error ? 'aria-invalid="true"' : ""}>`;
    return `<label class="mq-field"><span>${label}</span>${input}${error ? `<small class="mq-error">${esc(error.message)}</small>` : ""}${immutable ? "<small>Database identity / audit attribute</small>" : ""}</label>`;
  }
  async mountEditors() {
    const epoch = this.editorEpoch;
    const hosts = [...this.container.querySelectorAll("[data-sql-column]")];
    if (!hosts.length) return;
    try {
      const { createOracleEditor } = await import("../../core/MonacoOracle.js");
      if (!this.container || epoch !== this.editorEpoch) return;
      for (const host of hosts) {
        const column = host.dataset.sqlColumn;
        const row = this.selectedRow;
        const readOnly = !this.editing || this.frozen || !MANAGED.includes(this.selected.table);
        const editor = createOracleEditor(host, {
          value: valueText(row[column]),
          readOnly,
          ariaLabel: friendly(column),
          theme: document.documentElement.classList.contains("dark") ? "oracle-dml-dark" : "vs",
          wordWrap: "on",
        });
        const listener = editor.onDidChangeModelContent(() => {
          if (!readOnly && !this.frozen && !this.targetChanged) {
            row[column] = { type: "clob", value: editor.getValue() };
            this.changed();
          }
        });
        this.editors.push({ editor, listener, column });
      }
    } catch {
      if (!this.container || epoch !== this.editorEpoch) return;
      for (const host of hosts) {
        const column = host.dataset.sqlColumn;
        host.innerHTML = `<textarea class="mq-sql-fallback" aria-label="${friendly(column)}" name="${column}" data-column="${column}" spellcheck="false" ${!this.editing ? "readonly" : ""}>${esc(valueText(this.selectedRow[column]))}</textarea>`;
      }
      this.status("SQL editor unavailable. Full text editing remains available.");
    }
  }
  updateField(input) {
    if (!this.editing || this.frozen || this.targetChanged || !this.selectedRow) return;
    const column = input.dataset.column;
    const meta = columnsFor(this.metadata, this.selected.table).find((item) => columnName(item) === column);
    if (!meta) return;
    const row = this.selectedRow;
    const oldId = row[KEYS[this.selected.table]];
    let value = input.value;
    if (columnType(meta) === "NUMBER") {
      try {
        value = { type: "number", value: canonicalNumber(value) };
        input.setCustomValidity("");
      } catch (error) {
        input.setCustomValidity(error.message);
        value = { type: "number", value };
      }
    } else if (columnType(meta) === "CLOB") value = { type: "clob", value };
    else if (value === "") value = null;
    if (equal(row[column], value)) return;
    if (column === KEYS[this.selected.table]) {
      if (this.baseline[this.selected.table]?.some((item) => item[column] === oldId)) return;
      if (this.tables[this.selected.table].some((item) => item !== row && item[column] === value)) {
        input.setCustomValidity("ID already exists");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      for (const [child, parent] of Object.entries(PARENTS))
        if (parent[0] === this.selected.table) {
          this.tables[child]
            .filter((item) => item[parent[1]] === oldId)
            .forEach((item) => {
              item[parent[1]] = value;
            });
        }
      this.selected.id = value;
      if (this.selected.table === "DSH_MENU") this.menuId = value;
    }
    row[column] = value;
    this.changed();
  }
  add(table) {
    if (!this.metadata || !MANAGED.includes(table)) return;
    const row = {};
    for (const column of columnsFor(this.metadata, table)) {
      const name = columnName(column);
      const def = String(column.default ?? "").trim();
      const type = columnType(column);
      row[name] = type === "NUMBER" && /^\d+$/.test(def) ? { type: "number", value: def } : /^'.*'$/.test(def) ? def.slice(1, -1) : null;
    }
    row[KEYS[table]] = crypto.randomUUID();
    if (PARENTS[table]) {
      const parent = PARENTS[table];
      row[parent[1]] = parent[0] === "DSH_MENU" ? this.menuId : this.selected.id;
    }
    if ("DATASOURCE_ID" in row) row.DATASOURCE_ID = this.tables.DSH_DATASOURCE[0]?.DATASOURCE_ID || null;
    this.tables[table].push(row);
    if (table === "DSH_MENU") this.menuId = row.MENU_ID;
    this.selected = { table, id: row[KEYS[table]] };
    this.view = "inspect";
    this.editing = true;
    this.changed();
    this.renderAll();
  }
  reviewHtml() {
    const operations = this.operations;
    const errors = validateChanges(operations, this.metadata, this.tables);
    const blocked =
      this.frozen || this.commitRefreshPending || this.targetChanged || !this.remote.writable || !operations.length || errors.length;
    const actor = this.identity.username;
    return `<div class="mq-section-heading"><h2>Review Changes <span class="mq-badge">Revision ${this.revision}</span></h2>${button("inspect", "Back to Configuration")}</div>
      <p class="mq-hint">${operations.length} rows · ${esc(this.identity.database)} / ${esc(this.identity.service)} / MONITORING<br>Actor: ${esc(actor)} · Connected Oracle username. Review complete values before Update Oracle.</p>
      ${this.needsRefresh ? '<p class="mq-warning">Restored draft: latest Oracle rows will be checked before writing.</p>' : ""}
      ${errors.map((error) => `<p class="mq-error"><button class="mq-row-link" data-action="select" data-table="${error.table}" data-id="${esc(error.id)}">${esc(error.id)}</button> · ${esc(error.message)}</p>`).join("")}
      ${this.conflicts?.map((conflict, index) => `<div class="mq-review-row"><strong>Conflict · ${esc(conflict.table)} · ${esc(conflict.id || conflict.recordId || "")}</strong><div class="mq-diff"><div>Original baseline<pre>${esc(JSON.stringify(conflict.baseline, null, 2))}</pre></div><div>Latest Oracle<pre>${esc(JSON.stringify(conflict.latest, null, 2))}</pre></div></div><div>Proposed<pre class="mq-code">${esc(JSON.stringify(conflict.desired, null, 2))}</pre></div><div class="mq-actions"><button class="mq-button" data-action="resolve-latest" data-index="${index}">Keep Latest</button><button class="mq-button" data-action="resolve-draft" data-index="${index}" ${!conflict.latest ? "disabled" : ""}>Reapply Draft onto Latest</button></div></div>`).join("") || ""}
      ${
        operations
          .map(
            (
              op,
            ) => `<details class="mq-review-row"><summary><span class="mq-badge">${op.action === "INSERT" ? "Create New" : "Update Existing"}</span> ${esc(LABELS[op.table])} · <span translate="no">${esc(op.desired[KEYS[op.table]])}</span> · ${op.columns.length} fields</summary>${op.columns.map((column) => `<div><strong>${friendly(column)}</strong><div class="mq-diff"><div>Before<pre>${esc(op.baseline?.[column] === null || !op.baseline ? "NULL" : valueText(op.baseline?.[column]))}</pre></div><div>After<pre>${esc(op.desired[column] === null ? "NULL" : valueText(op.desired[column]))}</pre></div></div></div>`).join("")}
      <details><summary>SQL template — requires backend bindings</summary><pre class="mq-code">${esc(this.sqlTemplate(op))}</pre><pre class="mq-code">${esc(JSON.stringify({ baseline: op.baseline, desired: op.desired }, null, 2))}</pre></details></details>`,
          )
          .join("") || "<p>No pending changes.</p>"
      }
      ${this.package ? `<details class="mq-review-row"><summary>Standalone SQL · ${esc(this.package.packageId)}</summary><p class="mq-hint" translate="no">SHA-256 ${esc(this.package.scriptSha256)}</p><pre class="mq-code">${esc(this.package.sql)}</pre></details>` : ""}
      <div class="mq-review-actions">${button("apply", this.state === "Updating" ? "Updating…" : "Update Oracle", Boolean(blocked || this.conflicts?.length), "mq-primary")}
      ${button("generate", "Generate SQL", Boolean(blocked || this.conflicts?.length))}${button("copy", "Copy SQL", !this.package || this.frozen)}${button("download", "Download Package", !this.package || this.frozen)}
      ${button("verify", "Verify Database", !this.submission && !this.expectedOperations)}${button("handoff", "Open in Run Query", true)}
      ${this.state === "Outcome Unknown" && this.reconciled ? button("resume", "Resume Editing") : ""}
      <span class="mq-hint">Run Query handoff requires verified runner compatibility and an explicit target mapping.</span></div>`;
  }
  sqlTemplate(op) {
    const columns = op.columns.filter((column) => column !== KEYS[op.table]);
    return op.action === "INSERT"
      ? `INSERT INTO MONITORING.${op.table} (${Object.keys(op.desired).join(", ")})\nVALUES (${Object.keys(op.desired)
          .map((column) => `:${column.toLowerCase()}`)
          .join(", ")});`
      : `UPDATE MONITORING.${op.table}\nSET ${columns.map((column) => `${column} = :${column.toLowerCase()}`).join(",\n    ")}\nWHERE ${KEYS[op.table]} = :pk;`;
  }
  async preflight(operations) {
    const latest = await this.service.load(this.connection);
    if (
      !latest.complete ||
      !latest.writable ||
      JSON.stringify(latest.identity) !== JSON.stringify(this.identity) ||
      latest.fingerprint !== this.fingerprint
    ) {
      throw new Error("Target identity, schema or read completeness changed. Reload and review the configuration.");
    }
    const conflicts = operations.flatMap((op) => {
      const current = latest.tables[op.table].find((row) => row[KEYS[op.table]] === op.desired[KEYS[op.table]]);
      if ((op.action === "INSERT" && current) || (op.action === "UPDATE" && !equal(current, op.baseline))) {
        return [
          {
            table: op.table,
            id: op.desired[KEYS[op.table]],
            baseline: op.baseline,
            latest: current || null,
            desired: op.desired,
            action: op.action,
          },
        ];
      }
      return [];
    });
    if (conflicts.length) {
      this.conflicts = conflicts;
      this.state = "Conflict";
      this.status("Oracle changed since load. Resolve the baseline/latest/draft conflicts, then review again.", true);
      return false;
    }
    for (const op of operations) {
      const parents = PARENTS[op.table] ? [PARENTS[op.table]] : [];
      if (op.desired.DATASOURCE_ID) parents.push(["DSH_DATASOURCE", "DATASOURCE_ID"]);
      for (const [parentTable, parentColumn] of parents) {
        const key = op.desired[parentColumn];
        const present =
          latest.tables[parentTable]?.some((row) => row[KEYS[parentTable]] === key) ||
          operations.some(
            (parent) => parent.action === "INSERT" && parent.table === parentTable && parent.desired[KEYS[parentTable]] === key,
          );
        if (!present) throw new Error(`${op.table}: referenced ${parentColumn} no longer exists. Refresh or resolve the draft.`);
      }
    }
    this.needsRefresh = false;
    return true;
  }
  async apply() {
    if (this.view !== "review" || this.frozen || this.targetChanged) return;
    const operations = structuredClone(this.operations);
    if (!operations.length) return;
    const errors = validateChanges(operations, this.metadata, this.tables);
    if (errors.length) throw new Error(errors[0].message);
    this.state = "Checking Latest";
    this.renderAll();
    this.status("Checking latest Oracle rows…");
    let dispatched = false;
    try {
      if (!(await this.preflight(operations))) return;
      const request = {
        identity: this.identity,
        fingerprint: this.fingerprint,
        operations,
        requestId: crypto.randomUUID(),
        changeId: crypto.randomUUID(),
        revision: this.revision,
        actor: { source: "oracle-username", name: this.identity.username, databaseUsername: this.identity.username },
      };
      this.submission = structuredClone(request);
      await this.persist();
      if (this.persistError)
        throw new Error("Submission could not be persisted. Oracle was not contacted. Resolve local storage before applying.");
      this.state = "Updating";
      this.renderAll();
      this.status("Updating Oracle in one guarded transaction…");
      dispatched = true;
      const result = await this.service.apply(this.connection, request);
      if (result.state === "Committed") {
        this.expectedOperations = operations;
        this.lastSubmission = request;
        this.state = "Committed";
        await this.acceptCommitted(result);
        this.submission = null;
        this.status(`Committed · Change ${request.changeId}. Open History or Verify Database for readback.`);
      } else if (result.state === "Outcome Unknown") {
        this.state = "Outcome Unknown";
        this.status("Outcome Unknown. Verify Database and history before another write.", true);
      } else {
        this.state = result.state === "Conflict" ? "Conflict" : "Failed";
        this.conflicts = result.conflicts || [];
        this.submission = null;
        this.status(
          result.message || result.error?.message || `Oracle returned ${result.state}. No confirmed commit. Draft retained.`,
          true,
        );
      }
    } catch (error) {
      this.state = dispatched ? "Outcome Unknown" : "Failed";
      if (!dispatched) this.submission = null;
      this.status(dispatched ? "Outcome Unknown. The commit response was lost. Verify Database before resuming." : error.message, true);
    } finally {
      await this.persist();
      this.renderAll();
    }
  }
  async acceptCommitted(_result) {
    this.commitRefreshPending = true;
    // Always refresh from committed readback. A refresh failure retains Committed rather than inventing rollback.
    try {
      const loaded = await this.service.load(this.connection);
      if (loaded.complete && equal(loaded.identity, this.identity)) {
        this.baseline = structuredClone(loaded.tables);
        this.tables = structuredClone(loaded.tables);
        this.remote = loaded;
        this.package = null;
        this.revision++;
        this.commitRefreshPending = false;
        this.baselineReadAt = new Date().toISOString();
      } else this.status("Committed; database refresh is pending. Use Verify Database.");
    } catch {
      this.status("Committed; database refresh is pending. Use Verify Database.");
    }
  }
  resolveConflict(index, reapply) {
    const conflict = this.conflicts[index];
    if (!conflict) return;
    const { table, id, latest, baseline, desired } = conflict;
    if (conflict.action === "INSERT" && reapply) throw new Error("New ID already exists. Keep Latest, then create a row with a fresh ID.");
    this.baseline[table] = this.baseline[table].filter((row) => row[KEYS[table]] !== id);
    this.tables[table] = this.tables[table].filter((row) => row[KEYS[table]] !== id);
    if (latest) {
      this.baseline[table].push(structuredClone(latest));
      const resolved = structuredClone(latest);
      if (reapply)
        for (const column of Object.keys(desired))
          if (!equal(baseline?.[column], desired[column])) resolved[column] = structuredClone(desired[column]);
      this.tables[table].push(resolved);
    }
    this.conflicts.splice(index, 1);
    this.changed();
    this.renderAll();
  }
  async generate() {
    const operations = structuredClone(this.operations);
    this.state = "Checking Latest";
    this.renderAll();
    try {
      if (!(await this.preflight(operations))) return;
      const { createPackage } = await import("./package.js");
      this.package = await createPackage({
        identity: this.identity,
        fingerprint: this.fingerprint,
        metadata: this.metadata,
        operations,
        revision: this.revision,
        baselineReadAt: this.baselineReadAt,
        readAt: new Date().toISOString(),
        actor: { source: "oracle-username", name: this.identity.username, databaseUsername: this.identity.username },
      });
      await this.store.put({ key: this.package.packageId, ...this.package }, "packages");
      this.lastSubmission = null;
      this.expectedOperations = operations;
      this.state = "Generated";
      this.status("Standalone guarded SQL generated. Copy/download includes embedded values; it has not executed.");
    } catch (error) {
      this.state = "Draft";
      this.fail(error);
    } finally {
      if (this.state === "Checking Latest") this.state = "Draft";
      await this.persist();
      this.renderAll();
    }
  }
  async download() {
    if (!this.package || this.targetChanged) return;
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(this.package.manifest, null, 2));
    zip.file("apply.sql", this.package.sql);
    zip.file("verify.sql", this.package.verifySql);
    zip.file("changes.json", JSON.stringify(this.package.changes, null, 2));
    const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `monitoring-${this.package.packageId}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async verify() {
    const request = {
      ...(this.submission ||
        this.lastSubmission || { identity: this.identity, fingerprint: this.fingerprint, operations: this.expectedOperations }),
      outcomeUnknown: this.state === "Outcome Unknown",
    };
    if (!request.operations?.length) throw new Error("No submitted or generated change set to verify.");
    this.status("Verifying complete Oracle values and change history…");
    const result = await this.service.verify(this.connection, request);
    if (this.state === "Outcome Unknown") {
      this.reconciled = result.state === "Verified";
      this.status(
        result.state === "Verified"
          ? "Submitted change verified with committed audit evidence. Choose Resume Editing to continue."
          : "Outcome Unknown remains unresolved. Database or audit evidence is incomplete; do not retry.",
        result.state !== "Verified",
      );
      if (this.reconciled) await this.acceptCommitted(result);
    } else {
      this.state = result.state === "Verified" ? "Verified" : "Verification Mismatch";
      if (result.state === "Verified") await this.acceptCommitted(result);
      this.status(result.message || this.state, this.state !== "Verified");
    }
    await this.persist();
    this.renderAll();
  }
  async history(cursor = null) {
    this.editing = false;
    this.view = "history";
    const historySequence = (this.historySequence = (this.historySequence || 0) + 1);
    const menuId = this.menuId;
    const identity = this.identity;
    this.historyError = null;
    this.historyLoading = true;
    this.renderContent();
    try {
      const result = await this.service.history(this.connection, {
        identity: this.identity,
        menuId: this.menuId,
        offset: cursor || 0,
        pageSize: 20,
      });
      if (historySequence !== this.historySequence || this.menuId !== menuId || this.identity !== identity || this.view !== "history")
        return;
      this.historyEntries = cursor
        ? [...(this.historyEntries || []), ...(result.entries || result.transactions || [])]
        : result.entries || result.transactions || [];
      this.historyNext = result.nextOffset ?? null;
      this.historyComplete = result.complete;
      this.historyMessage = result.message;
    } catch (error) {
      if (historySequence === this.historySequence) this.historyError = error.message;
    } finally {
      this.historyLoading = false;
      this.renderContent();
    }
  }
  historyHtml() {
    return `<div class="mq-section-heading"><h2>Change History</h2>${button("inspect", "Back to Configuration")}</div><p class="mq-hint">Committed changes for ${esc(this.menuId)}. History is read-only; no automatic undo.</p>
      ${
        this.historyLoading
          ? '<p role="status">Loading history…</p>'
          : this.historyError
            ? `<p class="mq-error">${esc(this.historyError)}. Check history access and retry.</p>`
            : (this.historyEntries || [])
                .map(
                  (entry) =>
                    `<details class="mq-review-row"><summary>${esc(valueText(entry.changedAt || entry.time || ""))} · ${esc(entry.changedBy || entry.actor || "")} · ${esc(entry.changeId || entry.auditId || "Legacy entry")} · ${esc(entry.operationCount || entry.count || "")} rows</summary><pre class="mq-code">${esc(JSON.stringify(entry, null, 2))}</pre>${entry.oldValue !== undefined ? `<div class="mq-diff"><div>Before${this.historyRowHtml(entry.oldValue?.row)}</div><div>After${this.historyRowHtml(entry.newValue?.row)}</div></div>` : ""}${entry.oldValue === undefined && (entry.auditId || entry.changeId) ? `<button class="mq-button" data-action="history-diff" data-id="${esc(entry.changeId || entry.auditId)}">Open Complete Diff</button>` : ""}</details>`,
                )
                .join("") || "<p>No matching history entries in this page.</p>"
      }
      ${this.historyNext ? button("history-more", "Load More") : ""}${this.historyComplete === false ? '<p class="mq-warning">History is incomplete. This page does not prove a complete transaction.</p>' : ""}`;
  }
  historyRowHtml(row) {
    if (!row) return '<pre class="mq-code">NULL — new row</pre>';
    return Object.entries(row)
      .map(
        ([column, value]) =>
          `<strong>${esc(friendly(column))}</strong><pre class="mq-code">${esc(value === null ? "NULL" : valueText(value))}</pre>`,
      )
      .join("");
  }
  async historyDiff(id) {
    const result = await this.service.history(this.connection, {
      identity: this.identity,
      menuId: this.menuId,
      ...(/^\d+$/.test(id) ? { auditIds: [id] } : { changeId: id }),
    });
    this.historyEntries = result.entries || [result];
    this.historyNext = null;
    this.historyComplete = result.complete;
    this.renderContent();
  }
  hasActiveBackgroundWork() {
    return this.frozen;
  }
  onSoftDeactivate() {
    clearTimeout(this.saveTimer);
    this.persist();
    this.disposeEditors();
  }
  onWarmResume() {
    if (this.container && this.tables) this.renderAll();
  }
  onUnmount() {
    clearTimeout(this.saveTimer);
    this.persist();
    this.loadSequence++;
    this.abort?.abort();
    this.disposeEditors();
  }
  disposeHeavyResources() {
    this.disposeEditors();
  }
}
