class Base64Tools extends BaseTool {
  constructor(eventBus) {
    super({
      id: "base64-tools",
      name: "Base64 Tools",
      description: "Encode and decode Base64 with text and file support",
      category: "general",
      eventBus: eventBus,
    });
    this.currentMode = "encode";
    this.uploadedFiles = [];
    this.selectedFiles = new Map(); // Store selected files for processing
  }

  render() {
    return window.Base64ToolsTemplate;
  }

  async onMount() {
    console.log("🔍 [DEBUG] Base64Tools onMount() called");
    console.log("🔍 [DEBUG] Container at mount:", this.container);
    
    this.bindToolEvents();
    this.setupTabs();
    this.setupFileHandling();
    this.processCurrentMode();
    
    console.log("🔍 [DEBUG] Base64Tools onMount() completed");
  }

  // Override the base bindEvents to prevent early binding
  bindEvents() {
    // Don't bind events during initialization - wait for onMount
  }

  bindToolEvents() {
    const container = this.container;
    if (!container) return;

    // Tab switching
    const tabButtons = container.querySelectorAll(".tab-button");
    tabButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        const mode = e.target.dataset.mode;
        if (mode) {
          this.switchMode(mode);
        }
      });
    });

    // Process buttons
    const encodeBtn = container.querySelector("#encode-btn");
    const decodeBtn = container.querySelector("#decode-btn");

    console.log("🔍 [DEBUG] Button elements found:", { encodeBtn, decodeBtn });

    if (encodeBtn) {
      console.log("🔍 [DEBUG] Adding click listener to encode button");
      encodeBtn.addEventListener("click", () => {
        console.log("🔍 [DEBUG] Encode button clicked!");
        this.encodeToBase64();
      });
    } else {
      console.warn("⚠️ [DEBUG] Encode button not found!");
    }

    if (decodeBtn) {
      console.log("🔍 [DEBUG] Adding click listener to decode button");
      decodeBtn.addEventListener("click", () => {
        console.log("🔍 [DEBUG] Decode button clicked!");
        this.decodeFromBase64();
      });
    } else {
      console.warn("⚠️ [DEBUG] Decode button not found!");
    }

    // Copy buttons
    const encodeCopyBtn = container.querySelector("#encode-copy-btn");
    const decodeCopyBtn = container.querySelector("#decode-copy-btn");

    if (encodeCopyBtn) {
      encodeCopyBtn.addEventListener("click", () =>
        this.copyToClipboard("encode-output")
      );
    }

    if (decodeCopyBtn) {
      decodeCopyBtn.addEventListener("click", () =>
        this.copyToClipboard("decode-output")
      );
    }

    // Paste buttons
    const encodePasteBtn = container.querySelector("#encode-paste-btn");
    const decodePasteBtn = container.querySelector("#decode-paste-btn");

    if (encodePasteBtn) {
      encodePasteBtn.addEventListener("click", () =>
        this.pasteFromClipboard("encode-input")
      );
    }

    if (decodePasteBtn) {
      decodePasteBtn.addEventListener("click", () =>
        this.pasteFromClipboard("decode-input")
      );
    }

    // Clear buttons
    const encodeClearBtn = container.querySelector("#encode-clear-btn");
    const decodeClearBtn = container.querySelector("#decode-clear-btn");
    const encodeOutputClearBtn = container.querySelector(
      "#encode-output-clear-btn"
    );
    const decodeOutputClearBtn = container.querySelector(
      "#decode-output-clear-btn"
    );

    if (encodeClearBtn) {
      encodeClearBtn.addEventListener("click", () => this.clearInputFiles("encode"));
    }

    if (decodeClearBtn) {
      decodeClearBtn.addEventListener("click", () => this.clearInputFiles("decode"));
    }

    if (encodeOutputClearBtn) {
      encodeOutputClearBtn.addEventListener("click", () => this.clearOutputFiles("encode"));
    }

    if (decodeOutputClearBtn) {
      decodeOutputClearBtn.addEventListener("click", () => this.clearOutputFiles("decode"));
    }

    if (encodeOutputClearBtn) {
      encodeOutputClearBtn.addEventListener("click", () =>
        this.clearField("encode")
      );
    }

    if (decodeOutputClearBtn) {
      decodeOutputClearBtn.addEventListener("click", () =>
        this.clearField("decode")
      );
    }

    // Download buttons
    const encodeDownloadBtn = container.querySelector("#encode-download-btn");
    const decodeDownloadBtn = container.querySelector("#decode-download-btn");

    if (encodeDownloadBtn) {
      encodeDownloadBtn.addEventListener("click", () =>
        this.downloadResult("encode")
      );
    }

    if (decodeDownloadBtn) {
      decodeDownloadBtn.addEventListener("click", () =>
        this.downloadResult("decode")
      );
    }

    // File upload inputs are handled in setupFileHandling() method
    // Removed duplicate event listeners to prevent duplicate file cards
  }

  setupTabs() {
    const container = this.container;
    if (!container) return;

    // Set initial active tab
    this.switchMode(this.currentMode);
  }

  setupFileHandling() {
    const container = this.container;
    if (!container) return;

    // Setup file input handlers for multiple file selection
    const encodeFileInput = container.querySelector("#encode-file-input");
    const decodeFileInput = container.querySelector("#decode-file-input");

    if (encodeFileInput) {
      encodeFileInput.addEventListener("change", (e) => {
        this.handleMultipleFileUpload(e, "encode");
      });
    }

    if (decodeFileInput) {
      decodeFileInput.addEventListener("change", (e) => {
        this.handleMultipleFileUpload(e, "decode");
      });
    }
  }

  switchMode(mode) {
    const container = this.container;
    if (!container) return;

    this.currentMode = mode;

    // Update tab buttons
    const tabButtons = container.querySelectorAll(".tab-button");
    tabButtons.forEach((btn) => {
      btn.classList.remove("active");
      if (btn.dataset.mode === mode) {
        btn.classList.add("active");
      }
    });

    // Update sections visibility
    const sections = container.querySelectorAll(".tool-section");
    sections.forEach((section) => {
      section.style.display = section.classList.contains(`${mode}-section`)
        ? "block"
        : "none";
    });
  }

  processCurrentMode() {
    if (this.currentMode === "encode") {
      this.encodeToBase64();
    } else {
      this.decodeFromBase64();
    }
  }

  async handleMultipleFileUpload(event, mode) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Hide textareas during file upload
    this.hideTextareas(mode);

    // Add files to selected files map and display them
    files.forEach(file => {
      const fileId = `${mode}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.selectedFiles.set(fileId, { file, mode });
      this.displayFileCard(file, fileId, mode);
    });

    // Show files display container
    this.showFilesDisplay(mode);
  }

  displayFileCard(file, fileId, mode) {
    const container = this.container;
    if (!container) return;

    const filesContainer = container.querySelector(`#${mode}-files-container`);
    if (!filesContainer) return;

    const fileCard = document.createElement('div');
    fileCard.className = 'file-card';
    fileCard.dataset.fileId = fileId;

    fileCard.innerHTML = `
      <div class="file-card-info">
        <svg class="file-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 1 2 2h12a2 2 0 0 1 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <div class="file-card-details">
          <p class="file-card-name" title="${file.name}">${file.name}</p>
          <p class="file-card-size">${this.formatFileSize(file.size)}</p>
        </div>
      </div>
      <button class="file-card-remove" type="button" title="Remove file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    // Add remove functionality
    const removeBtn = fileCard.querySelector('.file-card-remove');
    removeBtn.addEventListener('click', () => {
      this.removeFileCard(fileId, mode);
    });

    filesContainer.appendChild(fileCard);
  }

  removeFileCard(fileId, mode) {
    const container = this.container;
    if (!container) return;

    // Remove from selected files
    this.selectedFiles.delete(fileId);

    // Remove card from DOM
    const fileCard = container.querySelector(`[data-file-id="${fileId}"]`);
    if (fileCard) {
      fileCard.remove();
    }

    // Hide files display if no files left
    const filesContainer = container.querySelector(`#${mode}-files-container`);
    if (filesContainer && filesContainer.children.length === 0) {
      this.hideFilesDisplay(mode);
      this.showTextareas(mode);
    }
  }

  showFilesDisplay(mode) {
    const container = this.container;
    if (!container) return;

    const filesDisplay = container.querySelector(`#${mode}-files-display`);
    if (filesDisplay) {
      filesDisplay.style.display = 'block';
    }
  }

  hideFilesDisplay(mode) {
    const container = this.container;
    if (!container) return;

    const filesDisplay = container.querySelector(`#${mode}-files-display`);
    if (filesDisplay) {
      filesDisplay.style.display = 'none';
    }
  }

  hideTextareas(mode) {
    const container = this.container;
    if (!container) return;

    // Only hide textareas if processed files are present (not input files)
    const processedDisplay = container.querySelector(`#${mode}-processed-files`);
    const processedContainer = container.querySelector(`#${mode}-processed-container`);
    
    // Check if processed files div is visible and has content
    const hasProcessedFiles = processedDisplay && 
                             processedDisplay.style.display !== 'none' && 
                             processedContainer && 
                             processedContainer.children.length > 0;

    if (hasProcessedFiles) {
      const inputTextarea = container.querySelector(`#${mode}-input`);
      const outputTextarea = container.querySelector(`#${mode}-output`);
      
      if (inputTextarea) {
        inputTextarea.style.display = 'none';
      }
      
      if (outputTextarea) {
        outputTextarea.style.display = 'none';
      }
    }
  }

  showTextareas(mode) {
    const container = this.container;
    if (!container) return;

    const inputTextarea = container.querySelector(`#${mode}-input`);
    const outputTextarea = container.querySelector(`#${mode}-output`);
    
    if (inputTextarea) {
      inputTextarea.style.display = 'block';
    }
    
    if (outputTextarea) {
      outputTextarea.style.display = 'block';
    }
  }

  async processFile(file, mode) {
    const container = this.container;
    if (!container) return;

    try {
      if (mode === "encode") {
        // For encoding, read file as ArrayBuffer and convert to base64
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);

        const outputArea = container.querySelector("#encode-output");
        if (outputArea) {
          outputArea.value = base64;
        }
      } else {
        // For decoding, read file as text and decode
        const text = await this.readFileAsText(file);
        try {
          const binaryString = atob(text.trim());
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          // Create blob and show download option
          const blob = new Blob([bytes]);
          const outputArea = container.querySelector("#decode-output");
          if (outputArea) {
            outputArea.value = `File decoded successfully. Size: ${this.formatFileSize(
              blob.size
            )}`;
          }

          // Store for download
          this.decodedBlob = blob;
          this.decodedFilename =
            file.name.replace(/\.[^/.]+$/, "") + "_decoded";
        } catch (error) {
          this.showError("Invalid Base64 content in file");
        }
      }

      this.showFileInfo(file, mode);
    } catch (error) {
      this.showError(`Failed to process file: ${error.message}`);
    }
  }

  showFileInfo(file, mode) {
    const container = this.container;
    if (!container) return;

    const infoDiv = container.querySelector(`#${mode}-file-info`);
    if (infoDiv) {
      infoDiv.innerHTML = `
        <div class="file-info-item">
          <strong>File:</strong> ${file.name}
        </div>
        <div class="file-info-item">
          <strong>Size:</strong> ${this.formatFileSize(file.size)}
        </div>
        <div class="file-info-item">
          <strong>Type:</strong> ${file.type || "Unknown"}
        </div>
      `;
      infoDiv.style.display = "block";
    }
  }

  async encodeToBase64() {
    console.log("🔍 [DEBUG] encodeToBase64() method called");
    
    const container = this.container;
    if (!container) {
      console.error("❌ [DEBUG] Container not found in encodeToBase64");
      return;
    }

    console.log("🔍 [DEBUG] Container found:", container);

    // Check if we have selected files to process
    const selectedFilesForMode = Array.from(this.selectedFiles.entries())
      .filter(([_, data]) => data.mode === 'encode');

    console.log("🔍 [DEBUG] Selected files for encode mode:", selectedFilesForMode.length, selectedFilesForMode);

    if (selectedFilesForMode.length > 0) {
      console.log("🔍 [DEBUG] Processing multiple files for encode");
      // Process multiple files
      await this.processMultipleFiles('encode');
    } else {
      console.log("🔍 [DEBUG] Processing text input for encode");
      // Process text input as before
      const inputArea = container.querySelector("#encode-input");
      const outputArea = container.querySelector("#encode-output");

      console.log("🔍 [DEBUG] Input/Output areas found:", { inputArea, outputArea });

      if (!inputArea || !outputArea) {
        console.error("❌ [DEBUG] Input or output area not found");
        return;
      }

      const text = inputArea.value;
      console.log("🔍 [DEBUG] Input text:", text ? `"${text.substring(0, 50)}..."` : "empty");

      if (!text.trim()) {
        console.log("🔍 [DEBUG] Empty input, clearing output");
        // Success - using BaseTool's native notification system
        outputArea.value = "";
        return;
      }

      try {
        console.log("🔍 [DEBUG] Attempting to encode text to Base64");
        const encoded = btoa(unescape(encodeURIComponent(text)));
        outputArea.value = encoded;
        console.log("✅ [DEBUG] Successfully encoded text to Base64");
        // Success - using BaseTool's native notification system
      } catch (error) {
        console.error("❌ [DEBUG] Error encoding text:", error);
        this.showError("Failed to encode text to Base64");
        outputArea.value = "";
      }
    }
  }

  async decodeFromBase64() {
    console.log("🔍 [DEBUG] decodeFromBase64() method called");
    
    const container = this.container;
    if (!container) {
      console.error("❌ [DEBUG] Container not found in decodeFromBase64");
      return;
    }

    console.log("🔍 [DEBUG] Container found:", container);

    // Check if we have selected files to process
    const selectedFilesForMode = Array.from(this.selectedFiles.entries())
      .filter(([_, data]) => data.mode === 'decode');

    console.log("🔍 [DEBUG] Selected files for decode mode:", selectedFilesForMode.length, selectedFilesForMode);

    if (selectedFilesForMode.length > 0) {
      console.log("🔍 [DEBUG] Processing multiple files for decode");
      // Process multiple files
      await this.processMultipleFiles('decode');
    } else {
      console.log("🔍 [DEBUG] Processing text input for decode");
      // Process text input as before
      const inputArea = container.querySelector("#decode-input");
      const outputArea = container.querySelector("#decode-output");

      console.log("🔍 [DEBUG] Input/Output areas found:", { inputArea, outputArea });

      if (!inputArea || !outputArea) {
        console.error("❌ [DEBUG] Input or output area not found");
        return;
      }

      const base64Text = inputArea.value.trim();
      console.log("🔍 [DEBUG] Input Base64 text:", base64Text ? `"${base64Text.substring(0, 50)}..."` : "empty");

      if (!base64Text) {
        console.log("🔍 [DEBUG] Empty input, clearing output");
        // Success - using BaseTool's native notification system
        outputArea.value = "";
        return;
      }

      try {
        console.log("🔍 [DEBUG] Attempting to decode Base64 text");
        const decoded = decodeURIComponent(escape(atob(base64Text)));
        outputArea.value = decoded;
        console.log("✅ [DEBUG] Successfully decoded Base64 text");
        // Success - using BaseTool's native notification system
      } catch (error) {
        console.error("❌ [DEBUG] Error decoding Base64:", error);
        this.showError("Invalid Base64 input");
        outputArea.value = "";
      }
    }
  }

  async processMultipleFiles(mode) {
    console.log("🔍 [DEBUG] processMultipleFiles() called with mode:", mode);
    
    const container = this.container;
    if (!container) {
      console.error("❌ [DEBUG] Container not found in processMultipleFiles");
      return;
    }

    const selectedFilesForMode = Array.from(this.selectedFiles.entries())
      .filter(([_, data]) => data.mode === mode);

    console.log("🔍 [DEBUG] Selected files for processing:", selectedFilesForMode.length, selectedFilesForMode.map(([id, data]) => data.file.name));

    if (selectedFilesForMode.length === 0) {
      console.log("🔍 [DEBUG] No files selected for mode:", mode);
      return;
    }

    // Hide textareas during processing
    console.log("🔍 [DEBUG] Hiding textareas for mode:", mode);
    this.hideTextareas(mode);
    const outputArea = container.querySelector(`#${mode}-output`);
    if (outputArea) {
      outputArea.style.display = 'none';
      console.log("🔍 [DEBUG] Output area hidden");
    }

    // Clear processed files display
    console.log("🔍 [DEBUG] Clearing processed files display");
    this.clearProcessedFiles(mode);

    // Process each file
    const processedFiles = [];
    console.log("🔍 [DEBUG] Starting to process", selectedFilesForMode.length, "files");
    
    for (const [fileId, { file }] of selectedFilesForMode) {
      console.log("🔍 [DEBUG] Processing file:", file.name, "size:", file.size);
      try {
        const result = await this.processFileForMultiple(file, mode);
        console.log("🔍 [DEBUG] File processed successfully:", file.name, "result length:", result.length);
        
        processedFiles.push({
          originalName: file.name,
          processedName: `${file.name.split('.')[0]}.txt`,
          content: result,
          size: new Blob([result]).size
        });
      } catch (error) {
        console.error("❌ [DEBUG] Failed to process file:", file.name, error);
        this.showError(`Failed to process ${file.name}: ${error.message}`);
      }
    }

    console.log("🔍 [DEBUG] All files processed. Total processed files:", processedFiles.length);

    // Display processed files
    console.log("🔍 [DEBUG] Calling displayProcessedFiles with", processedFiles.length, "files");
    this.displayProcessedFiles(processedFiles, mode);

    // Clear selected files and reset to default state after processing
    console.log("🔍 [DEBUG] Clearing file upload state");
    this.clearFileUploadState(mode);
    
    console.log("🔍 [DEBUG] processMultipleFiles() completed");
  }

  async processFileForMultiple(file, mode) {
    console.log("🔍 [DEBUG] processFileForMultiple() called with file:", file.name, "mode:", mode, "size:", file.size);
    
    try {
      if (mode === 'encode') {
        console.log("🔍 [DEBUG] Encoding file to Base64");
        // For encoding, read file as ArrayBuffer and convert to base64
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        console.log("🔍 [DEBUG] File read as ArrayBuffer, size:", arrayBuffer.byteLength);
        
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        
        const base64Result = btoa(binary);
        console.log("🔍 [DEBUG] File encoded to Base64, result length:", base64Result.length);
        return base64Result;
      } else {
        console.log("🔍 [DEBUG] Decoding file from Base64");
        // For decoding, read file as text and decode
        const text = await this.readFileAsText(file);
        console.log("🔍 [DEBUG] File read as text, length:", text.length);
        
        const binaryString = atob(text.trim());
        console.log("🔍 [DEBUG] File decoded from Base64, result length:", binaryString.length);
        return binaryString;
      }
    } catch (error) {
      console.error("❌ [DEBUG] Error in processFileForMultiple:", error);
      throw error;
    }
  }

  displayProcessedFiles(processedFiles, mode) {
    console.log("🔍 [DEBUG] displayProcessedFiles() called with mode:", mode, "files count:", processedFiles.length);
    
    const container = this.container;
    if (!container) {
      console.error("❌ [DEBUG] Container not found in displayProcessedFiles");
      return;
    }

    const processedContainer = container.querySelector(`#${mode}-processed-container`);
    const processedDisplay = container.querySelector(`#${mode}-processed-files`);
    
    console.log("🔍 [DEBUG] DOM elements found:", {
      processedContainer: !!processedContainer,
      processedDisplay: !!processedDisplay,
      containerSelector: `#${mode}-processed-container`,
      displaySelector: `#${mode}-processed-files`
    });
    
    if (!processedContainer || !processedDisplay) {
      console.error("❌ [DEBUG] Required DOM elements not found for processed files display");
      return;
    }

    // Clear existing processed files
    console.log("🔍 [DEBUG] Clearing existing processed files");
    processedContainer.innerHTML = '';

    // Add each processed file as a card
    console.log("🔍 [DEBUG] Creating file cards for", processedFiles.length, "processed files");
    processedFiles.forEach((fileData, index) => {
      console.log("🔍 [DEBUG] Creating card for file:", fileData.processedName, "size:", fileData.size);
      
      const fileCard = document.createElement('div');
      fileCard.className = 'file-card processed-file-card';
      fileCard.dataset.fileIndex = index;

      fileCard.innerHTML = `
        <div class="file-card-info">
          <svg class="file-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 1 2 2h12a2 2 0 0 1 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <div class="file-card-details">
            <p class="file-card-name" title="${fileData.processedName}">${fileData.processedName}</p>
            <p class="file-card-size">${this.formatFileSize(fileData.size)}</p>
          </div>
        </div>
        <button class="btn btn-sm download-btn" type="button" title="Download processed file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download
        </button>
      `;

      // Add download functionality
      const downloadBtn = fileCard.querySelector('.download-btn');
      downloadBtn.addEventListener('click', () => {
        console.log("🔍 [DEBUG] Download button clicked for file:", fileData.processedName);
        this.downloadProcessedFile(fileData);
      });

      console.log("🔍 [DEBUG] Appending file card to container");
      processedContainer.appendChild(fileCard);
    });

    // Show processed files display
    console.log("🔍 [DEBUG] Showing processed files display");
    processedDisplay.style.display = 'block';
    
    // Hide textarea when processed files are present (not input files)
    console.log("🔍 [DEBUG] Hiding textarea since processed files are present");
    this.hideTextareas(mode);
    
    console.log("✅ [DEBUG] displayProcessedFiles() completed successfully");
  }

  downloadProcessedFile(fileData) {
    const blob = new Blob([fileData.content], { type: 'text/plain' });
    this.downloadBlob(blob, fileData.processedName);
  }

  clearProcessedFiles(mode) {
    const container = this.container;
    if (!container) return;

    const processedDisplay = container.querySelector(`#${mode}-processed-files`);
    const processedContainer = container.querySelector(`#${mode}-processed-container`);
    
    if (processedDisplay) {
      processedDisplay.style.display = 'none';
    }
    
    if (processedContainer) {
      processedContainer.innerHTML = '';
    }
  }

  async copyToClipboard(targetId) {
    const container = this.container;
    if (!container) return;

    const element = container.querySelector(`#${targetId}`);
    if (!element || !element.value.trim()) {
      this.showError("No content to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(element.value);
      this.showSuccess("Copied to clipboard!");
    } catch (error) {
      this.showError("Failed to copy to clipboard");
      console.error("Clipboard error:", error);
    }
  }

  async pasteFromClipboard(targetId) {
    const container = this.container;
    if (!container) return;

    try {
      const text = await navigator.clipboard.readText();
      const element = container.querySelector(`#${targetId}`);
      if (element) {
        element.value = text;
        // Trigger processing
        this.processCurrentMode();
        this.showSuccess("Pasted from clipboard!");
      }
    } catch (error) {
      this.showError("Failed to paste from clipboard");
      console.error("Clipboard error:", error);
    }
  }

  clearField(targetId) {
    const container = this.container;
    if (!container) return;

    const inputElement = container.querySelector(`#${targetId}-input`);
    const outputElement = container.querySelector(`#${targetId}-output`);
    const fileInfoElement = container.querySelector(`#${targetId}-file-info`);

    if (inputElement) inputElement.value = "";
    if (outputElement) outputElement.value = "";
    if (fileInfoElement) {
      fileInfoElement.style.display = "none";
      fileInfoElement.innerHTML = "";
    }

    // Clear any stored decoded blob
    if (targetId === "decode") {
      this.decodedBlob = null;
      this.decodedFilename = null;
    }

    // Clear file upload state and reset to default textfield state
    this.clearFileUploadState(targetId);

    // Success - using BaseTool's native notification system
  }

  clearInputFiles(mode) {
    console.log(`[DEBUG] Clearing input files for mode: ${mode}`);
    const container = this.container;
    if (!container) return;

    // Clear the textarea input
    const inputElement = container.querySelector(`#${mode}-input`);
    if (inputElement) inputElement.value = "";

    // Clear file info display
    const fileInfoElement = container.querySelector(`#${mode}-file-info`);
    if (fileInfoElement) {
      fileInfoElement.style.display = "none";
      fileInfoElement.innerHTML = "";
    }

    // Clear uploaded files display
    this.clearFileUploadState(mode);

    // Show textarea if it was hidden
    this.showTextareas(mode);

    console.log(`[DEBUG] Input files cleared for mode: ${mode}`);
  }

  clearOutputFiles(mode) {
    console.log(`[DEBUG] Clearing output files for mode: ${mode}`);
    const container = this.container;
    if (!container) return;

    // Clear the textarea output
    const outputElement = container.querySelector(`#${mode}-output`);
    if (outputElement) outputElement.value = "";

    // Clear processed files display
    this.clearProcessedFiles(mode);

    // Clear any stored decoded blob
    if (mode === "decode") {
      this.decodedBlob = null;
      this.decodedFilename = null;
    }

    // Show textarea if it was hidden
    this.showTextareas(mode);

    console.log(`[DEBUG] Output files cleared for mode: ${mode}`);
  }

  clearFileUploadState(mode) {
    const container = this.container;
    if (!container) return;

    // Clear selected files for this mode
    const filesToRemove = Array.from(this.selectedFiles.entries())
      .filter(([_, data]) => data.mode === mode)
      .map(([fileId]) => fileId);
    
    filesToRemove.forEach(fileId => {
      this.selectedFiles.delete(fileId);
    });

    // Clear file cards
    const filesContainer = container.querySelector(`#${mode}-files-container`);
    if (filesContainer) {
      filesContainer.innerHTML = '';
    }

    // Hide files display
    this.hideFilesDisplay(mode);

    // Don't clear processed files - they should remain visible after processing
    // this.clearProcessedFiles(mode);

    // Show textareas
    this.showTextareas(mode);

    // Show output area
    const outputArea = container.querySelector(`#${mode}-output`);
    if (outputArea) {
      outputArea.style.display = 'block';
    }

    // Reset file input
    const fileInput = container.querySelector(`#${mode}-file-input`);
    if (fileInput) {
      fileInput.value = '';
    }
  }

  downloadResult(mode) {
    const container = this.container;
    if (!container) return;

    if (mode === "encode") {
      const outputArea = container.querySelector("#encode-output");
      if (!outputArea || !outputArea.value.trim()) {
        this.showError("No encoded content to download");
        return;
      }

      const blob = new Blob([outputArea.value], { type: "text/plain" });
      this.downloadBlob(blob, "encoded.txt");
    } else {
      // For decode mode, check if we have a decoded blob
      if (this.decodedBlob) {
        this.downloadBlob(
          this.decodedBlob,
          this.decodedFilename || "decoded_file"
        );
      } else {
        const outputArea = container.querySelector("#decode-output");
        if (!outputArea || !outputArea.value.trim()) {
          this.showError("No decoded content to download");
          return;
        }

        const blob = new Blob([outputArea.value], { type: "text/plain" });
        this.downloadBlob(blob, "decoded.txt");
      }
    }
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showSuccess(`Downloaded: ${filename}`);
  }

  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // Removed custom notification methods - now using BaseTool's native notification system

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}

window.Base64Tools = Base64Tools;
