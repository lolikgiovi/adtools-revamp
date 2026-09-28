/**
 * GridView - Renders comparison results as a robust HTML Table with an Excel-Style Two-Tier Header.
 *
 * Features:
 * - Robust Table: Uses standard <table>, <thead>, and <tbody> for structural integrity.
 * - Two-Tier Header: Field names span two columns via colspan; PK/Status span two rows via rowspan.
 * - Dynamic PK Head: Automatically uses the primary key field names (e.g., PARAMETER_KEY).
 * - Excel Parity: Neutral styling with clear borders and professional typography.
 * - Smart Filtering: Hides columns that are identical across all records.
 * - Character-level diff: When _diffDetails available, shows character-level changes.
 * - Lazy Loading: Renders rows in batches for better performance with large datasets.
 */
export class GridView {
  constructor() {
    // Lazy loading configuration
    this.BATCH_SIZE = 100;
    this.renderedCount = 0;
    this.observer = null;
    this.fallbackLoadTimer = null;

    // Cached state for lazy loading
    this.comparisons = [];
    this.fieldsToDisplay = [];
    this.hasSourceFile = false;

    // Sorting state
    this.sortDirection = null; // null = original order, 'asc', 'desc'
    this.onSortChange = null; // Callback when sort changes (to notify parent)

    // Search/filter state
    this.searchQuery = ""; // Lowercase search query for highlighting
    this.onInspect = null;
    this.columnFilters = {};
    this.activeFilterColumn = null;
    this.onColumnFilterChange = null;
  }

