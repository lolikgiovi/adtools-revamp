export const HTMLTemplateToolTemplate = /* html */ `
  <div class="tool-container html-template">
    <div class="html-template-toolbar">
      <div class="toolbar-left">
        <button id="btnFormatHtml" class="btn btn-primary" title="Format HTML">Format</button>
        <button id="btnMinifyHtml" class="btn btn-primary" title="Minify HTML">Minify</button>
        <button id="btnExtractVtl" class="btn btn-secondary" title="Extract VTL variables">Extract VTL</button>
      </div>
      <div class="toolbar-right">
        <button id="btnCopyHtml" class="btn btn-sm" title="Copy HTML">Copy</button>
        <button id="btnPasteHtml" class="btn btn-sm" title="Paste HTML">Paste</button>
        <button id="btnClearHtml" class="btn btn-sm" title="Clear HTML">Clear</button>
      </div>
    </div>

    <div class="html-template-layout">
      <div class="pane editor-pane">
        <div class="pane-header">
          <h3>Editor</h3>
        </div>
        <div id="htmlEditor" class="monaco-editor-container"></div>
      </div>

      <div class="pane renderer-pane">
        <div class="pane-header">
          <h3>Preview</h3>
          <div class="renderer-actions">
            <label class="renderer-toggle">
              <input type="checkbox" id="toggleSandboxSameOrigin" /> allow-same-origin
            </label>
            <button id="btnReloadPreview" class="btn btn-sm" title="Reload Preview">Reload</button>
          </div>
        </div>
        <iframe id="htmlRenderer" class="renderer-iframe" sandbox="allow-scripts allow-forms"></iframe>
      </div>
    </div>

    <div id="vtlPanel" class="vtl-panel" style="display:none;">
      <div class="vtl-header">
        <h4>VTL Variables</h4>
        <button id="btnCloseVtl" class="btn btn-sm">Close</button>
      </div>
      <div id="vtlContent" class="vtl-content"></div>
    </div>
  </div>
`;