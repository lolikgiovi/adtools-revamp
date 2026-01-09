/**
 * VTL JSON Editor HTML Template
 * Contains the UI structure for VTL template editing and validation
 */

export const VTLJSONEditorTemplate = /* html */ `
<div class="vtl-editor-container">
    <div class="vtl-editor-header">
        <div class="tabs-container vtl-editor-tabs">
            <div class="tabs-left">
                <button class="tab-button active" data-tab="validate">Validate</button>
                <button class="tab-button" data-tab="preview">Preview</button>
                <button class="tab-button" data-tab="variables">Variables</button>
            </div>
        </div>
    </div>
    
    <div class="vtl-editor-main">
        <div class="vtl-input-section">
            <div class="vtl-input-header">
                <h3>VTL Template</h3>
                <div class="vtl-input-actions">
                    <button class="btn btn-ghost btn-sm btn-clear" title="Clear Editor">Clear</button>
                    <button class="btn btn-ghost btn-sm btn-copy-input" title="Copy Input">Copy</button>
                    <button class="btn btn-ghost btn-sm btn-paste" title="Paste from Clipboard">Paste</button>
                    <button class="btn btn-primary btn-sm btn-action-primary" title="Perform Action">Validate</button>
                </div>
            </div>
            <div id="vtl-input-editor" class="vtl-monaco-editor"></div>
        </div>
        
        <div class="vtl-output-section">
            <div class="vtl-output-header">
                <h3 id="vtl-output-title">Validation Results</h3>
                <div class="vtl-output-actions">
                    <button class="btn btn-ghost btn-sm btn-copy-output" title="Copy Output">Copy</button>
                    <button class="btn btn-ghost btn-sm btn-generate-mock" title="Generate Mock Data" style="display: none;">Generate Mock</button>
                </div>
            </div>
            <!-- Validation Results -->
            <div id="vtl-validation-output" class="vtl-output-panel"></div>
            <!-- Preview Output -->
            <div id="vtl-preview-output" class="vtl-monaco-editor" style="display: none;"></div>
            <!-- Variables List -->
            <div id="vtl-variables-output" class="vtl-output-panel" style="display: none;"></div>
        </div>
    </div>
    
    <!-- Mock Data Panel (collapsible) -->
    <div class="vtl-mock-panel" id="vtl-mock-panel" style="display: none;">
        <div class="vtl-mock-header">
            <h4>Mock Data (JSON)</h4>
            <button class="btn btn-ghost btn-sm btn-toggle-mock" title="Toggle Mock Panel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6,9 12,15 18,9"/>
                </svg>
            </button>
        </div>
        <div id="vtl-mock-editor" class="vtl-monaco-editor vtl-mock-editor"></div>
    </div>
</div>
`;
