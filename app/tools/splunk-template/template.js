export const SplunkVTLEditorTemplate = /* html */ `
  <div class="tool-container splunk-vtl-editor">
    
    <div class="vtl-layout">
      <div class="pane editor-pane">
        <div class="pane-header">
          <h3>Splunk Editor</h3>
          <div>
            <button id="btnFormatVtl" class="btn btn-primary" title="Format template">Format</button>
            <button id="btnMinifyVtl" class="btn btn-primary" title="Minify template">Minify</button>
            <button id="btnCopyVtl" class="btn btn-sm" title="Copy">Copy</button>
            <button id="btnPasteVtl" class="btn btn-sm" title="Paste">Paste</button>
            <button id="btnClearVtl" class="btn btn-sm" title="Clear">Clear</button>
          </div>
        </div>
        <div id="vtlEditor" class="monaco-editor-container"></div>
      </div>

      <div id="vtlResizer" class="vtl-resizer" role="separator" aria-orientation="vertical" aria-label="Resize panes"></div>

      <div class="pane table-pane">
        <div class="pane-header">
          <h3>Fields Review</h3>
        </div>
        <div id="fieldsTable" class="handsontable-container"></div>
      </div>
    </div>
  </div>
`;
