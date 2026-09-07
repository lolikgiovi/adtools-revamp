import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { cleanAnalyticsMeta } from "../../core/AnalyticsMeta.js";
import { getIconSvg } from "./icon.js";
import { getLineCounts, getTextCounts } from "./service.js";
import { CharCounterTemplate } from "./template.js";
import "./styles.css";

const STORAGE_KEY = "tool:char-counter:text";
const MODE_STORAGE_KEY = "tool:char-counter:mode";

export class CharCounter extends BaseTool {
  constructor(eventBus) {
    super({ id: "char-counter", eventBus });
    this.input = null;
    this.persistTimer = null;
    this.hasTrackedCount = false;
    this.mode = "summary";
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return CharCounterTemplate;
  }

  onMount() {
    this.input = this.container.querySelector("#charCounterInput");
    this.restoreDraft();
    this.restoreMode();
    this.bindEvents();
    this.applyMode();
    this.updateCounts();
    this.input?.focus();

    try {
      UsageTracker.trackEvent("char-counter", "mount");
    } catch (_) {
      // Analytics must never interrupt the tool.
    }
  }

  onUnmount() {
    clearTimeout(this.persistTimer);
    this.persistDraft();
    this.input = null;
  }

  bindEvents() {
    this.input?.addEventListener("input", () => {
      this.updateCounts();
      this.schedulePersist();
    });

    this.container.querySelector("#charCounterPaste")?.addEventListener("click", () => this.pasteText());
    this.container.querySelector("#charCounterCopy")?.addEventListener("click", () => this.copyText());
    this.container.querySelector("#charCounterClear")?.addEventListener("click", () => this.clearText());
    this.container.querySelector("#charCounterSummaryMode")?.addEventListener("click", () => this.setMode("summary"));
    this.container.querySelector("#charCounterRowMode")?.addEventListener("click", () => this.setMode("rows"));
  }

  updateCounts() {
    const text = this.input?.value || "";
    const counts = getTextCounts(text);
    const formatted = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value.toLocaleString()]));

    this.setText("#charCounterCharacters", formatted.characters);
    this.setText("#charCounterNoSpaces", formatted.charactersNoSpaces);
    this.setText("#charCounterWords", formatted.words);
    this.setText("#charCounterLines", formatted.lines);
    this.setText("#charCounterBytes", formatted.bytes);
    if (this.mode === "rows") this.renderLineCounts(text);

    const hasText = text.length > 0;
    this.container.querySelector(".char-counter-workspace")?.classList.toggle("has-text", hasText);
    const copyButton = this.container.querySelector("#charCounterCopy");
    const clearButton = this.container.querySelector("#charCounterClear");
    if (copyButton) copyButton.disabled = !hasText;
    if (clearButton) clearButton.disabled = !hasText;

    if (hasText && !this.hasTrackedCount) {
      this.hasTrackedCount = true;
      const meta = cleanAnalyticsMeta({ characters: counts.characters, words: counts.words });
      try {
        UsageTracker.trackToolUse("char-counter", "count", meta);
      } catch (_) {
        // Analytics must never interrupt the tool.
      }
    }
  }

  renderLineCounts(text) {
    const rowsContainer = this.container.querySelector("#charCounterRows");
    if (!rowsContainer) return;

    const rows = getLineCounts(text);
    this.setText("#charCounterRowsCaption", `${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"}`);
    rowsContainer.replaceChildren();

    if (rows.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "char-counter-row-empty";
      emptyState.innerHTML = `
        <p>Enter one value per row to compare their lengths.</p>
        <code>config-integration-service-code-01 <strong>34</strong></code>
        <code>config-integration-service-code-0124234234 <strong>42</strong></code>
      `;
      rowsContainer.appendChild(emptyState);
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      const result = document.createElement("div");
      result.className = "char-counter-row-result";

      const line = document.createElement("span");
      line.className = "char-counter-row-number";
      line.textContent = row.line.toLocaleString();

      const content = document.createElement("code");
      content.textContent = row.content || "Empty row";
      if (!row.content) content.classList.add("is-empty");

      const length = document.createElement("strong");
      length.textContent = row.characters.toLocaleString();

      result.append(line, content, length);
      fragment.appendChild(result);
    });
    rowsContainer.appendChild(fragment);
  }

  setMode(mode) {
    if (mode !== "summary" && mode !== "rows") return;
    if (this.mode === mode) {
      this.input?.focus();
      return;
    }
    this.mode = mode;
    this.applyMode();
    if (mode === "rows") this.renderLineCounts(this.input?.value || "");
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch (_) {
      // Mode persistence is optional.
    }

    try {
      UsageTracker.trackEvent("char-counter", "mode_changed", { mode });
    } catch (_) {
      // Analytics must never interrupt the tool.
    }
    this.input?.focus();
  }

  applyMode() {
    const isRowMode = this.mode === "rows";
    this.container.querySelector(".char-counter-workspace")?.classList.toggle("is-row-mode", isRowMode);
    this.container.querySelector("#charCounterSummaryMode")?.setAttribute("aria-pressed", String(!isRowMode));
    this.container.querySelector("#charCounterRowMode")?.setAttribute("aria-pressed", String(isRowMode));
  }

  setText(selector, value) {
    const element = this.container.querySelector(selector);
    if (element) element.textContent = value;
  }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistDraft(), 250);
  }

  persistDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, this.input?.value || "");
    } catch (_) {
      // Storage can be unavailable in private or restricted contexts.
    }
  }

  restoreDraft() {
    if (!this.input) return;
    try {
      this.input.value = localStorage.getItem(STORAGE_KEY) || "";
    } catch (_) {
      // Start with an empty draft when storage is unavailable.
    }
  }

  restoreMode() {
    try {
      this.mode = localStorage.getItem(MODE_STORAGE_KEY) === "rows" ? "rows" : "summary";
    } catch (_) {
      this.mode = "summary";
    }
  }

  async pasteText() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        this.showError("Clipboard is empty");
        return;
      }

      this.input.value = text;
      this.updateCounts();
      this.persistDraft();
      this.input.focus();
      this.showSuccess("Pasted from clipboard");
    } catch (error) {
      console.error("Paste error:", error);
      this.showError("Failed to paste from clipboard");
    }
  }

  async copyText() {
    const text = this.input?.value || "";
    if (!text) return;
    if (await this.copyToClipboard(text, this.container.querySelector("#charCounterCopy"))) {
      try {
        UsageTracker.trackEvent("char-counter", "copy");
      } catch (_) {
        // Analytics must never interrupt the tool.
      }
    }
    this.input?.focus();
  }

  clearText() {
    if (!this.input) return;
    this.input.value = "";
    this.updateCounts();
    this.persistDraft();
    this.input.focus();
  }
}
