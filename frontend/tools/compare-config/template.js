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
        <!-- Tabs Header -->
        <div class="tabs-container">
            <div class="tabs-left">
                <div class="tool-tabs">
                    <button class="tool-tab active" data-tab="compare" id="tab-compare">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                        Single Comparison
                    </button>
                    <!-- Bulk Select tab hidden for now - needs more work -->
                    <!-- <button class="tool-tab" data-tab="bulk-select" id="tab-bulk-select">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 6h16M4 12h16M4 18h16"></path>
                        </svg>
                        Bulk Select
                    </button> -->
                </div>
            </div>
            <div class="tabs-right">
                <!-- Sidecar Status Indicator (Tauri modes only) -->
                <div id="sidecar-status-indicator" class="sidecar-status-indicator tauri-only">
                    <span class="status-dot stopped"></span>
                    <span class="status-text">Disconnected</span>
                    <button class="btn-sidecar-restart" id="btn-sidecar-restart" title="Restart Oracle sidecar" style="display: none;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                    </button>
                </div>
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

        <!-- Compare Tab Content -->
        <div id="tab-content-compare" class="tab-content active">
        <!-- Unified Compare Mode -->
        <div id="unified-compare-mode" class="unified-compare-mode">

            <!-- Source Panels -->
            <div class="source-panels">
                <!-- Source A (Reference) -->
                <div class="source-panel source-a">
                    <div class="source-panel-header">
                        <h4>Source A (Reference)</h4>
                        <div class="source-type-selector-inline">
                            <label class="source-type-btn" title="Oracle Database">
                                <input type="radio" name="source-a-type" value="oracle" id="source-a-type-oracle">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                                </svg>
                                <span>Oracle</span>
                            </label>
                            <label class="source-type-btn" title="Excel/CSV File">
                                <input type="radio" name="source-a-type" value="excel" id="source-a-type-excel">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                <span>Excel</span>
                            </label>
                        </div>
                        <span class="source-status" id="source-a-status">Not loaded</span>
                    </div>

                    <!-- Oracle Config (shown when Oracle selected) -->
                    <div class="oracle-config" id="source-a-oracle-config" style="display: none;">
                        <!-- Connection & Query Mode Row -->
                        <div class="oracle-config-row">
                            <div class="form-group connection-group">
                                <label>Connection</label>
                                <div class="config-dropdown" id="source-a-connection-wrapper">
                                    <button type="button" class="btn btn-secondary config-dropdown-btn" id="source-a-connection-btn">
                                        <span id="source-a-connection-label">Select connection...</span>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="6 9 12 15 18 9"></polyline>
                                        </svg>
                                    </button>
                                    <div class="config-dropdown-menu" id="source-a-connection-dropdown"></div>
                                </div>
                            </div>
                            <div class="form-group query-mode-group">
                                <label>Query Mode</label>
                                <div class="config-dropdown" id="source-a-query-mode-wrapper">
                                    <button type="button" class="btn btn-secondary config-dropdown-btn" id="source-a-query-mode-btn">
                                        <span id="source-a-query-mode-label">By Table</span>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="6 9 12 15 18 9"></polyline>
                                        </svg>
                                    </button>
                                    <div class="config-dropdown-menu" id="source-a-query-mode-dropdown">
                                        <button class="config-dropdown-option active" data-value="table">By Table</button>
                                        <button class="config-dropdown-option" data-value="sql">By Raw SQL</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Table Mode Config -->
                        <div class="table-mode-config" id="source-a-table-config">
                            <div class="schema-table-row">
                                <div class="form-group">
                                    <label>Schema</label>
                                    <div class="searchable-select" id="source-a-schema-wrapper">
                                        <input type="text" class="form-input searchable-input"
                                               id="source-a-schema-search" placeholder="Select connection first..." autocomplete="off" disabled>
                                        <div class="searchable-dropdown" id="source-a-schema-dropdown"></div>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>Table</label>
                                    <div class="searchable-select" id="source-a-table-wrapper">
                                        <input type="text" class="form-input searchable-input"
                                               id="source-a-table-search" placeholder="Select schema first..." autocomplete="off" disabled>
                                        <div class="searchable-dropdown" id="source-a-table-dropdown"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>WHERE Clause (optional)</label>
                                <input type="text" id="source-a-where" class="form-input"
                                       placeholder="STATUS = 'ACTIVE' AND ID > 100">
                                <span class="form-hint">Condition only, without WHERE keyword. Use AND/OR to combine.</span>
                            </div>
                        </div>

                        <!-- Raw SQL Mode Config -->
                        <div class="sql-mode-config" id="source-a-sql-config" style="display: none;">
                            <div class="form-group">
                                <label>SQL Query</label>
                                <textarea id="source-a-sql" class="form-textarea sql-input"
                                          placeholder="SELECT * FROM schema.table WHERE ..."></textarea>
                            </div>
                        </div>

                        <!-- Common Oracle Options -->
                        <div class="form-group">
                            <label>Max Rows</label>
                            <input type="number" id="source-a-max-rows" class="form-input"
                                   value="500" min="1" max="10000">
                        </div>
                    </div>

                    <!-- Excel Config (shown when Excel selected) - Enhanced with multi-file support -->
                    <div class="excel-config" id="source-a-excel-config" style="display: none;">
                        <div class="file-upload-zone compact" id="source-a-upload-zone">
                            <div class="upload-zone-header">
                                <span class="zone-label">Excel Files</span>
                                <div class="upload-zone-actions">
                                    <button class="btn btn-ghost btn-xs btn-browse" id="source-a-browse-files">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                            <polyline points="14 2 14 8 20 8"></polyline>
                                            <line x1="12" y1="18" x2="12" y2="12"></line>
                                            <line x1="9" y1="15" x2="15" y2="15"></line>
                                        </svg>
                                        Add Files
                                    </button>
                                    <button class="btn btn-ghost btn-xs btn-browse" id="source-a-browse-folder">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                            <line x1="12" y1="11" x2="12" y2="17"></line>
                                            <line x1="9" y1="14" x2="15" y2="14"></line>
                                        </svg>
                                        Add Folder
                                    </button>
                                    <button class="btn btn-ghost btn-xs btn-clear-files" id="source-a-clear-all" style="display: none;">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                        </svg>
                                        Clear All
                                    </button>
                                </div>
                            </div>
                            <input type="file" id="source-a-file-input" multiple accept=".xlsx,.xls,.csv" style="display: none;">
                            <input type="file" id="source-a-folder-input" webkitdirectory style="display: none;">
                            <div class="file-list" id="source-a-file-list"></div>
                        </div>

                        <!-- File Selection Dropdown (shown when files are uploaded) -->
                        <div class="file-selection-dropdown" id="source-a-file-selection" style="display: none;">
                            <label>Select File to Compare</label>
                            <div class="searchable-select" id="source-a-file-wrapper">
                                <input type="text" class="form-input searchable-input"
                                       id="source-a-file-search" placeholder="Search or select file..." autocomplete="off">
                                <div class="searchable-dropdown" id="source-a-file-dropdown"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Inline Validation Message -->
                    <div class="inline-validation" id="source-a-validation" style="display: none;">
                        <div class="validation-icon"></div>
                        <div class="validation-content">
                            <span class="validation-message-text"></span>
                            <span class="validation-hint"></span>
                        </div>
                    </div>

                    <!-- Data Preview -->
                    <div class="data-preview" id="source-a-preview" style="display: none;">
                        <div class="preview-header">
                            <span class="preview-label">Loaded</span>
                            <span class="preview-stats" id="source-a-stats"></span>
                        </div>
                    </div>
                </div>

                <!-- Source B (Comparator) -->
                <div class="source-panel source-b">
                    <div class="source-panel-header">
                        <h4>Source B (Comparator)</h4>
                        <div class="source-type-selector-inline">
                            <label class="source-type-btn" title="Oracle Database">
                                <input type="radio" name="source-b-type" value="oracle" id="source-b-type-oracle">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                                </svg>
                                <span>Oracle</span>
                            </label>
                            <label class="source-type-btn" title="Excel/CSV File">
                                <input type="radio" name="source-b-type" value="excel" id="source-b-type-excel">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                <span>Excel</span>
                            </label>
                        </div>
                        <span class="source-status" id="source-b-status">Not loaded</span>
                    </div>

                    <!-- Oracle Config -->
                    <div class="oracle-config" id="source-b-oracle-config" style="display: none;">
                        <!-- Connection & Query Mode Row -->
                        <div class="oracle-config-row">
                            <div class="form-group connection-group">
                                <label>Connection</label>
                                <div class="config-dropdown" id="source-b-connection-wrapper">
                                    <button type="button" class="btn btn-secondary config-dropdown-btn" id="source-b-connection-btn">
                                        <span id="source-b-connection-label">Select connection...</span>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="6 9 12 15 18 9"></polyline>
                                        </svg>
                                    </button>
                                    <div class="config-dropdown-menu" id="source-b-connection-dropdown"></div>
                                </div>
                                <!-- Follow Mode Badge (shown in Oracle vs Oracle mode) -->
                                <div class="follow-mode-badge" id="source-b-follow-mode-note" style="display: none;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                    </svg>
                                    <span>Following Source A</span>
                                </div>
                            </div>
                            <div class="form-group query-mode-group">
                                <label>Query Mode</label>
                                <div class="config-dropdown" id="source-b-query-mode-wrapper">
                                    <button type="button" class="btn btn-secondary config-dropdown-btn" id="source-b-query-mode-btn">
                                        <span id="source-b-query-mode-label">By Table</span>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="6 9 12 15 18 9"></polyline>
                                        </svg>
                                    </button>
                                    <div class="config-dropdown-menu" id="source-b-query-mode-dropdown">
                                        <button class="config-dropdown-option active" data-value="table">By Table</button>
                                        <button class="config-dropdown-option" data-value="sql">By Raw SQL</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="table-mode-config" id="source-b-table-config">
                            <div class="schema-table-row">
                                <div class="form-group">
                                    <label>Schema</label>
                                    <div class="searchable-select" id="source-b-schema-wrapper">
                                        <input type="text" class="form-input searchable-input"
                                               id="source-b-schema-search" placeholder="Select connection first..." autocomplete="off" disabled>
                                        <div class="searchable-dropdown" id="source-b-schema-dropdown"></div>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>Table</label>
                                    <div class="searchable-select" id="source-b-table-wrapper">
                                        <input type="text" class="form-input searchable-input"
                                               id="source-b-table-search" placeholder="Select schema first..." autocomplete="off" disabled>
                                        <div class="searchable-dropdown" id="source-b-table-dropdown"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>WHERE Clause (optional)</label>
                                <input type="text" id="source-b-where" class="form-input"
                                       placeholder="STATUS = 'ACTIVE' AND ID > 100">
                                <span class="form-hint">Condition only, without WHERE keyword. Use AND/OR to combine.</span>
                            </div>
                        </div>

                        <div class="sql-mode-config" id="source-b-sql-config" style="display: none;">
                            <div class="form-group">
                                <label>SQL Query</label>
                                <textarea id="source-b-sql" class="form-textarea sql-input"
                                          placeholder="SELECT * FROM schema.table WHERE ..."></textarea>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Max Rows</label>
                            <input type="number" id="source-b-max-rows" class="form-input"
                                   value="500" min="1" max="10000">
                        </div>
                    </div>

                    <!-- Excel Config - Enhanced with multi-file support -->
                    <div class="excel-config" id="source-b-excel-config" style="display: none;">
                        <div class="file-upload-zone compact" id="source-b-upload-zone">
                            <div class="upload-zone-header">
                                <span class="zone-label">Excel Files</span>
                                <div class="upload-zone-actions">
                                    <button class="btn btn-ghost btn-xs btn-browse" id="source-b-browse-files">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                            <polyline points="14 2 14 8 20 8"></polyline>
                                            <line x1="12" y1="18" x2="12" y2="12"></line>
                                            <line x1="9" y1="15" x2="15" y2="15"></line>
                                        </svg>
                                        Add Files
                                    </button>
                                    <button class="btn btn-ghost btn-xs btn-browse" id="source-b-browse-folder">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                            <line x1="12" y1="11" x2="12" y2="17"></line>
                                            <line x1="9" y1="14" x2="15" y2="14"></line>
                                        </svg>
                                        Add Folder
                                    </button>
                                    <button class="btn btn-ghost btn-xs btn-clear-files" id="source-b-clear-all" style="display: none;">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                        </svg>
                                        Clear All
                                    </button>
                                </div>
                            </div>
                            <input type="file" id="source-b-file-input" multiple accept=".xlsx,.xls,.csv" style="display: none;">
                            <input type="file" id="source-b-folder-input" webkitdirectory style="display: none;">
                            <div class="file-list" id="source-b-file-list"></div>
                        </div>

                        <!-- File Selection Dropdown (shown when files are uploaded) -->
                        <div class="file-selection-dropdown" id="source-b-file-selection" style="display: none;">
                            <label>Select File to Compare</label>
                            <div class="searchable-select" id="source-b-file-wrapper">
                                <input type="text" class="form-input searchable-input"
                                       id="source-b-file-search" placeholder="Search or select file..." autocomplete="off">
                                <div class="searchable-dropdown" id="source-b-file-dropdown"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Inline Validation Message -->
                    <div class="inline-validation" id="source-b-validation" style="display: none;">
                        <div class="validation-icon"></div>
                        <div class="validation-content">
                            <span class="validation-message-text"></span>
                            <span class="validation-hint"></span>
                        </div>
                    </div>

                    <!-- Data Preview -->
                    <div class="data-preview" id="source-b-preview" style="display: none;">
                        <div class="preview-header">
                            <span class="preview-label">Loaded</span>
                            <span class="preview-stats" id="source-b-stats"></span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Unified Inline Error Banner (shown between panels and Load button) -->
            <div class="unified-error-banner" id="unified-error-banner" style="display: none;">
                <div class="error-banner-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                </div>
                <div class="error-banner-content">
                    <strong class="error-banner-title"></strong>
                    <p class="error-banner-message"></p>
                    <p class="error-banner-hint"></p>
                </div>
                <button class="btn btn-ghost btn-xs error-banner-dismiss" title="Dismiss">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <!-- Load Data Button -->
            <div class="unified-load-actions" id="unified-load-actions">
                <button class="btn btn-primary" id="btn-unified-load-data" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Load Data from Both Sources
                </button>
            </div>

            <!-- Field Reconciliation (shown after both sources have data) -->
            <div class="field-reconciliation" id="unified-field-reconciliation" style="display: none;">
                <!-- Config Changed Banner (shown when user changes config after loading data) -->
                <div class="config-changed-banner" id="unified-config-changed-banner" style="display: none;">
                    <div class="banner-content">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        <span>Configuration has changed. Click <strong>Reload Data</strong> to refresh.</span>
                    </div>
                    <button class="btn btn-primary btn-sm" id="btn-unified-reload-data">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        Reload Data
                    </button>
                </div>

                <!-- Column Mismatch Warning -->
                <div class="column-warning" id="unified-column-warning" style="display: none;">
                    <div class="warning-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                    </div>
                    <div class="warning-content">
                        <strong>Column Differences Detected</strong>
                        <p>Some columns exist in only one source and will be excluded from comparison.</p>
                        <details>
                            <summary>Show details</summary>
                            <div class="column-details">
                                <div class="only-in-a" id="unified-columns-only-in-a"></div>
                                <div class="only-in-b" id="unified-columns-only-in-b"></div>
                            </div>
                        </details>
                    </div>
                </div>

                <!-- Primary Key Selection -->
                <div class="field-selection-section">
                    <div class="field-header">
                        <h4 class="field-title">Primary Key Selection</h4>
                        <div class="field-actions">
                            <button class="btn btn-ghost btn-sm" id="btn-unified-select-all-pk">Select All</button>
                            <button class="btn btn-ghost btn-sm" id="btn-unified-deselect-all-pk">Clear</button>
                        </div>
                    </div>
                    <p class="field-help">Select field(s) to use as primary key for matching rows</p>
                    <div id="unified-pk-field-list" class="field-list"></div>
                </div>

                <!-- Comparison Fields Selection -->
                <div class="field-selection-section">
                    <div class="field-header">
                        <h4 class="field-title">Fields to Compare</h4>
                        <div class="field-actions">
                            <button class="btn btn-ghost btn-sm" id="btn-unified-select-all-fields">Select All</button>
                            <button class="btn btn-ghost btn-sm" id="btn-unified-deselect-all-fields">Clear</button>
                        </div>
                    </div>
                    <p class="field-help">Select fields to include in comparison</p>
                    <div id="unified-compare-field-list" class="field-list"></div>
                </div>

                <!-- Comparison Options -->
                <div class="unified-comparison-options">
                    <div class="settings-row">
                        <div class="setting-group">
                            <label>Row Matching:</label>
                            <div class="radio-group">
                                <label class="radio-label">
                                    <input type="radio" name="unified-row-matching" value="key" checked>
                                    <span>By Primary Key</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="unified-row-matching" value="position">
                                    <span>By Row Position</span>
                                </label>
                            </div>
                        </div>

                        <div class="setting-group">
                            <label>Data Comparison:</label>
                            <div class="radio-group">
                                <label class="radio-label">
                                    <input type="radio" name="unified-data-comparison" value="strict" checked>
                                    <span>Strict (as-is)</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="unified-data-comparison" value="normalized">
                                    <span>Normalized</span>
                                </label>
                            </div>
                        </div>

                        <div class="setting-group">
                            <label class="checkbox-label" title="Enable case-insensitive field name matching (e.g., PARAMETER_KEY matches parameter_key)">
                                <input type="checkbox" id="unified-normalize-fields">
                                <span>Normalize Field Names</span>
                                <span class="setting-hint">(case-insensitive)</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Compare Button -->
                <div class="comparison-actions">
                    <button class="btn btn-primary btn-lg" id="btn-unified-compare" disabled>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                        Compare Data
                    </button>
                </div>
            </div>
        </div>

        <!-- Progress Overlay -->
        <div id="unified-progress-overlay" class="progress-overlay" style="display: none;">
            <div class="progress-card">
                <div class="progress-header">
                    <div class="progress-spinner"></div>
                    <h3 id="unified-progress-title">Loading Data</h3>
                </div>
                <div class="progress-steps" id="unified-progress-steps">
                    <div class="progress-step" id="unified-step-source-a">
                        <div class="step-icon pending">○</div>
                        <div class="step-content">
                            <div class="step-label">Loading Source A data</div>
                            <div class="step-detail" id="unified-step-source-a-detail">—</div>
                        </div>
                    </div>
                    <div class="progress-step" id="unified-step-validate-b" style="display: none;">
                        <div class="step-icon pending">○</div>
                        <div class="step-content">
                            <div class="step-label">Validating Source B</div>
                            <div class="step-detail" id="unified-step-validate-b-detail">—</div>
                        </div>
                    </div>
                    <div class="progress-step" id="unified-step-source-b">
                        <div class="step-icon pending">○</div>
                        <div class="step-content">
                            <div class="step-label">Loading Source B data</div>
                            <div class="step-detail" id="unified-step-source-b-detail">—</div>
                        </div>
                    </div>
                    <div class="progress-step" id="unified-step-reconcile">
                        <div class="step-icon pending">○</div>
                        <div class="step-content">
                            <div class="step-label">Reconciling fields</div>
                            <div class="step-detail" id="unified-step-reconcile-detail">—</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Results Section -->
        <div id="results-section" class="results-section" style="display: none;">
            <div class="results-title-row">
                <h3 id="results-title">Comparison Results</h3>
                <!-- Comparison Context (Excel Compare only) -->
                <div id="comparison-context" class="comparison-context" style="display: none;">
                    <span class="context-label">Comparing:</span>
                    <span class="context-file ref" id="context-ref-file"></span>
                    <span class="context-vs">vs</span>
                    <span class="context-file comp" id="context-comp-file"></span>
                </div>
            </div>

            <!-- Summary + Actions Row -->
            <div class="results-toolbar">
                <div id="results-summary" class="results-summary">
                    <!-- Summary will be populated here -->
                </div>
                <div class="results-actions">
                    <div class="results-actions-row">
                    <button class="btn btn-ghost btn-sm" id="btn-toggle-filter">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="m21 21-4.35-4.35"></path>
                        </svg>
                        Filter
                    </button>
                    <div class="view-dropdown" id="view-dropdown">
                        <button class="btn btn-secondary btn-sm" id="btn-view">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                <rect x="3" y="3" width="7" height="7"></rect>
                                <rect x="14" y="3" width="7" height="7"></rect>
                                <rect x="14" y="14" width="7" height="7"></rect>
                                <rect x="3" y="14" width="7" height="7"></rect>
                            </svg>
                            <span id="view-type-label">Summary Grid</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 4px;">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </button>
                        <div class="view-dropdown-menu" id="view-dropdown-menu">
                            <button class="view-option active" data-value="grid">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="7" height="7"></rect>
                                    <rect x="14" y="3" width="7" height="7"></rect>
                                    <rect x="14" y="14" width="7" height="7"></rect>
                                    <rect x="3" y="14" width="7" height="7"></rect>
                                </svg>
                                Summary Grid
                            </button>
                            <button class="view-option" data-value="vertical">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="18" height="5" rx="1"></rect>
                                    <rect x="3" y="10" width="18" height="5" rx="1"></rect>
                                    <rect x="3" y="17" width="18" height="5" rx="1"></rect>
                                </svg>
                                Cards
                            </button>
                            <button class="view-option" data-value="master-detail">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                    <line x1="16" y1="13" x2="8" y2="13"></line>
                                    <line x1="16" y1="17" x2="8" y2="17"></line>
                                </svg>
                                Detail View
                            </button>
                        </div>
                    </div>
                    <div class="export-dropdown" id="export-dropdown">
                        <button class="btn btn-secondary btn-sm" id="btn-export">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="17 8 12 3 7 8"></polyline>
                                <line x1="12" y1="3" x2="12" y2="15"></line>
                            </svg>
                            Export
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 4px;">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </button>
                        <div class="export-dropdown-menu" id="export-dropdown-menu">
                            <button class="export-option" id="btn-export-json">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                Export as JSON
                            </button>
                            <button class="export-option" id="btn-export-excel">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                    <line x1="16" y1="13" x2="8" y2="13"></line>
                                    <line x1="16" y1="17" x2="8" y2="17"></line>
                                </svg>
                                Export as Excel
                            </button>
                            <button class="export-option" id="btn-export-csv">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                Export as CSV
                            </button>
                        </div>
                    </div>
                    <button class="btn btn-primary btn-sm" id="btn-new-comparison">New Comparison</button>
                    </div>
                    <div class="results-search-box" id="results-search-box" style="display: none;">
                        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="m21 21-4.35-4.35"></path>
                        </svg>
                        <input type="text" id="results-search-input" class="results-search-input" placeholder="Filter results..." />
                        <button id="results-search-clear" class="results-search-clear" title="Clear search" style="display: none;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Results Content -->
            <div id="results-content" class="results-content">
                <!-- Results will be populated here based on selected view -->
            </div>
        </div>
        </div><!-- End tab-content-compare -->

        <!-- Bulk Select Tab Content -->
        <div id="tab-content-bulk-select" class="tab-content">
            <div class="bulk-select-mode">
                <!-- Environment Selection Row -->
                <div class="bulk-select-environments">
                    <div class="bulk-env-panel">
                        <h4>Source A (Reference)</h4>
                        <div class="form-group">
                            <label>Connection</label>
                            <div class="config-dropdown" id="bulk-source-a-connection-wrapper">
                                <button type="button" class="btn btn-secondary config-dropdown-btn" id="bulk-source-a-connection-btn">
                                    <span id="bulk-source-a-connection-label">Select connection...</span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </button>
                                <div class="config-dropdown-menu" id="bulk-source-a-connection-dropdown"></div>
                            </div>
                        </div>
                    </div>

                    <div class="bulk-env-panel">
                        <h4>Source B (Comparator)</h4>
                        <div class="form-group">
                            <label>Connection</label>
                            <div class="config-dropdown" id="bulk-source-b-connection-wrapper">
                                <button type="button" class="btn btn-secondary config-dropdown-btn" id="bulk-source-b-connection-btn">
                                    <span id="bulk-source-b-connection-label">Select connection...</span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </button>
                                <div class="config-dropdown-menu" id="bulk-source-b-connection-dropdown"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- SQL Statements Input -->
                <div class="bulk-sql-section">
                    <div class="form-group">
                        <label>SELECT Statements (one per line)</label>
                        <textarea id="bulk-sql-statements" class="form-textarea bulk-sql-input" 
                                  placeholder="SELECT * FROM SCHEMA.TABLE1 WHERE ID = 123
