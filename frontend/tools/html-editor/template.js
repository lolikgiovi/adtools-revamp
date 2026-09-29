export const HTMLTemplateToolTemplate = /* html */ `
  <div class="tool-container html-template">
    <div class="html-document-bar" aria-label="HTML documents">
      <div id="htmlDocumentTabs" class="html-document-tabs" role="tablist" aria-label="HTML documents"></div>
      <button id="btnNewHtmlDocument" class="html-document-add" type="button" title="New HTML document" aria-label="New HTML document">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14"></path>
        </svg>
      </button>
      <div id="htmlDocumentUndo" class="html-document-undo" hidden>
        <span id="htmlDocumentUndoMessage">Tab closed</span>
        <button id="btnUndoCloseHtmlDocument" type="button">Undo</button>
      </div>
    </div>
    <div class="html-template-layout">
      <div id="htmlDocumentPanel" class="pane editor-pane" role="tabpanel">
        <div class="pane-header">
          <h3>Editor</h3>
          <div class="toolbar-left">
            <input type="file" id="htmlFileInput" accept=".html,.htm" style="display: none;" />
            <button id="btnImportHtml" class="btn btn-primary btn-sm" title="Import HTML File">Import</button>
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
        <div
          id="vtlModal"
          class="vtl-modal app-popover-surface"
          role="dialog"
          aria-modal="false"
          aria-label="VTL Variables"
          style="display:none;"
        >
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

      <div
        id="splitResizer"
        class="html-template-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize HTML Template panes"
        aria-valuemin="240"
        aria-valuenow="560"
        tabindex="0"
      ></div>

      <div class="pane renderer-pane">
        <div class="pane-header">
          <div class="renderer-actions">
            <div id="envControls" class="env-controls" style="display:inline-flex;gap:.5rem;align-items:center;margin-right:.5rem;">
              <label for="envSelector" class="env-label">ENV:</label>
              <select id="envSelector" class="env-select" title="Select environment"></select>
            </div>

            <select
              id="previewViewportSelect"
              class="preview-viewport-select"
              aria-label="Preview viewport width"
              title="Preview viewport width"
            ></select>
            <input
              id="previewViewportWidth"
              class="preview-viewport-width"
              type="number"
              min="240"
              max="1440"
              step="1"
              inputmode="numeric"
              aria-label="Custom preview viewport width in pixels"
              placeholder="px"
              hidden
            />

            <div class="preview-mode-control">
              <select
                id="previewVtlModeSelect"
                class="preview-vtl-mode-select"
                aria-label="VTL preview mode"
                title="Render VTL using the current values"
              >
                <option value="rendered">Render VTL</option>
                <option value="plain">Show VTL plainly</option>
              </select>
            </div>

            <button
              id="btnWhitePreviewBg"
              class="btn btn-secondary btn-sm preview-bg-toggle"
              type="button"
              aria-pressed="false"
              title="Show a white background behind transparent HTML"
            >White BG</button>
            <button
              id="btnReloadPreview"
              class="btn btn-secondary btn-sm btn-icon-only"
              type="button"
              aria-label="Reload preview"
              title="Reload preview"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 15.7-6L21 9"></path>
                <path d="M21 3v6h-6"></path>
                <path d="M21 12a9 9 0 0 1-15.7 6L3 15"></path>
                <path d="M3 21v-6h6"></path>
              </svg>
            </button>
          </div>
        </div>
        <div id="rendererSurface" class="renderer-surface">
          <iframe id="htmlRenderer" class="renderer-iframe" sandbox="allow-scripts allow-forms allow-same-origin" hidden></iframe>
        </div>
      </div>
    </div>

  </div>
`;
