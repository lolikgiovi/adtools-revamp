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
            <button id="btnCollapseVelocityTemplate" class="vtl-collapse-button" type="button" aria-label="Collapse Velocity Template" aria-expanded="true">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
            </button>
            <h3 id="velocityEditorTitle">Velocity Template</h3>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnImportVelocitySql" class="btn btn-secondary btn-sm" type="button" hidden>Import SQL</button>
            <button id="btnCopyVelocity" class="btn btn-secondary btn-sm" type="button">Copy template</button>
            <details id="velocityMoreActions" class="vtl-actions-menu">
              <summary class="btn btn-secondary btn-sm">More</summary>
              <div class="vtl-actions-menu-popover app-popover-surface">
                <button id="btnPasteVelocity" type="button">Paste from clipboard</button>
                <button id="btnClearVelocity" class="is-destructive" type="button">Clear template</button>
              </div>
            </details>
            <button
              id="btnCreateVelocityQuery"
              class="btn btn-primary btn-sm"
              type="button"
              disabled
              aria-describedby="velocityCreateQueryHint"
              hidden
            >Create query</button>
            <span id="velocityCreateQueryHint" class="sr-only">Import a template from SQL to enable this action.</span>
          </div>
        </div>
        <div id="velocityEditor" class="monaco-editor-container"></div>
      </section>

      <div id="velocityResizer" class="vtl-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize editor and result panes" aria-valuemin="25" aria-valuemax="75" aria-valuenow="60"></div>

      <section class="pane vtl-parameters-pane" aria-labelledby="velocityContextTitle">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group">
            <button id="btnCollapseVelocityContext" class="vtl-collapse-button" type="button" aria-label="Collapse Context Data" aria-expanded="true">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
            </button>
            <h3 id="velocityContextTitle">Context Data</h3>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnSyncVelocityContext" class="btn btn-secondary btn-sm" type="button">Add missing fields…</button>
            <button id="btnFormatVelocityContext" class="btn btn-secondary btn-sm" type="button">Format JSON</button>
          </div>
        </div>
        <div id="velocityContextError" class="vtl-inline-error" role="alert" hidden></div>
        <div id="velocityContext" class="vtl-parameters-input" aria-label="Velocity context JSON"></div>
      </section>

      <section class="pane vtl-preview-pane" aria-label="Velocity validation and preview">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group">
            <button id="btnValidateVelocity" class="btn btn-primary btn-sm" type="button">Validate</button>
            <button id="btnVelocityValidatorSettings" class="btn btn-secondary btn-sm" type="button" title="Velocity API Validator settings">Settings</button>
          </div>
          <div class="vtl-panel-actions">
            <details id="velocityResultTypeMenu" class="vtl-actions-menu vtl-result-type-menu">
              <summary id="velocityResultType" class="btn btn-secondary btn-sm" aria-label="Result type">Text</summary>
              <div class="vtl-actions-menu-popover app-popover-surface" role="menu" aria-label="Result type">
                <button type="button" role="menuitemradio" aria-checked="true" data-result-type="text">Text</button>
                <button type="button" role="menuitemradio" aria-checked="false" data-result-type="json">JSON</button>
              </div>
            </details>
            <button id="btnToggleVelocityWrap" class="btn btn-secondary btn-sm" type="button" aria-pressed="true">Wrap</button>
            <button id="btnCopyVelocityPreview" class="btn btn-primary btn-sm" type="button" disabled>Copy output</button>
          </div>
        </div>
        <div id="velocityValidationStatus" class="vtl-validation-status" role="status" aria-live="polite" hidden></div>
        <div id="velocityResultMeta" class="vtl-result-meta" data-state="idle">Not rendered yet</div>
        <span id="velocityRenderAnnouncement" class="sr-only" role="status" aria-live="polite"></span>
        <div id="velocityPreviewStatus" class="vtl-inline-error velocity-preview-error" role="alert" hidden></div>
        <div id="velocityPreview" class="vtl-preview-output" aria-label="Rendered Velocity template"></div>
      </section>
    </div>

    <div id="velocityUndoToast" class="vtl-undo-toast" role="status" hidden>
      <span id="velocityUndoMessage"></span>
      <button id="btnUndoVelocity" type="button">Undo</button>
    </div>

    <div id="velocitySyncOverlay" class="vtl-import-overlay app-overlay-backdrop" hidden></div>
    <div
      id="velocitySyncDialog"
      class="vtl-import-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="velocitySyncTitle"
      hidden
    >
      <div class="vtl-import-dialog app-overlay-surface">
        <div class="vtl-import-header">
          <h3 id="velocitySyncTitle">Review context fields</h3>
          <button id="btnCloseVelocitySync" class="overlay-close-button app-overlay-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="vtl-import-body">
          <p class="vtl-sync-intro">
            Review missing inputs and values whose shape does not match the template. Apply the suggested samples, then edit
            them with your data. Helper methods require runtime support and cannot be supplied through JSON.
          </p>
          <ul id="velocitySyncFields" class="vtl-sync-list"></ul>
        </div>
        <div class="vtl-import-footer app-modal-actions">
          <button id="btnApplyVelocitySync" class="btn btn-primary" type="button">Apply changes</button>
          <button id="btnCancelVelocitySync" class="btn" type="button">Cancel</button>
        </div>
      </div>
    </div>

    <div id="velocitySqlImportOverlay" class="vtl-import-overlay app-overlay-backdrop" hidden></div>
    <div id="velocitySqlImportDialog" class="vtl-import-modal" role="dialog" aria-modal="true" aria-labelledby="velocitySqlImportTitle" hidden>
      <div class="vtl-import-dialog app-overlay-surface">
        <div class="vtl-import-header">
          <h3 id="velocitySqlImportTitle">Import template from SQL</h3>
          <button id="btnCloseVelocitySqlImport" class="overlay-close-button app-overlay-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="vtl-import-body">
          <label class="vtl-import-field">
            <span>Oracle connection</span>
            <select id="velocitySqlConnection"></select>
          </label>
          <div id="velocitySqlQuery" class="vtl-sql-editor" aria-label="Oracle SELECT query"></div>
          <p id="velocitySqlQueryHint" class="vtl-import-hint" aria-live="polite" hidden></p>
          <div id="velocitySqlImportError" class="vtl-inline-error" role="alert" hidden></div>
          <div id="velocitySqlSelection" class="vtl-import-selection" hidden>
            <div class="vtl-import-results-field">
              <div class="vtl-import-results-head">
                <span>Results</span>
                <span id="velocitySqlRowCount" class="vtl-import-results-count"></span>
              </div>
              <div id="velocitySqlRowTable" class="vtl-import-results" role="region" aria-label="Query results"></div>
              <small class="vtl-import-hint">Click a row to select it; click a cell to also use that field as the template.</small>
            </div>
            <div class="vtl-import-details">
              <label class="vtl-import-field">
                <span>Template field</span>
                <select id="velocitySqlField"></select>
                <small id="velocitySqlRowIdentity" class="vtl-import-row-identity"></small>
              </label>
              <label class="vtl-import-field vtl-import-preview-field">
                <span>Value preview</span>
                <textarea id="velocitySqlPreview" rows="7" readonly></textarea>
              </label>
            </div>
          </div>
        </div>
        <div class="vtl-import-footer app-modal-actions">
          <button id="btnFetchVelocitySql" class="btn btn-primary" type="button">Fetch fields</button>
          <button id="btnApplyVelocitySqlImport" class="btn btn-primary" type="button" disabled>Import template</button>
          <button id="btnCancelVelocitySqlImport" class="btn" type="button">Cancel</button>
        </div>
      </div>
    </div>
  </div>
`;
