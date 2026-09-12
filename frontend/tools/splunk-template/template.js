export const SplunkVTLEditorTemplate = /* html */ `
  <div class="tool-container splunk-vtl-editor">
    
    <div class="vtl-layout">
      <div class="pane editor-pane">
        <div class="pane-header">
          <h3>Splunk Editor</h3>
          <div>
            <button id="btnFormatVtl" class="btn btn-primary btn-sm" title="Format template">Format</button>
            <button id="btnMinifyVtl" class="btn btn-primary btn-sm" title="Minify template">Minify</button>
            <button id="btnCopyVtl" class="btn btn-secondary btn-sm" title="Copy">Copy</button>
            <button id="btnPasteVtl" class="btn btn-secondary btn-sm" title="Paste">Paste</button>
            <button id="btnClearVtl" class="btn btn-secondary btn-sm" title="Clear">Clear</button>
          </div>
        </div>
        <div id="vtlEditor" class="monaco-editor-container"></div>
      </div>

      <div id="vtlResizer" class="vtl-resizer" role="separator" aria-orientation="vertical" aria-label="Resize panes"></div>

      <div class="pane workspace-pane">
        <div class="pane-header">
          <div class="vtl-tabs" role="tablist" aria-label="Template workspace">
            <button id="tabFields" class="vtl-tab is-active" type="button" role="tab" aria-selected="true" data-panel="fieldsPanel">Fields</button>
            <button id="tabParameters" class="vtl-tab" type="button" role="tab" aria-selected="false" data-panel="parametersPanel">Sample Data</button>
            <button id="tabPreview" class="vtl-tab" type="button" role="tab" aria-selected="false" data-panel="previewPanel">Preview</button>
          </div>
          <div id="fieldsActions" class="vtl-panel-actions">
            <button id="btnAddField" class="btn btn-sm" title="Add field">Add Field</button>
          </div>
          <div id="parametersActions" class="vtl-panel-actions" hidden>
            <button id="btnGenerateParameters" class="btn btn-secondary btn-sm" title="Add missing parameters used by the template">Add Missing</button>
            <button id="btnFormatParameters" class="btn btn-secondary btn-sm" title="Format sample JSON">Format JSON</button>
          </div>
          <div id="previewActions" class="vtl-panel-actions" hidden>
            <button id="btnCopyPreview" class="btn btn-secondary btn-sm" title="Copy rendered preview">Copy</button>
          </div>
        </div>
        <div id="fieldsPanel" class="vtl-workspace-panel is-active" role="tabpanel" aria-labelledby="tabFields">
          <div id="fieldsTable" class="handsontable-container"></div>
        </div>
        <div id="parametersPanel" class="vtl-workspace-panel" role="tabpanel" aria-labelledby="tabParameters" hidden>
          <p class="vtl-panel-help">JSON parameters are available as both <code>$name</code> and <code>$context.name</code>, matching the consumer.</p>
          <textarea id="splunkParameters" class="vtl-parameters-input" spellcheck="false" aria-label="Sample parameters JSON"></textarea>
        </div>
        <div id="previewPanel" class="vtl-workspace-panel" role="tabpanel" aria-labelledby="tabPreview" hidden>
          <div id="previewStatus" class="vtl-preview-status" role="status">Ready</div>
          <pre id="splunkPreview" class="vtl-preview-output" aria-label="Rendered Splunk template"></pre>
        </div>
      </div>
    </div>
  </div>
`;