SELECT COL1, COL2 FROM SCHEMA.TABLE2 WHERE STATUS = 'ACTIVE'
SELECT COUNT(*) FROM SCHEMA.TABLE3"></textarea>
                        <span class="form-hint">Enter one SELECT statement per line. Each query will be executed on both environments and compared.</span>
                    </div>

                    <div class="bulk-options-row">
                        <div class="form-group">
                            <label>Max Rows per Query</label>
                            <input type="number" id="bulk-max-rows" class="form-input" value="500" min="1" max="10000">
                        </div>
                        <div class="setting-group">
                            <label>Data Comparison:</label>
                            <div class="radio-group">
                                <label class="radio-label">
                                    <input type="radio" name="bulk-data-comparison" value="strict" checked>
                                    <span>Strict (as-is)</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="bulk-data-comparison" value="normalized">
                                    <span>Normalized</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Compare Button -->
                <div class="bulk-actions">
                    <button class="btn btn-primary btn-lg" id="btn-bulk-compare" disabled>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                        Compare All Queries
                    </button>
                </div>

                <!-- Progress Section -->
                <div id="bulk-progress-section" class="bulk-progress-section" style="display: none;">
                    <div class="bulk-progress-header">
                        <h4>Comparison Progress</h4>
                        <span id="bulk-progress-counter">0 / 0</span>
                    </div>
                    <div class="bulk-progress-bar">
                        <div class="bulk-progress-fill" id="bulk-progress-fill" style="width: 0%;"></div>
                    </div>
                    <div id="bulk-progress-current" class="bulk-progress-current"></div>
                </div>

                <!-- Results Section -->
                <div id="bulk-results-section" class="bulk-results-section" style="display: none;">
                    <div class="bulk-results-header">
                        <h3>Bulk Comparison Results</h3>
                        <div class="bulk-results-summary" id="bulk-results-summary"></div>
                    </div>
                    <div id="bulk-results-list" class="bulk-results-list">
                        <!-- Individual query results will be rendered here -->
                    </div>
                </div>
            </div>
        </div><!-- End tab-content-bulk-select -->
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
