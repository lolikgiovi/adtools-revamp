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

    const cardsHtml = comparisons
      .map(comp => this.renderCard(comp, env1Name, env2Name))
      .join('');

    return `
      <div class="vertical-card-view">
        <div class="card-grid">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  /**
   * Renders a single comparison card
   */
  renderCard(comparison, env1Name, env2Name) {
    const statusClass = comparison.status.toLowerCase().replace('_', '-');
    const statusLabel = this.getStatusLabel(comparison.status);

    return `
      <div class="comparison-card status-${statusClass}">
        <div class="card-header">
          <div class="card-pk">${this.escapeHtml(comparison.primary_key)}</div>
          <span class="status-badge status-${statusClass}">${statusLabel}</span>
        </div>
        <div class="card-content">
          ${this.renderCardContent(comparison, env1Name, env2Name)}
        </div>
      </div>
    `;
  }

  /**
   * Renders card content based on status
   */
  renderCardContent(comparison, env1Name, env2Name) {
    if (comparison.status === 'only_in_env1') {
      return `
        <div class="card-message">
          <p>Only exists in <strong>${env1Name}</strong></p>
        </div>
        ${this.renderCardData(comparison.env1_data)}
      `;
    }

    if (comparison.status === 'only_in_env2') {
      return `
        <div class="card-message">
          <p>Only exists in <strong>${env2Name}</strong></p>
        </div>
        ${this.renderCardData(comparison.env2_data)}
      `;
    }

    if (comparison.status === 'match') {
      return `
        <div class="card-message">
          <p>✓ Records match perfectly</p>
        </div>
      `;
    }

    // Status is 'differ' - show differences
    return `
      <div class="card-diff-section">
        <div class="diff-grid">
          <div class="diff-column">
            <h4>${this.escapeHtml(env1Name)}</h4>
            <div class="diff-fields">
              ${comparison.differences.map(diff => this.renderCardDiffField(diff, 'env1')).join('')}
            </div>
          </div>
          <div class="diff-column">
            <h4>${this.escapeHtml(env2Name)}</h4>
            <div class="diff-fields">
              ${comparison.differences.map(diff => this.renderCardDiffField(diff, 'env2')).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders a single field difference for a card
   */
  renderCardDiffField(diff, envKey) {
    const chunks = envKey === 'env1' ? diff.env1_diff_chunks : diff.env2_diff_chunks;
    const valueHtml = this.renderDiffChunks(chunks);

    return `
      <div class="card-field">
        <div class="card-field-name">${this.escapeHtml(diff.field_name)}</div>
        <div class="card-field-value">${valueHtml}</div>
      </div>
    `;
  }

  /**
   * Renders diff chunks with highlighting
   */
  renderDiffChunks(chunks) {
    if (!chunks || chunks.length === 0) {
      return '<span class="empty-value">(empty)</span>';
    }

    return chunks
      .map(chunk => {
        const escapedText = this.escapeHtml(chunk.text);
        switch (chunk.chunk_type) {
          case 'same':
            return `<span class="diff-same">${escapedText}</span>`;
          case 'added':
            return `<span class="diff-added">${escapedText}</span>`;
          case 'removed':
            return `<span class="diff-removed">${escapedText}</span>`;
          case 'modified':
            return `<span class="diff-modified">${escapedText}</span>`;
          default:
            return `<span>${escapedText}</span>`;
        }
      })
      .join('');
  }

  /**
   * Renders card data object
   */
  renderCardData(data) {
    if (!data) return '';

    const entries = Object.entries(data).slice(0, 5); // Show first 5 fields
    return `
      <div class="card-data">
        ${entries.map(([key, value]) => `
          <div class="card-data-row">
            <span class="card-data-key">${this.escapeHtml(key)}:</span>
            <span class="card-data-value">${this.escapeHtml(JSON.stringify(value))}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Gets a human-readable status label
   */
  getStatusLabel(status) {
    switch (status) {
      case 'match':
        return 'Match';
      case 'differ':
        return 'Differ';
      case 'only_in_env1':
        return 'Only in Env 1';
      case 'only_in_env2':
        return 'Only in Env 2';
      default:
        return status;
    }
  }

  /**
   * Escapes HTML to prevent XSS
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
}
