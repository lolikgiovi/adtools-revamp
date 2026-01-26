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

    // Cached state for lazy loading
    this.comparisons = [];
    this.fieldsToDisplay = [];
    this.hasSourceFile = false;
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
    const { compareFields, showStatus = true } = options;

    // Reset lazy loading state
    this.renderedCount = 0;
    this.comparisons = comparisons || [];
    this.cleanupObserver();
    if (!comparisons || comparisons.length === 0) {
      return `
        <div class="placeholder-message">
          <p>No records found matching the criteria.</p>
        </div>
      `;
    }

    // 1. Identify which fields have differences across the WHOLE set
    const fieldsWithDiffs = new Set();
    const allFieldNames = new Set();

    comparisons.forEach((comp) => {
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
    let isUserSelected = false;
    if (compareFields && compareFields.length > 0) {
      // User-selected fields - preserve their selection order
      fieldsToDisplay = compareFields;
      isUserSelected = true;
    } else {
      // Auto-detect: show fields with differences, or all fields if none differ
      const activeFields = Array.from(allFieldNames)
        .filter((f) => fieldsWithDiffs.has(f))
        .sort();
      fieldsToDisplay = activeFields.length > 0 ? activeFields : Array.from(allFieldNames).sort();
    }

    // For footer info: count how many fields have differences
    const diffFieldCount = fieldsWithDiffs.size;

    // 3. Determine PK Header name from actual metadata and filter out PK fields from display
    let pkHeaderName = "PRIMARY KEY";
    let pkFieldsSet = new Set();
    if (comparisons.length > 0 && comparisons[0].key) {
      const pkKeys = Object.keys(comparisons[0].key);
      if (pkKeys.length > 0) {
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
    this.hasSourceFile = comparisons.some((c) => c._sourceFile);
    this.showStatus = showStatus;

    // Check if any row has a source file (for multi-file Excel compare)
    const hasSourceFile = comparisons.some((c) => c._sourceFile);

    // When env names are identical (e.g., same filename in Excel compare), use Reference/Comparator labels
    let displayEnv1Name = this.formatEnvName(env1Name);
    let displayEnv2Name = this.formatEnvName(env2Name);
    if (env1Name === env2Name) {
      displayEnv1Name = "Reference";
      displayEnv2Name = "Comparator";
    }

    return `
      <div class="excel-table-container">
        <div class="table-scroll-area">
          <table class="excel-table">
            <thead>
              <tr class="h-row-1">
                ${hasSourceFile ? '<th rowspan="2" class="sticky-col source-header">SOURCE FILE</th>' : ""}
                <th rowspan="2" class="sticky-col pk-header">${this.escapeHtml(pkHeaderName)}</th>
                ${showStatus ? '<th rowspan="2" class="sticky-col status-header">STATUS</th>' : ""}
                ${fieldsToDisplay
                  .map(
                    (f) => `
                  <th colspan="2" class="field-header-main" title="${this.escapeHtml(f)}">${this.escapeHtml(this.extractFieldName(f))}</th>
                `,
                  )
                  .join("")}
              </tr>
              <tr class="h-row-2">
                ${fieldsToDisplay
                  .map(
                    (f) => `
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
              ${this.renderInitialBatch(comparisons, fieldsToDisplay, this.hasSourceFile, showStatus)}
            </tbody>
          </table>
        </div>

        ${comparisons.length > this.BATCH_SIZE ? `<div id="grid-load-more-sentinel" class="grid-load-sentinel"></div>` : ""}

        <div class="grid-info-footer">
          ${
            isUserSelected
              ? `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span>Showing ${fieldsToDisplay.length} selected field${fieldsToDisplay.length !== 1 ? "s" : ""} (${diffFieldCount} with differences).</span>
          `
              : diffFieldCount > 0 && diffFieldCount < allFieldNames.size
                ? `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span>Smart Filter: Showing only ${diffFieldCount} columns with differences (hiding ${
              allFieldNames.size - diffFieldCount
            } identical columns).</span>
          `
                : ""
          }
          ${
            comparisons.length > this.BATCH_SIZE
              ? `<span id="grid-row-count" class="row-count-info">Showing ${Math.min(this.BATCH_SIZE, comparisons.length)} of ${comparisons.length} rows</span>`
              : ""
          }
        </div>
      </div>
    `;
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
    return initialBatch.map((comp) => this.renderRow(comp, fields, hasSourceFile, showStatus)).join("");
  }

  /**
   * Attaches event listeners for lazy loading
   * @param {HTMLElement} container - The container element
   */
  attachEventListeners(container) {
    // Clean up any existing observer
    this.cleanupObserver();

    // Only set up observer if there are more rows to load
    if (this.renderedCount >= this.comparisons.length) {
      return;
    }

    const sentinel = container.querySelector("#grid-load-more-sentinel");
    if (!sentinel) return;

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
    tempDiv.innerHTML = nextBatch.map((comp) => this.renderRow(comp, this.fieldsToDisplay, this.hasSourceFile, this.showStatus)).join("");

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
  }

  /**
   * Cleans up the IntersectionObserver
   */
  cleanupObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * Renders a single row
   */
  renderRow(comparison, fields, hasSourceFile = false, showStatus = true) {
    const statusClass = comparison.status.toLowerCase().replace("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status, hasSourceFile);
    const pkValue = this.formatPrimaryKey(comparison.key);
    const diffFields = new Set(comparison.differences || []);
    const diffDetails = comparison._diffDetails || {};

    return `
      <tr class="data-row status-${statusClass}">
        ${
          hasSourceFile
            ? `<td class="sticky-col source-cell" title="${this.escapeHtml(comparison._sourceFile)}">${this.escapeHtml(
                comparison._sourceFile,
              )}</td>`
            : ""
        }
        <td class="sticky-col pk-cell" title="${this.escapeHtml(pkValue)}">${this.escapeHtml(pkValue)}</td>
        ${
          showStatus
            ? `
          <td class="sticky-col status-cell">
            <span class="status-badge status-${statusClass}">${statusLabel}</span>
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
            const isDifferent = diffFields.has(fieldName);
            const fieldDiff = diffDetails[fieldName];

            return this.renderCellPair(v1, v2, hasV1, hasV2, isDifferent, fieldDiff);
          })
          .join("")}
      </tr>
    `;
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
    const rawVal1 = hasV1 ? this.formatValue(v1) : "";
    const rawVal2 = hasV2 ? this.formatValue(v2) : "";
    const val1 = this.formatCellDisplay(rawVal1);
    const val2 = this.formatCellDisplay(rawVal2);

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
    if (isDifferent && diffInfo && diffInfo.type === "char-diff" && diffInfo.segments) {
      // Render with character-level highlighting
      const { env1Html, env2Html } = this.renderCharDiff(diffInfo.segments);
      return `
        <td class="${c1Class}">${env1Html}</td>
        <td class="${c2Class} field-boundary">${env2Html}</td>
      `;
    }

    // Standard rendering (cell-level diff or no diff details)
    return `
      <td class="${c1Class}">${this.escapeHtml(val1)}</td>
      <td class="${c2Class} field-boundary">${this.escapeHtml(val2)}</td>
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
        return isExcel ? "Only in Reference" : "Only in Env 1";
      case "only_in_env2":
        return isExcel ? "Only in Comparator" : "Only in Env 2";
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
}
