/**
 * Merge SQL HTML Template
 * Contains the UI structure for SQL file merging tool
 */

export const MergeSqlTemplate = /* html */ `
<div class="merge-sql-container tool-container">
  <div class="merge-sql-layout">
    <!-- Left Column -->
    <div class="merge-sql-left-col">
      <!-- Mode Toggle -->
      <div class="tabs-container mode-toggle-bar" id="merge-sql-mode-toggle">
        <div class="tabs-left">
          <button class="tab-button mode-toggle-btn active" data-mode="files">Files</button>
          <button class="tab-button mode-toggle-btn" data-mode="sql">Modified Merged SQL</button>
        </div>
      </div>

      <!-- Left Panel -->
      <div class="merge-sql-left-panel">

      <!-- Files Mode -->
      <div class="mode-section" id="merge-sql-input-files">
        <div class="panel-header">
          <div class="panel-actions">
            <button class="btn btn-ghost btn-xs" id="merge-sql-add-files" title="Add SQL files">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <line x1="9" y1="15" x2="15" y2="15"></line>
              </svg>
              Add Files
            </button>
            <button class="btn btn-ghost btn-xs" id="merge-sql-add-folder" title="Add folder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                <line x1="12" y1="11" x2="12" y2="17"></line>
                <line x1="9" y1="14" x2="15" y2="14"></line>
              </svg>
              Add Folder
            </button>
            <button class="btn btn-ghost btn-xs" id="merge-sql-clear-files-btn" style="display: none;" title="Clear Files">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Clear Files
            </button>
          </div>
        </div>

        <div class="folder-name-input">
          <label for="merge-sql-folder-name">Output Name</label>
          <input type="text" id="merge-sql-folder-name" class="form-input" placeholder="Enter output file name prefix..." value="MERGED">
        </div>

        <div class="sort-controls">
          <span class="sort-label">Sort:</span>
          <button class="btn btn-ghost btn-xs sort-btn active" id="merge-sql-sort-asc" title="Sort by table name A-Z">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12l7-7 7 7"/>
            </svg>
            A-Z
          </button>
          <button class="btn btn-ghost btn-xs sort-btn" id="merge-sql-sort-desc" title="Sort by table name Z-A">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 19V5M5 12l7 7 7-7"/>
            </svg>
            Z-A
          </button>
          <button class="btn btn-ghost btn-xs sort-btn" id="merge-sql-sort-manual" title="Drag table groups to reorder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="4" y1="6" x2="20" y2="6"></line>
              <line x1="4" y1="12" x2="20" y2="12"></line>
              <line x1="4" y1="18" x2="20" y2="18"></line>
            </svg>
            Manual
          </button>
          <span class="file-count-badge" id="merge-sql-file-count" style="display: none;">0 files</span>
        </div>

        <div class="file-list-container" id="merge-sql-file-list">
          <div class="file-list-empty" id="merge-sql-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <p>No SQL files added</p>
            <span class="hint">Use the buttons above to add .sql files</span>
          </div>
          <div class="file-list-items" id="merge-sql-file-items"></div>
        </div>

        <input type="file" id="merge-sql-file-input" multiple accept=".sql" style="display: none;">
        <input type="file" id="merge-sql-folder-input" webkitdirectory style="display: none;">

        <div class="merge-action">
          <button class="btn btn-primary" id="merge-sql-btn" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"></path>
              <path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"></path>
              <path d="M12 2v20"></path>
            </svg>
            MERGE SQLs
          </button>
          <button class="btn btn-ghost" id="merge-sql-clear-btn" style="display: none;">
            Clear All
          </button>
        </div>
      </div>

      <!-- SQL Mode -->
      <div class="mode-section" id="merge-sql-input-sql" style="display: none;">
        <div class="panel-header">
          <h3>Merged SQL</h3>
        </div>
        <div class="input-editor-container" id="merge-sql-input-editor"></div>
        <div class="merge-action">
          <button class="btn btn-primary" id="merge-sql-sql-refresh-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path>
              <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path>
            </svg>
            Refresh
          </button>
          <button class="btn btn-ghost" id="merge-sql-sql-clear-btn">
            Clear
          </button>
        </div>
      </div>
    </div>
    </div>

    <!-- Right Column -->
    <div class="merge-sql-right-col">
      <div class="merge-sql-result-tabs tabs-container" id="merge-sql-result-tabs">
        <div class="tabs-left" id="merge-sql-result-tabs-left">
          <!-- Tabs injected dynamically by mode -->
        </div>
      </div>
      <div class="merge-sql-right-panel">
        <div class="merge-sql-result-actions" id="merge-sql-result-actions">
          <div class="merge-sql-report-subtabs" id="merge-sql-report-subtabs">
            <button class="merge-sql-report-subtab active" data-subtab="summary">
              Summary
            </button>
            <button class="merge-sql-report-subtab" data-subtab="table-detail">
              Table Detail
            </button>
            <button class="merge-sql-report-subtab" data-subtab="squad-detail">
              Squad Detail
            </button>
          </div>
          <div class="merge-sql-generated-sql-subtabs" id="merge-sql-generated-subtabs" style="display: none;">
            <button class="merge-sql-generated-sql-subtab active" data-subtab="merged">
              Merged SQL
            </button>
            <button class="merge-sql-generated-sql-subtab" data-subtab="select">
              Select SQL
            </button>
            <button class="merge-sql-generated-sql-subtab" data-subtab="validation">
              Validation SQL
            </button>
          </div>
          <div class="merge-sql-result-actions-buttons">
            <button class="btn btn-ghost btn-xs" id="merge-sql-copy-btn" title="Copy">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy
            </button>
            <button class="btn btn-ghost btn-xs" id="merge-sql-download-btn" title="Download">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
            <button class="btn btn-primary btn-xs" id="merge-sql-download-all-btn" title="Download All">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              All
            </button>
          </div>
        </div>

      <!-- Insights Panel -->
      <div class="insights-panel insights-warning" id="merge-sql-insights" style="display: none;">
        <div class="insight-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </div>
        <div class="insight-content">
          <span class="insight-title" id="merge-sql-insight-title">Duplicate Queries Detected</span>
          <span class="insight-text" id="merge-sql-duplicates-text"></span>
        </div>
        <button class="btn btn-ghost btn-xs" id="merge-sql-view-duplicates" style="display: none;">View Duplicates</button>
        <button class="btn btn-ghost btn-xs" id="merge-sql-view-report" style="display: none;">View Report</button>
      </div>

      <!-- Result Content -->
      <div class="merge-sql-result-content" id="merge-sql-result-content">
        <div class="merge-sql-result-empty" id="merge-sql-result-empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>
          <p>Merged SQL will appear here</p>
          <span>Add files and click "MERGE SQLs" to start</span>
        </div>

        <!-- Report Tab Content -->
        <div class="merge-sql-tab-content" id="merge-sql-report-content" data-mode="both">
          <div class="merge-sql-report-subtab-content active" id="merge-sql-report-summary">
            <div class="report-content">
              <div class="report-section" id="merge-sql-report-dangerous"></div>
              <div class="report-section" id="merge-sql-report-statements"></div>
              <div class="report-section" id="merge-sql-report-squads"></div>
              <div class="report-section" id="merge-sql-report-features"></div>
              <div class="report-section" id="merge-sql-report-authors"></div>
            </div>
          </div>

          <div class="merge-sql-report-subtab-content" id="merge-sql-report-table-detail">
            <div class="report-content">
              <div class="report-section" id="merge-sql-report-table-squads"></div>
            </div>
          </div>

          <div class="merge-sql-report-subtab-content" id="merge-sql-report-squad-detail">
            <div class="report-content">
              <div class="report-section" id="merge-sql-report-squad-tables"></div>
            </div>
          </div>
        </div>

        <!-- Generated SQL Tab Content (Files mode) -->
        <div class="merge-sql-tab-content" id="merge-sql-generated-content" data-mode="files">
          <div class="merge-sql-generated-sql-subtab-content active" id="merge-sql-merged-subtab">
            <div class="monaco-editor-container" id="merge-sql-merged-editor"></div>
          </div>
          <div class="merge-sql-generated-sql-subtab-content" id="merge-sql-select-subtab">
            <div class="monaco-editor-container" id="merge-sql-select-editor"></div>
          </div>
          <div class="merge-sql-generated-sql-subtab-content" id="merge-sql-validation-subtab">
            <div class="monaco-editor-container" id="merge-sql-validation-editor"></div>
          </div>
        </div>

        <!-- Validation SQL Tab Content (SQL mode) -->
        <div class="merge-sql-tab-content" id="merge-sql-validation-tab-content" data-mode="sql">
          <div class="monaco-editor-container" id="merge-sql-validation-sql-editor"></div>
        </div>
      </div>
    </div>
    </div>
  </div>

  <!-- Duplicates Modal -->
  <div class="modal-overlay" id="merge-sql-duplicates-modal" style="display: none;">
    <div class="modal-content modal-lg">
      <div class="modal-header">
        <h3>Duplicate Queries</h3>
        <button class="btn btn-ghost btn-sm btn-close-modal" id="merge-sql-close-duplicates">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body" id="merge-sql-duplicates-list">
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="merge-sql-duplicates-close-btn">Close</button>
      </div>
    </div>
  </div>

</div>
`;
