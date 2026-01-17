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
 */
export class GridView {
  /**
   * Renders the grid view
   * @param {Array} comparisons - Array of comparison objects
   * @param {string} env1Name - Environment 1 name
   * @param {string} env2Name - Environment 2 name
   */
  render(comparisons, env1Name, env2Name) {
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

    // 2. Filter fields for Smart Diff View
    const activeFields = Array.from(allFieldNames)
      .filter((f) => fieldsWithDiffs.has(f))
      .sort();

    const fieldsToDisplay = activeFields.length > 0 ? activeFields : Array.from(allFieldNames).sort();

    // 3. Determine PK Header name from actual metadata
    let pkHeaderName = "PRIMARY KEY";
    if (comparisons.length > 0 && comparisons[0].key) {
      const pkKeys = Object.keys(comparisons[0].key);
      if (pkKeys.length > 0) {
        pkHeaderName = pkKeys.join(", ").toUpperCase();
      }
    }

    return `
      <div class="excel-table-container">
        <div class="table-scroll-area">
          <table class="excel-table">
            <thead>
              <tr class="h-row-1">
                <th rowspan="2" class="sticky-col pk-header">${this.escapeHtml(pkHeaderName)}</th>
                <th rowspan="2" class="sticky-col status-header">STATUS</th>
                ${fieldsToDisplay
                  .map(
                    (f) => `
                  <th colspan="2" class="field-header-main">${this.escapeHtml(f)}</th>
                `
                  )
                  .join("")}
              </tr>
              <tr class="h-row-2">
                ${fieldsToDisplay
                  .map(
                    (f) => `
                  <th class="env-header-sub env-1">
                    <div class="h-label-clip">${this.escapeHtml(env1Name)}</div>
                  </th>
                  <th class="env-header-sub env-2 field-boundary">
                    <div class="h-label-clip">${this.escapeHtml(env2Name)}</div>
                  </th>
                `
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${comparisons.map((comp) => this.renderRow(comp, fieldsToDisplay)).join("")}
            </tbody>
          </table>
        </div>
        
        ${
          activeFields.length > 0 && activeFields.length < allFieldNames.size
            ? `
          <div class="grid-info-footer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span>Smart Filter: Showing only ${activeFields.length} columns with differences (hiding ${
                allFieldNames.size - activeFields.length
              } identical columns).</span>
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  /**
   * Renders a single row
   */
  renderRow(comparison, fields) {
    const statusClass = comparison.status.toLowerCase().replace("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status);
    const pkValue = this.formatPrimaryKey(comparison.key);
    const diffFields = new Set(comparison.differences || []);
    const diffDetails = comparison._diffDetails || {};

    return `
      <tr class="data-row status-${statusClass}">
        <td class="sticky-col pk-cell" title="${this.escapeHtml(pkValue)}">${this.escapeHtml(pkValue)}</td>
        <td class="sticky-col status-cell">
          <span class="status-badge status-${statusClass}">${statusLabel}</span>
        </td>
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
    const val1 = hasV1 ? this.formatValue(v1) : "";
    const val2 = hasV2 ? this.formatValue(v2) : "";

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
    if (isDifferent && diffInfo && diffInfo.type === 'char-diff' && diffInfo.segments) {
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
    let env1Html = '';
    let env2Html = '';

    for (const seg of segments) {
      const escaped = this.escapeHtml(seg.value);

      switch (seg.type) {
        case 'equal':
          env1Html += escaped;
          env2Html += escaped;
          break;
        case 'delete':
          // Deleted from env1 (shown in env1 only)
          env1Html += `<span class="diff-delete">${escaped}</span>`;
          break;
        case 'insert':
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
  getStatusLabel(status) {
    switch (status) {
      case "match":
        return "Match";
      case "differ":
        return "Differ";
      case "only_in_env1":
        return "Only in Env 1";
      case "only_in_env2":
        return "Only in Env 2";
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
