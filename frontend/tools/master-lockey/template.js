/**
 * Master Lockey HTML Template
 * Displays localization keys in a searchable table with IndexedDB caching
 */

export const MasterLockeyTemplate = /* html */ `
<div class="master-lockey-container">
    <div class="master-lockey-header">
        <div class="master-lockey-controls">
            <div class="control-group">
                <select id="domain-selector" class="domain-selector">
                    <option value="">Pick Domain</option>
                </select>
            </div>
            <button class="btn-fetch" id="btn-fetch-data" disabled>
                <span class="btn-text">Get Latest Data</span>
                <span class="btn-spinner" style="display: none;">⟳</span>
            </button>
            <div class="cache-info" id="cache-info" style="display: none;">
                <span class="cache-badge">Cached</span>
                <span class="cache-timestamp" id="cache-timestamp"></span>
            </div>
            <div id="lockey-info" class="master-lockey-info" style="display: none;">
                <span id="info-domain-name" class="domain-name"></span>
                <span class="separator">-</span>
                <span class="version-info">Language Pack Version: <span id="info-version"></span></span>
            </div>
        </div>
    </div>

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
            <p>Select a domain and click "Fetch Latest Data" to get started.</p>
        </div>

        <div class="loading-state" id="loading-state" style="display: none;">
            <div class="spinner"></div>
            <p>Loading localization data...</p>
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

        <!-- Confluence Integration Section -->
        <div id="confluence-section" class="confluence-section" style="display: none;">
            <div class="confluence-header">
                <h4>📄 Confluence Lockeys</h4>
            </div>
            
            <!-- PAT Not Configured Warning -->
            <div id="confluence-pat-warning" class="confluence-warning" style="display: none;">
                ⚠️ Confluence credentials not configured. 
                <a href="#" id="confluence-settings-link">Go to Settings</a> to add your domain, username, and PAT.
            </div>
            
            <!-- Cached Pages Selector -->
            <div class="cached-pages-row">
                <select id="cached-pages-selector" class="cached-pages-selector">
                    <option value="">-- Select cached page or enter new --</option>
                </select>
                <button id="btn-refresh-page" class="btn-icon" title="Refresh from Confluence" disabled>🔄</button>
                <button id="btn-delete-cache" class="btn-icon btn-danger" title="Delete from cache" disabled>🗑️</button>
            </div>
            
            <!-- New Page Input -->
            <div class="confluence-controls">
                <input type="text" id="confluence-page-input" class="confluence-input" placeholder="Enter page URL or ID">
                <button id="btn-fetch-confluence" class="btn-confluence" disabled>
                    <span class="btn-text">Fetch Lockeys</span>
                    <span class="btn-spinner" style="display: none;">⟳</span>
                </button>
            </div>
            
            <div id="confluence-error" class="confluence-error" style="display: none;"></div>
            <div id="confluence-results" class="confluence-results" style="display: none;">
                <div class="results-header">
                    <div class="results-info">
                        <span id="confluence-page-title" class="page-title"></span>
                        <span id="confluence-results-count" class="results-count"></span>
                    </div>
                    <div class="export-buttons">
                        <button id="btn-export-tsv" class="btn-export" title="Copy as Tab-Separated Values">📋 TSV</button>
                        <button id="btn-export-csv" class="btn-export" title="Copy as Comma-Separated Values">📋 CSV</button>
                    </div>
                </div>
                <div class="confluence-table-container">
                    <table class="confluence-table" id="confluence-table">
                        <thead>
                            <tr>
                                <th>Lockey</th>
                                <th>Status</th>
                                <th>In Remote</th>
                                <th>Action</th>
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
</div>
`;
