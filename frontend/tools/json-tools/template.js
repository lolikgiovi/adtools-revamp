/**
 * JSON Tools HTML Template
 * Contains the UI structure for JSON validation, formatting, and manipulation tools
 */

export const JSONToolsTemplate = /* html */ `
<div class="json-tools-container">
    <div class="json-tools-header">
        <div class="json-tools-tabs">
            <button class="json-tab-button active" data-tab="validator">Validator</button>
            <button class="json-tab-button" data-tab="prettify">Beautify</button>
            <button class="json-tab-button" data-tab="minify">Minify</button>
            <button class="json-tab-button" data-tab="stringify">Stringify</button>
            <button class="json-tab-button" data-tab="unstringify">Unstringify</button>
            <button class="json-tab-button" data-tab="escape">Escape</button>
            <button class="json-tab-button" data-tab="unescape">Unescape</button>
            <button class="json-tab-button" data-tab="extract-keys">Extract Keys</button>
            <button class="json-tab-button" data-tab="json-to-table">To Table</button>
        </div>
    </div>
    
    <div class="json-tools-main">
        <div class="json-editor-section">
            <div class="json-editor-header">
                <h3>Input</h3>
                <div class="json-editor-actions">
                    <button class="btn btn-primary btn-sm btn-action-primary" title="Perform Action">Action</button>
                    <button class="btn btn-primary btn-sm btn-clear" title="Clear Editor">Clear</button>
                    <button class="btn btn-primary btn-sm btn-paste" title="Paste from Clipboard">Paste</button>
                    <button class="btn btn-primary btn-sm btn-copy-input" title="Copy Input">Copy</button>
                </div>
            </div>
            <div id="json-editor" class="json-editor"></div>
        </div>
        
        <div class="json-output-section">
            <div class="json-output-header">
                <h3 id="output-title">Output</h3>
                <div class="json-output-actions">
                    <button class="btn btn-primary btn-sm btn-expand-table" title="Expand Table" style="display: none;">Expand</button>
                    <button class="btn btn-primary btn-sm btn-transpose-table" title="Transpose Table" style="display: none;">Transpose</button>
                    <button class="btn btn-primary btn-sm btn-copy-output" title="Copy Output">Copy</button>
                </div>
            </div>
            <div id="json-output" class="json-editor"></div>
            <div id="json-table-output" class="json-table-output" style="display: none;"></div>
        </div>
    </div>
    
    <!-- Table Options Panel (placeholder for future options) -->
    <div class="table-options-panel" id="table-options" style="display: none;"></div>
    
    <!-- Extract Keys Options Panel -->
    <div class="extract-options-panel" id="extract-options" style="display: none;">
        <div class="options-header">
            <h4>Extract Keys Options</h4>
        </div>
        <div class="options-content">
            <div class="options-group">
                <span class="options-group-label">Key Type</span>
                <label>
                    <input type="radio" name="extract-type" value="simple" checked>
                    Simple Keys (e.g., "name", "age", "address")
                </label>
                <label>
                    <input type="radio" name="extract-type" value="paths">
                    Key Paths (e.g., "user.name", "user.address.city")
                </label>
            </div>
            <div class="options-group">
                <span class="options-group-label">Sort Order</span>
                <label>
                    <input type="radio" name="sort-order" value="natural" checked>
                    Natural (original order)
                </label>
                <label>
                    <input type="radio" name="sort-order" value="asc">
                    Sort A-Z
                </label>
                <label>
                    <input type="radio" name="sort-order" value="desc">
                    Sort Z-A
                </label>
            </div>
        </div>
    </div>
</div>
`;
