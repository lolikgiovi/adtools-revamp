/**
 * JSON Tools HTML Template
 * Contains the UI structure for JSON validation, formatting, and manipulation tools
 */

export const JSONToolsTemplate = /* html */ `
<div class="json-tools-container">
    <div class="json-tools-header">
        <div class="tabs-container json-tools-tabs">
            <div class="tabs-left">
                <button class="tab-button active" data-tab="prettify">Beautify</button>
                <button class="tab-button" data-tab="minify">Minify</button>
                <button class="tab-button" data-tab="stringify">Stringify</button>
                <button class="tab-button" data-tab="unstringify">Unstringify</button>
                <button class="tab-button" data-tab="escape">Escape</button>
                <button class="tab-button" data-tab="unescape">Unescape</button>
                <button class="tab-button" data-tab="extract-keys">Extract Keys</button>
                <button class="tab-button" data-tab="json-to-table">To Table</button>
            </div>
        </div>
    </div>
    
    <div class="json-tools-main">
        <div class="json-editor-section">
            <div class="json-editor-header">
                <h3>Input</h3>
                <div class="json-editor-actions">
                    <button class="btn btn-ghost btn-sm btn-clear" title="Clear Editor">Clear</button>
                    <button class="btn btn-ghost btn-sm btn-copy-input" title="Copy Input">Copy</button>
                    <button class="btn btn-ghost btn-sm btn-paste" title="Paste from Clipboard">Paste</button>
                    <button class="btn btn-primary btn-sm btn-action-primary" title="Perform Action">Action</button>
                </div>
            </div>
            <div id="json-editor" class="json-editor"></div>
        </div>
        
        <div class="json-output-section">
            <div class="json-output-header">
                <h3 id="output-title">Output</h3>
                <div class="json-output-actions">
                    <button class="btn btn-sm btn-toggle-search" title="Search in table" style="display: none;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                    </button>
                    <div class="table-search-group" style="display: none;">
                        <input type="text" class="table-search-input" placeholder="Search..." title="Search in table">
                        <span class="search-match-count"></span>
                        <button class="btn btn-sm btn-search-prev" title="Previous match">▲</button>
                        <button class="btn btn-sm btn-search-next" title="Next match">▼</button>
                    </div>
                    <button class="btn btn-primary btn-sm btn-expand-table" title="Expand Table" style="display: none;">Expand</button>
                    <button class="btn btn-primary btn-sm btn-transpose-table" title="Transpose Table" style="display: none;">Transpose</button>
                    <!-- Extract Keys Options Dropdown -->
                    <div class="extract-options-dropdown" id="extract-options" style="display: none;">
                        <button class="btn btn-sm btn-toggle-extract-options" title="Options">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="3"/><path d="M12.22 2.02a10 10 0 0 1 7.7 7.7M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z"/>
                            </svg>
                            Options
                        </button>
                        <div class="extract-options-menu" style="display: none;">
                            <div class="options-group">
                                <span class="options-group-label">Key Type</span>
                                <label><input type="radio" name="extract-type" value="simple" checked> Simple Keys</label>
                                <label><input type="radio" name="extract-type" value="paths"> Key Paths</label>
                            </div>
                            <div class="options-group">
                                <span class="options-group-label">Sort</span>
                                <label><input type="radio" name="sort-order" value="natural" checked> Natural</label>
                                <label><input type="radio" name="sort-order" value="asc"> A-Z</label>
                                <label><input type="radio" name="sort-order" value="desc"> Z-A</label>
                            </div>
                        </div>
                    </div>
                    <button class="btn btn-primary btn-sm btn-export-excel" title="Export to Excel" style="display: none;">Export Excel</button>
                    <button class="btn btn-primary btn-sm btn-copy-output" title="Copy Output">Copy</button>
                </div>
            </div>
            <div id="json-output" class="json-editor"></div>
            <div id="json-table-output" class="json-table-output" style="display: none;"></div>
        </div>
    </div>
    
    <!-- Table Options Panel (placeholder for future options) -->
    <div class="table-options-panel" id="table-options" style="display: none;"></div>
</div>
`;
