window.Base64ToolsTemplate = /* html */ `
<div class="base64-tools">
  <!-- Messages -->
  <div class="error-message" style="display: none;"></div>
  <div class="success-message" style="display: none;"></div>

  <!-- Tab Navigation -->
  <div class="tab-navigation">
    <button class="tab-button active" data-mode="encode">
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
      Encode to Base64
    </button>
    <button class="tab-button" data-mode="decode">
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="8 18 2 12 8 6"></polyline>
        <polyline points="16 6 22 12 16 18"></polyline>
      </svg>
      Decode from Base64
    </button>
  </div>

  <!-- Encode Section -->
  <div class="encode-section tool-section">

    <!-- Input Area -->
    <div class="input-group">
      <div class="input-header">
        <label for="encode-input">Input Text</label>
        <div class="input-actions">
          <label class="btn btn-secondary file-upload-btn">
            <input type="file" id="encode-file-input" class="file-input" accept=".txt,.base64" style="display: none;" />
            <svg class="file-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Upload File
          </label>
          <button class="btn btn-sm paste-btn" data-target="encode-input" title="Paste from clipboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
            Paste
          </button>
          <button class="btn btn-sm clear-btn" data-target="encode-input" title="Clear input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            Clear
          </button>
        </div>
      </div>
      <textarea 
        id="encode-input" 
        class="form-textarea" 
        placeholder="Enter text to encode to Base64..."
        rows="4"
      ></textarea>
    </div>

    <!-- Process Button -->
    <div class="action-buttons">
      <button id="encode-btn" class="btn btn-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
        Encode to Base64
      </button>
    </div>

    <!-- Output Area -->
    <div class="output-group">
      <div class="output-header">
        <label for="encode-output">Base64 Output</label>
        <div class="output-actions">
          <button class="btn btn-sm copy-btn" data-target="encode-output" title="Copy to clipboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
          <button class="btn btn-sm download-btn" data-mode="encode" title="Download as file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download
          </button>
          <button class="btn btn-sm clear-btn" data-target="encode-output" title="Clear output">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            Clear
          </button>
        </div>
      </div>
      <textarea 
        id="encode-output" 
        class="form-textarea output-textarea" 
        placeholder="Base64 encoded result will appear here..."
        rows="4"
        readonly
      ></textarea>
    </div>
  </div>

  <!-- Decode Section -->
  <div class="decode-section tool-section" style="display: none;">

    <!-- Input Area -->
    <div class="input-group">
      <div class="input-header">
        <label for="decode-input">Base64 Input</label>
        <div class="input-actions">
          <label class="btn btn-secondary file-upload-btn">
            <input type="file" id="encode-file-input" class="file-input" accept=".txt,.base64" style="display: none;" />
            <svg class="file-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Upload File
          </label>
          <button class="btn btn-sm paste-btn" data-target="decode-input" title="Paste from clipboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
            Paste
          </button>
          <button class="btn btn-sm clear-btn" data-target="decode-input" title="Clear input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            Clear
          </button>
        </div>
      </div>
      <textarea 
        id="decode-input" 
        class="form-textarea" 
        placeholder="Enter Base64 encoded data to decode..."
        rows="4"
      ></textarea>
    </div>

    <!-- Process Button -->
    <div class="action-buttons">
      <button id="decode-btn" class="btn btn-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="8 18 2 12 8 6"></polyline>
          <polyline points="16 6 22 12 16 18"></polyline>
        </svg>
        Decode from Base64
      </button>
    </div>

    <!-- Output Area -->
    <div class="output-group">
      <div class="output-header">
        <label for="decode-output">Decoded Output</label>
        <div class="output-actions">
          <button class="btn btn-sm copy-btn" data-target="decode-output" title="Copy to clipboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
          <button class="btn btn-sm download-btn" data-mode="decode" title="Download as file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download
          </button>
          <button class="btn btn-sm clear-btn" data-target="decode-output" title="Clear output">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            Clear
          </button>
        </div>
      </div>
      <textarea 
        id="decode-output" 
        class="form-textarea output-textarea" 
        placeholder="Decoded result will appear here..."
        rows="4"
        readonly
      ></textarea>
    </div>
  </div>

</div>
`;
