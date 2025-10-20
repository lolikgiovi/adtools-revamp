export const MAIN_TEMPLATE = /* html */ `<div class="quick-query-tool-container">
    <div class="quick-query-content">
        <div class="content-a">
            <div class="quick-query-left-panel">
                <div class="button-group quick-query-search">
                    <select id="queryTypeSelect">
                        <option value="merge">MERGE INTO</option>
                        <option value="insert">INSERT</option>
                        <option value="update">UPDATE</option>
                    </select>
                    <input type="text" id="tableNameInput" placeholder="schema_name.table_name"
                        value="schema_name.table_name">
                </div>
                <div class="button-group quick-query-left-controls">
                    <button id="showSavedSchemas" class="btn btn-primary">Schemas</button>
                    <button id="addNewSchemaRow" class="btn btn-primary">Add row</button>
                    <button id="removeLastSchemaRow" class="btn btn-primary">Remove last row</button>
                    <button id="clearAll" class="btn btn-primary">Clear All</button>
                    <button id="generateQuery" class="btn btn-primary">Generate Query</button>
                </div>

                <div id="spreadsheet-schema"></div>

                <!-- Attachments container -->
                <div id="files-container">
                    <div id="attachments-controls" class="button-group quick-query-attachments-controls" role="toolbar" aria-label="Attachment actions">
                        <button id="addFilesButton" class="btn btn-outline btn-xs" aria-label="Add file">Add file</button>
                        <button id="minifyButton" class="btn btn-outline btn-xs minify-button" aria-label="Minify attached text files" disabled aria-disabled="true">Minify</button>
                        <button id="deleteAllButton" class="btn btn-outline btn-xs delete-all-button" aria-label="Delete all attached files" disabled aria-disabled="true">Delete all</button>
                        <input type="file" id="attachmentsInput" accept=".txt, .jpg, .jpeg, .png, .html, .pdf, .json" multiple style="display: none;" />
                    </div>
                    <div id="file-items">
                        <div id="files-empty" class="empty-file-button" role="button" tabindex="0" aria-label="No file attached, click to attach file">No file attached, click to attach file</div>
                    </div>
                </div>

                <div id="guideContainer">
                </div>
            </div>
            <div class="quick-query-right-panel">
                <div class="button-group quick-query-right-controls">
                    <button id="toggleWordWrap" class="btn btn-primary">Word Wrap: Off</button>
                    <button id="copySQL" class="btn btn-primary">Copy SQL</button>
                    <button id="downloadSQL" class="btn btn-primary">Download SQL</button>
                </div>
                <div id="warningMessages"></div>
                <div id="errorMessages"></div>
                <div id="queryEditor" class="quick-query-content-area"></div>
            </div>
        </div>
        <div class="content-b">
            <div class="button-group quick-query-data-controls">
                <button id="addFieldNames" class="btn btn-primary">Add field names from schema</button>
                <button id="addDataRow" class="btn btn-primary">Add Row</button>
                <button id="removeDataRow" class="btn btn-primary">Remove Last Row</button>
                <button id="clearData" class="btn btn-primary">Clear Data</button>
                <p class="tip-text"><i class="tip-icon">💡</i> Tip: Enter 'max' for _id fields to enable auto-increment functionality</p>
            </div>
            <div id="spreadsheet-data"></div>
        </div>
    </div>
</div>

<div id="schemaOverlay" class="schema-overlay hidden">
    <div class="schema-modal">
        <div class="schema-modal-header">
            <h3>Saved Schemas</h3>
            <div class="schema-modal-actions">
                <button id="clearAllSchemas" class="btn btn-primary">Clear All</button>
                <button id="exportSchemas" class="btn btn-primary">Export</button>
                <button id="importSchemas" class="btn btn-primary">Import</button>
                <button id="closeSchemaOverlay" class="overlay-close-button">&times;</button>
            </div>
            <input type="file" id="schemaFileInput" accept=".json" style="display: none;">
        </div>
        <div class="schema-modal-content">
            <div id="savedSchemasList"></div>
        </div>
    </div>
</div>

<div id="fileViewerOverlay" class="file-viewer-overlay hidden">
    <div class="file-viewer-modal">
        <div class="file-viewer-header">
            <h3 id="fileViewerTitle">File Name</h3>
            <button id="closeFileViewer" class="overlay-close-button">&times;</button>
        </div>

        <div class="file-viewer-tabs">
            <button class="tab-button active" data-tab="original">Original</button>
            <button class="tab-button" data-tab="processed">Processed</button>
        </div>

        <div class="file-viewer-content">
            <div id="originalContent" class="tab-content active">
                <!-- Content will be dynamically inserted -->
            </div>
            <div id="processedContent" class="tab-content">
                <!-- Content will be dynamically inserted -->
            </div>
        </div>

        <div class="file-viewer-metadata">
            <div id="fileMetadata">
                <div class="metadata-grid">
                    <div id="fileType">File Type: -</div>
                    <div id="fileSize">Size: -</div>
                    <div id="base64Size" class="hidden">Base64 Size: -</div>
                    <div id="dimensions" class="hidden">Dimensions: -</div>
                    <div id="lineCount" class="hidden">Lines: -</div>
                    <div id="charCount" class="hidden">Characters: -</div>
                </div>
            </div>
        </div>
    </div>
</div>`;

export const FILE_BUTTON_TEMPLATE = (file) => {
  const t = (file.type || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return /* html */ `
  <div class="file-info">
    <button class="copy-filename" title="Copy filename" aria-label="Copy filename">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
    <span class="file-name">${file.name}</span>
  </div>
  <div class="file-actions">
    <span class="file-size" aria-label="File size">${(file.size / 1024).toFixed(2)} KB</span>
    <button class="delete-file" title="Delete file" aria-label="Delete file">×</button>
  </div>
`;
};
