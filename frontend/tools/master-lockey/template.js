/**
 * Master Lockey HTML Template
 * Displays localization keys in a searchable table with IndexedDB caching
 */

export const MasterLockeyTemplate = /* html */ `
<div class="master-lockey-container">
    <!-- Tab Navigation Row (tabs left, domain controls right) -->
    <div class="tabs-container ml-tabs">
        <div class="tabs-left">
            <button class="tab-button active" data-tab="lockey">
                Search Lockey
            </button>
            <button class="tab-button" data-tab="confluence">
                Extract Lockey from Confluence
            </button>
        </div>
        <!-- Domain Controls (visible only on Lockey tab) -->
        <div class="tabs-right" id="domain-controls">
            <div class="cache-info-compact" id="cache-info" style="display: none;">
                <span class="cache-timestamp" id="cache-timestamp"></span>
            </div>
            <span id="info-version" class="version-hash" style="display: none;"></span>
            <select id="domain-selector" class="domain-selector-compact">
                <option value="">Pick Domain</option>
            </select>
            <button class="btn-fetch-compact" id="btn-fetch-data" disabled>
                <span class="btn-text">Fetch</span>
                <span class="btn-spinner" style="display: none;">↻</span>
            </button>
        </div>
    </div>

    <!-- Search Lockey: single and bulk modes share one top-level tab. -->
    <div id="search-tab-panel" class="ml-tab-panel active" data-panel="lockey">
        <div id="lockey-tab-panel" class="lockey-mode-panel active">
            <div class="lockey-search-row">
                <!-- Search -->
                <div id="search-section" class="master-lockey-search">
                    <div class="search-container">
                        <div class="search-mode-wrapper">
                            <span class="dropdown-icon">▼</span>
                            <select id="search-mode" class="search-mode-selector" disabled>
                                <option value="key">Search by Key</option>
                                <option value="content">Search by Content</option>
                            </select>
                        </div>
                        <input type="text" id="search-input" class="search-input" disabled placeholder="Enter search term...">
                        <button id="btn-clear-search" class="btn-clear-search" disabled title="Clear search">×</button>
                        <button id="btn-whole-word" class="btn-whole-word" disabled title="Match whole word only">
                            Match Word
                        </button>
                    </div>
                    <div class="search-meta">
                        <p id="search-hint" class="search-hint">Tip: For key search, use comma-separated values (e.g., key1, key2)</p>
                        <div id="results-count" class="search-results-count" style="display: none;"><span id="results-text"></span></div>
                    </div>
                </div>

                <div class="lockey-mode-toggle" role="group" aria-label="Lockey search mode">
                    <button type="button" class="lockey-mode-btn active" data-search-mode="single" aria-pressed="true">Single</button>
                    <button type="button" class="lockey-mode-btn" data-search-mode="bulk" aria-pressed="false">Bulk</button>
                </div>
            </div>

            <div class="master-lockey-content" id="lockey-content">
                <div class="empty-state" id="empty-state">
                    <div class="empty-state-icon">🌐</div>
                    <h3>No Data Loaded</h3>
                    <p>Select a domain and click "Fetch" to get started.</p>
                </div>

                <div class="loading-state" id="loading-state" style="display: none;">
                    <div class="spinner"></div>
                    <p>Fetching lockey from remote...</p>
                </div>

                <div class="error-state" id="error-state" style="display: none;">
                    <div class="error-icon">⚠️</div>
                    <h3 id="error-title">Error</h3>
                    <p id="error-message"></p>
                    <button class="btn-retry" id="btn-retry">Retry</button>
                </div>

                <div class="table-container" id="table-container" style="display: none;">
                    <table class="lockey-table" id="lockey-table">
                        <thead id="table-head">
                            <!-- Dynamic headers will be inserted here -->
                        </thead>
                        <tbody id="table-body">
                            <!-- Data rows will be inserted here -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Bulk Search Tab Panel -->
        <div id="bulk-search-tab-panel" class="lockey-mode-panel">
            <div class="bulk-search-section">
                <div class="lockey-search-row">
                    <div class="master-lockey-search">
                        <div class="search-container bulk-search-container">
                            <textarea id="bulk-search-input" class="bulk-search-input" rows="1"
                                aria-label="Keys to check" placeholder="Enter lockey keys, one per line..."></textarea>
                            <div class="bulk-search-controls">
                                <button id="btn-bulk-search" class="btn-whole-word" disabled>Search</button>
                                <button id="btn-paste-bulk" class="btn-whole-word">Paste</button>
                                <button id="btn-clear-bulk" class="btn-whole-word">Clear</button>
                            </div>
                        </div>
                        <div class="search-meta">
                            <p class="search-hint">Enter one key per line to check for exact matches.</p>
                            <span id="bulk-search-results-count" class="search-results-count"></span>
                        </div>
                    </div>
                    <div class="lockey-mode-toggle" role="group" aria-label="Lockey search mode">
                        <button type="button" class="lockey-mode-btn" data-search-mode="single" aria-pressed="false">Single</button>
                        <button type="button" class="lockey-mode-btn active" data-search-mode="bulk" aria-pressed="true">Bulk</button>
                    </div>
                </div>

                <div id="bulk-search-no-data" class="empty-state" style="display: none;">
                    <div class="empty-state-icon">🌐</div>
                    <h3>No Data Loaded</h3>
                    <p>Select a domain and click "Fetch" to get started.</p>
                </div>

                <div id="bulk-search-results" class="bulk-search-results" style="display: none;">
                    <div class="bulk-search-table-container table-container">
                        <table class="lockey-table">
                            <thead>
                                <tr>
                                    <th>Lockey</th>
                                    <th id="bulk-search-en-header">EN</th>
                                    <th id="bulk-search-id-header">ID</th>
                                </tr>
                            </thead>
                            <tbody id="bulk-search-table-body">
                                <!-- Bulk search results will be inserted here -->
                            </tbody>
                        </table>
                    </div>
                    <div class="results-header">
                        <div class="export-buttons">
                            <select id="bulk-search-filter" class="bulk-search-filter">
                                <option value="all">Show All</option>
                                <option value="found">Found Only</option>
                                <option value="not-found">Not Found Only</option>
                            </select>
                            <button id="btn-copy-bulk-lockey" class="btn-export" title="Copy lockey keys only">Copy Lockey</button>
                            <button id="btn-copy-bulk-results" class="btn-export" title="Copy full results to clipboard">Copy Results</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Confluence Lookup Tab Panel -->
    <div id="confluence-tab-panel" class="ml-tab-panel" data-panel="confluence">
        <div id="confluence-section" class="confluence-section">
            <!-- PAT Not Configured Warning -->
            <div id="confluence-pat-warning" class="confluence-warning" style="display: none;">
                ⚠️ Confluence credentials not configured.
                <a href="#" id="confluence-settings-link">Go to Settings</a> to add your domain, username, and PAT.
            </div>

            <!-- Single Page Mode (existing) -->
            <div id="confluence-single-mode" class="confluence-mode-panel active">
                <!-- Input + Toggle + Buttons all inline -->
                <div class="confluence-controls-row">
                    <div class="page-search-container">
                        <input type="text" id="confluence-page-input" class="confluence-input" placeholder="Search cached pages or enter URL" autocomplete="off">
                        <div id="page-search-dropdown" class="page-search-dropdown" style="display: none;"></div>
                    </div>
                    <div class="confluence-mode-toggle">
                        <button class="confluence-mode-btn active" data-mode="single">Single Page</button>
                        <button class="confluence-mode-btn" data-mode="bulk">Bulk Pages</button>
                    </div>
                    <button id="btn-fetch-confluence" class="btn-confluence" disabled>
                        <span class="btn-text">Fetch Lockeys</span>
                        <span class="btn-spinner" style="display: none;">↻</span>
                    </button>
                    <button id="btn-refresh-page" class="btn-confluence" title="Refresh from Confluence" disabled>Reload</button>
                    <button id="btn-delete-cache" class="btn-confluence btn-danger" title="Delete from cache" disabled>Delete</button>
                </div>

                <div id="confluence-error" class="confluence-error" style="display: none;"></div>
                <div id="confluence-results" class="confluence-results" style="display: none;">
                    <div class="results-header">
                        <span id="confluence-results-count" class="results-count-label"></span>
                        <div class="confluence-search-bar">
                            <input type="text" id="confluence-search-input" class="confluence-search-input" placeholder="Filter lockeys...">
                            <button id="btn-clear-confluence-search" class="btn-clear-search" title="Clear search">×</button>
                        </div>
                        <div class="export-buttons">
                            <button id="btn-copy-lockey" class="btn-export" title="Copy lockey column to clipboard">Copy Lockey</button>
                            <button id="btn-copy-table" class="btn-export" title="Copy table as TSV for Excel">Copy Table</button>
                        </div>
                    </div>
                    <div class="confluence-table-container">
                        <table class="confluence-table" id="confluence-table">
                            <thead>
                                <tr>
                                    <th id="confluence-lockey-header" class="sortable-header">Lockey <span class="sort-indicator"></span></th>
                                    <th id="confluence-en-header">EN</th>
                                    <th id="confluence-id-header">ID</th>
                                    <th class="col-center col-action">Action</th>
                                </tr>
                            </thead>
                            <tbody id="confluence-table-body">
                                <!-- Confluence lockey rows will be inserted here -->
                            </tbody>
                        </table>
                    </div>

                    <!-- Hidden Keys Section -->
                    <div id="hidden-keys-section" class="hidden-keys-section" style="display: none;">
                        <div class="hidden-keys-header" id="hidden-keys-toggle">
                            <span class="toggle-icon">▶</span>
                            <span>Hidden Keys (<span id="hidden-keys-count">0</span>)</span>
                        </div>
                        <div id="hidden-keys-content" class="hidden-keys-content" style="display: none;">
                            <table class="confluence-table hidden-keys-table">
                                <thead>
                                    <tr>
                                        <th>Lockey</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody id="hidden-keys-body">
                                    <!-- Hidden keys will be inserted here -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Bulk Pages Mode (new) -->
            <div id="confluence-bulk-mode" class="confluence-mode-panel">
                <!-- Same layout as Single: Textarea + Toggle + Buttons inline -->
                <div class="confluence-controls-row bulk-mode-row">
                    <textarea id="bulk-confluence-input" class="bulk-confluence-input" placeholder="Enter Confluence URLs (one per line)..."></textarea>
                    <div class="confluence-mode-toggle">
                        <button class="confluence-mode-btn" data-mode="single">Single Page</button>
                        <button class="confluence-mode-btn active" data-mode="bulk">Bulk Pages</button>
                    </div>
                    <button id="btn-bulk-confluence-search" class="btn-confluence" disabled>
                        <span class="btn-text">Fetch All</span>
                        <span class="btn-spinner" style="display: none;">↻</span>
                    </button>
                    <button id="btn-paste-bulk-confluence" class="btn-confluence">Paste</button>
                    <button id="btn-clear-bulk-confluence" class="btn-confluence">Clear</button>
                </div>

                <div id="bulk-confluence-error" class="confluence-error" style="display: none;"></div>

                <div id="bulk-confluence-results" class="bulk-confluence-results" style="display: none;">
                    <div class="results-header">
                        <span id="bulk-confluence-results-count" class="results-count-label"></span>
                        <div class="export-buttons">
                            <button id="btn-copy-bulk-confluence-lockey" class="btn-export" title="Copy lockey column to clipboard">Copy Lockey</button>
                            <button id="btn-copy-bulk-confluence-table" class="btn-export" title="Copy table as TSV for Excel">Copy Table</button>
                        </div>
                    </div>

                    <div class="confluence-table-container">
                        <table class="confluence-table" id="bulk-confluence-table">
                            <thead>
                                <tr>
                                    <th class="col-screen-name">Screen</th>
                                    <th>Lockey</th>
                                    <th id="bulk-confluence-en-header">EN</th>
                                    <th id="bulk-confluence-id-header">ID</th>
                                </tr>
                            </thead>
                            <tbody id="bulk-confluence-table-body">
                                <!-- Bulk results will be inserted here -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>


</div>
`;
