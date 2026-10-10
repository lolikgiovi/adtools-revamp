/**
 * MasterDetailView - Renders comparison results with master-detail split layout
 *
 * The question this surface answers is "what differs", so the difference is the layout:
 * - Left pane: every compared record, annotated with the field names that differ in it.
 * - Right pane: the changed fields as a tab strip over one side-by-side text diff.
 * - The text diff is the only detail body. diff2html renders it; Monaco upgrades it in place.
 * - Reviewing many records one-by-one stays cheap: selecting a record swaps only the detail
 *   pane, so the list keeps its DOM, its scroll position, and arrow-key walking.
 */
import { createTwoFilesPatch } from "diff";
import { html as renderDiffHtml } from "diff2html";
import { formatFieldList } from "../lib/unified-compare-utils.js";

/** Differing field names listed under one record in the master list. */
const MASTER_FIELD_LIMIT = 2;

/** Below this host width the diff editor shows one inline pane instead of two. */
const SIDE_BY_SIDE_MIN_WIDTH = 660;

/** "(UAT1 COMP) SQL Query" reads as "UAT1 COMP" wherever a source labels one side of a diff. */
function shortSourceName(name, fallback = "") {
  if (!name) return fallback;
  return name.match(/^\(([^)]+)\)/)?.[1] || name;
}

/** Monaco takes a font stack, not a CSS variable, so resolve the token the theme owns. */
function monoFontFamily(element) {
  const value = getComputedStyle(element).getPropertyValue("--font-mono").trim();
  return value || "ui-monospace, Menlo, monospace";
}

/** The theme manager marks the active theme on the document root; the editor follows it. */
function isDarkTheme() {
  return document.documentElement.classList.contains("dark");
}

/**
 * 1-based line where two texts first part ways, or 0 when they match.
 * Opening a 120-line template at line 1 would hide the change the pane exists to show.
 */
function firstChangedLine(before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const shared = Math.min(beforeLines.length, afterLines.length);
  for (let index = 0; index < shared; index += 1) {
    if (beforeLines[index] !== afterLines[index]) return index + 1;
  }
  return beforeLines.length === afterLines.length ? 0 : shared + 1;
}

export class MasterDetailView {
  constructor() {
    this.selectedIndex = 0;
    this.selectedDiffField = null;
    this.comparisons = [];
    this.env1Name = "";
    this.env2Name = "";
    this.compareFields = null;
    this.diffEditor = null;
    this.diffModels = [];
    this.diffMountId = 0;
  }

  /**
   * Renders the master-detail view
   * @param {Array} comparisons - Array of comparison objects
   * @param {string} env1Name - Environment 1 name
   * @param {string} env2Name - Environment 2 name
   * @param {Object} options - Render options
   * @param {Array<string>} options.compareFields - Fields to display (from user selection)
   */
  render(comparisons, env1Name, env2Name, options = {}) {
    this.comparisons = comparisons || [];
    this.env1Name = env1Name;
    this.env2Name = env2Name;
    this.compareFields = options.compareFields || null;

    if (this.comparisons.length === 0) {
      return `
        <div class="placeholder-message">
          <p>No records found matching the criteria.</p>
        </div>
      `;
    }

    return `
      <div class="master-detail-view">
        <div class="master-pane">
          ${this.renderMasterList()}
        </div>
        <div class="detail-pane">
          ${this.renderDetailPanel()}
        </div>
      </div>
    `;
  }

  /**
   * Formats a primary key as one compact identity string: values only, joined by a pipe.
   * `{ SERVICE_CODE: "gold-buyback", ENVIRONMENT: "BETA" }` → `gold-buyback|BETA`
   */
  formatPrimaryKey(keyMap) {
    if (!keyMap || typeof keyMap !== "object") return "";
    const entries = Object.entries(keyMap);
    if (entries.length === 0) return "";
    return entries.map(([, value]) => this.formatValue(value)).join("|");
  }

