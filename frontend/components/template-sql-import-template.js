export const TemplateSqlImportTemplate = /* html */ `
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
`;