  /**
   * Renders the grid view
   * @param {Array} comparisons - Array of comparison objects
   * @param {string} env1Name - Environment 1 name
   * @param {string} env2Name - Environment 2 name
   * @param {Object} options - Render options
   * @param {Array<string>} options.compareFields - Fields to display (from user selection). If provided, only these fields are shown.
   */
  render(comparisons, env1Name, env2Name, options = {}) {
    const { compareFields, showStatus = true, allComparisons = comparisons } = options;

    // Reset lazy loading state
    this.renderedCount = 0;
    this.comparisons = comparisons || [];
    this.cleanupObserver();
    if (!allComparisons || allComparisons.length === 0) {
      return `
        <div class="placeholder-message">
          <p>No records found matching the criteria.</p>
        </div>
      `;
    }

    // 1. Identify which fields have differences across the WHOLE set
    const fieldsWithDiffs = new Set();
    const allFieldNames = new Set();

    allComparisons.forEach((comp) => {
      if (comp.env1_data) Object.keys(comp.env1_data).forEach((f) => allFieldNames.add(f));
      if (comp.env2_data) Object.keys(comp.env2_data).forEach((f) => allFieldNames.add(f));
      if (comp.differences) {
        comp.differences.forEach((f) => fieldsWithDiffs.add(f));
      }
    });

    // 2. Determine fields to display
    // If compareFields is provided (user selection), use those fields only
    // Otherwise, fall back to smart diff view (fields with differences)
    let fieldsToDisplay;
    if (compareFields && compareFields.length > 0) {
      // User-selected fields - preserve their selection order
      fieldsToDisplay = compareFields;
    } else {
      // Auto-detect: show fields with differences, or all fields if none differ
      const activeFields = Array.from(allFieldNames)
        .filter((f) => fieldsWithDiffs.has(f))
        .sort();
      fieldsToDisplay = activeFields.length > 0 ? activeFields : Array.from(allFieldNames).sort();
    }

    // 3. Determine PK Header name from actual metadata and filter out PK fields from display
    let pkHeaderName = "PRIMARY KEY";
    let pkFieldsSet = new Set();
    let pkFields = ["PRIMARY KEY"];
    if (allComparisons.length > 0 && allComparisons[0].key) {
      const pkKeys = Object.keys(allComparisons[0].key);
      if (pkKeys.length > 0) {
        pkFields = pkKeys;
        pkHeaderName = pkKeys.join(", ").toUpperCase();
        // Create a set of PK field names (case-insensitive) to filter from display
        pkKeys.forEach((k) => {
          pkFieldsSet.add(k.toLowerCase());
        });
      }
    }

    // Filter out primary key fields from fieldsToDisplay - they're already shown in the PK column
    if (pkFieldsSet.size > 0) {
      fieldsToDisplay = fieldsToDisplay.filter((f) => !pkFieldsSet.has(f.toLowerCase()));
    }

    // Cache for lazy loading (after PK filtering)
    this.fieldsToDisplay = fieldsToDisplay;
    this.hasSourceFile = allComparisons.some((c) => c._sourceFile);
    this.showStatus = showStatus;
    this.pkHeaderName = pkHeaderName;
    this.pkFields = pkFields;

    // Check if any row has a source file (for multi-file Excel compare)
    const hasSourceFile = this.hasSourceFile;

    // When env names are identical (e.g., same filename in Excel compare), use Reference/Comparator labels
    let displayEnv1Name = this.formatEnvName(env1Name);
    let displayEnv2Name = this.formatEnvName(env2Name);
    if (env1Name === env2Name) {
      displayEnv1Name = "Reference";
      displayEnv2Name = "Comparator";
    }
    this.displayEnv1Name = displayEnv1Name;
    this.displayEnv2Name = displayEnv2Name;

    return `
      <div class="excel-table-container">
        <div class="table-scroll-area">
          <table class="excel-table">
            <thead>
              <tr class="h-row-1">
                <th rowspan="2" class="sticky-col index-header">#</th>
                ${hasSourceFile ? `<th rowspan="2" class="sticky-col source-header">${this.renderFilterHeader("SOURCE FILE", "sourceFile")}</th>` : ""}
                ${pkFields.map((field, index) => `
                  <th rowspan="2" class="sticky-col pk-header ${index === 0 ? "sortable" : ""}"
                    ${index === 0 ? `id="pk-sort-header" title="Click to sort by ${this.escapeHtml(pkHeaderName)}"` : ""}
                    style="${this.getStickyOffsets(index, hasSourceFile)}">
                    <span class="pk-header-content">${this.renderFilterHeader(field, `key:${field}`)}
                      ${index === 0 ? `<span class="sort-indicator">${this.getSortIndicator()}</span>` : ""}
                    </span>
                  </th>
                `).join("")}
                ${showStatus ? `
                  <th rowspan="2" class="sticky-col status-header"
                    style="${this.getStickyOffsets(pkFields.length, hasSourceFile)}">${this.renderFilterHeader("STATUS", "status")}</th>
                ` : ""}
                ${fieldsToDisplay
                  .map(
                    (f) => `
                  <th colspan="2" class="field-header-main" title="${this.escapeHtml(f)}">${this.renderFilterHeader(this.extractFieldName(f), `field:${f}`)}</th>
                `,
                  )
                  .join("")}
              </tr>
              <tr class="h-row-2">
                ${fieldsToDisplay
                  .map(
                    () => `
                  <th class="env-header-sub env-1">
                    <div class="h-label-clip">${this.escapeHtml(displayEnv1Name)}</div>
                  </th>
                  <th class="env-header-sub env-2 field-boundary">
                    <div class="h-label-clip">${this.escapeHtml(displayEnv2Name)}</div>
                  </th>
                `,
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody id="grid-tbody">
              ${comparisons.length ? this.renderInitialBatch(comparisons, fieldsToDisplay, this.hasSourceFile, showStatus) :
                `<tr><td class="grid-empty" colspan="${1 + Number(hasSourceFile) + pkFields.length + Number(showStatus) + fieldsToDisplay.length * 2}">No records match these filters.</td></tr>`}
            </tbody>
          </table>
          ${this.renderedCount < comparisons.length ? '<div id="grid-load-more-sentinel" aria-hidden="true"></div>' : ""}
        </div>


      </div>
    `;
  }

  renderFilterHeader(label, column) {
    const escapedColumn = this.escapeHtml(column);
    const value = this.columnFilters[column] || "";
    const isOpen = this.activeFilterColumn === column;
    const control = column === "status"
      ? `<select class="grid-column-filter-select" data-column="status" aria-label="Filter status">
          <option value="">All statuses</option>
          ${["differ", "only_in_env1", "only_in_env2", "match"].map((status) =>
            `<option value="${status}" ${value === status ? "selected" : ""}>${this.escapeHtml(this.getStatusLabel(status, this.hasSourceFile))}</option>`).join("")}
        </select>`
      : `<input type="search" class="grid-column-filter-input" data-column="${escapedColumn}"
          aria-label="Filter ${this.escapeHtml(label)}" placeholder="Filter…" value="${this.escapeHtml(value)}">`;
    return `<span class="grid-filter-heading"><span>${this.escapeHtml(label)}</span>
      <button type="button" class="grid-filter-toggle ${value ? "is-active" : ""}" data-filter-column="${escapedColumn}"
        aria-label="Filter ${this.escapeHtml(label)}" aria-expanded="${isOpen}" title="Filter ${this.escapeHtml(label)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M7 12h10m-7 5h4"/></svg>
      </button></span>${isOpen ? `<div class="grid-filter-control">${control}</div>` : ""}`;
  }

