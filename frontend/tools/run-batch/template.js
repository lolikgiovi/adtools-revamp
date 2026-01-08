export const RunBatchTemplate = /*html*/ `
  <div class="run-batch">
    <div class="tabs-container rb-tabs" aria-label="Run Batch tabs">
      <div class="tabs-left" role="tablist">
        <button class="tab-button active" id="rb-tab-run-btn" role="tab" aria-selected="true" aria-controls="rb-tab-run">Run Batch</button>
        <button class="tab-button" id="rb-tab-history-btn" role="tab" aria-selected="false" aria-controls="rb-tab-history">History</button>
      </div>
      <div class="rb-status" data-role="status">Ready</div>
    </div>

    <div id="rb-tab-run" role="tabpanel" aria-labelledby="rb-tab-run-btn">
      <div class="rb-run-content">
        <div class="rb-form-section">
          <div class="rb-form">
            <div class="rb-field">
              <label for="rb-env">Environment <span class="setting-required">*</span></label>
              <select id="rb-env" class="rb-input" aria-required="true">
                <option value="">Loading...</option>
              </select>
              <div class="rb-error" id="rb-env-error" style="display:none"></div>
            </div>

            <div class="rb-field">
              <label for="rb-batch-name">Batch Name <span class="setting-required">*</span></label>
              <input type="text" id="rb-batch-name" class="rb-input" placeholder="e.g. campaign-batch" aria-required="true" />
              <div class="rb-hint">The batch identifier in Jenkins</div>
            </div>

            <div class="rb-field">
              <label for="rb-job-name">Job Name <span class="setting-required">*</span></label>
              <input type="text" id="rb-job-name" class="rb-input" placeholder="e.g. campaign-cc-from-edm" aria-required="true" />
              <div class="rb-hint">The specific job to execute within the batch</div>
            </div>

            <div class="rb-actions">
              <button id="rb-run-btn" class="btn btn-primary" disabled>Run Batch</button>
              <button id="rb-save-btn" class="btn btn-secondary">Save Config</button>
            </div>
          </div>
        </div>

        <div class="rb-saved-section">
          <div class="rb-list-controls" role="toolbar" aria-label="Saved config controls">
            <label class="rb-search-control">
              <span class="sr-only">Search</span>
              <input id="rb-config-search" type="text" class="rb-input" placeholder="Search saved configs" aria-label="Search saved configs" />
            </label>
          </div>
          <div id="rb-saved-list" class="rb-saved-list" aria-label="Saved batch configurations">
            <p class="rb-empty-message">No saved configurations yet</p>
          </div>
        </div>
      </div>

      <div class="rb-logs-section">
        <div class="rb-log-header">
          <div class="rb-log-title">
            <span>Build Logs</span>
            <span id="rb-build-number" class="rb-build-number" style="display:none"></span>
          </div>
          <div class="rb-log-header-right">
            <a id="rb-build-link" href="#" target="_blank" rel="noopener" style="display:none">Open Build</a>
          </div>
        </div>
        <pre id="rb-logs" class="rb-log"></pre>
      </div>
    </div>

    <div id="rb-tab-history" role="tabpanel" aria-labelledby="rb-tab-history-btn" style="display:none">
      <div class="rb-history">
        <table class="rb-history-table" aria-label="Run History">
          <colgroup>
            <col class="rb-col-time" />
            <col class="rb-col-config" />
            <col class="rb-col-env" />
            <col class="rb-col-status" />
            <col class="rb-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Time</th>
              <th>Config</th>
              <th>ENV</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="rb-history-list"></tbody>
        </table>
        <p id="rb-history-empty" class="rb-empty-message">No history yet</p>
      </div>
    </div>
  </div>

  <!-- Save Config Modal -->
  <div id="rb-save-modal-overlay" class="rb-modal-overlay" style="display:none" aria-hidden="true"></div>
  <div id="rb-save-modal" class="rb-modal" role="dialog" aria-modal="true" aria-labelledby="rb-save-modal-title" style="display:none">
    <div class="rb-modal-content">
      <div class="rb-modal-header">
        <h3 id="rb-save-modal-title">Save Configuration</h3>
        <button id="rb-save-modal-close" class="rb-modal-close-btn" aria-label="Close modal" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18"></path>
            <path d="M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="rb-modal-body">
        <div class="rb-field">
          <label for="rb-config-name">Configuration Name <span class="setting-required">*</span></label>
          <input type="text" id="rb-config-name" class="rb-input" placeholder="e.g. Campaign Batch DEV" aria-required="true" />
          <div class="rb-error" id="rb-config-name-error" style="display:none"></div>
        </div>
        <div class="rb-field">
          <label for="rb-config-conflu-link">Confluence Page Link</label>
          <input type="text" id="rb-config-conflu-link" class="rb-input" placeholder="https://confluence.example.com/..." />
          <div class="rb-hint">Optional: Link to batch documentation page</div>
        </div>
      </div>
      <div class="rb-modal-footer">
        <button id="rb-save-modal-cancel" class="btn btn-secondary">Cancel</button>
        <button id="rb-save-modal-confirm" class="btn btn-primary">Save</button>
      </div>
    </div>
  </div>

  <!-- Edit Config Modal -->
  <div id="rb-edit-modal" class="rb-modal" role="dialog" aria-modal="true" aria-labelledby="rb-edit-modal-title" style="display:none">
    <div class="rb-modal-content">
      <div class="rb-modal-header">
        <h3 id="rb-edit-modal-title">Edit Configuration</h3>
        <button id="rb-edit-modal-close" class="rb-modal-close-btn" aria-label="Close modal" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18"></path>
            <path d="M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="rb-modal-body">
        <input type="hidden" id="rb-edit-config-id" />
        <div class="rb-field">
          <label for="rb-edit-config-name">Configuration Name <span class="setting-required">*</span></label>
          <input type="text" id="rb-edit-config-name" class="rb-input" placeholder="e.g. Campaign Batch DEV" aria-required="true" />
          <div class="rb-error" id="rb-edit-config-name-error" style="display:none"></div>
        </div>
        <div class="rb-field">
          <label for="rb-edit-batch-name">Batch Name <span class="setting-required">*</span></label>
          <input type="text" id="rb-edit-batch-name" class="rb-input" placeholder="e.g. campaign-batch" aria-required="true" />
        </div>
        <div class="rb-field">
          <label for="rb-edit-job-name">Job Name <span class="setting-required">*</span></label>
          <input type="text" id="rb-edit-job-name" class="rb-input" placeholder="e.g. campaign-cc-from-edm" aria-required="true" />
        </div>
        <div class="rb-field">
          <label for="rb-edit-conflu-link">Confluence Page Link</label>
          <input type="text" id="rb-edit-conflu-link" class="rb-input" placeholder="https://confluence.example.com/..." />
          <div class="rb-hint">Optional: Link to batch documentation page</div>
        </div>
      </div>
      <div class="rb-modal-footer">
        <button id="rb-edit-modal-cancel" class="btn btn-secondary">Cancel</button>
        <button id="rb-edit-modal-confirm" class="btn btn-primary">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- Confirm Delete Modal -->
  <div id="rb-confirm-modal" class="rb-modal" role="dialog" aria-modal="true" aria-labelledby="rb-confirm-modal-title" style="display:none">
    <div class="rb-modal-content">
      <div class="rb-modal-header">
        <h3 id="rb-confirm-modal-title" class="rb-modal-title">Confirm Deletion</h3>
        <button id="rb-confirm-close" class="rb-modal-close-btn" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18"></path>
            <path d="M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="rb-modal-body">
        <p id="rb-confirm-message">Are you sure you want to delete this configuration?</p>
      </div>
      <div class="rb-modal-footer">
        <button id="rb-confirm-cancel-btn" class="btn btn-secondary">Cancel</button>
        <button id="rb-confirm-delete-btn" class="btn btn-danger">Delete</button>
      </div>
    </div>
  </div>
`;
