export const QUERIFY_TEMPLATE = /* html */ `
<div class="querify-container tool-container">
  <div class="querify-layout">
    <aside class="querify-sidebar">
      <div class="querify-toolbar">
        <button class="btn btn-ghost btn-xs" id="querify-add-files" title="Add Excel files">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <path d="M12 12v6"></path>
            <path d="M9 15h6"></path>
          </svg>
          Add Files
        </button>
        <button class="btn btn-ghost btn-xs" id="querify-clear-files" title="Clear files" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
          </svg>
          Clear
        </button>
      </div>

      <div class="querify-controls">
        <label for="querify-query-type">Query Type</label>
        <select id="querify-query-type" class="form-input">
          <option value="merge" selected>MERGE</option>
          <option value="insert">INSERT</option>
          <option value="update">UPDATE</option>
        </select>
        <button class="btn btn-primary" id="querify-generate" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14"></path>
            <path d="M13 6l6 6-6 6"></path>
          </svg>
          Generate
        </button>
      </div>

      <input type="file" id="querify-file-input" accept=".xlsx,.xls" multiple hidden>
      <div class="querify-file-list" id="querify-file-list">
        <div class="querify-empty" id="querify-empty-state">No files added</div>
      </div>
    </aside>

    <section class="querify-results">
      <div class="querify-result-header">
        <div class="querify-result-tabs">
          <button class="querify-tab active" data-view="selected">Selected</button>
          <button class="querify-tab" data-view="combined">Combined</button>
        </div>
        <div class="querify-result-actions">
          <button class="btn btn-ghost btn-xs" id="querify-copy" title="Copy SQL" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
          <button class="btn btn-ghost btn-xs" id="querify-download" title="Download SQL" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download
          </button>
        </div>
      </div>
      <div class="querify-message" id="querify-message"></div>
      <div class="querify-editor" id="querify-editor"></div>
    </section>
  </div>
</div>`;
