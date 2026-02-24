export const TLVViewerTemplate = /* html */ `
<div class="tool-container tlv-viewer">
  <section class="tlv-panel tlv-input-panel">
    <div class="tlv-panel-header">
      <h3>Input</h3>
      <div class="tlv-toolbar">
        <label class="tlv-input-mode-wrap" for="tlv-input-mode">
          <span>Mode</span>
          <select id="tlv-input-mode" class="tlv-input-mode">
            <option value="hex">Hex</option>
            <option value="base64">Base64</option>
            <option value="utf8">UTF-8/Text</option>
          </select>
        </label>
        <div class="tlv-actions">
          <button class="btn btn-primary btn-sm" id="tlv-parse-btn">Parse</button>
          <button class="btn btn-secondary btn-sm" id="tlv-paste-btn">Paste</button>
          <button class="btn btn-secondary btn-sm" id="tlv-sample-btn">Sample</button>
          <button class="btn btn-secondary btn-sm" id="tlv-clear-btn">Clear</button>
        </div>
      </div>
    </div>

    <textarea
      id="tlv-input"
      class="form-textarea tlv-input-area"
      rows="12"
      placeholder="Enter TLV payload here..."
    ></textarea>

    <p class="tlv-help-text">
      Hex mode accepts whitespace and separators. Base64 and UTF-8 modes are converted to bytes before parsing.
    </p>
  </section>

  <section class="tlv-panel tlv-output-panel">
    <div class="tlv-panel-header">
      <h3>Output</h3>
      <div class="tlv-output-controls">
        <div class="tabs-container tlv-view-tabs">
          <button class="tab-button active" data-view="tree">Tree</button>
          <button class="tab-button" data-view="table">Table</button>
        </div>
        <button class="btn btn-primary btn-sm" id="tlv-copy-output-btn" disabled>Copy Output</button>
      </div>
    </div>

    <div id="tlv-error" class="tlv-error" style="display: none;"></div>

    <div class="tlv-summary">
      <div class="tlv-summary-card">
        <span class="tlv-summary-label">Bytes</span>
        <strong id="tlv-summary-bytes">0</strong>
      </div>
      <div class="tlv-summary-card">
        <span class="tlv-summary-label">Nodes</span>
        <strong id="tlv-summary-nodes">0</strong>
      </div>
      <div class="tlv-summary-card">
        <span class="tlv-summary-label">Top-level</span>
        <strong id="tlv-summary-top">0</strong>
      </div>
      <div class="tlv-summary-card">
        <span class="tlv-summary-label">Max depth</span>
        <strong id="tlv-summary-depth">0</strong>
      </div>
    </div>

    <div id="tlv-tree-view" class="tlv-view-pane">
      <div id="tlv-tree-list" class="tlv-tree-list tlv-empty-state">Parse TLV to view nested nodes.</div>
      <pre id="tlv-json-output" class="tlv-json-output"></pre>
    </div>

    <div id="tlv-table-view" class="tlv-view-pane" style="display: none;">
      <div class="tlv-table-wrapper">
        <table class="tlv-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Depth</th>
              <th>Offset</th>
              <th>Class</th>
              <th>Tag</th>
              <th>C</th>
              <th>Length</th>
              <th>Preview</th>
              <th>Value (Hex)</th>
              <th>Raw TLV</th>
            </tr>
          </thead>
          <tbody id="tlv-table-body">
            <tr class="tlv-empty-row">
              <td colspan="10">Parse TLV to populate rows.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</div>
`;
