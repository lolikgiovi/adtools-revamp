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

      const rowsHtml = comps.map((c) => {
        const pk = c.key ? JSON.stringify(c.key) : "{}";
        const status = c.status || "";
        let body = "";
        if (status === "Differ") {
          const diffs = c.differences || {};
          const items = Object.keys(diffs)
            .map((k) => `<li><strong>${k}</strong>: <span class="diff-left">${diffs[k].env1 ?? ""}</span> → <span class="diff-right">${diffs[k].env2 ?? ""}</span></li>`)
            .join("");
          body = `<ul class="cc-diffs">${items}</ul>`;
        } else if (status === "OnlyInEnv1") {
          const v = c.env1 || {};
          const items = fields.map((f) => `<li><strong>${f}</strong>: ${v[f] ?? ""}</li>`).join("");
          body = `<div class="cc-only cc-only1"><ul>${items}</ul></div>`;
        } else if (status === "OnlyInEnv2") {
          const v = c.env2 || {};
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