  /**
   * Renders the initial batch of rows
   * @param {Array} comparisons - All comparison objects
   * @param {Array} fields - Fields to display
   * @param {boolean} hasSourceFile - Whether to show source file column
   * @param {boolean} showStatus - Whether to show status column
   * @returns {string} HTML for initial batch
   */
  renderInitialBatch(comparisons, fields, hasSourceFile, showStatus = true) {
    const initialBatch = comparisons.slice(0, this.BATCH_SIZE);
    this.renderedCount = initialBatch.length;
    return initialBatch.map((comp, idx) => this.renderRow(comp, fields, hasSourceFile, showStatus, idx + 1)).join("");
  }

  /**
   * Attaches event listeners for lazy loading and sorting
   * @param {HTMLElement} container - The container element
   */
  attachEventListeners(container) {
    // Clean up any existing observer
    this.cleanupObserver();

    container.querySelectorAll(".grid-filter-toggle").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.activeFilterColumn = this.activeFilterColumn === button.dataset.filterColumn ? null : button.dataset.filterColumn;
        this.onColumnFilterChange?.();
      });
    });
    container.querySelectorAll(".grid-column-filter-input, .grid-column-filter-select").forEach((control) => {
      control.addEventListener("click", (event) => event.stopPropagation());
      control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
        this.columnFilters[control.dataset.column] = control.value;
        this.onColumnFilterChange?.({ focusColumn: control.dataset.column, cursor: control.selectionStart });
      });
    });

    // Attach sort click handler to PK header
    const pkHeader = container.querySelector("#pk-sort-header");
    if (pkHeader) {
      pkHeader.addEventListener("click", () => {
        this.toggleSort();
        if (this.onSortChange) {
          this.onSortChange(this.sortDirection);
        }
      });
    }

    container.querySelector(".excel-table")?.addEventListener("click", (event) => {
      const keyCell = event.target.closest(".pk-cell");
      if (keyCell && this.onInspect) this.onInspect(Number(keyCell.dataset.index));
    });

    // Only set up observer if there are more rows to load
    if (this.renderedCount >= this.comparisons.length) {
      return;
    }

    const sentinel = container.querySelector("#grid-load-more-sentinel");
    if (!sentinel) return;

    if (typeof IntersectionObserver === "undefined") {
      this.scheduleFallbackLoad(container);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.loadMoreRows(container);
          }
        });
      },
      {
        root: container.querySelector(".table-scroll-area"),
        rootMargin: "200px",
        threshold: 0,
      },
    );

    this.observer.observe(sentinel);
  }

  /**
   * Loads and renders more rows
   * @param {HTMLElement} container - The container element
   */
  loadMoreRows(container) {
    if (this.renderedCount >= this.comparisons.length) {
      // All rows loaded, remove sentinel and observer
      this.cleanupObserver();
      const sentinel = container.querySelector("#grid-load-more-sentinel");
      if (sentinel) sentinel.remove();

      const rowCount = container.querySelector("#grid-row-count");
      if (rowCount) rowCount.textContent = `Showing all ${this.comparisons.length} rows`;
      return;
    }

    const tbody = container.querySelector("#grid-tbody");
    if (!tbody) return;

    // Get next batch
    const nextBatch = this.comparisons.slice(this.renderedCount, this.renderedCount + this.BATCH_SIZE);

    // Render and append rows
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement("tbody");
    tempDiv.innerHTML = nextBatch
      .map((comp, idx) => this.renderRow(comp, this.fieldsToDisplay, this.hasSourceFile, this.showStatus, this.renderedCount + idx + 1))
      .join("");

    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild);
    }
    tbody.appendChild(fragment);

    this.renderedCount += nextBatch.length;

    // Update row count display
    const rowCount = container.querySelector("#grid-row-count");
    if (rowCount) {
      if (this.renderedCount >= this.comparisons.length) {
        rowCount.textContent = `Showing all ${this.comparisons.length} rows`;
      } else {
        rowCount.textContent = `Showing ${this.renderedCount} of ${this.comparisons.length} rows`;
      }
    }

    if (this.renderedCount >= this.comparisons.length) {
      this.cleanupObserver();
      const sentinel = container.querySelector("#grid-load-more-sentinel");
      if (sentinel) sentinel.remove();
    }
  }

  /**
   * Cleans up the IntersectionObserver
   */
  cleanupObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.fallbackLoadTimer !== null) {
      clearTimeout(this.fallbackLoadTimer);
      this.fallbackLoadTimer = null;
    }
  }

  scheduleFallbackLoad(container) {
    if (this.fallbackLoadTimer !== null || this.renderedCount >= this.comparisons.length) return;
    this.fallbackLoadTimer = setTimeout(() => {
      this.fallbackLoadTimer = null;
      if (this.renderedCount >= this.comparisons.length) return;
      this.loadMoreRows(container);
      this.scheduleFallbackLoad(container);
    }, 0);
  }

  /**
   * Renders a single row
   */
  renderRow(comparison, fields, hasSourceFile = false, showStatus = true, rowIndex = 0) {
    const statusClass = comparison.status.toLowerCase().replaceAll("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status, hasSourceFile);
    const diffFields = new Set(comparison.differences || []);
    const diffDetails = comparison._diffDetails || {};

    const pkFields = this.pkFields || Object.keys(comparison.key || {});

    return `
      <tr class="data-row status-${statusClass}">
        <td class="sticky-col index-cell">${rowIndex}</td>
        ${
          hasSourceFile
            ? `<td class="sticky-col source-cell" title="${this.escapeHtml(comparison._sourceFile)}">${this.escapeHtml(
                comparison._sourceFile,
              )}</td>`
            : ""
        }
        ${pkFields.map((field, index) => {
          const value = comparison.key?.[field];
          const display = this.formatValue(value);
          const valueHtml = this.searchQuery ? this.highlightSearchMatch(display) : this.escapeHtml(display);
          return `<td class="sticky-col pk-cell" data-index="${rowIndex - 1}" title="${this.escapeHtml(display)}"
            style="${this.getStickyOffsets(index, hasSourceFile)}">
            <button type="button" class="grid-inspect-button"
              aria-label="Inspect ${this.escapeHtml(field)}: ${this.escapeHtml(display)}">${valueHtml}</button>
          </td>`;
        }).join("")}
        ${
          showStatus
            ? `
          <td class="sticky-col status-cell" style="${this.getStickyOffsets(pkFields.length, hasSourceFile)}">
            <span class="status-badge status-${statusClass}">${this.escapeHtml(statusLabel)}</span>
          </td>
        `
            : ""
        }
        ${fields
          .map((fieldName) => {
            const v1 = comparison.env1_data && fieldName in comparison.env1_data ? comparison.env1_data[fieldName] : undefined;
            const v2 = comparison.env2_data && fieldName in comparison.env2_data ? comparison.env2_data[fieldName] : undefined;

            const hasV1 = v1 !== undefined;
            const hasV2 = v2 !== undefined;
            const isDifferent = diffFields.has(fieldName) || comparison.status === "only_in_env1" || comparison.status === "only_in_env2";
            const fieldDiff = diffDetails[fieldName];

            return this.renderCellPair(v1, v2, hasV1, hasV2, isDifferent, fieldDiff);
          })
          .join("")}
      </tr>
    `;
  }

  getStickyOffsets(keyIndex, hasSourceFile) {
    const sourceWide = hasSourceFile ? 150 : 0;
    const sourceCompact = hasSourceFile ? 130 : 0;
    const keyOffsetWide = keyIndex === 0 ? 0 : 190 + (keyIndex - 1) * 130;
    const keyOffsetCompact = keyIndex === 0 ? 0 : 170 + (keyIndex - 1) * 110;
    const keyWidthWide = keyIndex === 0 ? 190 : 130;
    const keyWidthCompact = keyIndex === 0 ? 170 : 110;
    return [
      `--sticky-left: ${50 + sourceWide + keyOffsetWide}px`,
      `--sticky-left-compact: ${40 + sourceCompact + keyOffsetCompact}px`,
      `--pk-width: ${keyWidthWide}px`,
      `--pk-width-compact: ${keyWidthCompact}px`,
    ].join("; ");
  }

  /**
   * Renders a pair of cells (Env 1 and Env 2) for a field
   * @param {*} v1 - Value from env1
   * @param {*} v2 - Value from env2
   * @param {boolean} hasV1 - Whether v1 exists
   * @param {boolean} hasV2 - Whether v2 exists
   * @param {boolean} isDifferent - Whether values differ
   * @param {Object} diffInfo - Character-level diff info from _diffDetails
   */
  renderCellPair(v1, v2, hasV1, hasV2, isDifferent, diffInfo = null) {
    const val1 = hasV1 ? this.formatValue(v1) : "Missing";
    const val2 = hasV2 ? this.formatValue(v2) : "Missing";
    const previewLimit = 100;
    const isLong = val1.length > previewLimit || val2.length > previewLimit;

    let c1Class = "val-cell env-1";
    let c2Class = "val-cell env-2";

    if (isDifferent) {
      c1Class += " is-diff";
      c2Class += " is-diff";
    } else {
      c1Class += " is-match";
      c2Class += " is-match";
    }

    // Check if we have character-level diff details
    if (!isLong && isDifferent && diffInfo && diffInfo.type === "char-diff" && diffInfo.segments) {
      // Render with character-level highlighting (search highlight applied after)
      let { env1Html, env2Html } = this.renderCharDiff(diffInfo.segments);
      if (this.searchQuery) {
        env1Html = this.highlightSearchInHtml(env1Html);
        env2Html = this.highlightSearchInHtml(env2Html);
      }
      return `
        <td class="${c1Class}">${env1Html}</td>
        <td class="${c2Class} field-boundary">${env2Html}</td>
      `;
    }

    // Standard rendering (cell-level diff or no diff details)
    // Apply search highlighting if active
    const preview1 = isLong && val1.length > previewLimit ? `${val1.slice(0, previewLimit)}…` : val1;
    const preview2 = isLong && val2.length > previewLimit ? `${val2.slice(0, previewLimit)}…` : val2;
    const display1 = this.searchQuery ? this.highlightSearchMatch(preview1) : this.escapeHtml(preview1);
    const display2 = this.searchQuery ? this.highlightSearchMatch(preview2) : this.escapeHtml(preview2);
    return `
      <td class="${c1Class}">${display1}</td>
      <td class="${c2Class} field-boundary">${display2}</td>
    `;
  }

  /**
   * Renders character-level diff with highlighting
   * @param {Array} segments - Diff segments [{type: 'equal'|'insert'|'delete', value: string}]
   * @returns {Object} { env1Html, env2Html }
   */
  renderCharDiff(segments) {
    let env1Html = "";
    let env2Html = "";

    for (const seg of segments) {
      const escaped = this.escapeHtml(seg.value);

      switch (seg.type) {
        case "equal":
          env1Html += escaped;
          env2Html += escaped;
          break;
        case "delete":
          // Deleted from env1 (shown in env1 only)
          env1Html += `<span class="diff-delete">${escaped}</span>`;
          break;
        case "insert":
          // Inserted in env2 (shown in env2 only)
          env2Html += `<span class="diff-insert">${escaped}</span>`;
          break;
      }
    }

    return { env1Html, env2Html };
  }

  /**
   * Formats a primary key HashMap into a display string
   */
  formatPrimaryKey(keyMap) {
    if (!keyMap || typeof keyMap !== "object") return "";
    const entries = Object.entries(keyMap);
    if (entries.length === 0) return "";
    if (entries.length === 1) {
      return this.formatValue(entries[0][1]);
    }
    return entries.map(([k, v]) => `${k}=${this.formatValue(v)}`).join(", ");
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
   * Gets a human-readable status label
   */
  getStatusLabel(status, isExcel = false) {
    switch (status) {
      case "match":
        return "Match";
      case "differ":
        return "Differ";
      case "only_in_env1":
        return isExcel ? "Only in Reference" : `Only in ${this.displayEnv1Name || "Source A"}`;
      case "only_in_env2":
        return isExcel ? "Only in Comparator" : `Only in ${this.displayEnv2Name || "Source B"}`;
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

  /**
   * Extracts just the field name from a potentially qualified name (TABLE_NAME.FIELD_NAME)
   * @param {string} qualifiedName - The full field name (may include table prefix)
   * @returns {string} Just the field name portion
   */
  extractFieldName(qualifiedName) {
    if (!qualifiedName || typeof qualifiedName !== "string") return qualifiedName;
    const lastDotIndex = qualifiedName.lastIndexOf(".");
    if (lastDotIndex === -1) return qualifiedName;
    return qualifiedName.substring(lastDotIndex + 1);
  }

  /**
   * Formats a cell value for display, simplifying qualified references
   * - "(ENV) TABLE.FIELD..." → "(ENV)" only (table info is in title bar)
   * - "TABLE.FIELD..." (no prefix) → "(Excel)" for Excel sources
   * @param {string} value - The cell value
   * @returns {string} Formatted display value
   */
  formatCellDisplay(value) {
    if (!value || typeof value !== "string") return value;

    // Match pattern: (ENV_NAME) followed by anything with a dot (TABLE.FIELD...)
    const dbRefPattern = /^\(([^)]+)\)\s+\S+\.\S+/i;
    const dbMatch = value.match(dbRefPattern);
    if (dbMatch) {
      return dbMatch[1];
    }

    // Match pattern: starts with WORD.WORD (no parentheses prefix - Excel source)
    const excelRefPattern = /^[A-Z_][A-Z0-9_]*\.[A-Z_]/i;
    if (excelRefPattern.test(value)) {
      return "Excel";
    }

    return value;
  }

  /**
   * Formats environment name for header display
   * - "(ENV) TABLE.FIELD" → "ENV"
   * - "TABLE.FIELD" → "Excel"
   * @param {string} envName - The environment name
   * @returns {string} Formatted name
   */
  formatEnvName(envName) {
    if (!envName || typeof envName !== "string") return envName;

    const sqlQueryMatch = envName.match(/^\(([^)]+)\)\s+SQL Query$/i);
    if (sqlQueryMatch) return sqlQueryMatch[1];

    // Match pattern: (ENV_NAME) followed by TABLE.FIELD
    const dbPattern = /^\(([^)]+)\)\s+\S+\.\S+/i;
    const dbMatch = envName.match(dbPattern);
    if (dbMatch) {
      return dbMatch[1];
    }

    // Match pattern: TABLE.FIELD (Excel source)
    const excelPattern = /^[A-Z_][A-Z0-9_]*\.[A-Z_]/i;
    if (excelPattern.test(envName)) {
      return "Excel";
    }

    return envName;
  }

  /**
   * Returns the sort indicator HTML based on current sort direction
   */
  getSortIndicator() {
    switch (this.sortDirection) {
      case "asc":
        return "↑";
      case "desc":
        return "↓";
      default:
        return "⇅";
    }
  }

  /**
   * Toggles sort direction: null → asc → desc → null
   */
  toggleSort() {
    switch (this.sortDirection) {
      case null:
        this.sortDirection = "asc";
        break;
      case "asc":
        this.sortDirection = "desc";
        break;
      case "desc":
        this.sortDirection = null;
        break;
    }
  }

  /**
   * Sorts comparisons by primary key
   * @param {Array} comparisons - Array of comparison objects
   * @returns {Array} Sorted array (new array, does not mutate original)
   */
  sortComparisons(comparisons) {
    if (!this.sortDirection || !comparisons || comparisons.length === 0) {
      return comparisons;
    }

    return [...comparisons].sort((a, b) => {
      const pkA = this.formatPrimaryKey(a.key).toLowerCase();
      const pkB = this.formatPrimaryKey(b.key).toLowerCase();

      let result = pkA.localeCompare(pkB, undefined, { numeric: true, sensitivity: "base" });

      return this.sortDirection === "desc" ? -result : result;
    });
  }

  /**
   * Resets sort direction to default (null = original order)
   */
  resetSort() {
    this.sortDirection = null;
  }

  /**
   * Highlights search query matches in a plain text string
   * @param {string} text - The text to highlight
   * @returns {string} HTML with search matches wrapped in highlight spans
   */
  highlightSearchMatch(text) {
    if (!this.searchQuery || !text) {
      return this.escapeHtml(text);
    }

    const escaped = this.escapeHtml(text);
    const query = this.escapeHtml(this.searchQuery);

    // Case-insensitive replacement with preserved case
    const regex = new RegExp(`(${this.escapeRegExp(query)})`, "gi");
    return escaped.replace(regex, '<span class="search-highlight">$1</span>');
  }

  /**
   * Highlights search query in HTML that already contains other markup (e.g., diff spans)
   * Only highlights text content, not inside tags
   * @param {string} html - HTML string
   * @returns {string} HTML with search highlights added to text content
   */
  highlightSearchInHtml(html) {
    if (!this.searchQuery || !html) {
      return html;
    }

    const query = this.escapeHtml(this.searchQuery);
    const regex = new RegExp(`(${this.escapeRegExp(query)})`, "gi");

    // Split by tags, highlight only text parts
    return html.replace(/>([^<]+)</g, (match, textContent) => {
      const highlighted = textContent.replace(regex, '<span class="search-highlight">$1</span>');
      return `>${highlighted}<`;
    });
  }

  /**
   * Escapes special regex characters in a string
   * @param {string} str - String to escape
   * @returns {string} Escaped string safe for use in RegExp
   */
  escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
