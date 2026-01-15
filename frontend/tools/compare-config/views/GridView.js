/**
 * GridView - Renders comparison results as a clean, smart comparison grid.
 *
 * Features:
 * - Smart Column Filtering: Only shows columns that have differences across the result set.
 * - Horizontal Side-by-Side: Comparisons are shown side-by-side (Value 1 | Value 2) for consistent row height.
 * - Sticky Primary Key: PK column remains fixed on the left for context while scrolling.
 * - Compact & Focused: Hides noise and highlights exactly what changed.
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
    // This allows us to hide columns that are 100% identical.
    const fieldsWithDiffs = new Set();
    const allFieldNames = new Set();

    comparisons.forEach((comp) => {
      // Collect all field names
      if (comp.env1_data) Object.keys(comp.env1_data).forEach((f) => allFieldNames.add(f));
      if (comp.env2_data) Object.keys(comp.env2_data).forEach((f) => allFieldNames.add(f));

      // Collect fields that differ in THIS record
      if (comp.differences) {
        comp.differences.forEach((f) => fieldsWithDiffs.add(f));
      }
    });

    // 2. Filter fields to only those that have at least one difference
    // This makes the grid "Smart" by removing noise.
    const activeFields = Array.from(allFieldNames)
      .filter((f) => fieldsWithDiffs.has(f))
      .sort();

    // If NO fields have differences (e.g., all match), but user wants to see them
    // fall back to showing all fields if activeFields is empty but results exist
    const fieldsToDisplay = activeFields.length > 0 ? activeFields : Array.from(allFieldNames).sort();

    return `
      <div class="grid-view-container smart-grid">
        <div class="grid-scroll-wrapper">
          <table class="grid-view-table">
            <thead>
              <tr class="main-header">
                <th class="sticky-col" rowspan="2">Primary Key</th>
                <th rowspan="2">Status</th>
                ${fieldsToDisplay
                  .map(
                    (f) => `
                  <th class="field-header">
                    <div class="field-label">${this.escapeHtml(f)}</div>
                    <div class="env-labels">
                      <span class="env-label-1">${this.escapeHtml(env1Name)}</span>
                      <span class="env-label-divider">|</span>
                      <span class="env-label-2">${this.escapeHtml(env2Name)}</span>
                    </div>
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
            <span>Smart Filter active: Showing only ${activeFields.length} columns with differences (hiding ${
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
   * Renders a single row in the grid
   */
  renderRow(comparison, fields) {
    const statusClass = comparison.status.toLowerCase().replace("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status);
    const pkDisplay = this.formatPrimaryKey(comparison.key);
    const diffFields = new Set(comparison.differences || []);

    return `
      <tr class="grid-row status-${statusClass}">
        <td class="sticky-col pk-cell">${this.escapeHtml(pkDisplay)}</td>
        <td class="status-cell">
          <span class="status-badge status-${statusClass}">${statusLabel}</span>
        </td>
        ${fields
          .map((fieldName) => {
            const v1 = comparison.env1_data ? comparison.env1_data[fieldName] : undefined;
            const v2 = comparison.env2_data ? comparison.env2_data[fieldName] : undefined;
            const isDifferent = diffFields.has(fieldName);

            return this.renderCell(v1, v2, isDifferent);
          })
          .join("")}
      </tr>
    `;
  }

  /**
   * Renders a single cell content with horizontal side-by-side comparison
   */
  renderCell(v1, v2, isDifferent) {
    const displayV1 = this.formatValue(v1);
    const displayV2 = this.formatValue(v2);

    if (!isDifferent) {
      // Matching values - show single value centered or across both slots
      return `
        <td class="grid-cell cell-match">
          <div class="val-combined">${this.escapeHtml(displayV1)}</div>
        </td>
      `;
    }

    // Records differ - show horizontal split
    return `
      <td class="grid-cell cell-differ">
        <div class="diff-horizontal">
          <div class="val-slot val-env1" title="Env 1: ${this.escapeHtml(displayV1)}">${this.escapeHtml(displayV1)}</div>
          <div class="val-slot val-divider"></div>
          <div class="val-slot val-env2" title="Env 2: ${this.escapeHtml(displayV2)}">${this.escapeHtml(displayV2)}</div>
        </div>
      </td>
    `;
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
