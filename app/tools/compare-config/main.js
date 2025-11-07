import { BaseTool } from "../../core/BaseTool.js";
import { isTauri } from "../../core/Runtime.js";
import { CompareConfigTemplate } from "./template.js";
import "./styles.css";
import { UsageTracker } from "../../core/UsageTracker.js";

function parseFields(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function el(id) {
  return document.getElementById(id);
}

export class CompareConfigTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "compare-config",
      name: "Compare Config",
      description: "Compare Oracle configuration records across environments",
      icon: "database",
      category: "config",
      eventBus,
    });
    this.lastResult = null;
    this.viewMode = "rows"; // rows | cards | master
  }

  render() {
    return CompareConfigTemplate;
  }

  async onMount() {
    // Gate on Tauri availability
    const tauri = isTauri();
    const disableAll = (msg) => {
      this.toggleUIEnabled(false);
      const cs = el("clientStatus");
      if (cs) cs.textContent = msg;
      const guide = el("clientGuide");
      if (guide) guide.style.display = "";
    };

    if (!tauri) {
      disableAll("Tauri runtime not detected — Oracle features disabled.");
      return;
    }

    // Wire actions
    el("btnCheckPrime").addEventListener("click", () => this.checkAndPrime());
    el("btnSetCreds1").addEventListener("click", () => this.setCreds(1));
    el("btnGetCreds1").addEventListener("click", () => this.getCreds(1));
    el("btnTestConn1").addEventListener("click", () => this.testConn(1));
    el("btnSetCreds2").addEventListener("click", () => this.setCreds(2));
    el("btnGetCreds2").addEventListener("click", () => this.getCreds(2));
    el("btnTestConn2").addEventListener("click", () => this.testConn(2));
    el("btnCompare").addEventListener("click", () => {
      try { UsageTracker.trackFeature("compare-config", "compare"); } catch (_) {}
      this.compare();
    });
    el("btnExportJson").addEventListener("click", () => this.exportResult("json"));
    el("btnExportCsv").addEventListener("click", () => this.exportResult("csv"));

    // Filters
    ["fltMatches", "fltDifferences", "fltOnlyEnv1", "fltOnlyEnv2"].forEach((id) => {
      const box = el(id);
      if (box) box.addEventListener("change", () => this.applyFilters());
    });

    // Presets
    el("btnSavePreset").addEventListener("click", () => this.savePreset());
    el("btnApplyPreset").addEventListener("click", () => this.applySelectedPreset());
    el("btnDeletePreset").addEventListener("click", () => this.deleteSelectedPreset());
    this.refreshPresetsSelect();

    // CSV Preview
    el("btnPreviewCsv").addEventListener("click", () => this.previewCsv());
    el("btnDownloadCsv").addEventListener("click", () => this.downloadCsvBrowser());

    // Saved connections dropdowns
    const s1 = el("env1Saved");
    const s2 = el("env2Saved");
    if (s1) s1.addEventListener("change", () => this.applySavedConnection(1));
    if (s2) s2.addEventListener("change", () => this.applySavedConnection(2));
    this.refreshSavedConnectionsSelects();

    // Summary auto-update on field edits
    ["Id", "Host", "Port", "Service"].forEach((fld) => {
      const i1 = el(`env1${fld}`);
      const i2 = el(`env2${fld}`);
      if (i1) i1.addEventListener("input", () => this.refreshEnvSummary(1));
      if (i2) i2.addEventListener("input", () => this.refreshEnvSummary(2));
    });

    // Metadata + fields multi-select
    const btnMeta = el("btnLoadMetadata");
    if (btnMeta) btnMeta.addEventListener("click", () => this.loadMetadata());
    const selAll = el("btnSelectAllFields");
    const deselAll = el("btnDeselectAllFields");
    if (selAll) selAll.addEventListener("click", () => this.selectAllFields(true));
    if (deselAll) deselAll.addEventListener("click", () => this.selectAllFields(false));

    // View mode toggles
    const vRows = el("viewRows");
    const vCards = el("viewCards");
    const vMaster = el("viewMaster");
    if (vRows) vRows.addEventListener("click", () => this.setViewMode("rows"));
    if (vCards) vCards.addEventListener("click", () => this.setViewMode("cards"));
    if (vMaster) vMaster.addEventListener("click", () => this.setViewMode("master"));

    // Search filter
    const search = el("cmpSearch");
    if (search) search.addEventListener("input", () => this.applyFilters());

    // Copy install command
    const copyCmdBtn = el("btnCopyInstallCmd");
    if (copyCmdBtn) {
      copyCmdBtn.addEventListener("click", () => {
        const cmdEl = el("clientInstallCmd");
        const text = cmdEl ? cmdEl.textContent : "bash scripts/install-oracle-instant-client.sh";
        this.copyToClipboard(text, copyCmdBtn);
      });
    }

    // Auto-check client readiness and gate UI
    this.toggleUIEnabled(false);
    await this.ensureClientReady();
  }

  toggleUIEnabled(enabled) {
    const ids = [
      "btnSetCreds1",
      "btnGetCreds1",
      "btnTestConn1",
      "btnSetCreds2",
      "btnGetCreds2",
      "btnTestConn2",
      "btnCompare",
      "btnExportJson",
      "btnExportCsv",
      "btnSavePreset",
      "btnApplyPreset",
      "btnDeletePreset",
      "btnPreviewCsv",
      "btnDownloadCsv",
      "btnLoadMetadata",
      "btnSelectAllFields",
      "btnDeselectAllFields",
      "viewRows",
      "viewCards",
      "viewMaster",
      "env1Saved",
      "env2Saved",
      "presetSelect",
      // Inputs and text fields
      "env1Id",
      "env1User",
      "env1Pass",
      "env1Host",
      "env1Port",
      "env1Service",
      "env1Schema",
      "env2Id",
      "env2User",
      "env2Pass",
      "env2Host",
      "env2Port",
      "env2Service",
      "env2Schema",
      "cmpTable",
      "cmpFields",
      "cmpWhere",
      "cmpSearch",
      "presetName",
    ];
    ids.forEach((id) => {
      const b = el(id);
      if (b) b.disabled = !enabled;
    });
    // Disable field checkboxes if present
    const fieldsList = el("fieldsList");
    if (fieldsList) {
      fieldsList.querySelectorAll("input.cc-field-check").forEach((inp) => {
        inp.disabled = !enabled;
      });
    }
    // Status visibility
    const guide = el("clientGuide");
    if (guide) guide.style.display = enabled ? "none" : "";
  }

  async ensureClientReady() {
    const statusEl = el("clientStatus");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke("check_oracle_client_ready");
      if (!status.installed) {
        statusEl.textContent = status.message || "Oracle client not detected";
        this.toggleUIEnabled(false);
        try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "client_not_installed", message: String(status.message || "Oracle client not detected") }); } catch (_) {}
        return false;
      }
      statusEl.textContent = "Client detected.";
      this.toggleUIEnabled(true);
      return true;
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.toggleUIEnabled(false);
      try { UsageTracker.trackEvent("compare-config", "tauri_error", { action: "ensure_ready", message: String(e) }); } catch (_) {}
      return false;
    }
  }

  getEnvConfig(idx) {
    const id = el(`env${idx}Id`).value.trim();
    const host = el(`env${idx}Host`).value.trim();
    const port = parseInt(el(`env${idx}Port`).value, 10) || 1521;
    const service_name = el(`env${idx}Service`).value.trim();
    const schemaVal = el(`env${idx}Schema`).value.trim();
    return {
      id,
      host,
      port,
      service_name,
      schema: schemaVal ? schemaVal : null,
    };
  }

  // Saved connections management
  getSavedConnections() {
    // Prefer Settings-managed list at key `config.oracle.connections` (kvlist of {key, value(JSON)})
    try {
      const settingsRaw = localStorage.getItem("config.oracle.connections");
      if (settingsRaw) {
        const arr = JSON.parse(settingsRaw);
        if (Array.isArray(arr)) {
          const map = {};
          for (const entry of arr) {
            if (!entry || typeof entry !== "object") continue;
            const name = String(entry.key || "").trim();
            let val = entry.value;
            try { if (typeof val === "string") val = JSON.parse(val); } catch (_) {}
            if (!name || !val || typeof val !== "object") continue;
            const host = String(val.host || "").trim();
            const port = Number(val.port || 1521);
            const service_name = String(val.service_name || val.serviceName || "").trim();
            const schema = val.schema ? String(val.schema).trim() : null;
            if (!host || !service_name) continue;
            map[name] = { id: name, host, port: Number.isNaN(port) ? 1521 : port, service_name, schema };
          }
          // If we built any, return them
          if (Object.keys(map).length) return map;
        }
      }
    } catch (_) {}
    // Fallback to tool-local storage
    try {
      const raw = localStorage.getItem("compare-config.savedConnections") || "{}";
      const obj = JSON.parse(raw);
      return typeof obj === "object" && obj ? obj : {};
    } catch (_) { return {}; }
  }

  setSavedConnections(obj) {
    try { localStorage.setItem("compare-config.savedConnections", JSON.stringify(obj || {})); } catch (_) {}
  }

  refreshSavedConnectionsSelects() {
    const saved = this.getSavedConnections();
    const ids = Object.keys(saved);
    const opts = ids.map((id) => `<option value="${id}">${id}</option>`).join("");
    const s1 = el("env1Saved");
    const s2 = el("env2Saved");
    if (s1) s1.innerHTML = `<option value="">-- Select --</option>${opts}`;
    if (s2) s2.innerHTML = `<option value="">-- Select --</option>${opts}`;
    const st1 = el("env1SavedStatus");
    const st2 = el("env2SavedStatus");
    if (st1) st1.textContent = ids.length ? "Available" : "No saved connections";
    if (st2) st2.textContent = ids.length ? "Available" : "No saved connections";
  }

  applySavedConnection(idx) {
    const sel = el(`env${idx}Saved`);
    const statusEl = el(`env${idx}SavedStatus`);
    if (!sel) return;
    const id = sel.value;
    const saved = this.getSavedConnections();
    const cfg = saved[id];
    if (!id || !cfg) {
      if (statusEl) statusEl.textContent = "None";
      return;
    }
    el(`env${idx}Id`).value = cfg.id || id;
    el(`env${idx}Host`).value = cfg.host || "";
    el(`env${idx}Port`).value = String(cfg.port ?? 1521);
    el(`env${idx}Service`).value = cfg.service_name || "";
    el(`env${idx}Schema`).value = cfg.schema || "";
    if (statusEl) statusEl.textContent = "Applied";
    this.showSuccess(`Applied saved connection '${id}' to Env${idx}`);
    // Refresh summary line
    this.refreshEnvSummary(idx);
  }

  saveCurrentConnection(idx) {
    const cfg = this.getEnvConfig(idx);
    if (!cfg.id) return; // require id
    const saved = this.getSavedConnections();
    saved[cfg.id] = cfg;
    this.setSavedConnections(saved);
    this.refreshSavedConnectionsSelects();
    const statusEl = el(`env${idx}SavedStatus`);
    if (statusEl) statusEl.textContent = "Saved";
  }

  async checkAndPrime() {
    const statusEl = el("clientStatus");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke("check_oracle_client_ready");
      if (!status.installed) {
        statusEl.textContent = status.message || "Oracle client not detected";
        this.showError(status.message || "Oracle client not detected");
        try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "client_not_installed", message: String(status.message || "Oracle client not detected") }); } catch (_) {}
        this.toggleUIEnabled(false);
        return;
      }
      statusEl.textContent = "Client detected. Priming...";
      await invoke("prime_oracle_client");
      statusEl.textContent = "Client primed and ready.";
      this.showSuccess("Oracle client primed");
      this.toggleUIEnabled(true);
      const btn = el("btnCheckPrime");
      if (btn) btn.textContent = "Check Again";
    } catch (e) {
      console.error(e);
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Prime failed: ${e}`);
      try { UsageTracker.trackEvent("compare-config", "tauri_error", { action: "check_and_prime", message: String(e) }); } catch (_) {}
      this.toggleUIEnabled(false);
    }
  }

  async setCreds(idx) {
    const statusEl = el(`credsStatus${idx}`);
    const id = el(`env${idx}Id`).value.trim();
    const username = el(`env${idx}User`).value.trim();
    const password = el(`env${idx}Pass`).value;
    if (!id || !username || !password) {
      this.showError("Provide connection ID, username, and password");
      try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "set_creds_invalid", idx }); } catch (_) {}
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_oracle_credentials", { connection_id: id, username, password });
      statusEl.textContent = "Saved to keychain.";
      this.showSuccess("Credentials saved");
      this.refreshEnvSummary(idx);
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Save failed: ${e}`);
      try { UsageTracker.trackEvent("compare-config", "tauri_error", { action: "set_creds", idx, message: String(e) }); } catch (_) {}
    }
  }

  async getCreds(idx) {
    const statusEl = el(`credsStatus${idx}`);
    const id = el(`env${idx}Id`).value.trim();
    if (!id) { this.showError("Provide connection ID"); try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "get_creds_invalid", idx }); } catch (_) {} return; }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke("get_oracle_credentials", { connection_id: id });
      if (res && res.username) {
        el(`env${idx}User`).value = res.username;
        statusEl.textContent = res.hasPassword ? "Password found." : "Password missing.";
        this.refreshEnvSummary(idx);
      } else {
        statusEl.textContent = "No credentials stored.";
      }
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Lookup failed: ${e}`);
      try { UsageTracker.trackEvent("compare-config", "tauri_error", { action: "get_creds", idx, message: String(e) }); } catch (_) {}
    }
  }

  async refreshEnvSummary(idx) {
    const sumEl = el(`env${idx}Summary`);
    if (!sumEl) return;
    const id = (el(`env${idx}Id`)?.value || "").trim();
    const host = (el(`env${idx}Host`)?.value || "").trim();
    const port = parseInt(el(`env${idx}Port`)?.value, 10) || 1521;
    const service = (el(`env${idx}Service`)?.value || "").trim();
    const hostStr = host ? `${host}:${port}/${service || ""}` : "";
    if (!id || !host || !service) {
      sumEl.textContent = id ? `${id}: Incomplete connection details` : "No connection selected";
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke("get_oracle_credentials", { connection_id: id });
      if (res && res.username) {
        sumEl.textContent = `${id}: Login using ${res.username} on ${hostStr}`;
      } else {
        sumEl.textContent = `${id}: Credentials missing — host ${hostStr}`;
      }
    } catch (_) {
      sumEl.textContent = `${id}: Credentials lookup error — host ${hostStr}`;
    }
  }

  async testConn(idx) {
    const statusEl = el(`connStatus${idx}`);
    const cfg = this.getEnvConfig(idx);
    if (!cfg.id || !cfg.host || !cfg.service_name) {
      this.showError("Provide id, host, and service name");
      try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "test_conn_invalid", idx }); } catch (_) {}
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      statusEl.textContent = "Testing...";
      // Pre-check credentials presence
      try {
        const creds = await invoke("get_oracle_credentials", { connection_id: cfg.id });
        if (!creds || !creds.hasPassword) {
          statusEl.textContent = "Password missing";
          this.showError("Password missing — set credentials before testing");
          return;
        }
      } catch (_) {
        // Continue and let backend surface a readable error
      }
      const ok = await invoke("test_oracle_connection", { config: cfg });
      statusEl.textContent = ok ? "Connection OK" : "Connection failed";
      if (ok) this.showSuccess("Connection succeeded"); else this.showError("Connection failed");
      if (ok) {
        // Save this connection for future selection
        this.saveCurrentConnection(idx);
        this.refreshEnvSummary(idx);
      }
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Test failed: ${e}`);
      try { UsageTracker.trackEvent("compare-config", "tauri_error", { action: "test_conn", idx, message: String(e) }); } catch (_) {}
    }
  }

  async compare() {
    const statusEl = el("compareStatus");
    const spinner = el("ccSpinner");
    const env1 = this.getEnvConfig(1);
    const env2 = this.getEnvConfig(2);
    const table = el("cmpTable").value.trim();
    const fields = this.getSelectedFields();
    const where = el("cmpWhere").value.trim();

    if (!env1.id || !env2.id || !table) {
      this.showError("Provide Env1, Env2, and Table");
      try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "validation_failed", reason: "missing_envs_or_table", table: table || "" }); } catch (_) {}
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      statusEl.textContent = "Comparing...";
      if (spinner) spinner.hidden = false;
      el("btnCompare").disabled = true;
      const result = await invoke("compare_configurations", {
        env1,
        env2,
        table,
        where_clause: where ? where : null,
        fields: Array.isArray(fields) && fields.length ? fields : null,
      });
      this.lastResult = result;
      statusEl.textContent = "Compared.";
      this.showSuccess("Comparison complete");
      this.renderResult(result);
      el("btnExportJson").disabled = false;
      el("btnExportCsv").disabled = false;
      // Persist connections for dropdowns
      this.saveCurrentConnection(1);
      this.saveCurrentConnection(2);
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Compare failed: ${e}`);
      try { UsageTracker.trackEvent("compare-config", "tauri_error", { action: "compare", table: table || "", message: String(e) }); } catch (_) {}
    } finally {
      if (spinner) spinner.hidden = true;
      el("btnCompare").disabled = false;
    }
  }

  renderResult(json) {
    try {
      const summaryEl = el("cmpSummary");
      const resultsEl = el("cmpResults");
      const s = json.summary || {};
      summaryEl.innerHTML = `
        <div class="cc-summary-grid">
          <div><strong>Total</strong><div>${s.total ?? ""}</div></div>
          <div><strong>Matches</strong><div>${s.matches ?? ""}</div></div>
          <div><strong>Differences</strong><div>${s.differences ?? ""}</div></div>
          <div><strong>Only Env1</strong><div>${s.only_env1 ?? ""}</div></div>
          <div><strong>Only Env2</strong><div>${s.only_env2 ?? ""}</div></div>
        </div>
      `;

      const comps = Array.isArray(json.comparisons) ? json.comparisons : [];
      const fields = Array.isArray(json.fields) ? json.fields : [];
      const filtered = this.filterComparisons(comps);
      // Performance guardrail: stream rendering for large result sets (rows/cards)
      const needsChunk = (this.viewMode === "rows" || this.viewMode === "cards") && filtered.length > 1000;
      if (needsChunk) {
        resultsEl.innerHTML = "";
        const banner = document.createElement("div");
        banner.className = "cc-empty";
        banner.textContent = `Rendering ${filtered.length} results…`; // textContent for safety
        resultsEl.appendChild(banner);
        // Defer chunked DOM updates
        queueMicrotask(() => this.renderResultsChunked(filtered, fields));
      } else {
        let html = "";
        if (this.viewMode === "rows") {
          html = filtered.map((c) => this.renderRowItem(c, fields)).join("");
        } else if (this.viewMode === "cards") {
          html = `<div class="cc-results-cards">${filtered.map((c) => this.renderCardItem(c, fields)).join("")}</div>`;
        } else if (this.viewMode === "master") {
          html = this.renderMasterDetail(filtered, fields);
        }
        resultsEl.innerHTML = html || "<div class='cc-empty'>No results.</div>";
        // Bind copy buttons
        resultsEl.querySelectorAll("button[data-copy]").forEach((b) => {
          b.addEventListener("click", () => this.copyToClipboard(b.getAttribute("data-copy"), b));
        });
      }
    } catch (e) {
      console.error(e);
      try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "render_failed", message: String(e?.message || e) }); } catch (_) {}
    }
  }

  renderRowItem(c, fields) {
    const pkObj = c.primary_key || {};
    const pk = JSON.stringify(pkObj);
    const status = c.status || "";
    let body = "";
    if (status === "Differ") {
      const diffs = Array.isArray(c.differences) ? c.differences : [];
      const items = diffs
        .map((d) => {
          const env1Html = this.renderDiffChunks(d.env1_diff_chunks, d.env1);
          const env2Html = this.renderDiffChunks(d.env2_diff_chunks, d.env2);
          return `<li><strong>${this.escapeHtml(d.field ?? "")}</strong>: ${env1Html} → ${env2Html}</li>`;
        })
        .join("");
      body = `<ul class="cc-diffs">${items}</ul>`;
    } else if (status === "OnlyInEnv1") {
      const v = c.env1_data || {};
      const items = fields.map((f) => `<li><strong>${this.escapeHtml(f)}</strong>: ${this.escapeHtml(v[f] ?? "")}</li>`).join("");
      body = `<div class="cc-only cc-only1"><ul>${items}</ul></div>`;
    } else if (status === "OnlyInEnv2") {
      const v = c.env2_data || {};
      const items = fields.map((f) => `<li><strong>${this.escapeHtml(f)}</strong>: ${this.escapeHtml(v[f] ?? "")}</li>`).join("");
      body = `<div class="cc-only cc-only2"><ul>${items}</ul></div>`;
    } else {
      body = `<div class="cc-match">All selected fields match.</div>`;
    }
    return `
      <div class="cc-row-item">
        <div class="cc-row-head">
          <span class="cc-badge cc-${status.toLowerCase()}">${status}</span>
          <code class="cc-key">${pk}</code>
          <button class="btn btn-xs" data-copy='${pk}'>Copy Key</button>
        </div>
        ${body}
      </div>
    `;
  }

  renderCardItem(c, fields) {
    const pkObj = c.primary_key || {};
    const pk = JSON.stringify(pkObj);
    const status = c.status || "";
    let body = "";
    if (status === "Differ") {
      const diffs = Array.isArray(c.differences) ? c.differences : [];
      body = diffs.map((d) => {
        const env1Html = this.renderDiffChunks(d.env1_diff_chunks, d.env1);
        const env2Html = this.renderDiffChunks(d.env2_diff_chunks, d.env2);
        return `<div><strong>${this.escapeHtml(d.field ?? "")}</strong><div>${env1Html} → ${env2Html}</div></div>`;
      }).join("");
    } else if (status === "OnlyInEnv1") {
      const v = c.env1_data || {};
      body = fields.map((f) => `<div><strong>${this.escapeHtml(f)}</strong><div>${this.escapeHtml(v[f] ?? "")}</div></div>`).join("");
    } else if (status === "OnlyInEnv2") {
      const v = c.env2_data || {};
      body = fields.map((f) => `<div><strong>${this.escapeHtml(f)}</strong><div>${this.escapeHtml(v[f] ?? "")}</div></div>`).join("");
    } else {
      body = `<div class="cc-match">All selected fields match.</div>`;
    }
    return `
      <div class="cc-row-item">
        <div class="cc-row-head">
          <span class="cc-badge cc-${status.toLowerCase()}">${status}</span>
          <code class="cc-key">${pk}</code>
          <button class="btn btn-xs" data-copy='${pk}'>Copy Key</button>
        </div>
        <div class="cc-card-body">${body}</div>
      </div>
    `;
  }

  renderMasterDetail(list, fields) {
    const items = list.map((c, idx) => {
      const pk = JSON.stringify(c.primary_key || {});
      const status = c.status || "";
      return `<button class="btn btn-outline btn-sm" data-idx="${idx}"><span class="cc-badge cc-${status.toLowerCase()}">${status}</span> ${pk}</button>`;
    }).join("");
    const first = list[0];
    const detail = first ? this.renderRowItem(first, fields) : "<div class='cc-empty'>No selection.</div>";
    const html = `
      <div class="cc-master-detail" style="display:grid;grid-template-columns:240px 1fr;gap:0.5rem;align-items:start;">
        <div class="cc-master" style="display:flex;flex-direction:column;gap:0.25rem;">${items || "<div class='cc-empty'>No results.</div>"}</div>
        <div class="cc-detail">${detail}</div>
      </div>
    `;
    // After injecting, wire selection
    const resultsEl = el("cmpResults");
    setTimeout(() => {
      const master = resultsEl.querySelectorAll(".cc-master button[data-idx]");
      const detailEl = resultsEl.querySelector(".cc-detail");
      master.forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = parseInt(btn.getAttribute("data-idx"), 10);
          const c = list[i];
          detailEl.innerHTML = this.renderRowItem(c, fields);
          detailEl.querySelectorAll("button[data-copy]").forEach((b) => {
            b.addEventListener("click", () => this.copyToClipboard(b.getAttribute("data-copy"), b));
          });
        });
      });
    }, 0);
    return html;
  }

  filterComparisons(list) {
    try {
      const showMatches = !!el("fltMatches")?.checked;
      const showDiff = !!el("fltDifferences")?.checked;
      const showOnly1 = !!el("fltOnlyEnv1")?.checked;
      const showOnly2 = !!el("fltOnlyEnv2")?.checked;
      const q = (el("cmpSearch")?.value || "").trim().toLowerCase();

      const allowed = new Set();
      if (showMatches) allowed.add("Match");
      if (showDiff) allowed.add("Differ");
      if (showOnly1) allowed.add("OnlyInEnv1");
      if (showOnly2) allowed.add("OnlyInEnv2");

      return list.filter((c) => {
        const status = c.status || "";
        const statusOk = allowed.size === 0 ? true : allowed.has(status);
        if (!statusOk) return false;
        if (q) {
          const keyStr = JSON.stringify(c.primary_key || {}).toLowerCase();
          if (!keyStr.includes(q)) return false;
        }
        return true;
      });
    } catch (_) {
      return list;
    }
  }

  applyFilters() {
    if (!this.lastResult) return;
    this.renderResult(this.lastResult);
  }

  // View mode switching
  setViewMode(mode) {
    this.viewMode = mode;
    const ids = ["viewRows", "viewCards", "viewMaster"];
    ids.forEach((id) => {
      const btn = el(id);
      if (!btn) return;
      const isActive = (id === "viewRows" && mode === "rows") || (id === "viewCards" && mode === "cards") || (id === "viewMaster" && mode === "master");
      btn.classList.toggle("btn-outline", !isActive);
    });
    if (this.lastResult) this.renderResult(this.lastResult);
  }

  // Metadata fetching and field selection UI
  async loadMetadata() {
    const statusEl = el("metadataStatus");
    const env1 = this.getEnvConfig(1);
    const table = el("cmpTable").value.trim();
    if (!env1.id || !env1.host || !env1.service_name || !table) {
      this.showError("Provide Env1 (id, host, service), and Table");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      statusEl.textContent = "Loading metadata...";
      const meta = await invoke("fetch_table_metadata", { config: env1, schema: env1.schema, table });
      statusEl.textContent = "Loaded.";
      this.renderMetadata(meta);
      this.renderFieldsFromMetadata(meta);
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Metadata load failed: ${e}`);
      try { UsageTracker.trackEvent("compare-config", "tauri_error", { action: "fetch_table_metadata", table: table || "", message: String(e) }); } catch (_) {}
    }
  }

  renderMetadata(meta) {
    const p = el("metadataPreview");
    if (!p) return;
    try {
      const cols = Array.isArray(meta.columns) ? meta.columns : [];
      const rows = cols.map((c) => {
        const len = c.data_length != null ? `(${c.data_length})` : "";
        const nullable = c.nullable ? "NULL" : "NOT NULL";
        const def = c.data_default ? ` DEFAULT ${c.data_default}` : "";
        const pk = c.is_primary_key ? " • PK" : "";
        return `<div><code>${c.name}</code> — ${c.data_type}${len} — ${nullable}${def}${pk}</div>`;
      }).join("");
      p.innerHTML = rows || "<div class='cc-empty'>No columns.</div>";
    } catch (e) {
      p.innerHTML = `<div class='cc-empty'>Metadata render failed: ${e}</div>`;
    }
  }

  renderFieldsFromMetadata(meta) {
    const list = el("fieldsList");
    if (!list) return;
    try {
      const cols = Array.isArray(meta.columns) ? meta.columns : [];
      list.innerHTML = cols.map((c) => {
        const checked = "checked"; // default select all on load
        return `<label class="cc-field-item"><input type="checkbox" class="cc-field-check" data-field="${c.name}" ${checked}> <span>${c.name}</span></label>`;
      }).join("");
      // Update text field to reflect selection
      const fields = cols.map((c) => c.name);
      el("cmpFields").value = fields.join(",");
      // Wire checkbox change to sync text
      list.querySelectorAll("input.cc-field-check").forEach((inp) => {
        inp.addEventListener("change", () => this.syncFieldsTextFromChecks());
      });
    } catch (e) {
      list.innerHTML = `<div class='cc-empty'>Fields render failed: ${e}</div>`;
    }
  }

  selectAllFields(checked) {
    const list = el("fieldsList");
    if (!list) return;
    list.querySelectorAll("input.cc-field-check").forEach((inp) => {
      inp.checked = !!checked;
    });
    this.syncFieldsTextFromChecks();
  }

  syncFieldsTextFromChecks() {
    const list = el("fieldsList");
    if (!list) return;
    const fields = Array.from(list.querySelectorAll("input.cc-field-check:checked")).map((i) => i.getAttribute("data-field"));
    el("cmpFields").value = fields.join(",");
  }

  getSelectedFields() {
    const list = el("fieldsList");
    if (list) {
      const checks = Array.from(list.querySelectorAll("input.cc-field-check:checked"));
      const fields = checks.map((i) => i.getAttribute("data-field"));
      if (fields.length) return fields;
    }
    return parseFields(el("cmpFields").value);
  }

  getPresetPayload() {
    return {
      env1: this.getEnvConfig(1),
      env2: this.getEnvConfig(2),
      table: el("cmpTable").value.trim(),
      fields: parseFields(el("cmpFields").value),
      where: el("cmpWhere").value.trim(),
    };
  }

  refreshPresetsSelect() {
    try {
      const select = el("presetSelect");
      if (!select) return;
      const presets = JSON.parse(localStorage.getItem("compare-config.presets") || "[]");
      select.innerHTML = presets
        .map((p, i) => `<option value="${i}">${p.name}</option>`)
        .join("");
    } catch (_) {}
  }

  savePreset() {
    const statusEl = el("presetStatus");
    try {
      const name = el("presetName").value.trim();
      if (!name) { this.showError("Enter a preset name"); return; }
      const payload = this.getPresetPayload();
      const presets = JSON.parse(localStorage.getItem("compare-config.presets") || "[]");
      presets.push({ name, payload });
      localStorage.setItem("compare-config.presets", JSON.stringify(presets));
      this.refreshPresetsSelect();
      statusEl.textContent = "Saved.";
      this.showSuccess("Preset saved");
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Save preset failed: ${e}`);
    }
  }

  applySelectedPreset() {
    const statusEl = el("presetStatus");
    try {
      const idx = parseInt(el("presetSelect").value, 10);
      const presets = JSON.parse(localStorage.getItem("compare-config.presets") || "[]");
      const p = presets[idx];
      if (!p) { this.showError("No preset selected"); return; }
      const { env1, env2, table, fields, where } = p.payload || {};
      // Populate Env1
      el("env1Id").value = env1?.id || "";
      el("env1User").value = ""; // do not override username from keychain
      el("env1Pass").value = ""; // never store passwords in presets
      el("env1Host").value = env1?.host || "";
      el("env1Port").value = String(env1?.port ?? 1521);
      el("env1Service").value = env1?.service_name || "";
      el("env1Schema").value = env1?.schema || "";
      // Populate Env2
      el("env2Id").value = env2?.id || "";
      el("env2User").value = "";
      el("env2Pass").value = "";
      el("env2Host").value = env2?.host || "";
      el("env2Port").value = String(env2?.port ?? 1521);
      el("env2Service").value = env2?.service_name || "";
      el("env2Schema").value = env2?.schema || "";
      // Compare fields
      el("cmpTable").value = table || "";
      el("cmpFields").value = (Array.isArray(fields) ? fields.join(",") : "");
      el("cmpWhere").value = where || "";
      statusEl.textContent = "Applied.";
      this.showSuccess("Preset applied");
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Apply preset failed: ${e}`);
    }
  }

  deleteSelectedPreset() {
    const statusEl = el("presetStatus");
    try {
      const idx = parseInt(el("presetSelect").value, 10);
      const presets = JSON.parse(localStorage.getItem("compare-config.presets") || "[]");
      if (isNaN(idx) || !presets[idx]) { this.showError("Select a preset to delete"); return; }
      presets.splice(idx, 1);
      localStorage.setItem("compare-config.presets", JSON.stringify(presets));
      this.refreshPresetsSelect();
      statusEl.textContent = "Deleted.";
      this.showSuccess("Preset deleted");
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Delete preset failed: ${e}`);
    }
  }

  toCsv(json) {
    try {
      const rows = [];
      const comps = Array.isArray(json.comparisons) ? json.comparisons : [];
      comps.forEach((c) => {
        const keyObj = c.primary_key || {};
        const key = JSON.stringify(keyObj);
        const status = c.status || "";
        if (status === "Differ") {
          const diffs = Array.isArray(c.differences) ? c.differences : [];
          diffs.forEach((d) => {
            const field = d.field ?? "";
            const env1 = d.env1 ?? "";
            const env2 = d.env2 ?? "";
            rows.push({ key, status, field, env1, env2 });
          });
        } else if (status === "OnlyInEnv1") {
          const v = c.env1_data || {};
          Object.keys(v).forEach((field) => {
            const env1 = v[field] ?? "";
            rows.push({ key, status, field, env1, env2: "" });
          });
        } else if (status === "OnlyInEnv2") {
          const v = c.env2_data || {};
          Object.keys(v).forEach((field) => {
            const env2 = v[field] ?? "";
            rows.push({ key, status, field, env1: "", env2 });
          });
        }
      });
      const header = ["primary_key", "status", "field", "env1", "env2"]; 
      const lines = [header.join(",")].concat(
        rows.map((r) => [r.key.replace(/"/g, "'"), r.status, r.field.replace(/"/g, "'"), this.csvEscape(r.env1), this.csvEscape(r.env2)].join(","))
      );
      return lines.join("\n");
    } catch (e) {
      return `Error generating CSV: ${e}`;
    }
  }

  csvEscape(val) {
    const s = String(val ?? "");
    if (/[,"\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  previewCsv() {
    const statusEl = el("csvStatus");
    const area = el("csvPreview");
    if (!this.lastResult) { this.showError("Run a comparison first"); try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "csv_preview_no_result" }); } catch (_) {} return; }
    const csv = this.toCsv(this.lastResult);
    area.value = csv;
    statusEl.textContent = "Preview generated.";
  }

  downloadCsvBrowser() {
    if (!this.lastResult) { this.showError("Run a comparison first"); try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "csv_download_no_result" }); } catch (_) {} return; }
    try {
      const csv = this.toCsv(this.lastResult);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dt = new Date();
      const ts = dt.toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `comparison-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showSuccess("CSV downloaded");
    } catch (e) {
      this.showError(`Download failed: ${e}`);
      try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "csv_download_failed", message: String(e) }); } catch (_) {}
    }
  }

  // Render precomputed diff chunks; fallback to plain escaped value
  renderDiffChunks(chunks, fallbackValue) {
    const arr = Array.isArray(chunks) ? chunks : null;
    if (!arr || !arr.length) {
      return `<span>${this.escapeHtml(fallbackValue ?? "")}</span>`;
    }
    const html = arr.map((chunk) => {
      const text = this.escapeHtml(chunk.text ?? "");
      switch (chunk.chunk_type) {
        case "Same":
          return `<span class="diff-same">${text}</span>`;
        case "Added":
          return `<span class="diff-added">${text}</span>`;
        case "Removed":
          return `<span class="diff-removed">${text}</span>`;
        case "Modified":
          return `<span class="diff-modified">${text}</span>`;
        default:
          return `<span>${text}</span>`;
      }
    }).join("");
    return html;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  // Chunked rendering to avoid blocking UI thread for large lists
  renderResultsChunked(list, fields) {
    const resultsEl = el("cmpResults");
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
    const mode = this.viewMode;
    const chunkSize = 200;
    let index = 0;

    const appendChunk = () => {
      const frag = document.createDocumentFragment();
      const end = Math.min(index + chunkSize, list.length);
      for (let i = index; i < end; i++) {
        const c = list[i];
        let html = "";
        if (mode === "rows") html = this.renderRowItem(c, fields);
        else if (mode === "cards") html = this.renderCardItem(c, fields);
        else html = ""; // master handled elsewhere
        if (html) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = html;
          const node = wrapper.firstElementChild;
          if (node) frag.appendChild(node);
        }
      }
      resultsEl.appendChild(frag);
      index = end;
      if (index < list.length) {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(appendChunk);
        } else {
          setTimeout(appendChunk, 0);
        }
      } else {
        // Bind copy buttons after final append
        queueMicrotask(() => {
          resultsEl.querySelectorAll("button[data-copy]").forEach((b) => {
            b.addEventListener("click", () => this.copyToClipboard(b.getAttribute("data-copy"), b));
          });
        });
      }
    };

    appendChunk();
  }

  async exportResult(fmt) {
    if (!this.lastResult) { this.showError("Run a comparison first"); try { UsageTracker.trackEvent("compare-config", "ui_error", { type: "export_no_result", fmt }); } catch (_) {} return; }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const payload = JSON.stringify(this.lastResult);
      const path = await invoke("export_comparison_result", { format: fmt, payload });
      this.showSuccess(`${fmt.toUpperCase()} exported: ${path}`);
      await this.copyToClipboard(path);
    } catch (e) {
      this.showError(`Export failed: ${e}`);
      try { UsageTracker.trackEvent("compare-config", "tauri_error", { action: "export", fmt, message: String(e) }); } catch (_) {}
    }
  }
}