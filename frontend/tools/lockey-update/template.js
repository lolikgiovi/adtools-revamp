/**
 * Lockey Update HTML template.
 */
export const LockeyUpdateTemplate = /* html */ `
<div class="tool-container lockey-update">
  <div class="lu-topbar">
    <div class="lu-tabs" role="tablist" aria-label="Lockey Update views">
      <button id="lu-tab-create" class="lu-tab active" type="button" role="tab" aria-selected="true" aria-controls="lu-create-panel" data-tab="create">Create Lockey Update</button>
      <button id="lu-tab-history" class="lu-tab" type="button" role="tab" aria-selected="false" aria-controls="lu-history-panel" data-tab="history">Check Version History</button>
    </div>
    <div class="lu-env">
      <select id="lu-connection" class="lu-select" aria-label="Environment"></select>
      <button id="lu-fetch-oracle" class="btn btn-primary btn-sm" type="button">Load from Oracle</button>
    </div>
  </div>

  <p class="lu-inline-error" id="lu-source-error" hidden></p>

  <section class="lu-tab-panel active" id="lu-create-panel" data-panel="create" role="tabpanel" aria-labelledby="lu-tab-create">
    <div class="lu-create">
      <div class="lu-create-main">
        <div class="lu-formbar">
          <label class="lu-inline-field">
            <span>Release ID</span>
            <input id="lu-release-id" class="lu-input" type="text" maxlength="10" placeholder="x.x.x" list="lu-release-options" autocomplete="off" spellcheck="false">
            <datalist id="lu-release-options"></datalist>
          </label>
          <label class="lu-inline-field">
            <span>Audit trail</span>
            <input id="lu-audit-user" class="lu-input" type="text" maxlength="50" placeholder="SYSTEM" autocapitalize="characters" autocomplete="off" spellcheck="false">
          </label>
          <p class="lu-form-note">Version is allocated by <code>MAX + 1</code> when the script runs.</p>
        </div>

        <div id="lu-grid" class="lu-grid" aria-label="Localization changes"></div>
        <div id="lu-validation" class="lu-validation" aria-live="polite"></div>
      </div>

      <aside class="lu-sql-pane" aria-label="Generated SQL">
        <header class="lu-sql-header">
          <h2>Generated SQL</h2>
          <div class="lu-sql-actions">
            <button id="lu-copy-sql" class="btn btn-secondary btn-sm" type="button" disabled>Copy</button>
            <button id="lu-download-sql" class="btn btn-primary btn-sm" type="button" disabled>Download</button>
          </div>
        </header>
        <div id="lu-sql-editor" class="lu-sql-editor" aria-label="Generated Oracle SQL"></div>
      </aside>
    </div>
  </section>

  <section class="lu-tab-panel" id="lu-history-panel" data-panel="history" role="tabpanel" aria-labelledby="lu-tab-history">
    <div class="lu-history">
      <p class="lu-history-summary" id="lu-history-summary">No localization data loaded.</p>
      <div class="lu-data-warnings" id="lu-data-warnings" hidden aria-live="polite"></div>

      <div class="lu-history-toolbar">
        <input id="lu-search" class="lu-input" type="search" placeholder="Filter by key, value, release..." autocomplete="off">
        <select id="lu-release-filter" class="lu-select" aria-label="Filter by release">
          <option value="">All releases</option>
        </select>
        <span class="lu-count" id="lu-history-count"></span>
      </div>

      <div class="lu-table-wrap">
        <table class="lu-table">
          <thead>
            <tr>
              <th class="lu-col-version">Version</th>
              <th class="lu-col-release">Release</th>
              <th>Localization key</th>
              <th>ID_VALUE</th>
              <th>EN_VALUE</th>
              <th class="lu-col-time">Updated</th>
            </tr>
          </thead>
          <tbody id="lu-history-body"></tbody>
        </table>
        <div class="lu-empty" id="lu-history-empty">
          <strong>No localization data</strong>
          <span>Choose an environment and load from Oracle to inspect the version history.</span>
        </div>
      </div>

      <p class="lu-note" id="lu-history-note"></p>
    </div>
  </section>
</div>
`;
