/**
 * Lockey Update HTML template.
 */
export const LockeyUpdateTemplate = /* html */ `
<div class="tool-container lockey-update">
  <div class="tabs-container lu-tabs-row">
    <div class="tabs-left" role="tablist" aria-label="Lockey update views">
      <button id="lu-tab-create" class="tab-button lu-tab-btn active" type="button" role="tab" aria-selected="true" aria-controls="lu-create-panel" tabindex="0" data-tab="create">New update</button>
      <button id="lu-tab-history" class="tab-button lu-tab-btn" type="button" role="tab" aria-selected="false" aria-controls="lu-history-panel" tabindex="-1" data-tab="history">Version history</button>
    </div>
  </div>

  <section class="lu-panel active" id="lu-create-panel" data-panel="create" role="tabpanel" aria-labelledby="lu-tab-create">
    <div class="lu-create">
      <div class="lu-controls" id="lu-controls">
        <div class="lu-target-shell" id="lu-target-shell">
          <div class="lu-target-chips" id="lu-target-chips"></div>
          <input
            id="lu-release-id"
            class="lu-target-input"
            type="text"
            placeholder="Release IDs — Enter or comma"
            list="lu-release-options"
            autocomplete="off"
            spellcheck="false"
            aria-label="Release targets"
            aria-describedby="lu-validation"
            title="Type a release ID and press Enter or comma. Each target gets its own language-pack version row."
          >
        </div>
        <datalist id="lu-release-options"></datalist>
        <input id="lu-audit-user" class="lu-input lu-field-audit" type="text" maxlength="50" placeholder="Audit trail" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Audit trail" aria-describedby="lu-validation">
        <div class="lu-row-actions">
          <button id="lu-add-row" class="btn btn-secondary btn-sm lu-row-action" type="button" title="Add a localization row">Add row</button>
          <button id="lu-remove-row" class="btn btn-secondary btn-sm lu-row-action" type="button" title="Remove the selected row(s), or the last row">Remove row</button>
        </div>
      </div>
      <div class="lu-grid-shell">
        <div id="lu-grid" class="lu-grid" aria-label="Localization rows"></div>
      </div>
      <div id="lu-validation" class="lu-checks" aria-live="polite" hidden></div>

      <aside class="lu-sql-pane" aria-label="Generated SQL">
        <header class="lu-sql-header">
          <div class="lu-sql-heading">
            <h2>Generated SQL</h2>
            <span class="lu-sql-meta" id="lu-sql-meta">No script</span>
          </div>
          <div class="lu-sql-actions">
            <button id="lu-copy-sql" class="lu-sql-action" type="button" disabled>Copy</button>
            <button id="lu-download-sql" class="lu-sql-action lu-sql-primary" type="button" disabled>Download</button>
            <button id="lu-run-jenkins" class="lu-sql-action" type="button" disabled>Run in Jenkins</button>
          </div>
        </header>
        <div class="lu-sql-body">
          <div id="lu-sql-editor" class="lu-sql-editor" aria-label="Generated Oracle SQL"></div>
          <div class="lu-sql-empty" id="lu-sql-empty">
            <p class="lu-sql-empty-title" id="lu-sql-empty-title">Nothing to generate yet</p>
            <p class="lu-sql-empty-body" id="lu-sql-empty-body">Add a release ID and at least one localization key. The script updates as you type.</p>
          </div>
        </div>
      </aside>
    </div>
  </section>

  <section class="lu-panel" id="lu-history-panel" data-panel="history" role="tabpanel" aria-labelledby="lu-tab-history">
    <div class="lu-history">
      <div class="lu-history-head">
        <p class="lu-history-summary" id="lu-history-summary">No localization data loaded.</p>
        <div class="lu-source">
          <select id="lu-connection" class="lu-select lu-env-select" aria-label="Environment"></select>
          <button id="lu-fetch-oracle" class="btn btn-secondary btn-sm lu-load" type="button">Load from Oracle</button>
        </div>
      </div>
      <p class="lu-source-error" id="lu-source-error" role="alert" hidden></p>
      <div class="lu-data-warnings" id="lu-data-warnings" hidden aria-live="polite"></div>

      <div class="lu-history-toolbar" id="lu-history-toolbar">
        <label class="lu-search">
          <span class="lu-visually-hidden">Filter version history</span>
          <input id="lu-search" class="lu-input" type="search" placeholder="Filter by key, value, or release" autocomplete="off">
        </label>
        <label class="lu-filter">
          <span class="lu-visually-hidden">Release</span>
          <select id="lu-release-filter" class="lu-select" aria-label="Filter by release">
            <option value="">All releases</option>
          </select>
        </label>
        <span class="lu-count" id="lu-history-count"></span>
      </div>

      <div class="lu-table-wrap" tabindex="0" role="region" aria-label="Version history table">
        <table class="lu-table" id="lu-history-table">
          <caption class="lu-visually-hidden">Localization version history</caption>
          <thead>
            <tr>
              <th class="lu-col-version" scope="col">Version</th>
              <th class="lu-col-release" scope="col">Release</th>
              <th scope="col">Localization key</th>
              <th scope="col">EN value</th>
              <th scope="col">ID value</th>
              <th class="lu-col-time" scope="col">Updated</th>
            </tr>
          </thead>
          <tbody id="lu-history-body"></tbody>
        </table>
        <div class="lu-empty" id="lu-history-empty">
          <strong>No version history yet</strong>
          <span>Choose an environment, then load from Oracle to inspect versions and their keys.</span>
        </div>
      </div>

      <p class="lu-note" id="lu-history-note"></p>
    </div>
  </section>
</div>
`;