  /**
   * Formats a value for display
   */
  formatValue(value) {
    if (value === null || value === undefined) return "(null)";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  /**
   * Renders the master list (left pane)
   */
  renderMasterList() {
    const itemsHtml = this.comparisons.map((comp, index) => this.renderMasterItem(comp, index)).join("");

    return `
      <div class="master-list">
        <div class="master-header">
          <h3>Records (${this.comparisons.length})</h3>
        </div>
        <div class="master-items" role="listbox" aria-label="Compared records">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  /**
   * Renders a single master list item: the record identity, its status, and the fields that differ.
   */
  renderMasterItem(comparison, index) {
    const statusClass = comparison.status.toLowerCase().replaceAll("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status);
    const isSelected = index === this.selectedIndex;
    const differFields = comparison.status === "differ" ? comparison.differences || [] : [];

    return `
      <div class="master-item ${isSelected ? "selected" : ""} status-${statusClass}"
           data-index="${index}" role="option" aria-selected="${isSelected}" tabindex="${isSelected ? 0 : -1}">
        <div class="master-item-pk">${this.escapeHtml(this.formatPrimaryKey(comparison.key))}</div>
        <div class="master-item-row">
          <span class="status-badge status-${statusClass}">${this.escapeHtml(statusLabel)}</span>
          ${
            differFields.length
              ? `<span class="master-item-meta" title="${this.escapeHtml(formatFieldList(differFields, 99))}">${this.escapeHtml(
                  formatFieldList(differFields, MASTER_FIELD_LIMIT),
                )}</span>`
              : ""
          }
        </div>
      </div>
    `;
  }

  /**
   * Renders the detail panel (right pane)
   */
  renderDetailPanel() {
    const comparison = this.comparisons[this.selectedIndex];
    if (!comparison) {
      return '<div class="detail-empty"><p>Select a record to view details</p></div>';
    }

    return `
      <div class="detail-content">
        ${this.renderDetailHeader(comparison)}
        ${this.renderDetailBody(comparison)}
      </div>
    `;
  }

  /**
   * Renders detail panel header: what the record is, and where it sits in the review queue.
   */
  renderDetailHeader(comparison) {
    const statusClass = comparison.status.toLowerCase().replaceAll("_", "-");
    const title = this.formatPrimaryKey(comparison.key);
    const isFirst = this.selectedIndex === 0;
    const isLast = this.selectedIndex === this.comparisons.length - 1;

    return `
      <div class="detail-header">
        <span class="status-badge status-${statusClass}">${this.escapeHtml(this.getStatusLabel(comparison.status))}</span>
        <h3 class="detail-title" title="${this.escapeHtml(title)}">${this.escapeHtml(title)}</h3>
        <div class="detail-nav">
          <button type="button" class="btn btn-outline btn-sm detail-nav-step" id="btn-prev-detail"
                  aria-label="Previous record" title="Previous record (↑)"
                  ${isFirst ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <span class="detail-position">${this.selectedIndex + 1}/${this.comparisons.length}</span>
          <button type="button" class="btn btn-outline btn-sm detail-nav-step" id="btn-next-detail"
                  aria-label="Next record" title="Next record (↓)"
                  ${isLast ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Renders the detail body. Matching records carry no difference to navigate, so they get a
   * plain value list instead of diff chrome.
   */
  renderDetailBody(comparison) {
    if (comparison.status === "match") {
      return `
        <div class="detail-body">
          <p class="detail-message">Every compared field is identical in both sources.</p>
          ${this.renderDetailData(comparison.env1_data, this.env1Name)}
        </div>
      `;
    }

    const fields = this.visibleDiffFields(comparison);
    if (fields.length === 0) {
      return `
        <div class="detail-body">
          <p class="detail-message">This record changes only in fields that are not selected for comparison.</p>
        </div>
      `;
    }

    return this.renderFieldDiff(comparison, fields);
  }

  /**
   * Ordering is the comparison's own, so tabs read in the order fields were compared.
   * Both sides of the pair are considered: a record present in one source still needs tabs
   * for every comparable field it carries.
   * @returns {Array<string>} Fields the detail pane can show, with `selectedDiffField` kept valid.
   */
  visibleDiffFields(comparison) {
    const env1Data = comparison.env1_data || {};
    const env2Data = comparison.env2_data || {};
    const differFields = comparison.differences || [];
    const candidates =
      comparison.status === "differ" && differFields.length
        ? differFields
        : [...new Set([...Object.keys(env1Data), ...Object.keys(env2Data)])];
    const fields = this.compareFields?.length
      ? candidates.filter((field) => this.compareFields.includes(field))
      : candidates;

    if (!fields.includes(this.selectedDiffField)) this.selectedDiffField = fields[0] || null;
    return fields;
  }

  /**
   * Renders one side-by-side diff, tabbed by the fields that differ in this record.
   */
  renderFieldDiff(comparison, fields) {
    const field = this.selectedDiffField;
    const activeIndex = fields.indexOf(field);
    const [before, after] = this.formatDiffPair(comparison.env1_data || {}, comparison.env2_data || {}, field);
    const patch = createTwoFilesPatch("before", "after", before, after, "", "", { context: 3 });
    const fallback = renderDiffHtml(patch, {
      drawFileList: false,
      outputFormat: "side-by-side",
      matching: "lines",
      diffStyle: "char",
    });

    return `
      <div class="detail-field-tabs" role="tablist" aria-label="Fields that differ">
        ${fields.map((name, index) => this.renderFieldTab(name, index, index === activeIndex)).join("")}
      </div>
      <div class="detail-diff-pane" role="tabpanel" aria-labelledby="detail-field-tab-${activeIndex}">
        ${this.renderDiffColumns(comparison)}
        <div class="compare-monaco-diff" aria-hidden="true"></div>
        <section class="detail-text-diff detail-diff-fallback" tabindex="0"
                 aria-label="${this.escapeHtml(field)} comparison between ${this.escapeHtml(this.env1Name)} and ${this.escapeHtml(
                   this.env2Name,
                 )}">${fallback}</section>
      </div>
    `;
  }

  renderFieldTab(name, index, isActive) {
    return `
      <button type="button" class="field-tab" id="detail-field-tab-${index}" role="tab" data-diff-field="${this.escapeHtml(name)}"
              aria-selected="${isActive}" tabindex="${isActive ? 0 : -1}">${this.escapeHtml(name)}</button>
    `;
  }

  /**
   * Names the two diff panes with the concise source label, and says which side has no record.
   */
  renderDiffColumns(comparison) {
    const missing = comparison.status === "only_in_env1" ? "env2" : comparison.status === "only_in_env2" ? "env1" : null;
    const label = (name, isMissing) =>
      `${this.escapeHtml(shortSourceName(name, "Source"))}${isMissing ? " &middot; missing" : ""}`;

    return `
      <div class="detail-diff-columns">
        <span class="${missing === "env1" ? "is-missing" : ""}">${label(this.env1Name, missing === "env1")}</span>
        <span class="${missing === "env2" ? "is-missing" : ""}">${label(this.env2Name, missing === "env2")}</span>
      </div>
    `;
  }

  /**
   * Prepares the two texts a diff will show for one field.
   */
  formatDiffPair(before, after, field) {
    const oldValue = Object.hasOwn(before, field) ? before[field] : undefined;
    const newValue = Object.hasOwn(after, field) ? after[field] : undefined;
    const oldText = oldValue === undefined ? "(missing)" : this.formatValue(oldValue);
    const newText = newValue === undefined ? "(missing)" : this.formatValue(newValue);
    const oldJson = this.parseJsonValue(oldValue);
    const newJson = this.parseJsonValue(newValue);

    // Pretty-print changed JSON for readable lines, but retain raw text when formatting alone caused a strict difference.
    if (oldJson && newJson && JSON.stringify(oldJson.value) !== JSON.stringify(newJson.value)) {
      return [oldJson.pretty, newJson.pretty];
    }
    if (oldJson && newValue === undefined) return [oldJson.pretty, newText];
    if (newJson && oldValue === undefined) return [oldText, newJson.pretty];
    return [oldText, newText];
  }

  parseJsonValue(value) {
    if (typeof value !== "string" && (typeof value !== "object" || value === null)) return null;
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      if (typeof parsed !== "object" || parsed === null) return null;
      return { value: parsed, pretty: JSON.stringify(parsed, null, 2) };
    } catch {
      return null;
    }
  }

  renderReadableValue(value) {
    const json = this.parseJsonValue(value);
    return json
      ? `<pre class="detail-json-value">${this.escapeHtml(json.pretty)}</pre>`
      : this.escapeHtml(this.formatValue(value));
  }

  /**
   * Renders data object as table
   */
  renderDetailData(data, title) {
    if (!data) return "";

    const entries = Object.entries(data);
    return `
      <div class="detail-data">
        <table class="data-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>${this.escapeHtml(title)}</th>
            </tr>
          </thead>
          <tbody>
            ${entries
              .map(
                ([key, value]) => `
              <tr>
                <td class="data-key">${this.escapeHtml(key)}</td>
                <td class="data-value">${this.renderReadableValue(value)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Drops the mounted diff and any pending mount so a re-render cannot be raced.
   */
  dispose() {
    this.diffMountId += 1;
    this.diffEditor?.dispose();
    this.diffEditor = null;
    this.diffModels.forEach((model) => model.dispose());
    this.diffModels = [];
    this.diffResizeObserver?.disconnect();
    this.diffResizeObserver = null;
    this.tabResizeObserver?.disconnect();
    this.tabResizeObserver = null;
    if (this.diffThemeListener) document.removeEventListener("themeChange", this.diffThemeListener);
    this.diffThemeListener = null;
  }

  /**
   * Upgrades the rendered fallback to a Monaco diff editor when the bundle is available.
   */
  async mountTextDiff(container) {
    const host = container.querySelector(".compare-monaco-diff");
    if (!host || import.meta.env.MODE === "test") return;
    const mountId = ++this.diffMountId;
    try {
      const [editorWorkerModule, jsonWorkerModule, workers] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.worker?worker"),
        import("monaco-editor/esm/vs/language/json/json.worker?worker"),
        import("../../../core/MonacoWorkers.js"),
      ]);
      if (mountId !== this.diffMountId || !host.isConnected) return;
      workers.configureMonacoWorkers(self, { editor: editorWorkerModule.default, json: jsonWorkerModule.default });
      const monaco = await import("monaco-editor/esm/vs/editor/editor.main.js");
      if (mountId !== this.diffMountId || !host.isConnected) return;
      this.diffThemeListener = () => monaco.editor.setTheme(isDarkTheme() ? "vs-dark" : "vs");
      this.diffThemeListener();
      document.addEventListener("themeChange", this.diffThemeListener);
      const comparison = this.comparisons[this.selectedIndex];
      const [before, after] = this.formatDiffPair(
        comparison.env1_data || {},
        comparison.env2_data || {},
        this.selectedDiffField,
      );
      const jsonValues = [before, after].every((value) => {
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      });
      this.diffModels = [
        monaco.editor.createModel(before, jsonValues ? "json" : "plaintext"),
        monaco.editor.createModel(after, jsonValues ? "json" : "plaintext"),
      ];
      host.style.display = "block";
      // Below this width Monaco drops to one inline pane, so the two pane labels collapse into
      // a single legend naming both sources; the class is what the CSS reads.
      const applyDiffLayout = () => {
        const sideBySide = host.clientWidth >= SIDE_BY_SIDE_MIN_WIDTH;
        host.closest(".detail-diff-pane")?.classList.toggle("is-inline-diff", !sideBySide);
        return sideBySide;
      };
      this.diffEditor = monaco.editor.createDiffEditor(host, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        diffWordWrap: "on",
        renderSideBySide: applyDiffLayout(),
        useInlineViewWhenSpaceIsLimited: false,
        renderOverviewRuler: false,
        fontFamily: monoFontFamily(host),
        fontSize: 12,
        lineNumbersMinChars: 3,
      });
      this.diffEditor.setModel({ original: this.diffModels[0], modified: this.diffModels[1] });
      const changedLine = firstChangedLine(before, after);
      if (changedLine > 1) {
        this.diffEditor.getOriginalEditor().revealLineInCenter(changedLine);
        this.diffEditor.getModifiedEditor().revealLineInCenter(changedLine);
      }
      if (typeof ResizeObserver !== "undefined") {
        this.diffResizeObserver = new ResizeObserver(() =>
          this.diffEditor?.updateOptions({ renderSideBySide: applyDiffLayout() }),
        );
        this.diffResizeObserver.observe(host);
      }
      host.classList.add("is-ready");
      container.querySelector(".detail-diff-fallback")?.classList.add("is-hidden");
    } catch (error) {
      console.warn("Monaco diff unavailable; showing text comparison", error);
    }
  }

  /**
   * Attaches event listeners (called after render)
   */
  attachEventListeners(container) {
    this.bindListListeners(container);
    this.bindDetailListeners(container);
  }

  bindListListeners(container) {
    const list = container.querySelector(".master-items");
    if (!list) return;
    list.addEventListener("click", (event) => {
      const item = event.target.closest(".master-item");
      if (item) this.selectItem(Number(item.dataset.index), container);
    });
    list.addEventListener("keydown", (event) => this.onListKeydown(event, container));
  }

  bindDetailListeners(container) {
    container.querySelector("#btn-prev-detail")?.addEventListener("click", () => {
      if (this.selectedIndex > 0) this.selectItem(this.selectedIndex - 1, container);
    });
    container.querySelector("#btn-next-detail")?.addEventListener("click", () => {
      if (this.selectedIndex < this.comparisons.length - 1) this.selectItem(this.selectedIndex + 1, container);
    });

    const tabs = container.querySelector(".detail-field-tabs");
    if (tabs) {
      tabs.addEventListener("click", (event) => {
        const tab = event.target.closest("[data-diff-field]");
        if (!tab || tab.dataset.diffField === this.selectedDiffField) return;
        this.chooseDiffField(tab.dataset.diffField, container);
      });
      tabs.addEventListener("keydown", (event) => this.onTabKeydown(event, container));
      this.watchTabOverflow(tabs);
    }

    this.mountTextDiff(container);
  }

  /**
   * Walks the record queue. Reviewing dozens of records one-by-one is the stated use case,
   * so the list is a keyboard surface rather than a pointer-only one.
   */
  onListKeydown(event, container) {
    const total = this.comparisons.length;
    if (total === 0) return;
    const last = total - 1;
    const moves = {
      ArrowDown: () => Math.min(last, this.selectedIndex + 1),
      ArrowUp: () => Math.max(0, this.selectedIndex - 1),
      PageDown: () => Math.min(last, this.selectedIndex + 10),
      PageUp: () => Math.max(0, this.selectedIndex - 10),
      Home: () => 0,
      End: () => last,
    };
    const move = moves[event.key];
    if (!move) return;

    event.preventDefault();
    const next = move();
    if (next !== this.selectedIndex) this.selectItem(next, container);
  }

  /**
   * Arrow keys move through changed fields with automatic activation, the tabs pattern.
   */
  onTabKeydown(event, container) {
    const fields = this.visibleDiffFields(this.comparisons[this.selectedIndex]) || [];
    if (fields.length < 2) return;
    const current = Math.max(0, fields.indexOf(this.selectedDiffField));
    const last = fields.length - 1;
    const moves = { ArrowRight: Math.min(last, current + 1), ArrowLeft: Math.max(0, current - 1), Home: 0, End: last };
    if (!Object.hasOwn(moves, event.key)) return;

    event.preventDefault();
    const next = moves[event.key];
    if (next !== current) this.chooseDiffField(fields[next], container);
  }

  chooseDiffField(field, container) {
    this.selectedDiffField = field;
    this.selectItem(this.selectedIndex, container, { focusRecord: false, focusField: true });
  }

  /**
   * A field strip can outgrow its row. Edge masks mark the overflow, the wheel scrolls it, and
   * the active tab is always brought back into view.
   */
  watchTabOverflow(strip) {
    const update = () => {
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      strip.classList.toggle("is-overflowing", maxScroll > 1);
      strip.classList.toggle("can-scroll-back", maxScroll > 1 && strip.scrollLeft > 1);
      strip.classList.toggle("can-scroll-forward", maxScroll > 1 && strip.scrollLeft < maxScroll - 1);
    };

    strip.addEventListener("scroll", update, { passive: true });
    strip.addEventListener(
      "wheel",
      (event) => {
        if (strip.scrollWidth <= strip.clientWidth || event.deltaY === 0) return;
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      },
      { passive: false },
    );

    if (typeof ResizeObserver !== "undefined") {
      this.tabResizeObserver = new ResizeObserver(update);
      this.tabResizeObserver.observe(strip);
    }
    update();
    strip.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  /**
   * Selects an item and updates the view. Only the detail pane is replaced, so the master list
   * keeps its node, its scroll offset, and its observer bindings across selections.
   */
  selectItem(index, container, options = {}) {
    const { focusRecord = true, focusField = false } = options;
    const recordChanged = index !== this.selectedIndex;

    this.dispose();
    this.selectedIndex = index;
    if (recordChanged) this.selectedDiffField = null;

    const list = container.querySelector(".master-items");
    if (list) this.markSelectedItem(list, index, focusRecord);

    const pane = container.querySelector(".detail-pane");
    if (pane) {
      pane.innerHTML = this.renderDetailPanel();
      this.bindDetailListeners(container);
      if (focusField && this.selectedDiffField) {
        const tab = [...container.querySelectorAll("[data-diff-field]")].find(
          (element) => element.dataset.diffField === this.selectedDiffField,
        );
        tab?.focus();
      }
      return;
    }

    container.innerHTML = this.render(this.comparisons, this.env1Name, this.env2Name, {
      compareFields: this.compareFields,
    });
    this.attachEventListeners(container);
  }

  markSelectedItem(list, index, focusRecord) {
    const items = list.querySelectorAll(".master-item");
    items.forEach((item, itemIndex) => {
      const selected = itemIndex === index;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });

    const active = items[index];
    if (!active) return;
    if (typeof active.scrollIntoView === "function") active.scrollIntoView({ block: "nearest" });
    if (focusRecord) active.focus({ preventScroll: true });
  }

  /**
   * Gets a human-readable status label
   */
  getStatusLabel(status) {
    switch (status) {
      case "match":
        return "Match";
      case "differ":
        return "Differ";
      case "only_in_env1":
        return `Only in ${shortSourceName(this.env1Name, "Source A")}`;
      case "only_in_env2":
        return `Only in ${shortSourceName(this.env2Name, "Source B")}`;
      default:
        return status;
    }
  }

  /**
   * Escapes HTML to prevent XSS
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }
}
