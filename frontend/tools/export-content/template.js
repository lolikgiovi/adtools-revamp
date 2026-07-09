export const EXPORT_CONTENT_TEMPLATE = /* html */ `
<div class="export-content-container tool-container">
  <div class="export-content-workbench">
    <section class="export-content-panel export-content-query-panel">
      <div class="export-content-header">
        <div>
          <h2>Export Content</h2>
          <p>Export HTML content from Oracle query results.</p>
        </div>
        <div class="export-content-status" id="export-content-status">Ready</div>
      </div>

      <div class="export-content-grid">
        <div class="form-group">
          <label>Environment</label>
          <select id="export-content-connection" class="form-input">
            <option value="">Select connection...</option>
          </select>
        </div>
        <div class="form-group">
          <label>Max Rows</label>
          <input id="export-content-max-rows" class="form-input" type="number" min="1" max="10000" value="500">
        </div>
      </div>

      <div class="export-content-snippets">
        <div class="export-content-snippet-save">
          <div class="form-group">
            <label>Snippet Name</label>
            <input id="export-content-snippet-name" class="form-input" type="text" placeholder="Gold loan content">
          </div>
          <button id="export-content-save-snippet" class="btn btn-secondary btn-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            Save
          </button>
        </div>
        <div class="export-content-snippet-list" id="export-content-snippet-list"></div>
      </div>

      <div class="form-group export-content-sql-group">
        <label>SQL Query</label>
        <textarea
          id="export-content-sql"
          class="form-textarea export-content-sql"
          spellcheck="false"
          placeholder="SELECT mt.TOPIC, mt.TEMPLATE_MESSAGE_EN, mt.TEMPLATE_MESSAGE_ID
FROM CONTENT.MESSAGE_TEMPLATE mt
WHERE mt.TOPIC IN ('gold-loan-agreement-template')"
        ></textarea>
        <span class="form-hint">Use a read-only SELECT or WITH query. Columns ending _EN or _ID are selected as content by default.</span>
      </div>

      <div class="export-content-actions">
        <button id="export-content-preview" class="btn btn-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7"></circle>
            <path d="m21 21-5-5"></path>
          </svg>
          Preview Query
        </button>
        <button id="export-content-export" class="btn btn-secondary" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Export HTML Zip
        </button>
      </div>
    </section>

    <section class="export-content-panel export-content-review-panel">
      <div id="export-content-empty-preview" class="export-content-empty-preview">
        <h3>Preview</h3>
        <p>Run a query to review rows, select content columns, and preview generated HTML files.</p>
      </div>
      <div id="export-content-config" style="display: none;">
        <div class="export-content-config-header">
          <div>
            <h3>Export Setup</h3>
            <p id="export-content-preview-summary"></p>
          </div>
          <div id="export-content-estimate" class="export-content-estimate"></div>
        </div>
        <div class="export-content-columns">
          <div>
            <h4>Filename Identifier</h4>
            <div id="export-content-identifier-columns" class="export-content-check-list"></div>
          </div>
          <div>
            <h4>HTML Content Columns</h4>
            <div id="export-content-content-columns" class="export-content-check-list"></div>
          </div>
        </div>
        <div class="export-content-preview-table" id="export-content-preview-table"></div>
        <div class="export-content-html-preview">
          <div class="export-content-html-header">
            <h4>HTML Preview</h4>
            <select id="export-content-html-file" class="form-input"></select>
          </div>
          <iframe id="export-content-html-frame" class="export-content-html-frame" sandbox=""></iframe>
        </div>
      </div>
    </section>
  </div>
</div>`;
