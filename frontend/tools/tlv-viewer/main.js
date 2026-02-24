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
      description: "Parse TLV payloads with tree and table views",
      icon: "tlv",
      category: "general",
      eventBus,
    });

    this.currentView = "tree";
    this.lastResult = null;
    this.persistTimer = null;
    this.storageKeys = {
      input: "tool:tlv-viewer:input",
      mode: "tool:tlv-viewer:mode",
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
    const container = this.container;
    if (!container) return;

    container.querySelector("#tlv-parse-btn")?.addEventListener("click", () => this.parseCurrentInput());
    container.querySelector("#tlv-paste-btn")?.addEventListener("click", () => this.handlePaste());
    container.querySelector("#tlv-sample-btn")?.addEventListener("click", () => this.applySample());
    container.querySelector("#tlv-clear-btn")?.addEventListener("click", () => this.clearInputAndOutput());
    container.querySelector("#tlv-copy-output-btn")?.addEventListener("click", () => this.copyCurrentOutput());

    const inputEl = container.querySelector("#tlv-input");
    if (inputEl) {
      inputEl.addEventListener("input", () => this.persistInputDebounced());
      inputEl.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          this.parseCurrentInput();
        }
      });
    }

    const modeEl = container.querySelector("#tlv-input-mode");
    if (modeEl) {
      modeEl.addEventListener("change", () => {
        this.persistValue(this.storageKeys.mode, modeEl.value);
        if ((this.container.querySelector("#tlv-input")?.value || "").trim()) {
          this.parseCurrentInput();
        }
      });
    }

    container.querySelectorAll(".tlv-view-tabs .tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.getAttribute("data-view");
        if (view) this.applyView(view);
      });
    });
  }

  restoreState() {
    const container = this.container;
    if (!container) return;

    const inputEl = container.querySelector("#tlv-input");
    const modeEl = container.querySelector("#tlv-input-mode");

    try {
      const savedMode = localStorage.getItem(this.storageKeys.mode);
      const savedInput = localStorage.getItem(this.storageKeys.input);
      const savedView = localStorage.getItem(this.storageKeys.view);

      if (savedMode && modeEl && ["hex", "base64", "utf8"].includes(savedMode)) {
        modeEl.value = savedMode;
      }

      if (savedInput && inputEl) {
        inputEl.value = savedInput;
      }

      if (savedView && ["tree", "table"].includes(savedView)) {
        this.currentView = savedView;
      }
    } catch (_) {}

    if ((inputEl?.value || "").trim()) {
      this.parseCurrentInput();
    } else {
      this.renderEmptyOutput();
    }
  }

  persistInputDebounced() {
    const input = this.container?.querySelector("#tlv-input")?.value || "";
    if (this.persistTimer) clearTimeout(this.persistTimer);

    this.persistTimer = setTimeout(() => {
      this.persistValue(this.storageKeys.input, input);
    }, 250);
  }

  persistValue(key, value) {
    try {
      localStorage.setItem(key, value || "");
    } catch (_) {}
  }

  parseCurrentInput() {
    const container = this.container;
    if (!container) return;

    const inputEl = container.querySelector("#tlv-input");
    const modeEl = container.querySelector("#tlv-input-mode");
    const input = inputEl?.value || "";
    const inputMode = modeEl?.value || "hex";

    if (!input.trim()) {
      this.lastResult = null;
      this.renderEmptyOutput();
      this.showInlineError("Input is empty. Paste or type TLV payload first.");
      this.updateCopyButton();
      return;
    }

    try {
      const result = TLVViewerService.parse(input, inputMode);
      this.lastResult = result;
      this.clearInlineError();
      this.renderResult(result);
      this.updateCopyButton();
      UsageTracker.trackFeature("tlv-viewer", "parse");
      UsageTracker.trackEvent("tlv-viewer", "parse", {
        mode: inputMode,
        bytes: result.summary.byteLength,
        nodes: result.summary.nodeCount,
      });
    } catch (error) {
      this.lastResult = null;
      this.renderEmptyOutput();
      this.showInlineError(error?.message || "Failed to parse TLV payload.");
      this.updateCopyButton();
      UsageTracker.trackEvent("tlv-viewer", "parse_error", UsageTracker.enrichErrorMeta(error, { mode: inputMode }));
    }
  }

  renderResult(result) {
    const container = this.container;
    if (!container) return;

    container.querySelector("#tlv-summary-bytes").textContent = String(result.summary.byteLength);
    container.querySelector("#tlv-summary-nodes").textContent = String(result.summary.nodeCount);
    container.querySelector("#tlv-summary-top").textContent = String(result.summary.topLevelCount);
    container.querySelector("#tlv-summary-depth").textContent = String(result.summary.maxDepth);

    const treeList = container.querySelector("#tlv-tree-list");
    const jsonOutput = container.querySelector("#tlv-json-output");
    const tableBody = container.querySelector("#tlv-table-body");

    if (treeList) {
      treeList.classList.remove("tlv-empty-state");
      treeList.innerHTML = this.buildTreeMarkup(result.nodes);
    }
    if (jsonOutput) jsonOutput.textContent = JSON.stringify(result.jsonTree, null, 2);
    if (tableBody) tableBody.innerHTML = this.buildTableRows(result.rows);
  }

  renderEmptyOutput() {
    const container = this.container;
    if (!container) return;

    container.querySelector("#tlv-summary-bytes").textContent = "0";
    container.querySelector("#tlv-summary-nodes").textContent = "0";
    container.querySelector("#tlv-summary-top").textContent = "0";
    container.querySelector("#tlv-summary-depth").textContent = "0";

    const treeList = container.querySelector("#tlv-tree-list");
    const jsonOutput = container.querySelector("#tlv-json-output");
    const tableBody = container.querySelector("#tlv-table-body");
    const jsonPanel = container.querySelector("#tlv-json-panel");

    if (treeList) {
      treeList.classList.add("tlv-empty-state");
      treeList.innerHTML = this.getEmptyTreeMarkup("No TLV parsed yet", 'Paste a payload and press "Parse TLV" to inspect nodes.');
    }
    if (jsonOutput) jsonOutput.textContent = "";
    if (jsonPanel) jsonPanel.open = false;
    if (tableBody) {
      tableBody.innerHTML = `
        <tr class="tlv-empty-row">
          <td colspan="10">Parse TLV to populate rows.</td>
        </tr>
      `;
    }
  }

  buildTreeMarkup(nodes) {
    if (!nodes || nodes.length === 0) {
      return this.getEmptyTreeMarkup("No TLV nodes found", "This payload does not contain parseable TLV nodes.");
    }

    const renderLevel = (items) => {
      return `
        <ul class="tlv-tree-level">
          ${items
            .map((node) => {
              const preview = node.valuePreview ? `Preview: "${this.escapeHtml(node.valuePreview)}"` : "Preview: (binary)";
              const valueHex = this.formatHexPreview(node.valueHex, 64);
              return `
                <li class="tlv-tree-node">
                  <div class="tlv-tree-node-header">
                    <span class="tlv-tree-tag">${this.escapeHtml(node.tag)}</span>
                    <span class="tlv-tree-chip">${this.escapeHtml(node.tagClass)}</span>
                    <span class="tlv-tree-chip">${node.constructed ? "Constructed" : "Primitive"}</span>
                    <span class="tlv-tree-len">Len ${node.length}</span>
                    <span class="tlv-tree-offset">@${node.offset}</span>
                  </div>
                  <div class="tlv-tree-node-meta">${preview}</div>
                  <div class="tlv-tree-node-hex">Value: ${this.escapeHtml(valueHex || "(empty)")}</div>
                  ${node.children && node.children.length > 0 ? renderLevel(node.children) : ""}
                </li>
              `;
            })
            .join("")}
        </ul>
      `;
    };

    return renderLevel(nodes);
  }

  buildTableRows(rows) {
    if (!rows || rows.length === 0) {
      return `
        <tr class="tlv-empty-row">
          <td colspan="10">No rows to show.</td>
        </tr>
      `;
    }

    return rows
      .map((row) => {
        const preview = row.valuePreview ? this.escapeHtml(row.valuePreview) : "(binary)";
        const valueHexShort = this.formatHexPreview(row.valueHex, 80);
        const rawHexShort = this.formatHexPreview(row.rawHex, 80);
        const depthPad = row.depth * 12;

        return `
          <tr>
            <td>${row.rowIndex}</td>
            <td>${row.depth}</td>
            <td>${row.offset}</td>
            <td>${this.escapeHtml(row.tagClass)}</td>
            <td class="tlv-mono">
              <span class="tlv-depth-mark" style="margin-left:${depthPad}px"></span>${this.escapeHtml(row.tag)}
            </td>
            <td>${row.constructed ? "Y" : "N"}</td>
            <td>${row.length}</td>
            <td>${preview}</td>
            <td class="tlv-mono">${this.escapeHtml(valueHexShort)}</td>
            <td class="tlv-mono">${this.escapeHtml(rawHexShort)}</td>
          </tr>
        `;
      })
      .join("");
  }

  applyView(view) {
    if (!["tree", "table"].includes(view)) return;

    this.currentView = view;
    this.persistValue(this.storageKeys.view, view);

    const container = this.container;
    if (!container) return;

    const treePane = container.querySelector("#tlv-tree-view");
    const tablePane = container.querySelector("#tlv-table-view");

    if (treePane) treePane.style.display = view === "tree" ? "flex" : "none";
    if (tablePane) tablePane.style.display = view === "table" ? "flex" : "none";

    container.querySelectorAll(".tlv-view-tabs .tab-button").forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-view") === view);
    });
  }

  showInlineError(message) {
    const errorEl = this.container?.querySelector("#tlv-error");
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }

  clearInlineError() {
    const errorEl = this.container?.querySelector("#tlv-error");
    if (!errorEl) return;
    errorEl.textContent = "";
    errorEl.style.display = "none";
  }

  updateCopyButton() {
    const copyBtn = this.container?.querySelector("#tlv-copy-output-btn");
    if (!copyBtn) return;
    copyBtn.disabled = !this.lastResult;
  }

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

  applySample() {
    const samplePayload = "6F0E8407A0000000031010A503500141";
    const inputEl = this.container?.querySelector("#tlv-input");
    const modeEl = this.container?.querySelector("#tlv-input-mode");
    if (!inputEl || !modeEl) return;

    inputEl.value = samplePayload;
    modeEl.value = "hex";
    this.persistValue(this.storageKeys.mode, "hex");
    this.persistInputDebounced();
    this.parseCurrentInput();
  }

  clearInputAndOutput() {
    const inputEl = this.container?.querySelector("#tlv-input");
    if (inputEl) inputEl.value = "";
    this.persistValue(this.storageKeys.input, "");
    this.lastResult = null;
    this.clearInlineError();
    this.renderEmptyOutput();
    this.updateCopyButton();
  }

  async copyCurrentOutput() {
    if (!this.lastResult) return;

    const text =
      this.currentView === "table"
        ? this.buildTableCopyText(this.lastResult.rows)
        : JSON.stringify(this.lastResult.jsonTree, null, 2);

    await this.copyToClipboard(text);
  }

  buildTableCopyText(rows) {
    const header = ["row", "depth", "offset", "class", "tag", "constructed", "length", "preview", "value_hex", "raw_hex"].join("\t");
    const lines = rows.map((row) =>
      [
        row.rowIndex,
        row.depth,
        row.offset,
        row.tagClass,
        row.tag,
        row.constructed ? "Y" : "N",
        row.length,
        row.valuePreview || "",
        row.valueHex,
        row.rawHex,
      ].join("\t")
    );
    return [header, ...lines].join("\n");
  }

  getEmptyTreeMarkup(title, subtitle) {
    return `
      <div class="tlv-empty-title">${this.escapeHtml(title)}</div>
      <div class="tlv-empty-subtitle">${this.escapeHtml(subtitle)}</div>
      <ol class="tlv-empty-steps">
        <li>Choose mode (Hex, Base64, or UTF-8/Text).</li>
        <li>Paste payload data into the input panel.</li>
        <li>Press Parse TLV, then switch between tree and table.</li>
      </ol>
    `;
  }

  formatHexPreview(value, maxChars = 80) {
    const text = String(value || "");
    if (!text) return "";
    return text.length > maxChars ? `${text.slice(0, maxChars)} ...` : text;
  }

  escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

export { TLVViewer };
