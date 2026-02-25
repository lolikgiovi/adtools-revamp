import { TLVViewerTemplate } from "./template.js";
import { TLVViewerService } from "./service.js";
import { BaseTool } from "../../core/BaseTool.js";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";

class TLVViewer extends BaseTool {
  constructor(eventBus) {
    super({
      id: "tlv-viewer",
      name: "TLV Viewer",
      description: "Parse QRIS & BER-TLV payloads with tree and table views",
      icon: "tlv",
      category: "general",
      eventBus,
    });

    this.currentView = "tree";
    this.lastResult = null;
    this.persistTimer = null;
    this.storageKeys = {
      input: "tool:tlv-viewer:input",
      format: "tool:tlv-viewer:format",
      view: "tool:tlv-viewer:view",
    };
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return TLVViewerTemplate;
  }

  onMount() {
    this.bindToolEvents();
    this.restoreState();
    this.applyView(this.currentView);
    this.updateCopyButton();
  }

  onUnmount() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  bindToolEvents() {
    const c = this.container;
    if (!c) return;

    c.querySelector("#tlv-parse-btn")?.addEventListener("click", () => this.parseCurrentInput());
    c.querySelector("#tlv-paste-btn")?.addEventListener("click", () => this.handlePaste());
    c.querySelector("#tlv-sample-btn")?.addEventListener("click", () => this.applySample("qris"));
    c.querySelector("#tlv-sample-ber-btn")?.addEventListener("click", () => this.applySample("ber"));
    c.querySelector("#tlv-clear-btn")?.addEventListener("click", () => this.clearAll());
    c.querySelector("#tlv-copy-output-btn")?.addEventListener("click", () => this.copyCurrentOutput());

    const inputEl = c.querySelector("#tlv-input");
    if (inputEl) {
      inputEl.addEventListener("input", () => this.persistInputDebounced());
      inputEl.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          this.parseCurrentInput();
        }
      });
    }

    const formatEl = c.querySelector("#tlv-format");
    if (formatEl) {
      formatEl.addEventListener("change", () => {
        this.persistValue(this.storageKeys.format, formatEl.value);
        if ((c.querySelector("#tlv-input")?.value || "").trim()) this.parseCurrentInput();
      });
    }

    c.querySelectorAll(".tlv-view-tabs .tab-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.getAttribute("data-view");
        if (view) this.applyView(view);
      });
    });
  }

  restoreState() {
    const c = this.container;
    if (!c) return;

    try {
      const savedFormat = localStorage.getItem(this.storageKeys.format);
      const savedInput = localStorage.getItem(this.storageKeys.input);
      const savedView = localStorage.getItem(this.storageKeys.view);

      if (savedFormat && c.querySelector("#tlv-format")) {
        c.querySelector("#tlv-format").value = savedFormat;
      }
      if (savedInput && c.querySelector("#tlv-input")) {
        c.querySelector("#tlv-input").value = savedInput;
      }
      if (savedView && ["tree", "table", "json"].includes(savedView)) {
        this.currentView = savedView;
      }
    } catch (_) {}

    if ((c.querySelector("#tlv-input")?.value || "").trim()) {
      this.parseCurrentInput();
    } else {
      this.renderEmpty();
    }
  }

  persistInputDebounced() {
    const input = this.container?.querySelector("#tlv-input")?.value || "";
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistValue(this.storageKeys.input, input), 250);
  }

  persistValue(key, value) {
    try { localStorage.setItem(key, value || ""); } catch (_) {}
  }

  // ── Parsing ───────────────────────────────────────────────────────────

  parseCurrentInput() {
    const c = this.container;
    if (!c) return;

    const input = c.querySelector("#tlv-input")?.value || "";
    const format = c.querySelector("#tlv-format")?.value || "auto";

    if (!input.trim()) {
      this.lastResult = null;
      this.renderEmpty();
      this.showError("Input is empty.");
      this.updateCopyButton();
      return;
    }

    try {
      const result = TLVViewerService.parse(input, format);
      this.lastResult = result;
      this.clearError();
      this.renderResult(result);
      this.updateCopyButton();
      UsageTracker.trackFeature("tlv-viewer", "parse");
      UsageTracker.trackEvent("tlv-viewer", "parse", { format: result.format, nodes: result.summary.nodeCount });
    } catch (error) {
      this.lastResult = null;
      this.renderEmpty();
      this.showError(error?.message || "Failed to parse TLV payload.");
      this.updateCopyButton();
      UsageTracker.trackEvent("tlv-viewer", "parse_error", UsageTracker.enrichErrorMeta(error, { format }));
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  renderResult(result) {
    const c = this.container;
    if (!c) return;

    this.renderSummary(result);
    this.renderCrc(result);
    this.renderValidation(result);
    this.renderTableHead(result.format);

    const treeList = c.querySelector("#tlv-tree-list");
    const jsonOutput = c.querySelector("#tlv-json-output");
    const tableBody = c.querySelector("#tlv-table-body");

    if (treeList) {
      treeList.classList.remove("tlv-empty-state");
      treeList.innerHTML = this.buildTreeMarkup(result.nodes, result.format);
    }
    if (jsonOutput) jsonOutput.textContent = JSON.stringify(result.jsonTree, null, 2);
    if (tableBody) tableBody.innerHTML = this.buildTableRows(result.rows, result.format);
  }

  renderEmpty() {
    const c = this.container;
    if (!c) return;

    c.querySelector("#tlv-summary-bar").textContent = "";
    this.hideStatusBar();

    const treeList = c.querySelector("#tlv-tree-list");
    if (treeList) {
      treeList.classList.add("tlv-empty-state");
      treeList.innerHTML = `<div class="tlv-empty-msg">Paste a QRIS string or TLV payload and press Parse.</div>`;
    }

    const jsonOutput = c.querySelector("#tlv-json-output");
    if (jsonOutput) jsonOutput.textContent = "";

    const tableBody = c.querySelector("#tlv-table-body");
    if (tableBody) tableBody.innerHTML = `<tr class="tlv-empty-row"><td colspan="10">Parse TLV to populate table.</td></tr>`;
  }

  renderSummary(result) {
    const bar = this.container?.querySelector("#tlv-summary-bar");
    if (!bar) return;

    const s = result.summary;
    if (result.format === "qris") {
      bar.textContent = `${s.charLength} chars · ${s.nodeCount} fields · depth ${s.maxDepth}`;
    } else {
      bar.textContent = `${s.byteLength} bytes · ${s.nodeCount} nodes · depth ${s.maxDepth}`;
    }
  }

  renderCrc(result) {
    const crc = this.container?.querySelector("#tlv-crc-bar");
    if (!crc) return;

    if (result.format !== "qris" || !result.crc) {
      crc.className = "tlv-crc-status";
      crc.textContent = "";
      return;
    }

    crc.className = "tlv-crc-status";

    if (!result.crc.present) {
      crc.classList.add("crc-missing");
      crc.textContent = "CRC tag (63) not found";
    } else if (result.crc.valid) {
      crc.classList.add("crc-valid");
      crc.textContent = `✓ CRC valid (${result.crc.actual})`;
    } else {
      crc.classList.add("crc-invalid");
      crc.textContent = `✗ CRC invalid — payload computes to ${result.crc.expected} (CRC-CCITT 0xFFFF), but tag 63 contains ${result.crc.actual}. The payload may have been modified after the CRC was generated.`;
    }
  }

  renderValidation(result) {
    const bar = this.container?.querySelector("#tlv-validation-bar");
    const statusBar = this.container?.querySelector("#tlv-status-bar");
    if (!bar || !statusBar) return;

    if (result.format !== "qris" || !result.validation) {
      bar.innerHTML = "";
      statusBar.style.display = "none";
      return;
    }

    statusBar.style.display = "flex";

    if (result.validation.length === 0) {
      bar.innerHTML = `<span class="tlv-validation-ok">· ✓ All mandatory tags present</span>`;
      return;
    }

    bar.innerHTML = result.validation.map((v) => {
      const cls = v.level === "error" ? "validation-error" : "validation-warn";
      const icon = v.level === "error" ? "✗" : "⚠";
      return `<span class="tlv-validation-item ${cls}"><span class="tlv-validation-icon">${icon}</span> ${this.esc(v.message)}</span>`;
    }).join("");
  }

  hideStatusBar() {
    const statusBar = this.container?.querySelector("#tlv-status-bar");
    if (statusBar) { statusBar.style.display = "none"; }
    const crc = this.container?.querySelector("#tlv-crc-bar");
    if (crc) { crc.className = "tlv-crc-status"; crc.textContent = ""; }
    const val = this.container?.querySelector("#tlv-validation-bar");
    if (val) { val.innerHTML = ""; }
  }

  renderTableHead(format) {
    const head = this.container?.querySelector("#tlv-table-head");
    if (!head) return;

    if (format === "qris") {
      head.innerHTML = `<tr><th>#</th><th>Tag</th><th>Name</th><th>Len</th><th>Value</th></tr>`;
    } else {
      head.innerHTML = `<tr><th>#</th><th>Depth</th><th>Offset</th><th>Class</th><th>Tag</th><th>C</th><th>Len</th><th>Preview</th><th>Value (Hex)</th></tr>`;
    }
  }

  // ── Tree markup ───────────────────────────────────────────────────────

  buildTreeMarkup(nodes, format) {
    if (!nodes || nodes.length === 0) {
      return `<div class="tlv-empty-msg">No TLV nodes found.</div>`;
    }

    const renderLevel = (items) => `
      <ul class="tlv-tree-level">
        ${items.map((node) => format === "qris" ? this.qrisTreeNode(node, renderLevel) : this.berTreeNode(node, renderLevel)).join("")}
      </ul>
    `;

    return renderLevel(nodes);
  }

  qrisTreeNode(node, renderLevel) {
    const name = node.tagName ? `<span class="tlv-tree-name">${this.esc(node.tagName)}</span>` : "";
    const annotation = node.annotation ? ` <span class="tlv-tree-annotation">(${this.formatAnnotation(node.tag, node.annotation)})</span>` : "";

    if (node.constructed) {
      return `
        <li class="tlv-tree-node tlv-tree-node-constructed">
          <div class="tlv-tree-node-header">
            <span class="tlv-tree-tag">${this.esc(node.tag)}</span> ${name}
          </div>
          ${node.children && node.children.length > 0 ? renderLevel(node.children) : ""}
        </li>
      `;
    }

    // Primitive: show value inline on the same line
    const display = node.value.length > 80 ? node.value.slice(0, 80) + "..." : node.value;
    return `
      <li class="tlv-tree-node">
        <div class="tlv-tree-node-header">
          <span class="tlv-tree-tag">${this.esc(node.tag)}</span> ${name}
          <span class="tlv-tree-inline-value">${this.esc(display)}</span>${annotation}
        </div>
      </li>
    `;
  }

  berTreeNode(node, renderLevel) {
    const chip = `<span class="tlv-tree-chip">${this.esc(node.tagClass)}</span>`;
    const meta = `<span class="tlv-tree-meta">${node.length}B @${node.offset}</span>`;

    if (node.constructed) {
      return `
        <li class="tlv-tree-node tlv-tree-node-constructed">
          <div class="tlv-tree-node-header">
            <span class="tlv-tree-tag">${this.esc(node.tag)}</span> ${chip} ${meta}
          </div>
          ${node.children && node.children.length > 0 ? renderLevel(node.children) : ""}
        </li>
      `;
    }

    const hex = this.trimHex(node.valueHex, 60);
    const preview = node.valuePreview ? ` <span class="tlv-tree-name">"${this.esc(node.valuePreview)}"</span>` : "";
    return `
      <li class="tlv-tree-node">
        <div class="tlv-tree-node-header">
          <span class="tlv-tree-tag">${this.esc(node.tag)}</span> ${chip}
          <span class="tlv-tree-inline-value">${this.esc(hex || "(empty)")}</span>${preview} ${meta}
        </div>
      </li>
    `;
  }

  // ── Table rows ────────────────────────────────────────────────────────

  buildTableRows(rows, format) {
    if (!rows || rows.length === 0) {
      return `<tr class="tlv-empty-row"><td colspan="10">No rows.</td></tr>`;
    }
    return rows.map((r) => format === "qris" ? this.qrisTableRow(r) : this.berTableRow(r)).join("");
  }

  qrisTableRow(row) {
    const indent = `<span class="tlv-depth-indent"></span>`.repeat(row.depth);
    const value = row.value.length > 100 ? row.value.slice(0, 100) + "..." : row.value;
    const annotation = row.annotation ? ` <span class="tlv-tree-annotation">(${this.formatAnnotation(row.tag, row.annotation)})</span>` : "";
    return `
      <tr>
        <td>${row.rowIndex}</td>
        <td class="tlv-mono">${indent}${this.esc(row.tag)}</td>
        <td>${this.esc(row.tagName || "")}</td>
        <td>${row.length}</td>
        <td>${row.constructed ? "(template)" : this.esc(value)}${annotation}</td>
      </tr>
    `;
  }

  berTableRow(row) {
    const indent = `<span class="tlv-depth-indent"></span>`.repeat(row.depth);
    const hex = this.trimHex(row.valueHex, 60);
    return `
      <tr>
        <td>${row.rowIndex}</td>
        <td>${row.depth}</td>
        <td>${row.offset}</td>
        <td>${this.esc(row.tagClass)}</td>
        <td class="tlv-mono">${indent}${this.esc(row.tag)}</td>
        <td>${row.constructed ? "Y" : "N"}</td>
        <td>${row.length}</td>
        <td>${this.esc(row.valuePreview || "")}</td>
        <td class="tlv-mono">${this.esc(hex)}</td>
      </tr>
    `;
  }

  // ── View switching ────────────────────────────────────────────────────

  applyView(view) {
    if (!["tree", "table", "json"].includes(view)) return;
    this.currentView = view;
    this.persistValue(this.storageKeys.view, view);

    const c = this.container;
    if (!c) return;

    c.querySelector("#tlv-tree-view").style.display = view === "tree" ? "flex" : "none";
    c.querySelector("#tlv-table-view").style.display = view === "table" ? "flex" : "none";
    c.querySelector("#tlv-json-view").style.display = view === "json" ? "flex" : "none";

    c.querySelectorAll(".tlv-view-tabs .tab-button").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === view);
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────

  async handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      const inputEl = this.container?.querySelector("#tlv-input");
      if (!inputEl) return;
      inputEl.value = text || "";
      this.persistInputDebounced();
      this.parseCurrentInput();
    } catch (_) {
      this.showError("Failed to read clipboard");
    }
  }

  applySample(type) {
    const inputEl = this.container?.querySelector("#tlv-input");
    const formatEl = this.container?.querySelector("#tlv-format");
    if (!inputEl || !formatEl) return;

    if (type === "qris") {
      inputEl.value = TLVViewerService.buildQrisSample();
      formatEl.value = "qris";
    } else {
      inputEl.value = "6F0E8407A0000000031010A503500141";
      formatEl.value = "ber-hex";
    }

    this.persistValue(this.storageKeys.format, formatEl.value);
    this.persistInputDebounced();
    this.parseCurrentInput();
  }

  clearAll() {
    const inputEl = this.container?.querySelector("#tlv-input");
    if (inputEl) inputEl.value = "";
    this.persistValue(this.storageKeys.input, "");
    this.lastResult = null;
    this.clearError();
    this.renderEmpty();
    this.updateCopyButton();
  }

  async copyCurrentOutput() {
    if (!this.lastResult) return;

    let text;
    if (this.currentView === "table") {
      text = this.buildTableCopyText(this.lastResult.rows, this.lastResult.format);
    } else {
      text = JSON.stringify(this.lastResult.jsonTree, null, 2);
    }

    await this.copyToClipboard(text);
  }

  buildTableCopyText(rows, format) {
    if (format === "qris") {
      const header = ["#", "tag", "name", "length", "value"].join("\t");
      const lines = rows.map((r) => [r.rowIndex, r.tag, r.tagName || "", r.length, r.constructed ? "(template)" : r.value].join("\t"));
      return [header, ...lines].join("\n");
    }

    const header = ["#", "depth", "offset", "class", "tag", "constructed", "length", "preview", "value_hex"].join("\t");
    const lines = rows.map((r) =>
      [r.rowIndex, r.depth, r.offset, r.tagClass, r.tag, r.constructed ? "Y" : "N", r.length, r.valuePreview || "", r.valueHex].join("\t")
    );
    return [header, ...lines].join("\n");
  }

  // ── UI helpers ────────────────────────────────────────────────────────

  showError(message) {
    const el = this.container?.querySelector("#tlv-error");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
  }

  clearError() {
    const el = this.container?.querySelector("#tlv-error");
    if (!el) return;
    el.textContent = "";
    el.style.display = "none";
  }

  updateCopyButton() {
    const btn = this.container?.querySelector("#tlv-copy-output-btn");
    if (btn) btn.disabled = !this.lastResult;
  }

  formatAnnotation(tag, annotation) {
    if (tag === "52") {
      return `${this.esc(annotation)} - based on <a href="https://www.iso.org/standard/33365.html" target="_blank" rel="noopener noreferrer">ISO 18245</a>`;
    }
    return this.esc(annotation);
  }

  esc(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  trimHex(value, max = 80) {
    const s = String(value || "");
    return s.length > max ? s.slice(0, max) + " ..." : s;
  }
}

export { TLVViewer };
