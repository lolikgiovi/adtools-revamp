/**
 * Master Lockey HTML Template
 * Displays localization keys in a searchable table with IndexedDB caching
 */

export const MasterLockeyTemplate = /* html */ `
<div class="master-lockey-container">
    <div class="master-lockey-header">
        <div class="master-lockey-controls">
            <div class="control-group">
                <label for="domain-selector">Domain:</label>
                <select id="domain-selector" class="domain-selector">
                    <option value="">Select a domain...</option>
                </select>
            </div>
            <button class="btn-fetch" id="btn-fetch-data" disabled>
                <span class="btn-text">Fetch Latest Data</span>
                <span class="btn-spinner" style="display: none;">⟳</span>
            </button>
            <div class="cache-info" id="cache-info" style="display: none;">
                <span class="cache-badge">Cached</span>
                <span class="cache-timestamp" id="cache-timestamp"></span>
            </div>
        </div>
    </div>

    <div class="master-lockey-info" id="lockey-info" style="display: none;">
        <div class="info-content">
            <span class="domain-name" id="info-domain-name"></span>
            <span class="separator">-</span>
            <span class="version-info">Language Pack Version: <strong id="info-version"></strong></span>
        </div>
    </div>

    <div class="master-lockey-search" id="search-section" style="display: none;">
        <div class="search-container">
            <select id="search-mode" class="search-mode-selector">
                <option value="key">Search by Key</option>
                <option value="content">Search by Content</option>
            </select>
            <input 
                type="text" 
                id="search-input" 
                class="search-input" 
                placeholder="Enter search term..."
            />
            <button class="btn-clear-search" id="btn-clear-search" title="Clear search">×</button>
        </div>
        <div class="search-hint" id="search-hint">
            Tip: For key search, use comma-separated values (e.g., key1, key2)
        </div>
        <div class="search-results-count" id="results-count" style="display: none;">
            <span id="results-text"></span>
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
    </div>
</div>
`;
