import { BaseTool } from "../../core/BaseTool.js";
import { isTauri } from "../../core/Runtime.js";
import { CompareConfigTemplate } from "./template.js";
import "./styles.css";

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
  }

  render() {
    return CompareConfigTemplate;
  }

  async onMount() {
    // Gate on Tauri availability
    const tauri = isTauri();
    const disableAll = (msg) => {
      [
        "btnCheckPrime",
        "btnSetCreds1",
        "btnGetCreds1",
        "btnTestConn1",
        "btnSetCreds2",
        "btnGetCreds2",
        "btnTestConn2",
        "btnCompare",
        "btnExportJson",
        "btnExportCsv",
      ].forEach((id) => {
        const b = el(id);
        if (b) b.disabled = true;
      });
      const cs = el("clientStatus");
      if (cs) cs.textContent = msg;
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
    el("btnCompare").addEventListener("click", () => this.compare());
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

  async checkAndPrime() {
    const statusEl = el("clientStatus");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke("check_oracle_client_ready");
      if (!status.installed) {
        statusEl.textContent = status.message || "Oracle client not detected";
        this.showError(status.message || "Oracle client not detected");
        return;
      }
      statusEl.textContent = "Client detected. Priming...";
      await invoke("prime_oracle_client");
      statusEl.textContent = "Client primed and ready.";
      this.showSuccess("Oracle client primed");
    } catch (e) {
      console.error(e);
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Prime failed: ${e}`);
    }
  }

  async setCreds(idx) {
    const statusEl = el(`credsStatus${idx}`);
    const id = el(`env${idx}Id`).value.trim();
    const username = el(`env${idx}User`).value.trim();
    const password = el(`env${idx}Pass`).value;
    if (!id || !username || !password) {
      this.showError("Provide connection ID, username, and password");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_oracle_credentials", { connection_id: id, username, password });
      statusEl.textContent = "Saved to keychain.";
      this.showSuccess("Credentials saved");
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Save failed: ${e}`);
    }
  }

  async getCreds(idx) {
    const statusEl = el(`credsStatus${idx}`);
    const id = el(`env${idx}Id`).value.trim();
    if (!id) { this.showError("Provide connection ID"); return; }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke("get_oracle_credentials", { connection_id: id });
      if (res && res.username) {
        el(`env${idx}User`).value = res.username;
        statusEl.textContent = res.hasPassword ? "Password found." : "Password missing.";
      } else {
        statusEl.textContent = "No credentials stored.";
      }
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Lookup failed: ${e}`);
    }
  }

  async testConn(idx) {
    const statusEl = el(`connStatus${idx}`);
    const cfg = this.getEnvConfig(idx);
    if (!cfg.id || !cfg.host || !cfg.service_name) {
      this.showError("Provide id, host, and service name");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      statusEl.textContent = "Testing...";
      const ok = await invoke("test_oracle_connection", { config: cfg });
      statusEl.textContent = ok ? "Connection OK" : "Connection failed";
      if (ok) this.showSuccess("Connection succeeded"); else this.showError("Connection failed");
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Test failed: ${e}`);
    }
  }

  async compare() {
    const statusEl = el("compareStatus");
    const env1 = this.getEnvConfig(1);
    const env2 = this.getEnvConfig(2);
    const table = el("cmpTable").value.trim();
    const fields = parseFields(el("cmpFields").value);
    const where = el("cmpWhere").value.trim();

    if (!env1.id || !env2.id || !table) {
      this.showError("Provide Env1, Env2, and Table");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      statusEl.textContent = "Comparing...";
      const result = await invoke("compare_configurations", {
        env1,
        env2,
        table,
        where_clause: where ? where : null,
        fields: fields.length ? fields : null,
      });
      this.lastResult = result;
      statusEl.textContent = "Compared.";
      this.showSuccess("Comparison complete");
      this.renderResult(result);
      el("btnExportJson").disabled = false;
      el("btnExportCsv").disabled = false;
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      this.showError(`Compare failed: ${e}`);
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
      const rowsHtml = filtered.map((c) => {
        const pkObj = c.primary_key || {};
        const pk = JSON.stringify(pkObj);
        const status = c.status || "";
        let body = "";
        if (status === "Differ") {
          const diffs = Array.isArray(c.differences) ? c.differences : [];
          const items = diffs
            .map((d) => `<li><strong>${d.field}</strong>: <span class="diff-left">${d.env1 ?? ""}</span> → <span class="diff-right">${d.env2 ?? ""}</span></li>`)
            .join("");
          body = `<ul class="cc-diffs">${items}</ul>`;
        } else if (status === "OnlyInEnv1") {
          const v = c.env1_data || {};
          const items = fields.map((f) => `<li><strong>${f}</strong>: ${v[f] ?? ""}</li>`).join("");
          body = `<div class="cc-only cc-only1"><ul>${items}</ul></div>`;
        } else if (status === "OnlyInEnv2") {
          const v = c.env2_data || {};
          const items = fields.map((f) => `<li><strong>${f}</strong>: ${v[f] ?? ""}</li>`).join("");
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
      }).join("");

      resultsEl.innerHTML = rowsHtml || "<div class='cc-empty'>No results.</div>";

      // Bind copy buttons
      resultsEl.querySelectorAll("button[data-copy]").forEach((b) => {
        b.addEventListener("click", () => this.copyToClipboard(b.getAttribute("data-copy"), b));
      });
    } catch (e) {
      console.error(e);
    }
  }

  filterComparisons(list) {
    try {
      const showMatches = !!el("fltMatches")?.checked;
      const showDiff = !!el("fltDifferences")?.checked;
      const showOnly1 = !!el("fltOnlyEnv1")?.checked;
      const showOnly2 = !!el("fltOnlyEnv2")?.checked;
      return list.filter((c) => {
        const s = (c.status || "").toLowerCase();
        if (s === "match") return showMatches;
        if (s === "differ") return showDiff;
        if (s === "onlyinenv1") return showOnly1;
        if (s === "onlyinenv2") return showOnly2;
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
    if (!this.lastResult) { this.showError("Run a comparison first"); return; }
    const csv = this.toCsv(this.lastResult);
    area.value = csv;
    statusEl.textContent = "Preview generated.";
  }

  downloadCsvBrowser() {
    if (!this.lastResult) { this.showError("Run a comparison first"); return; }
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
    }
  }

  async exportResult(fmt) {
    if (!this.lastResult) { this.showError("Run a comparison first"); return; }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const payload = JSON.stringify(this.lastResult);
      const path = await invoke("export_comparison_result", { format: fmt, payload });
      this.showSuccess(`${fmt.toUpperCase()} exported: ${path}`);
      await this.copyToClipboard(path);
    } catch (e) {
      this.showError(`Export failed: ${e}`);
    }
  }
}