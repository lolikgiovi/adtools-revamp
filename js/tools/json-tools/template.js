/**
 * JSON Tools HTML Template
 * Contains the UI structure for JSON validation, formatting, and manipulation tools
 */

window.JSONToolsTemplate = /* html */ `
<div class="json-tools-container">
    <div class="json-tools-header">
        <div class="json-tools-tabs">
            <button class="tab-button active" data-tab="validator">Validator</button>
            <button class="tab-button" data-tab="prettify">Prettify</button>
            <button class="tab-button" data-tab="minify">Minify</button>
            <button class="tab-button" data-tab="stringify">Stringify</button>
            <button class="tab-button" data-tab="unstringify">Unstringify</button>
            <button class="tab-button" data-tab="escape">Escape</button>
            <button class="tab-button" data-tab="unescape">Unescape</button>
            <button class="tab-button" data-tab="extract-keys">Extract Keys</button>
        </div>
    </div>
    
    <div class="json-tools-main">
        <div class="json-editor-section">
            <div class="editor-header">
                <h3>JSON Input</h3>
                <div class="editor-actions">
                    <button class="btn-clear" title="Clear Editor">Clear</button>
                    <button class="btn-copy-input" title="Copy Input">Copy</button>
                </div>
            </div>
            <div id="json-editor" class="json-editor"></div>
        </div>
        
        <div class="json-output-section">
            <div class="output-header">
                <h3 id="output-title">Output</h3>
                <div class="output-actions">
                    <button class="btn-copy-output" title="Copy Output">Copy</button>
                </div>
            </div>
            <div id="json-output" class="json-output"></div>
        </div>
    </div>
    
    <div class="json-error-panel" id="error-panel">
        <div class="error-header">
            <h4>Errors & Warnings</h4>
            <button class="btn-toggle-errors" title="Toggle Error Panel">▼</button>
        </div>
        <div class="error-content" id="error-content">
            <div class="no-errors">No errors detected</div>
        </div>
    </div>
    
    <!-- Extract Keys Options Panel -->
    <div class="extract-options-panel" id="extract-options" style="display: none;">
        <div class="options-header">
            <h4>Extract Keys Options</h4>
        </div>
        <div class="options-content">
            <label>
                <input type="radio" name="extract-type" value="simple" checked>
                Simple Keys (e.g., "name", "age", "address")
            </label>
            <label>
                <input type="radio" name="extract-type" value="paths">
                Key Paths (e.g., "user.name", "user.address.city")
            </label>
        </div>
    </div>
</div>
`;
