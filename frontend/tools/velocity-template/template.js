export const VelocityTemplate = /* html */ `
  <div class="tool-container splunk-vtl-editor velocity-template-tool">
    <div class="velocity-document-bar" aria-label="Velocity documents">
      <div id="velocityDocumentTabs" class="velocity-document-tabs" role="tablist" aria-label="Velocity documents"></div>
      <button id="btnNewVelocityDocument" class="velocity-document-add" type="button" title="New Velocity document" aria-label="New Velocity document">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14"></path>
        </svg>
      </button>
    </div>
    <div class="vtl-layout">
      <section class="pane vtl-editor-pane" aria-labelledby="velocityEditorTitle">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group">
            <h3 id="velocityEditorTitle">Velocity Template</h3>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnImportVelocitySql" class="btn btn-secondary btn-sm" type="button" hidden>Import SQL</button>
            <button id="btnCopyVelocity" class="btn btn-secondary btn-sm" type="button">Copy</button>
            <details id="velocityMoreActions" class="vtl-actions-menu">
              <summary class="btn btn-secondary btn-sm">More</summary>
              <div class="vtl-actions-menu-popover app-popover-surface">
                <button id="btnPasteVelocity" type="button">Paste from clipboard</button>
                <button id="btnClearVelocity" class="is-destructive" type="button">Clear template</button>
              </div>
            </details>
            <button id="btnCollapseVelocityTemplate" class="vtl-collapse-button" type="button" aria-label="Collapse Velocity Template" aria-expanded="true">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
            </button>
            <button id="btnCreateVelocityQuery" class="btn btn-primary btn-sm" type="button" disabled>Create query</button>
          </div>
        </div>
        <div id="velocityEditor" class="monaco-editor-container"></div>
      </section>

      <div id="velocityResizer" class="vtl-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize editor and result panes" aria-valuemin="25" aria-valuemax="75" aria-valuenow="60"></div>

      <section class="pane vtl-parameters-pane" aria-labelledby="velocityContextTitle">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group"><h3 id="velocityContextTitle">Context Data</h3></div>
          <div class="vtl-panel-actions">
            <button id="btnSyncVelocityContext" class="btn btn-secondary btn-sm" type="button">Sync fields</button>
            <button id="btnFormatVelocityContext" class="btn btn-secondary btn-sm" type="button">Format JSON</button>
            <button id="btnCollapseVelocityContext" class="vtl-collapse-button" type="button" aria-label="Collapse Context Data" aria-expanded="true">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
            </button>
          </div>
        </div>
        <div id="velocityContextError" class="vtl-inline-error" role="alert" hidden></div>
        <div id="velocityContext" class="vtl-parameters-input" aria-label="Velocity context JSON"></div>
      </section>

      <section class="pane vtl-preview-pane" aria-labelledby="velocityResultTitle">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group">
            <h3 id="velocityResultTitle">Rendered Result</h3>
          </div>
          <div class="vtl-panel-actions">
            <span class="vtl-result-type-label">Result type</span>
            <details id="velocityResultTypeMenu" class="vtl-actions-menu vtl-result-type-menu">
              <summary id="velocityResultType" class="btn btn-secondary btn-sm" aria-label="Result type">Text</summary>
              <div class="vtl-actions-menu-popover app-popover-surface" role="menu" aria-label="Result type">
                <button type="button" role="menuitemradio" aria-checked="true" data-result-type="text">Text</button>
                <button type="button" role="menuitemradio" aria-checked="false" data-result-type="json">JSON</button>
              </div>
            </details>
            <button id="btnToggleVelocityWrap" class="btn btn-secondary btn-sm" type="button" aria-pressed="true">Wrap</button>
            <button id="btnCopyVelocityPreview" class="btn btn-secondary btn-sm" type="button">Copy</button>
          </div>
        </div>
        <div id="velocityPreviewStatus" class="vtl-inline-error velocity-preview-error" role="alert" hidden></div>
        <div id="velocityPreview" class="vtl-preview-output" aria-label="Rendered Velocity template"></div>
      </section>
    </div>

    <div id="velocitySqlImportOverlay" class="vtl-import-overlay app-overlay-backdrop" hidden></div>
    <dialog id="velocitySqlImportDialog" class="vtl-import-dialog app-overlay-surface" aria-labelledby="velocitySqlImportTitle">
      <div class="vtl-import-header">
        <div>
          <h3 id="velocitySqlImportTitle">Import template from SQL</h3>
          <p>Run a read-only query, then choose the row and field containing the Velocity template.</p>
        </div>
        <button id="btnCloseVelocitySqlImport" class="vtl-icon-button" type="button" aria-label="Close import dialog">×</button>
      </div>
      <div class="vtl-import-body">
        <label class="vtl-import-field">
          <span>Oracle connection</span>
          <select id="velocitySqlConnection"></select>
        </label>
        <label class="vtl-import-field">
          <span>SELECT query</span>
          <textarea id="velocitySqlQuery" rows="5" spellcheck="false" placeholder="SELECT * FROM SCHEMA.TEMPLATE_TABLE WHERE TEMPLATE_ID = 1"></textarea>
          <small>Up to 100 rows are fetched. Only SELECT statements are allowed.</small>
        </label>
        <div id="velocitySqlImportError" class="vtl-inline-error" role="alert" hidden></div>
        <button id="btnFetchVelocitySql" class="btn btn-primary" type="button">Fetch fields</button>
        <div id="velocitySqlSelection" class="vtl-import-selection" hidden>
          <label class="vtl-import-field">
            <span>Row</span>
            <select id="velocitySqlRow"></select>
          </label>
          <label class="vtl-import-field">
            <span>Template field</span>
            <select id="velocitySqlField"></select>
          </label>
          <label class="vtl-import-field vtl-import-preview-field">
            <span>Value preview</span>
            <textarea id="velocitySqlPreview" rows="7" readonly></textarea>
          </label>
        </div>
      </div>
      <div class="vtl-import-footer">
        <button id="btnCancelVelocitySqlImport" class="btn btn-secondary" type="button">Cancel</button>
        <button id="btnApplyVelocitySqlImport" class="btn btn-primary" type="button" disabled>Import template</button>
      </div>
    </dialog>
  </div>
`;
