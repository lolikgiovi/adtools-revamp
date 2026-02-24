export const TLVViewerTemplate = /* html */ `
<div class="tool-container tlv-viewer">
  <section class="tlv-panel tlv-input-panel">
    <div class="tlv-input-header">
      <div class="tlv-title-block">
        <h3>TLV Payload</h3>
        <p>Paste input, choose mode, and parse to inspect nested fields.</p>
      </div>
    </div>

    <div class="tlv-controls">
      <div class="tlv-mode-row">
        <label class="tlv-input-mode-wrap" for="tlv-input-mode">
          <span>Input Mode</span>
          <select id="tlv-input-mode" class="tlv-input-mode">
            <option value="hex">Hex</option>
            <option value="base64">Base64</option>
            <option value="utf8">UTF-8/Text</option>
          </select>
        </label>
        <button class="btn btn-primary btn-sm tlv-parse-btn" id="tlv-parse-btn">Parse TLV</button>
      </div>

      <div class="tlv-actions">
        <button class="btn btn-secondary btn-sm" id="tlv-paste-btn">Paste</button>
        <button class="btn btn-secondary btn-sm" id="tlv-sample-btn">Load Sample</button>
        <button class="btn btn-secondary btn-sm" id="tlv-clear-btn">Clear</button>
      </div>
    </div>

    <textarea
      id="tlv-input"
      class="form-textarea tlv-input-area"
      rows="12"
      placeholder="Examples:
Hex: 6F0E8407A0000000031010A503500141
Base64: bw6EB6AAAAADEQClA1ABQQ==
Text: raw payload string"
    ></textarea>

    <div class="tlv-help-row">
      <span class="tlv-help-chip">Hex mode accepts spaces, separators, and 0x prefixes.</span>
      <span class="tlv-help-chip">Shortcut: Ctrl/Cmd + Enter to parse.</span>
    </div>
  </section>

  <section class="tlv-panel tlv-output-panel">
    <div class="tlv-output-header">
      <div class="tlv-title-block">
        <h3>Parsed Output</h3>
        <p>Switch between tree and table views for the same parsed result.</p>
      </div>
      <div class="tlv-output-controls">
        <div class="tabs-container tlv-view-tabs">
          <button class="tab-button active" data-view="tree">Tree</button>
          <button class="tab-button" data-view="table">Table</button>
        </div>
        <button class="btn btn-secondary btn-sm" id="tlv-copy-output-btn" disabled>Copy Current View</button>
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
      <div id="tlv-tree-list" class="tlv-tree-list tlv-empty-state">
        <div class="tlv-empty-title">No TLV parsed yet</div>
        <div class="tlv-empty-subtitle">Paste a payload and press "Parse TLV" to inspect nodes.</div>
        <ol class="tlv-empty-steps">
          <li>Choose mode (Hex, Base64, or UTF-8/Text).</li>
          <li>Paste payload data.</li>
          <li>Review tree or switch to table.</li>
        </ol>
      </div>

      <details id="tlv-json-panel" class="tlv-json-panel">
        <summary>JSON Snapshot</summary>
        <pre id="tlv-json-output" class="tlv-json-output"></pre>
      </details>
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
              <td colspan="10">Parse TLV to populate table rows.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</div>
`;
