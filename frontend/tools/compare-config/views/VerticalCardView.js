/**
 * VerticalCardView - Renders comparison results as vertical cards
 *
 * Features:
 * - Each comparison shown as a vertical card
 * - Side-by-side Env1/Env2 values in card
 * - Color-coded status badges
 * - Compact view for scanning many results
 */
export class VerticalCardView {
  /**
   * Renders the vertical card view
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

    const cardsHtml = comparisons.map((comp) => this.renderCard(comp, env1Name, env2Name)).join("");

    return `
      <div class="vertical-card-view">
        <div class="card-grid">
          ${cardsHtml}
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
   * Renders a single comparison card
   */
  renderCard(comparison, env1Name, env2Name) {
    const statusClass = comparison.status.toLowerCase().replace("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status);
    const pkDisplay = this.formatPrimaryKey(comparison.key);

    return `
      <div class="comparison-card status-${statusClass}">
        <div class="card-header">
          <div class="card-pk">${this.escapeHtml(pkDisplay)}</div>
          <span class="status-badge status-${statusClass}">${statusLabel}</span>
        </div>
        <div class="card-body">
          ${this.renderCardContent(comparison, env1Name, env2Name)}
        </div>
      </div>
    `;
  }

  /**
   * Renders card content based on status
   */
  renderCardContent(comparison, env1Name, env2Name) {
    if (comparison.status === "only_in_env1") {
      return `
        <div class="card-message">
          <p>Only exists in <strong>${env1Name}</strong></p>
        </div>
        ${this.renderCardData(comparison.env1_data)}
      `;
    }

    if (comparison.status === "only_in_env2") {
      return `
        <div class="card-message">
          <p>Only exists in <strong>${env2Name}</strong></p>
        </div>
        ${this.renderCardData(comparison.env2_data)}
      `;
    }

    if (comparison.status === "match") {
      return `
        <div class="card-message">
          <p>✓ Records match perfectly</p>
        </div>
      `;
    }

    // Status is 'differ' - show all fields, highlight differences
    const diffFields = new Set(comparison.differences || []);
    const env1Data = comparison.env1_data || {};
    const env2Data = comparison.env2_data || {};

    // Get all unique field names
    const allFields = Array.from(new Set([...Object.keys(env1Data), ...Object.keys(env2Data)])).sort();

    return `
      <div class="card-diff-section">
        <div class="diff-grid">
          <div class="diff-column">
            <h4>${this.escapeHtml(env1Name)}</h4>
            <div class="diff-fields">
              ${allFields
                .map((fieldName) => this.renderCardDiffField(fieldName, env1Data[fieldName], diffFields.has(fieldName), "removed"))
                .join("")}
            </div>
          </div>
          <div class="diff-column">
            <h4>${this.escapeHtml(env2Name)}</h4>
            <div class="diff-fields">
              ${allFields
                .map((fieldName) => this.renderCardDiffField(fieldName, env2Data[fieldName], diffFields.has(fieldName), "added"))
                .join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders a single field difference for a card
   */
  renderCardDiffField(fieldName, value, isDifferent, type) {
    const displayValue = this.formatValue(value);
    const highlightClass = isDifferent ? (type === "added" ? "diff-added" : "diff-removed") : "";

    return `
      <div class="card-field ${highlightClass} ${isDifferent ? "is-different" : ""}">
        <div class="card-field-name">${this.escapeHtml(fieldName)}</div>
        <div class="card-field-value">${this.escapeHtml(displayValue)}</div>
      </div>
    `;
  }

  /**
   * Renders card data object
   */
  renderCardData(data) {
    if (!data) return "";

    const entries = Object.entries(data).slice(0, 5); // Show first 5 fields
    return `
      <div class="card-data">
        ${entries
          .map(
            ([key, value]) => `
          <div class="card-data-row">
            <span class="card-data-key">${this.escapeHtml(key)}:</span>
            <span class="card-data-value">${this.escapeHtml(this.formatValue(value))}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;
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
