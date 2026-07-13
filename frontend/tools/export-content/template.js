export const EXPORT_CONTENT_TEMPLATE = /* html */ `
<div class="export-content-container tool-container">
  <div class="export-content-workbench">
    <div class="export-content-left-column">
      <section class="export-content-panel export-content-query-panel" id="export-content-query-panel">
        <div class="export-content-query-expanded" id="export-content-query-expanded">
          <div class="export-content-panel-header">
            <div>
              <h2>Query Configuration</h2>
            </div>
            <button id="export-content-collapse-query" class="export-content-icon-button" type="button" title="Collapse query setup" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m18 15-6-6-6 6"></path>
              </svg>
            </button>
          </div>

          <div class="export-content-grid">
            <div class="form-group">
              <label for="export-content-connection">Environment</label>
              <select id="export-content-connection" class="form-input">
                <option value="">Select connection...</option>
              </select>
            </div>
            <div class="form-group">
              <label for="export-content-max-rows">Max Rows</label>
              <input id="export-content-max-rows" class="form-input" type="number" min="1" max="10000" value="500">
            </div>
          </div>

          <div class="export-content-snippets">
            <div class="export-content-snippet-save">
              <div class="form-group">
                <label for="export-content-snippet-name">Saved Query</label>
                <input id="export-content-snippet-name" class="form-input" type="text" placeholder="Gold Loan Content">
              </div>
              <button id="export-content-save-snippet" class="btn btn-secondary btn-sm" type="button">
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
            <div class="export-content-label-row">
              <label for="export-content-sql">SQL Query</label>
              <button class="export-content-link-button" type="button" title="SQL editor uses the full panel">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M15 3h6v6"></path>
                  <path d="m10 14 11-11"></path>
                  <path d="M9 21H3v-6"></path>
                  <path d="m14 10-11 11"></path>
                </svg>
              </button>
            </div>
            <div id="export-content-query-error" class="export-content-query-error" hidden></div>
            <textarea
              id="export-content-sql"
              class="form-textarea export-content-sql"
              spellcheck="false"
              placeholder="SELECT mt.TOPIC, mt.TEMPLATE_MESSAGE_EN, mt.TEMPLATE_MESSAGE_ID
FROM CONTENT.MESSAGE_TEMPLATE mt
WHERE mt.TOPIC IN ('gold-loan-agreement-template')"
            ></textarea>
            <span class="form-hint">Only SELECT / WITH queries are supported.</span>
          </div>

          <div class="export-content-actions">
            <div id="export-content-status" class="export-content-status">Ready</div>
            <button id="export-content-preview" class="btn btn-primary" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span id="export-content-preview-label">Run Query</span>
            </button>
          </div>
        </div>

        <div class="export-content-query-collapsed" id="export-content-query-collapsed" hidden>
          <div class="export-content-collapsed-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m9 18 6-6-6-6"></path>
            </svg>
          </div>
          <div class="export-content-collapsed-summary">
            <h2>Query Configuration</h2>
            <p id="export-content-query-summary">No query has been run.</p>
          </div>
          <div class="export-content-collapsed-actions">
            <button id="export-content-expand-query" class="btn btn-ghost btn-sm" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h6v6"></path>
                <path d="m10 14 11-11"></path>
                <path d="M9 21H3v-6"></path>
                <path d="m14 10-11 11"></path>
              </svg>
              Expand
            </button>
            <button id="export-content-run-again" class="btn btn-ghost btn-sm" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              Run Again
            </button>
          </div>
        </div>
      </section>

      <section class="export-content-panel export-content-export-panel" id="export-content-export-panel">
        <div class="export-content-panel-header">
          <div class="export-content-title-with-help">
            <h2>Export Configuration</h2>
            <span class="export-content-help" title="Choose the filename identifier and HTML columns to generate files.">?</span>
          </div>
        </div>

        <div class="export-content-export-controls">
          <div class="form-group">
            <label for="export-content-identifier-select">Filename Identifier</label>
            <select id="export-content-identifier-select" class="form-input" disabled>
              <option value="">Run a query to configure</option>
            </select>
          </div>
          <div class="form-group">
            <label for="export-content-content-select">HTML Content Columns</label>
            <div id="export-content-content-select" class="export-content-chip-select export-content-disabled">
              <span>Run a query to configure</span>
            </div>
          </div>
        </div>

        <div id="export-content-estimate" class="export-content-estimate export-content-estimate-muted">
          Run a query to configure export and generate files.
        </div>

        <div class="export-content-files-header">
          <h3 id="export-content-files-title">Generated Files</h3>
          <div class="export-content-file-search-wrap">
            <input id="export-content-file-search" class="form-input" type="search" placeholder="Search files..." disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m21 21-5-5"></path>
            </svg>
          </div>
        </div>
        <div id="export-content-file-list" class="export-content-file-list export-content-file-list-empty">
          <div class="export-content-file-empty">Run a query to configure export and generate files.</div>
        </div>

        <div class="export-content-download-actions">
          <button id="export-content-export" class="btn btn-primary" type="button" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Export ZIP
          </button>
          <button id="export-content-download-manifest" class="btn btn-secondary" type="button" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <path d="M14 2v6h6"></path>
              <path d="M12 18v-6"></path>
              <path d="m9 15 3 3 3-3"></path>
            </svg>
            Download Manifest
          </button>
        </div>
      </section>
    </div>

    <section class="export-content-panel export-content-preview-panel export-content-compare-panel">
      <div class="export-content-preview-header">
        <div>
          <h2>Compare Content</h2>
          <p>Oracle is the baseline. Add a candidate from pasted markup, a file, or an Excel row.</p>
        </div>
        <div class="export-content-preview-file-control">
          <label for="export-content-html-file">Oracle content</label>
          <select id="export-content-html-file" class="form-input" disabled>
            <option value="">-</option>
          </select>
        </div>
      </div>

      <div class="export-content-candidate-card">
        <div class="export-content-candidate-header">
          <div>
            <h3>Candidate</h3>
            <p id="export-content-candidate-label">Paste content below or choose a candidate file.</p>
          </div>
          <div class="export-content-candidate-actions">
            <button id="export-content-upload-markup" class="btn btn-secondary btn-sm" type="button">HTML / XML file</button>
            <button id="export-content-upload-excel" class="btn btn-secondary btn-sm" type="button">Excel row</button>
            <button id="export-content-clear-candidate" class="btn btn-ghost btn-sm" type="button" disabled>Clear</button>
          </div>
        </div>
        <input id="export-content-markup-file" type="file" accept=".html,.htm,.xml,.xhtml,text/html,application/xml,application/xhtml+xml" hidden>
        <input id="export-content-excel-file" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden>
        <div id="export-content-excel-mapping" class="export-content-excel-mapping" hidden>
          <div class="form-group">
            <label for="export-content-excel-sheet">Sheet</label>
            <select id="export-content-excel-sheet" class="form-input"></select>
          </div>
          <div class="form-group">
            <label for="export-content-excel-row">Row</label>
            <select id="export-content-excel-row" class="form-input"></select>
          </div>
          <div class="form-group">
            <label for="export-content-excel-column">HTML column</label>
            <select id="export-content-excel-column" class="form-input"></select>
          </div>
        </div>
        <textarea
          id="export-content-candidate-editor"
          class="form-textarea export-content-candidate-editor"
          spellcheck="false"
          placeholder="Paste candidate HTML, XML, or XHTML here..."
        ></textarea>
      </div>

      <div class="export-content-compare-toolbar">
        <div class="export-content-preview-tabs" role="tablist" aria-label="Comparison mode">
          <button id="export-content-text-diff-tab" class="export-content-preview-tab is-active" type="button">Text Diff</button>
          <button id="export-content-source-diff-tab" class="export-content-preview-tab" type="button">Source Diff</button>
          <button id="export-content-rendered-tab" class="export-content-preview-tab" type="button">Preview</button>
        </div>
        <label class="export-content-whitespace-toggle">
          <input id="export-content-normalize-whitespace" type="checkbox" checked>
          Ignore formatting whitespace
        </label>
      </div>
      <div id="export-content-compare-summary" class="export-content-compare-summary" hidden></div>
      <div id="export-content-preview-surface" class="export-content-preview-surface">
        <div id="export-content-preview-empty" class="export-content-empty-preview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <path d="M14 2v6h6"></path>
            <path d="M9 13h4"></path>
            <path d="M9 17h2"></path>
            <circle cx="17" cy="17" r="3"></circle>
            <path d="m21 21-1.8-1.8"></path>
          </svg>
          <h3>Run a query to select the Oracle baseline.</h3>
          <p>Then paste content or import an HTML/XML/XHTML or Excel candidate to compare.</p>
        </div>
        <div id="export-content-diff-view" class="export-content-diff-view" hidden></div>
        <div id="export-content-rendered-comparison" class="export-content-rendered-comparison" hidden>
          <div class="export-content-rendered-pane">
            <div class="export-content-rendered-label">Oracle</div>
            <iframe id="export-content-html-frame" class="export-content-html-frame" title="Oracle content preview" sandbox=""></iframe>
          </div>
          <div class="export-content-rendered-pane">
            <div class="export-content-rendered-label">Candidate</div>
            <iframe id="export-content-candidate-frame" class="export-content-html-frame" title="Candidate content preview" sandbox=""></iframe>
          </div>
        </div>
      </div>
    </section>
  </div>
</div>`;
