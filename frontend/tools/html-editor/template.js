export const HTMLTemplateToolTemplate = /* html */ `
  <div class="tool-container html-template">
    <div class="html-template-layout">
      <div class="pane editor-pane">
        <div class="pane-header">
          <h3>Editor</h3>
          <div class="toolbar-left">
            <button id="btnFormatHtml" class="btn btn-primary btn-sm" title="Format HTML">Format</button>
            <button id="btnMinifyHtml" class="btn btn-primary btn-sm" title="Minify HTML">Minify</button>
            <button id="btnExtractVtl" class="btn btn-primary btn-sm" title="Extract VTL Fields">Extract VTL Fields</button>
            <button id="btnCopyHtml" class="btn btn-secondary btn-sm" title="Copy HTML">Copy</button>
            <button id="btnPasteHtml" class="btn btn-secondary btn-sm" title="Paste HTML">Paste</button>
            <button id="btnClearHtml" class="btn btn-secondary btn-sm" title="Clear HTML">Clear</button>
          </div>
        </div>
        <div id="htmlEditor" class="monaco-editor-container"></div>

        <!-- Modeless VTL modal positioned over the editor (bottom-left) -->
        <div id="vtlModal" class="vtl-modal" role="dialog" aria-modal="false" aria-label="VTL Variables" style="display:none;">
          <div class="vtl-modal-header">
            <h4 class="vtl-modal-title">VTL Variables</h4>
            <div style="display:flex;gap:.5rem;align-items:center;">
              <button id="btnResetVtl" class="btn btn-secondary btn-sm" title="Reset All">Reset</button>
              <button id="btnCloseVtl" class="btn btn-secondary btn-sm" title="Close VTL">Close</button>
            </div>
          </div>
          <div id="vtlModalBody" class="vtl-modal-body"></div>
        </div>
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

            <button id="btnReloadPreview" class="btn btn-secondary btn-sm" title="Reload Preview">Reload</button>
          </div>
        </div>
        <iframe id="htmlRenderer" class="renderer-iframe" sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
      </div>
    </div>

  </div>
`;
