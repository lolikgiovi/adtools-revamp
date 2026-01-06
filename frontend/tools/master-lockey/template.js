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
                🌐 Lockey
            </button>
            <button class="tab-button" data-tab="confluence">
                📄 Confluence Lookup 
            </button>
            <button class="tab-button" data-tab="bulk-search">
                🔍 Bulk Search
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

    <!-- Lockey Tab Panel -->
    <div id="lockey-tab-panel" class="ml-tab-panel active" data-panel="lockey">
        <!-- Search -->
        <div id="search-section" class="master-lockey-search" style="display: none;">
            <div class="search-container">
                <div class="search-mode-wrapper">
                    <span class="dropdown-icon">▼</span>
                    <select id="search-mode" class="search-mode-selector">
                        <option value="key">Search by Key</option>
                        <option value="content">Search by Content</option>
                    </select>
                </div>
                <input type="text" id="search-input" class="search-input" placeholder="Enter search term...">
                <button id="btn-clear-search" class="btn-clear-search" title="Clear search">×</button>
                <button id="btn-whole-word" class="btn-whole-word" title="Match whole word only">
                    Match Word
                </button>
            </div>
            <div class="search-meta">
                <p id="search-hint" class="search-hint">Tip: For key search, use comma-separated values (e.g., key1, key2)</p>
                <div id="results-count" class="search-results-count" style="display: none;"><span id="results-text"></span></div>
            </div>
        </div>

        <div class="master-lockey-content" id="lockey-content">
            <div class="empty-state" id="empty-state">
                <div class="empty-state-icon">🌐</div>
                <h3>No Data Loaded</h3>
                <p>Select a domain and click "Get Latest Data" to get started.</p>
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

    <!-- Confluence Lookup Tab Panel -->
    <div id="confluence-tab-panel" class="ml-tab-panel" data-panel="confluence">
        <div id="confluence-section" class="confluence-section">
            <!-- PAT Not Configured Warning -->
            <div id="confluence-pat-warning" class="confluence-warning" style="display: none;">
                ⚠️ Confluence credentials not configured.
                <a href="#" id="confluence-settings-link">Go to Settings</a> to add your domain, username, and PAT.
            </div>

            <!-- Page Search Input (unified search + URL input) -->
            <div class="confluence-controls-row">
                <div class="page-search-container">
                    <input type="text" id="confluence-page-input" class="confluence-input" placeholder="Search cached pages or enter URL" autocomplete="off">
                    <div id="page-search-dropdown" class="page-search-dropdown" style="display: none;"></div>
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
                    <div class="export-buttons">
                        <button id="btn-copy-lockey" class="btn-export" title="Copy lockey column to clipboard">Copy Lockey</button>
                        <button id="btn-copy-table" class="btn-export" title="Copy table as TSV for Excel">Copy Table</button>
                    </div>
                </div>
                <div class="confluence-table-container">
                    <table class="confluence-table" id="confluence-table">
                        <thead>
                            <tr>
                                <th>Lockey</th>
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
    </div>

    <!-- Bulk Search Tab Panel -->
    <div id="bulk-search-tab-panel" class="ml-tab-panel" data-panel="bulk-search">
        <div class="bulk-search-section">
            <div class="bulk-search-intro">
                <p class="bulk-search-hint">Enter lockey keys below (one per line) to check if they exist in the loaded remote data.</p>
            </div>
            
            <div class="bulk-search-input-section">
                <textarea id="bulk-search-input" class="bulk-search-input" placeholder="livinCareMilestoneSubtitleLabel&#10;livinCareMilestoneDoneTitleLabel&#10;livinCareMilestoneRejectedDisclaimerLabel"></textarea>
                <div class="bulk-search-controls">
                    <button id="btn-bulk-search" class="btn-confluence" disabled>
                        <span class="btn-text">Search</span>
                    </button>
                    <button id="btn-clear-bulk" class="btn-confluence">Clear</button>
                </div>
            </div>

            <div id="bulk-search-no-data" class="bulk-search-warning" style="display: none;">
                ⚠️ No remote data loaded. Please select a domain and fetch data from the Lockey tab first.
            </div>
            
            <div id="bulk-search-results" class="bulk-search-results" style="display: none;">
                <div class="results-header">
                    <span id="bulk-search-results-count" class="results-count-label"></span>
                    <div class="export-buttons">
                        <button id="btn-copy-bulk-results" class="btn-export" title="Copy results to clipboard">Copy Results</button>
                    </div>
                </div>
                <div class="bulk-search-table-container">
                    <table class="bulk-search-table">
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
            </div>
        </div>
    </div>
</div>
`;
