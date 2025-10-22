export const HTMLTemplateToolTemplate = /* html */ `
  <div class="tool-container html-template">
    <div class="html-template-layout">
      <div class="pane editor-pane">
        <div class="pane-header">
          <h3>Editor</h3>
          <div class="toolbar-left">
            <button id="btnFormatHtml" class="btn btn-primary" title="Format HTML">Format</button>
            <button id="btnMinifyHtml" class="btn btn-primary" title="Minify HTML">Minify</button>
            <button id="btnExtractVtl" class="btn btn-secondary" title="Extract VTL Fields">Extract VTL Fields</button>
            <button id="btnCopyHtml" class="btn btn-sm" title="Copy HTML">Copy</button>
            <button id="btnPasteHtml" class="btn btn-sm" title="Paste HTML">Paste</button>
            <button id="btnClearHtml" class="btn btn-sm" title="Clear HTML">Clear</button>
          </div>
        </div>
        <div id="htmlEditor" class="monaco-editor-container"></div>
      </div>

      <!-- Removed resizer for fixed split -->

      <div class="pane renderer-pane">
        <div class="pane-header">
          <h3>Preview</h3>
          <div class="renderer-actions">
            <div id="envControls" class="env-controls" style="display:inline-flex;gap:.5rem;align-items:center;margin-right:.5rem;">
              <label for="envSelector" class="env-label">ENV:</label>
              <select id="envSelector" class="env-select" title="Select environment"></select>
            </div>

            <button id="btnReloadPreview" class="btn btn-sm" title="Reload Preview">Reload</button>
          </div>
        </div>
        <iframe id="htmlRenderer" class="renderer-iframe" sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
      </div>
    </div>

    <div id="vtlPanel" class="vtl-panel" style="display:none;margin-top:.5rem;border:1px solid hsl(var(--border));border-radius:8px;padding:.75rem;background:hsl(var(--card));">
      <div class="vtl-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
        <h4 style="margin:0;font-size:14px;">VTL Variables</h4>
        <button id="btnCloseVtl" class="btn btn-sm">Close</button>
      </div>
      <div id="vtlContent" class="vtl-content" style="display:flex;flex-direction:column;gap:.5rem;"></div>
    </div>
  </div>
`;