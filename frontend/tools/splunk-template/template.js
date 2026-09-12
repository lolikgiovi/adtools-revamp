export const SplunkVTLEditorTemplate = /* html */ `
  <div class="tool-container splunk-vtl-editor">
    
    <div class="vtl-layout">
      <div class="pane editor-pane vtl-editor-pane">
        <div class="pane-header">
          <div class="vtl-editor-heading">
            <h3>Template Editor</h3>
            <div class="vtl-view-switch" role="tablist" aria-label="Template editor view">
              <button id="btnTextView" class="vtl-view-button is-active" type="button" role="tab" aria-selected="true">Text</button>
              <button id="btnTableView" class="vtl-view-button" type="button" role="tab" aria-selected="false">Table</button>
            </div>
          </div>
          <div id="textEditorActions" class="vtl-panel-actions">
            <button id="btnFormatVtl" class="btn btn-primary btn-sm" title="Format template">Format</button>
            <button id="btnMinifyVtl" class="btn btn-primary btn-sm" title="Minify template">Minify</button>
            <button id="btnCopyVtl" class="btn btn-secondary btn-sm" title="Copy">Copy</button>
            <button id="btnPasteVtl" class="btn btn-secondary btn-sm" title="Paste">Paste</button>
            <button id="btnClearVtl" class="btn btn-secondary btn-sm" title="Clear">Clear</button>
          </div>
          <div id="tableEditorActions" class="vtl-panel-actions" hidden>
            <button id="btnCopyInputsJson" class="btn btn-secondary btn-sm" title="Copy required template inputs as nested JSON">Inputs JSON</button>
            <button id="btnCopyInputsLines" class="btn btn-secondary btn-sm" title="Copy one required input path per line">Inputs Lines</button>
            <button id="btnAddField" class="btn btn-secondary btn-sm" title="Add field">Add Field</button>
          </div>
        </div>
        <div id="textEditorPanel" class="vtl-editor-view is-active" role="tabpanel" aria-labelledby="btnTextView">
          <div id="vtlEditor" class="monaco-editor-container"></div>
        </div>
        <div id="tableEditorPanel" class="vtl-editor-view" role="tabpanel" aria-labelledby="btnTableView" hidden>
          <div id="fieldsTable" class="handsontable-container"></div>
        </div>
      </div>

      <div id="vtlResizer" class="vtl-resizer" role="separator" aria-orientation="vertical" aria-label="Resize panes"></div>

      <div class="pane vtl-parameters-pane">
        <div class="pane-header vtl-context-header">
          <h3>Context Data</h3>
          <div class="vtl-panel-actions">
            <button id="btnGenerateParameters" class="btn btn-secondary btn-sm" title="Add fields required by the template">Sync</button>
            <button id="btnFormatParameters" class="btn btn-secondary btn-sm" title="Format sample JSON">Format</button>
          </div>
        </div>
        <textarea id="splunkParameters" class="vtl-parameters-input" spellcheck="false" aria-label="Sample parameters JSON"></textarea>
      </div>

      <div class="pane vtl-preview-pane">
        <div class="pane-header">
          <div>
            <h3>Rendered Result</h3>
            <span id="previewStatus" class="vtl-pane-caption" role="status">Ready</span>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnCopyPreview" class="btn btn-secondary btn-sm" title="Copy rendered preview">Copy</button>
          </div>
        </div>
        <pre id="splunkPreview" class="vtl-preview-output" aria-label="Rendered Splunk template"></pre>
      </div>
    </div>
  </div>
`;
