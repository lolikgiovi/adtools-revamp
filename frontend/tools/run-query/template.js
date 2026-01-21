export const JenkinsRunnerTemplate = /*html*/ `
  <div class="jenkins-runner">
    <div class="tabs-container jr-tabs" aria-label="Jenkins Runner tabs">
      <div class="tabs-left" role="tablist">
        <button class="tab-button active" id="jr-tab-run-btn" role="tab" aria-selected="true" aria-controls="jr-tab-run">Run Query</button>
        <button class="tab-button" id="jr-tab-history-btn" role="tab" aria-selected="false" aria-controls="jr-tab-history">History</button>
        <button class="tab-button" id="jr-tab-templates-btn" role="tab" aria-selected="false" aria-controls="jr-tab-templates">Templates</button>
      </div>
      <div class="jr-status" data-role="status">Ready</div>
    </div>

    <div id="jr-tab-run" role="tabpanel" aria-labelledby="jr-tab-run-btn">
      <div class="jr-sql">
        <div class="jr-sql-header">
          <label for="jenkins-sql-editor"><span>SQL Query</span></label>
          <div class="jr-runbar" role="group" aria-label="Run settings">
            <select id="jenkins-job" class="jr-input" aria-label="Job Name">
              <option value="tester-execute-query-new">tester-execute-query-new</option>
              <option value="tester-execute-query">tester-execute-query</option>
            </select>
            <select id="jenkins-env" class="jr-input" aria-label="ENV Choice"></select>
            <button id="jenkins-clear" class="btn btn-secondary btn-sm-xs" title="Clear editor">Clear</button>
            <button id="jenkins-paste" class="btn btn-secondary btn-sm-xs" title="Paste from clipboard">Paste</button>
            <button id="jenkins-run" class="btn btn-primary btn-sm-xs">Run on Jenkins</button>
          </div>
        </div>
        <div class="jr-runbar-errors">
          <div class="jr-error" id="jenkins-job-error" style="display:none"></div>
          <div class="jr-error" id="jenkins-env-error" style="display:none"></div>
        </div>
        <div id="jenkins-sql-editor" class="jr-monaco-editor"></div>
        <pre id="jenkins-sql-preview" class="jr-sql-preview" style="display:none"></pre>
      </div>
      <div class="jr-logs">
        <div class="jr-log-header">
          <div class="jr-log-title">
            <span>Build Logs</span>
            <span id="jenkins-build-number" class="jr-build-number" style="display:none"></span>
          </div>
          <div class="jr-log-header-right">
            <a id="jenkins-build-link" href="#" target="_blank" rel="noopener" style="display:none">Open Build</a>
          </div>
        </div>
        <pre id="jenkins-logs" class="jr-log"></pre>
      </div>
    </div>

    <div id="jr-tab-history" role="tabpanel" aria-labelledby="jr-tab-history-btn" style="display:none">
      <div class="jr-history">
        <table class="jr-history-table" aria-label="Run History">
          <colgroup>
            <col class="jr-col-time" />
            <col class="jr-col-env" />
            <col class="jr-col-query" />
            <col class="jr-col-build" />
            <col class="jr-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Time</th>
              <th>ENV</th>
              <th>Query</th>
              <th>Build</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="jr-history-list"></tbody>
        </table>
      </div>
    </div>

    <div id="jr-tab-templates" role="tabpanel" aria-labelledby="jr-tab-templates-btn" style="display:none">
      <div class="jr-templates">
        <div class="jr-template-list" aria-label="Templates section">
          <div class="jr-list-controls" role="toolbar" aria-label="Template controls">
            
            <label class="jr-search-control">
              <span class="sr-only">Search</span>
              <input id="jr-template-search" type="text" class="jr-input" placeholder="Search templates" aria-label="Search templates" />
            </label>
          <label>
              <span class="sr-only">Sort</span>
              <select id="jr-template-sort" class="jr-input" aria-label="Sort templates">
                <option value="updated_desc">Updated (Newest)</option>
                <option value="updated_asc">Updated (Oldest)</option>
                <option value="name_asc">Name (A–Z)</option>
                <option value="name_desc">Name (Z–A)</option>
              </select>
            </label>
            <label>
              <span class="sr-only">Filter by ENV</span>
              <select id="jr-template-filter-env" class="jr-input" aria-label="Filter by ENV">
                <option value="all">All Env</option>
              </select>
            </label>
            <label class="jr-tags-filter" aria-label="Filter by tags">
              <span class="sr-only">Filter by Tags</span>
              <div id="jr-template-filter-tags" class="jr-tags-input" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-owns="jr-tags-filter-suggestions" aria-multiselectable="true">
                <div id="jr-tags-filter-selected" class="jr-tags-selected" aria-live="polite"></div>
                <div class="jr-tags-anchor">
                  <input id="jr-tags-filter-input" type="text" class="jr-input jr-input-inline" placeholder="Tags" aria-autocomplete="list" aria-controls="jr-tags-filter-suggestions" aria-label="Add tag filter" />
                  <div id="jr-tags-filter-suggestions" class="jr-tags-suggestions" role="listbox" style="display:none"></div>
                </div>
              </div>
            </label>
          <button id="jr-template-create-btn" class="btn btn-primary" aria-label="Create New Template">New</button>
          </div>
          <div id="jr-template-list" class="jr-template-cards" aria-label="Templates list"></div>
        </div>

      </div>
    </div>
    <!-- Global Modals and Overlays (moved outside hidden template tab) -->
    <!-- Template Modal Overlay and Dialog -->
    <div id="jr-template-modal-overlay" class="jr-modal-overlay" style="display:none" aria-hidden="true"></div>
    <div id="jr-template-modal" class="jr-modal" role="dialog" aria-modal="true" aria-labelledby="jr-template-modal-title" style="display:none">
      <div class="jr-modal-content">
        <div class="jr-modal-header">
          <h3 id="jr-template-modal-title">Create Template</h3>
          <button id="jr-template-modal-close" class="btn btn-icon btn-sm-xs" aria-label="Close modal" title="Close">×</button>
        </div>
          <div class="jr-modal-body">
          <div class="jr-controls">
            <label class="jr-field">
              <span>Template Name <span class="setting-required" title="Required" aria-hidden="true">*</span></span>
              <input id="jr-template-name" class="jr-input" type="text" placeholder="Unique name" aria-required="true" />
              <div class="jr-error" id="jr-template-name-error" style="display:none"></div>
            </label>
            <label class="jr-field">
              <span>ENV <span class="setting-required" title="Required" aria-hidden="true">*</span></span>
              <select id="jr-template-env" class="jr-input" aria-required="true"></select>
              <div class="jr-error" id="jr-template-env-error" style="display:none"></div>
            </label>
            <label class="jr-field">
              <span>Tags</span>
              <div id="jr-template-tags" class="jr-tags-input" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-owns="jr-template-tags-suggestions" aria-multiselectable="true">
                <div id="jr-template-tags-selected" class="jr-tags-selected" aria-live="polite"></div>
                <div class="jr-tags-anchor">
                  <input id="jr-template-tags-input" type="text" class="jr-input jr-input-inline" placeholder="Add tags (enter to add)" aria-autocomplete="list" aria-controls="jr-template-tags-suggestions" aria-label="Add tags" />
                  <div id="jr-template-tags-suggestions" class="jr-tags-suggestions" role="listbox" style="display:none"></div>
                </div>
              </div>
              <div class="jr-hint" id="jr-template-tags-hint"></div>
              <div class="jr-error" id="jr-template-tags-error" style="display:none"></div>
            </label>
          </div>
          <div class="jr-sql">
            <div class="jr-sql-header">
              <label for="jr-template-sql-editor"><span>SQL Query (Template)</span></label>
            </div>
            <div id="jr-template-sql-editor" class="jr-monaco-editor"></div>
            <div class="jr-hint" id="jr-template-hint"></div>
          </div>
        </div>
        <div class="jr-modal-footer">
          <button id="jr-template-modal-save" class="btn btn-primary btn-sm-xs">Save</button>
          <button id="jr-template-modal-cancel" class="btn btn-sm-xs">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Confirm Delete Modal -->
    <div id="jr-confirm-modal" class="jr-modal" role="dialog" aria-modal="true" aria-labelledby="jr-confirm-modal-title" style="display:none">
      <div class="jr-modal-content">
        <div class="jr-modal-header">
          <h3 id="jr-confirm-modal-title" class="jr-modal-title">Confirm Deletion</h3>
          <button id="jr-confirm-close" class="btn btn-icon" aria-label="Close">✕</button>
        </div>
        <div class="jr-modal-body">
          <p id="jr-confirm-message">Are you sure you want to delete this template?</p>
        </div>
        <div class="jr-modal-footer">
          <button id="jr-confirm-delete-btn" class="btn btn-danger btn-sm-xs">Delete</button>
          <button id="jr-confirm-cancel-btn" class="btn btn-sm-xs">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Split Query Modal Overlay -->
    <div id="jr-split-modal-overlay" class="jr-modal-overlay jr-split-overlay" style="display:none" aria-hidden="true"></div>
    <!-- Split Query Modal -->
    <div id="jr-split-modal" class="jr-modal" role="dialog" aria-modal="true" aria-labelledby="jr-split-modal-title" style="display:none">
      <div class="jr-modal-content jr-split-modal-content">
        <div class="jr-modal-header">
          <h3 id="jr-split-modal-title" class="jr-modal-title">Split Query</h3>
          <div class="jr-modal-header-actions">
            <button id="jr-split-minimize" class="btn btn-icon btn-sm-xs" aria-label="Minimize to background" title="Run in background">−</button>
            <button id="jr-split-modal-close" class="btn btn-icon btn-sm-xs" aria-label="Close modal" title="Close">×</button>
          </div>
        </div>
        <div class="jr-modal-body jr-split-body" aria-live="polite">
          <aside class="jr-split-sidebar" aria-label="Chunk navigation">
            <div class="jr-split-summary">
              <div id="jr-split-chunk-label" class="jr-split-chunk-label">Chunk 1 of 1</div>
              <div id="jr-split-progress" class="jr-split-progress" aria-live="polite"></div>
            </div>
            <nav class="jr-split-nav" aria-label="Chunks list">
              <ul id="jr-split-chunks-list" class="jr-split-chunks-list"></ul>
            </nav>
            <div class="jr-split-controls">
              <button id="jr-split-prev" class="btn btn-sm-xs" aria-label="Previous chunk">Prev</button>
              <button id="jr-split-next" class="btn btn-sm-xs" aria-label="Next chunk">Next</button>
            </div>
          </aside>
          <section class="jr-split-editor-panel" aria-label="Chunk content">
            <div class="jr-sql-header">
              <label for="jr-split-editor"><span>SQL Chunk</span></label>
            </div>
          <div id="jr-split-editor" class="jr-monaco-editor" aria-readonly="true"></div>
          <div class="jr-hint">Chunks are read-only; use the main editor to modify.</div>
          <pre id="jr-split-mini-log" class="jr-mini-log" aria-live="polite"></pre>
        </section>
      </div>
        <div class="jr-modal-footer jr-split-footer">
          <button id="jr-split-execute-all" class="btn btn-primary btn-sm-xs">Execute All</button>
          <button id="jr-split-cancel" class="btn btn-sm-xs">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Minimized Split Progress Indicator (floating) -->
    <div id="jr-split-minimized" class="jr-split-minimized" style="display:none" role="status" aria-live="polite">
      <div class="jr-split-minimized-content">
        <span class="jr-split-minimized-icon">⏳</span>
        <span id="jr-split-minimized-text">Running splits...</span>
      </div>
      <button id="jr-split-maximize" class="btn btn-sm-xs" aria-label="Show split modal">Show</button>
    </div>
  </div>
`;
