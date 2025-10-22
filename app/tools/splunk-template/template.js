export const SplunkVTLEditorTemplate = /* html */ `
  <div class="tool-container splunk-vtl-editor">
    <div class="vtl-toolbar">
      <div class="toolbar-left">
        <button id="btnFormatVtl" class="btn btn-primary" title="Format template">Format</button>
        <button id="btnMinifyVtl" class="btn btn-primary" title="Minify template">Minify</button>
        <button id="btnLintVtl" class="btn btn-secondary" title="Lint VTL syntax">Lint</button>
      </div>
      <div class="toolbar-right">
        <button id="btnCopyVtl" class="btn btn-sm" title="Copy">Copy</button>
        <button id="btnPasteVtl" class="btn btn-sm" title="Paste">Paste</button>
        <button id="btnClearVtl" class="btn btn-sm" title="Clear">Clear</button>
      </div>
    </div>

    <div class="vtl-layout">
      <div class="pane editor-pane">
        <div class="pane-header">
          <h3>Splunk VTL Editor</h3>
        </div>
        <div id="vtlEditor" class="monaco-editor-container"></div>
      </div>

      <div class="pane lint-pane">
        <div class="pane-header">
          <h3>Lint Results</h3>
          <div id="vtlLintSummary" class="lint-summary" aria-live="polite"></div>
        </div>
        <div id="vtlLintOutput" class="lint-output"></div>
      </div>
    </div>
  </div>
`;