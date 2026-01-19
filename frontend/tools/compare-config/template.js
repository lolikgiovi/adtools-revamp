/**
 * Compare Config HTML Template
 * Contains the UI structure for Oracle database configuration comparison
 */

export const CompareConfigTemplate = /* html */ `
<div class="compare-config-container tool-container">
    <!-- Oracle Client Installation Guide (shown when client not installed) -->
    <div id="installation-guide" class="installation-guide" style="display: none;">
        <div class="installation-card">
            <div class="installation-header">
                <h2>Oracle Instant Client Required</h2>
                <p>The Compare Config feature requires Oracle Instant Client to be installed.</p>
            </div>

            <div class="installation-steps">
                <h3>Installation Options:</h3>

                <div class="installation-method">
                    <h4>Option 1: Automatic Installation (Recommended)</h4>
                    <p>Run this command in your terminal:</p>
                    <div class="command-box">
                        <code id="install-command">curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash</code>
                        <button class="btn btn-primary btn-sm btn-copy-command" title="Copy command">Copy</button>
                    </div>
                </div>

                <div class="installation-method">
                    <h4>Option 2: Manual Installation</h4>
                    <ol>
                        <li>Download Oracle Instant Client for macOS:</li>
                        <ul>
                            <li><a href="https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html" target="_blank">ARM64 (Apple Silicon)</a></li>
                            <li><a href="https://www.oracle.com/database/technologies/instant-client/macos-intel-x86-downloads.html" target="_blank">x86_64 (Intel)</a></li>
                        </ul>
                        <li>Extract the downloaded DMG file</li>
                        <li>Copy contents to: <code>~/Documents/adtools_library/oracle_instantclient/</code></li>
                        <li>Create symlink: <code>ln -s libclntsh.dylib.* libclntsh.dylib</code></li>
                    </ol>
                </div>
            </div>

            <div class="installation-actions">
                <button class="btn btn-primary" id="btn-check-again">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                    Check Again
                </button>
            </div>
        </div>
    </div>

    <!-- Main Tool Interface (shown when client is installed) -->
    <div id="main-interface" class="main-interface">
        <!-- Query Mode Tabs -->
        <div class="tabs-container">
            <div class="tabs-left">
                <button class="tab-button active" data-tab="schema-table">Schema/Table</button>
                <button class="tab-button" data-tab="raw-sql">Raw SQL</button>
                <button class="tab-button" data-tab="excel-compare">Excel Compare</button>
            </div>
            <div class="tabs-right">
                <!-- Connection Status Indicator (Tauri modes only) -->
                <div id="connection-status" class="connection-status tauri-only" style="display: none;">
                    <span class="connection-indicator"></span>
                    <div class="connection-list">
                        <!-- Connection chips will be populated here -->
                    </div>
                    <button class="btn btn-ghost btn-xs btn-close-connections" title="Close all connections">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>
        </div>

        <!-- Desktop-Only Feature Notice (shown in Web mode for Schema/Table and Raw SQL) -->
        <div id="desktop-only-notice" class="desktop-only-notice" style="display: none;">
            <div class="notice-card">
                <div class="notice-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                        <line x1="8" y1="21" x2="16" y2="21"></line>
                        <line x1="12" y1="17" x2="12" y2="21"></line>
                    </svg>
                </div>
                <h3>Desktop App Required</h3>
                <p>The <strong id="desktop-feature-name">Schema/Table</strong> comparison mode requires the AD Tools desktop application to connect to Oracle databases.</p>
                <div class="notice-actions">
                    <button class="btn btn-primary" id="btn-switch-to-excel">
                        Use Excel Compare Instead
                    </button>
                </div>
                <p class="notice-hint">Excel Compare works in both desktop and web versions.</p>
            </div>
        </div>

        <!-- Environment Selection -->
        <div class="environment-selection">
            <div class="selection-card">
                <div class="selection-grid">
                    <!-- Connections Row -->
                    <div class="grid-row">
                        <div class="form-group">
                            <label for="env1-connection">Env 1 (Reference)</label>
                            <select id="env1-connection" class="form-select">
                                <option value="">Select connection...</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="env2-connection">Env 2 (Comparison)</label>
                            <select id="env2-connection" class="form-select">
                                <option value="">Select connection...</option>
                            </select>
                        </div>
                    </div>

                    <!-- Schema & Table Row -->
                    <div class="grid-row">
                        <div class="form-group">
                            <label for="schema-select">Schema</label>
                            <select id="schema-select" class="form-select" disabled>
                                <option value="">Select connections first...</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="table-select">Table</label>
                            <select id="table-select" class="form-select" disabled>
                                <option value="">Select schema first...</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Validation Message -->
                <div id="validation-message" class="validation-message" style="display: none;"></div>
            </div>
        </div>

        <!-- Raw SQL Mode (shown when Raw SQL tab is active) -->
        <div id="raw-sql-mode" class="raw-sql-mode" style="display: none;">
            <div class="raw-sql-connections">
                <div class="grid-row">
                    <div class="form-group">
                        <label for="raw-env1-connection">Env 1 (Reference)</label>
                        <select id="raw-env1-connection" class="form-select">
                            <option value="">Select connection...</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="raw-env2-connection">Env 2 (Comparison)</label>
                        <select id="raw-env2-connection" class="form-select">
                            <option value="">Select connection...</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="raw-sql-editor">
                <div class="editor-header">
                    <h3>SQL Query</h3>
                </div>
                <textarea id="raw-sql" class="raw-sql-input" placeholder="Full SQL Query, for example:\nSELECT field_name_1, field_name_2, field_name_3 FROM schema_name.table_name\nWHERE field_key_1 IN ('a', 'b', 'c') AND field_key_2 = 0;"></textarea>
            </div>

            <div class="filter-row">
                <div class="where-clause-section">
                    <label for="raw-primary-key">Primary Key to Compare (Optional)</label>
                    <input type="text" id="raw-primary-key" class="form-input" placeholder="e.g., c.parameter_key or id">
                    <p class="help-text">Specify the field(s) to use as primary key. Use aliases if defined in the query (e.g., c.parameter_key). Leave empty to auto-detect from first column. For composite keys, separate with commas.</p>
                </div>

                <div class="max-rows-section">
                    <label for="raw-max-rows">Max Rows to Fetch</label>
                    <input type="number" id="raw-max-rows" class="form-input" value="100" min="1" max="10000" placeholder="100">
                    <p class="help-text">Maximum rows to fetch from each environment</p>
                </div>
            </div>

            <div class="raw-sql-actions">
                <button class="btn btn-primary" id="btn-compare-raw-sql">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                    Compare Query Result from Both Environments
                </button>
            </div>
        </div>

        <!-- Excel Compare Mode (shown when Excel Compare tab is active) -->
        <div id="excel-compare-mode" class="excel-compare-mode" style="display: none;">
            <!-- Step 1: File Upload -->
            <div class="excel-file-selection">
                <div class="grid-row">
                    <!-- Reference Files -->
                    <div class="file-upload-zone" id="ref-upload-zone">
                        <div class="upload-zone-header">
                            <h4>Reference Files</h4>
                            <button class="btn btn-ghost btn-xs btn-clear-files" id="ref-clear-all" style="display: none;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                                Clear All
                            </button>
                        </div>
                        <div class="upload-area">
                            <p>Click to <a href="#" class="browse-link" id="ref-browse">browse files</a> or <a href="#" class="browse-link" id="ref-folder-browse">select folder</a>, supports .xlsx, .xls</p>
                            <input type="file" id="ref-file-input" multiple accept=".xlsx,.xls,.csv" style="display: none;">
                            <input type="file" id="ref-folder-input" webkitdirectory style="display: none;">
                        </div>
                        <div class="file-list" id="ref-file-list"></div>
                    </div>

                    <!-- Comparator Files -->
                    <div class="file-upload-zone" id="comp-upload-zone">
                        <div class="upload-zone-header">
                            <h4>Comparator Files</h4>
                            <button class="btn btn-ghost btn-xs btn-clear-files" id="comp-clear-all" style="display: none;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                                Clear All
                            </button>
                        </div>
                        <div class="upload-area">
                            <p>Click to <a href="#" class="browse-link" id="comp-browse">browse files</a> or <a href="#" class="browse-link" id="comp-folder-browse">select folder</a>, supports .xlsx, .xls</p>
                            <input type="file" id="comp-file-input" multiple accept=".xlsx,.xls,.csv" style="display: none;">
                            <input type="file" id="comp-folder-input" webkitdirectory style="display: none;">
                        </div>
                        <div class="file-list" id="comp-file-list"></div>
                    </div>
                </div>
            </div>

            <!-- Step 2: File Pairing Selection (shown after files uploaded) -->
            <div id="excel-file-pairing" class="excel-file-pairing" style="display: none;">
                <div class="pairing-dropdowns">
                    <div class="form-group">
                        <label for="excel-ref-file-search">Reference File</label>
                        <div class="searchable-select" id="excel-ref-file-wrapper">
                            <input type="text" class="form-input searchable-input"
                                   id="excel-ref-file-search" placeholder="Search or select file..." autocomplete="off">
                            <div class="searchable-dropdown" id="excel-ref-file-dropdown"></div>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="excel-comp-file-search">Comparator File</label>
                        <div class="searchable-select" id="excel-comp-file-wrapper">
                            <input type="text" class="form-input searchable-input"
                                   id="excel-comp-file-search" placeholder="Auto-matched or search..." autocomplete="off">
                            <div class="searchable-dropdown" id="excel-comp-file-dropdown"></div>
                        </div>
                        <p class="help-text" id="comp-match-hint"></p>
                    </div>
                </div>
            </div>

            <!-- Step 3: Field Selection (shown after file pair selected) -->
            <div id="excel-field-selection" class="field-selection excel-field-selection" style="display: none;">
                <div class="file-pair-info">
                    <span class="file-badge ref" id="excel-ref-file-badge"></span>
                    <span class="vs-label">vs</span>
                    <span class="file-badge comp" id="excel-comp-file-badge"></span>
                </div>

                <!-- Column Mismatch Warning -->
                <div id="excel-column-warning" class="column-warning" style="display: none;"></div>

                <div class="field-header">
                    <h4 class="field-title">Primary Key Selection</h4>
                    <div class="field-actions">
                        <button class="btn btn-ghost btn-sm" id="btn-excel-select-all-pk">Select All</button>
                        <button class="btn btn-ghost btn-sm" id="btn-excel-deselect-all-pk">Clear</button>
                    </div>
                </div>
                <p class="field-help">Select fields to use as primary key for comparison</p>
                <div id="excel-pk-field-list" class="field-list"></div>

                <div class="field-header" style="margin-top: 24px;">
                    <h4 class="field-title">Fields to Compare</h4>
                    <div class="field-actions">
                        <button class="btn btn-ghost btn-sm" id="btn-excel-select-all-fields">Select All</button>
                        <button class="btn btn-ghost btn-sm" id="btn-excel-deselect-all-fields">Clear</button>
                    </div>
                </div>
                <p class="field-help">Select fields to include in comparison</p>
                <div id="excel-field-list" class="field-list"></div>

                <!-- Comparison Options -->
                <div class="excel-comparison-options">
                    <div class="settings-row">
                        <div class="setting-group">
                            <label>Row Matching:</label>
                            <div class="radio-group">
                                <label class="radio-label">
                                    <input type="radio" name="excel-row-matching" value="key" checked>
                                    <span>By Primary Key</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="excel-row-matching" value="position">
                                    <span>By Row Position</span>
                                </label>
                            </div>
                        </div>

                        <div class="setting-group">
                            <label>Data Comparison:</label>
                            <div class="radio-group">
                                <label class="radio-label">
                                    <input type="radio" name="excel-data-comparison" value="strict" checked>
                                    <span>Strict (as-is)</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="excel-data-comparison" value="normalized">
                                    <span>Normalized</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="comparison-actions">
                    <button class="btn btn-primary" id="btn-excel-compare">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                        Compare
                    </button>
                </div>
            </div>
        </div>

        <!-- Field Selection (shown after table is selected) -->
        <div id="field-selection" class="field-selection" style="display: none;">
            <div class="field-header">
                <h4 class="field-title">Primary Key Selection</h4>
                <div class="field-actions">
                    <button class="btn btn-ghost btn-sm" id="btn-select-all-pk">Select All</button>
                    <button class="btn btn-ghost btn-sm" id="btn-deselect-all-pk">Clear</button>
                </div>
            </div>
            <p class="field-help">Select fields to use as primary key for comparison</p>

            <div id="pk-field-list" class="field-list">
                <!-- PK fields will be populated here -->
            </div>

            <div class="field-header" style="margin-top: 24px;">
                <h4 class="field-title">Field Selection</h4>
                <div class="field-actions">
                    <button class="btn btn-ghost btn-sm" id="btn-select-all">Select All</button>
                    <button class="btn btn-ghost btn-sm" id="btn-deselect-all">Clear</button>
                </div>
            </div>
            <p class="field-help">Select fields to display and compare</p>

            <div id="field-list" class="field-list">
                <!-- Fields will be populated here -->
            </div>

            <div class="filter-row">
                <div class="where-clause-section">
                    <label for="where-clause">WHERE Clause (optional):</label>
                    <input type="text" id="where-clause" class="form-input" placeholder="e.g., status = 'active'">
                    <p class="help-text">Enter a WHERE clause to filter records (do not include 'WHERE' keyword)</p>
                </div>

                <div class="max-rows-section">
                    <label for="max-rows">Max Rows to Fetch:</label>
                    <input type="number" id="max-rows" class="form-input" value="100" min="1" max="10000" placeholder="100">
                    <p class="help-text">Maximum rows to fetch from each environment</p>
                </div>
            </div>

            <div class="comparison-actions">
                <button class="btn btn-primary" id="btn-compare">Compare Configs</button>
            </div>
        </div>

        <!-- Progress Overlay -->
        <div id="progress-overlay" class="progress-overlay" style="display: none;">
            <div class="progress-card">
                <div class="progress-header">
                    <div class="progress-spinner"></div>
                    <h3 id="progress-title">Comparing Configurations</h3>
                </div>
                <div class="progress-steps">
                    <div class="progress-step" id="step-env1">
                        <div class="step-icon pending">○</div>
                        <div class="step-content">
                            <div class="step-label">Connecting to Env 1</div>
                            <div class="step-detail" id="step-env1-detail">—</div>
                        </div>
                    </div>
                    <div class="progress-step" id="step-env2">
                        <div class="step-icon pending">○</div>
                        <div class="step-content">
                            <div class="step-label">Connecting to Env 2</div>
                            <div class="step-detail" id="step-env2-detail">—</div>
                        </div>
                    </div>
                    <div class="progress-step" id="step-fetch">
                        <div class="step-icon pending">○</div>
                        <div class="step-content">
                            <div class="step-label">Fetching data</div>
                            <div class="step-detail" id="step-fetch-detail">—</div>
                        </div>
                    </div>
                    <div class="progress-step" id="step-compare">
                        <div class="step-icon pending">○</div>
                        <div class="step-content">
                            <div class="step-label">Comparing records</div>
                            <div class="step-detail" id="step-compare-detail">—</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Results Section -->
        <div id="results-section" class="results-section" style="display: none;">
            <div class="results-header">
                <div class="header-left">
                    <h3 id="results-title">Comparison Results</h3>
                    <div class="view-selector">
                        <label>View:</label>
                        <select id="view-type" class="form-select">
                            <option value="grid">Summary Grid</option>
                            <option value="vertical">Cards</option>
                            <option value="master-detail">Detail View</option>
                        </select>
                    </div>
                </div>
                <div class="results-actions">
                    <button class="btn btn-secondary btn-sm" id="btn-export-json">Export JSON</button>
                    <button class="btn btn-secondary btn-sm" id="btn-export-csv">Export CSV</button>
                    <button class="btn btn-primary btn-sm" id="btn-new-comparison">New Comparison</button>
                </div>
            </div>

            <!-- Summary -->
            <div id="results-summary" class="results-summary">
                <!-- Summary will be populated here -->
            </div>

            <!-- Results Content -->
            <div id="results-content" class="results-content">
                <!-- Results will be populated here based on selected view -->
            </div>
        </div>
    </div>

    <!-- Generic Modal for Pairing & Config -->
    <div id="excel-modal-overlay" class="modal-overlay" style="display: none;">
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="excel-modal-title">Config</h3>
                <button class="btn btn-ghost btn-sm btn-close-modal">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div id="excel-modal-body" class="modal-body">
                <!-- Content injected via JS -->
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="btn-modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="btn-modal-save">Save</button>
            </div>
        </div>
    </div>
</div>
`;
