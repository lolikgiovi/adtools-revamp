/**
 * MasterDetailView - Renders comparison results with master-detail split layout
 *
 * Features:
 * - Left pane: Master list of all comparisons
 * - Right pane: Selected comparison details
 * - Click to select and view details
 * - Efficient for reviewing many comparisons one-by-one
 */
export class MasterDetailView {
  constructor() {
    this.selectedIndex = 0;
    this.comparisons = [];
    this.env1Name = "";
    this.env2Name = "";
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
   * Renders the master list (left pane)
   */
  renderMasterList() {
    const itemsHtml = this.comparisons.map((comp, index) => this.renderMasterItem(comp, index)).join("");

    return `
      <div class="master-list">
        <div class="master-header">
          <h3>Records (${this.comparisons.length})</h3>
        </div>
        <div class="master-items">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  /**
   * Renders a single master list item
   */
  renderMasterItem(comparison, index) {
    const statusClass = comparison.status.toLowerCase().replace("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status);
    const isSelected = index === this.selectedIndex;
    const pkDisplay = this.formatPrimaryKey(comparison.key);

    return `
      <div class="master-item ${isSelected ? "selected" : ""} status-${statusClass}"
           data-index="${index}">
        <div class="master-item-pk">${this.escapeHtml(pkDisplay)}</div>
        <span class="status-badge status-${statusClass}">${statusLabel}</span>
      </div>
    `;
  }

  /**
   * Renders the detail panel (right pane)
   */
  renderDetailPanel() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.comparisons.length) {
      return '<div class="detail-empty"><p>Select a record to view details</p></div>';
    }

    const comparison = this.comparisons[this.selectedIndex];

    return `
      <div class="detail-content">
        ${this.renderDetailHeader(comparison)}
        ${this.renderDetailBody(comparison)}
      </div>
    `;
  }

  /**
   * Renders detail panel header
   */
  renderDetailHeader(comparison) {
    const statusClass = comparison.status.toLowerCase().replace("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status);
    const pkDisplay = this.formatPrimaryKey(comparison.key);

    return `
      <div class="detail-header">
        <div>
          <h3>${this.escapeHtml(pkDisplay)}</h3>
        </div>
        <div class="detail-nav">
          <span class="status-badge status-${statusClass}">${statusLabel}</span>
          <button class="btn btn-outline btn-sm" id="btn-prev-detail" ${this.selectedIndex === 0 ? "disabled" : ""}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            Previous
          </button>
          <span class="detail-position">${this.selectedIndex + 1} / ${this.comparisons.length}</span>
          <button class="btn btn-outline btn-sm" id="btn-next-detail" ${
            this.selectedIndex === this.comparisons.length - 1 ? "disabled" : ""
          }>
            Next
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Renders detail panel body
   */
  renderDetailBody(comparison) {
    if (comparison.status === "only_in_env1") {
      return `
        <div class="detail-body">
          <div class="detail-message">
            <p>This record only exists in <strong>${this.env1Name}</strong></p>
          </div>
          ${this.renderDetailData(comparison.env1_data, this.env1Name)}
        </div>
      `;
    }

    if (comparison.status === "only_in_env2") {
      return `
        <div class="detail-body">
          <div class="detail-message">
            <p>This record only exists in <strong>${this.env2Name}</strong></p>
          </div>
          ${this.renderDetailData(comparison.env2_data, this.env2Name)}
        </div>
      `;
    }

    if (comparison.status === "match") {
      return `
        <div class="detail-body">
          <div class="detail-message">
            <p>✓ Records match perfectly</p>
          </div>
          ${this.renderDetailData(comparison.env1_data, "Data")}
        </div>
      `;
    }

    // Status is 'differ' - show selected fields, highlight differences
    const diffFields = new Set(comparison.differences || []);
    const diffDetails = comparison._diffDetails || {};
    const env1Data = comparison.env1_data || {};
    const env2Data = comparison.env2_data || {};

    // Get fields to display: use compareFields if provided, otherwise derive from data
    let allFields;
    if (this.compareFields && this.compareFields.length > 0) {
      allFields = this.compareFields;
    } else {
      allFields = Array.from(new Set([...Object.keys(env1Data), ...Object.keys(env2Data)])).sort();
    }

    return `
      <div class="detail-body">
        <div class="detail-diff-table">
          <table class="field-comparison-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>${this.escapeHtml(this.env1Name)}</th>
                <th>${this.escapeHtml(this.env2Name)}</th>
              </tr>
            </thead>
            <tbody>
              ${allFields
                .map((fieldName) =>
                  this.renderDetailDiffRow(fieldName, env1Data[fieldName], env2Data[fieldName], diffFields.has(fieldName), diffDetails[fieldName]),
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * Renders a detail diff row
   * @param {string} fieldName - Field name
   * @param {*} env1Value - Value from env1
   * @param {*} env2Value - Value from env2
   * @param {boolean} isDifferent - Whether values differ
   * @param {Object} diffInfo - Character-level diff info from _diffDetails
   */
  renderDetailDiffRow(fieldName, env1Value, env2Value, isDifferent, diffInfo = null) {
    const env1Display = this.formatValue(env1Value);
    const env2Display = this.formatValue(env2Value);

    const env1Class = isDifferent ? "field-value diff-removed" : "field-value";
    const env2Class = isDifferent ? "field-value diff-added" : "field-value";

    // Check if we have character-level diff details
    if (isDifferent && diffInfo && diffInfo.type === "char-diff" && diffInfo.segments) {
      const { env1Html, env2Html } = this.renderCharDiff(diffInfo.segments);
      return `
        <tr class="field-diff-row is-different">
          <td class="field-name">${this.escapeHtml(fieldName)}</td>
          <td class="${env1Class}">${env1Html}</td>
          <td class="${env2Class}">${env2Html}</td>
        </tr>
      `;
    }

    return `
      <tr class="field-diff-row ${isDifferent ? "is-different" : ""}">
        <td class="field-name">${this.escapeHtml(fieldName)}</td>
        <td class="${env1Class}">${this.escapeHtml(env1Display)}</td>
        <td class="${env2Class}">${this.escapeHtml(env2Display)}</td>
      </tr>
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
                <td class="data-value">${this.escapeHtml(this.formatValue(value))}</td>
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
   * Attaches event listeners (called after render)
   */
  attachEventListeners(container) {
    // Master item click
    container.querySelectorAll(".master-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        const index = parseInt(e.currentTarget.dataset.index);
        this.selectItem(index, container);
      });
    });

    // Previous button
    const btnPrev = container.querySelector("#btn-prev-detail");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (this.selectedIndex > 0) {
          this.selectItem(this.selectedIndex - 1, container);
        }
      });
    }

    // Next button
    const btnNext = container.querySelector("#btn-next-detail");
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        if (this.selectedIndex < this.comparisons.length - 1) {
          this.selectItem(this.selectedIndex + 1, container);
        }
      });
    }
  }

  /**
   * Selects an item and updates the view
   */
  selectItem(index, container) {
    this.selectedIndex = index;

    // Re-render the entire view (pass compareFields to preserve user selection)
    const html = this.render(this.comparisons, this.env1Name, this.env2Name, { compareFields: this.compareFields });
    container.innerHTML = html;

    // Re-attach event listeners
    this.attachEventListeners(container);
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
