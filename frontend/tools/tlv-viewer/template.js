export const TLVViewerTemplate = /* html */ `
<div class="tool-container tlv-viewer">
  <section class="tlv-panel tlv-input-panel">
    <div class="tlv-input-header">
      <h3>TLV Input</h3>
      <div class="tlv-format-row">
        <select id="tlv-format" class="tlv-format-select">
          <option value="auto">Auto-detect</option>
          <option value="qris">QRIS / EMV QR</option>
          <option value="ber-hex">BER-TLV (Hex)</option>
          <option value="ber-base64">BER-TLV (Base64)</option>
        </select>
        <button class="btn btn-primary btn-sm" id="tlv-parse-btn">Parse</button>
      </div>
    </div>

    <textarea
      id="tlv-input"
      class="form-textarea tlv-input-area"
      rows="10"
      placeholder="Paste QRIS string, hex TLV, or base64 payload..."
    ></textarea>

    <div class="tlv-input-footer">
      <div class="tlv-actions">
        <button class="btn btn-secondary btn-sm" id="tlv-paste-btn">Paste</button>
        <button class="btn btn-secondary btn-sm" id="tlv-sample-btn">QRIS Sample</button>
        <button class="btn btn-secondary btn-sm" id="tlv-sample-ber-btn">BER-TLV Sample</button>
        <button class="btn btn-secondary btn-sm" id="tlv-clear-btn">Clear</button>
      </div>
      <span class="tlv-shortcut-hint">Ctrl/Cmd + Enter to parse</span>
    </div>
  </section>

  <section class="tlv-panel tlv-output-panel">
    <div class="tlv-output-header">
      <div class="tlv-output-header-left">
        <div class="tabs-container tlv-view-tabs">
          <button class="tab-button active" data-view="tree">Tree</button>
          <button class="tab-button" data-view="table">Table</button>
          <button class="tab-button" data-view="json">JSON</button>
        </div>
        <div id="tlv-summary-bar" class="tlv-summary-bar"></div>
      </div>
      <button class="btn btn-secondary btn-sm" id="tlv-copy-output-btn" disabled>Copy</button>
    </div>

    <div id="tlv-crc-bar" class="tlv-crc-bar" style="display: none;"></div>
    <div id="tlv-error" class="tlv-error" style="display: none;"></div>

    <div id="tlv-tree-view" class="tlv-view-pane">
      <div id="tlv-tree-list" class="tlv-tree-list tlv-empty-state">
        <div class="tlv-empty-msg">Paste a QRIS string or TLV payload and press Parse.</div>
      </div>
    </div>

    <div id="tlv-table-view" class="tlv-view-pane" style="display: none;">
      <div class="tlv-table-wrapper">
        <table class="tlv-table">
          <thead id="tlv-table-head">
            <tr>
              <th>#</th>
              <th>Tag</th>
              <th>Name</th>
              <th>Len</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody id="tlv-table-body">
            <tr class="tlv-empty-row">
              <td colspan="5">Parse TLV to populate table.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div id="tlv-json-view" class="tlv-view-pane" style="display: none;">
      <pre id="tlv-json-output" class="tlv-json-output tlv-json-full"></pre>
    </div>
  </section>
</div>
`;
