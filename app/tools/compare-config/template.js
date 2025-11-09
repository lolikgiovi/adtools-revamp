/**
 * Compare Config HTML Template
 * Contains the UI structure for Oracle database configuration comparison
 */

export const CompareConfigTemplate = /* html */ `
<div class="compare-config-container">
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
                        <button class="btn-copy-command" title="Copy command">Copy</button>
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
                <button class="btn-primary" id="btn-check-again">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                    Check Again
                </button>
                <button class="btn-secondary" id="btn-troubleshooting">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    Troubleshooting
                </button>
            </div>
        </div>
    </div>

    <!-- Main Tool Interface (shown when client is installed) -->
    <div id="main-interface" class="main-interface">
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

        <!-- Field Selection (shown after table is selected) -->
        <div id="field-selection" class="field-selection" style="display: none;">
            <h3>Primary Key Selection</h3>
            <p class="field-help">Select fields to use as primary key for comparison (leave empty to use table's default primary key)</p>

            <div class="field-actions">
                <button class="btn-secondary" id="btn-select-all-pk">Select All</button>
                <button class="btn-secondary" id="btn-deselect-all-pk">Deselect All</button>
            </div>

            <div id="pk-field-list" class="field-list">
                <!-- PK fields will be populated here -->
            </div>

            <h3 style="margin-top: 24px;">Field Selection</h3>
            <p class="field-help">Select fields to display and compare</p>

            <div class="field-actions">
                <button class="btn-secondary" id="btn-select-all">Select All</button>
                <button class="btn-secondary" id="btn-deselect-all">Deselect All</button>
            </div>

            <div id="field-list" class="field-list">
                <!-- Fields will be populated here -->
            </div>

            <div class="where-clause-section">
                <label for="where-clause">WHERE Clause (optional):</label>
                <input type="text" id="where-clause" class="form-input" placeholder="e.g., status = 'active'">
                <p class="help-text">Enter a WHERE clause to filter records (do not include 'WHERE' keyword)</p>
            </div>

            <div class="comparison-actions">
                <button class="btn-primary" id="btn-compare">Compare Configurations</button>
            </div>
        </div>

        <!-- Loading State -->
        <div id="loading-state" class="loading-state" style="display: none;">
            <div class="spinner"></div>
            <p id="loading-message">Loading...</p>
        </div>

        <!-- Results Section -->
        <div id="results-section" class="results-section" style="display: none;">
            <div class="results-header">
                <h3>Comparison Results</h3>
                <div class="results-actions">
                    <button class="btn-secondary" id="btn-export-json">Export JSON</button>
                    <button class="btn-secondary" id="btn-export-csv">Export CSV</button>
                    <button class="btn-primary" id="btn-new-comparison">New Comparison</button>
                </div>
            </div>

            <!-- Summary -->
            <div id="results-summary" class="results-summary">
                <!-- Summary will be populated here -->
            </div>

            <!-- View Selector -->
            <div class="view-selector">
                <label>View:</label>
                <select id="view-type" class="form-select">
                    <option value="expandable">Expandable Rows</option>
                    <option value="vertical">Vertical Cards</option>
                    <option value="master-detail">Master-Detail</option>
                </select>
            </div>

            <!-- Results Content -->
            <div id="results-content" class="results-content">
                <!-- Results will be populated here based on selected view -->
            </div>
        </div>
    </div>
</div>
`;
