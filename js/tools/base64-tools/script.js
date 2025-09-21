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

    // Check if any files are .txt files containing base64 data
    const txtFiles = files.filter(file => file.name.toLowerCase().endsWith('.txt'));
    const otherFiles = files.filter(file => !file.name.toLowerCase().endsWith('.txt'));

    // Process .txt files containing base64 data
    for (const txtFile of txtFiles) {
      await this.processTxtFileWithBase64(txtFile, mode);
    }

    // Handle other files normally if any
    if (otherFiles.length > 0) {
      // Hide textareas during file upload
      this.hideTextareas(mode);

      // Add files to selected files map and display them
      otherFiles.forEach(file => {
        const fileId = `${mode}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.selectedFiles.set(fileId, { file, mode });
        this.displayFileCard(file, fileId, mode);
      });

      // Show files display container
      this.showFilesDisplay(mode);
    }
  }

  async processTxtFileWithBase64(txtFile, mode) {
    try {
      console.log(`[DEBUG] Processing .txt file: ${txtFile.name}`);
      
      // Read the text file content
      const textContent = await this.readFileAsText(txtFile);
      
      // Clean and validate base64 content
      const base64Content = textContent.trim().replace(/\s+/g, '');
      
      if (!base64Content) {
        throw new Error('Empty file content');
      }

      // Validate base64 format
      if (!this.isValidBase64(base64Content)) {
        throw new Error('Invalid base64 format');
      }

      console.log(`[DEBUG] Valid base64 content found, length: ${base64Content.length}`);

      try {
        // Decode the base64 content
        const binaryString = atob(base64Content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Detect content type and process accordingly
        const contentType = this.detectContentType(bytes);
        console.log(`[DEBUG] Detected content type: ${contentType}`);

        if (contentType.startsWith('image/')) {
          await this.displayImagePreview(bytes, contentType, txtFile.name);
        } else if (this.isTextContent(binaryString)) {
          this.displayTextContent(binaryString, txtFile.name);
        } else {
          this.displayBinaryFileCard(bytes, contentType, txtFile.name);
        }
      } catch (decodeError) {
        console.error(`[ERROR] Failed to decode base64 content from ${txtFile.name}:`, decodeError);
        this.showError(`Failed to decode base64 content from ${txtFile.name}: ${decodeError.message}`);
      }

    } catch (error) {
      console.error(`[ERROR] Failed to process .txt file ${txtFile.name}:`, error);
      this.showError(`Failed to process ${txtFile.name}: ${error.message}`);
    }
  }

  isValidBase64(str) {
    try {
      // Check if string is empty or contains only whitespace
      if (!str || typeof str !== 'string' || !str.trim()) {
        return false;
      }

      // Remove whitespace and check basic format
      const cleanStr = str.replace(/\s/g, '');
      
      // Base64 should only contain valid characters
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Regex.test(cleanStr)) {
        return false;
      }

      // Length should be multiple of 4 (after padding)
      if (cleanStr.length % 4 !== 0) {
        return false;
      }

      // Try to decode to verify it's valid
      atob(cleanStr);
      return true;
    } catch (error) {
      return false;
    }
  }

  detectContentType(bytes) {
    // Check for common file signatures
    const signatures = {
      'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/gif': [0x47, 0x49, 0x46, 0x38],
      'image/webp': [0x52, 0x49, 0x46, 0x46],
      'image/bmp': [0x42, 0x4D],
      'image/svg+xml': [0x3C, 0x73, 0x76, 0x67], // <svg
      'application/pdf': [0x25, 0x50, 0x44, 0x46],
      'application/zip': [0x50, 0x4B, 0x03, 0x04],
      'text/html': [0x3C, 0x68, 0x74, 0x6D, 0x6C], // <html
      'text/xml': [0x3C, 0x3F, 0x78, 0x6D, 0x6C], // <?xml
    };

    for (const [mimeType, signature] of Object.entries(signatures)) {
      if (this.matchesSignature(bytes, signature)) {
        return mimeType;
      }
    }

    // Default to binary if no signature matches
    return 'application/octet-stream';
  }

  matchesSignature(bytes, signature) {
    if (bytes.length < signature.length) return false;
    
    for (let i = 0; i < signature.length; i++) {
      if (bytes[i] !== signature[i]) {
        return false;
      }
    }
  }

  async displayImagePreview(bytes, contentType, filename) {
    try {
      console.log(`[DEBUG] Displaying image preview for ${filename}, type: ${contentType}`);
      
      const container = this.container;
      if (!container) return;

      // Create blob and object URL for the image
      const blob = new Blob([bytes], { type: contentType });
      const imageUrl = URL.createObjectURL(blob);

      // Create image element to get dimensions
      const img = new Image();
      
      return new Promise((resolve, reject) => {
        img.onload = () => {
          try {
            const imageData = {
              name: filename.replace('.txt', ''),
              content: bytes,
              type: contentType,
              size: bytes.length,
              width: img.naturalWidth,
              height: img.naturalHeight,
              url: imageUrl
            };

            // Display in processed files area
            this.displayProcessedFiles([{
              originalName: filename,
              processedName: imageData.name,
              content: imageData,
              isImage: true
            }], 'decode');

            resolve();
          } catch (error) {
            reject(error);
          }
        };

        img.onerror = () => {
          reject(new Error(`Failed to load image: ${filename}`));
        };

        img.src = imageUrl;
      });

    } catch (error) {
      this.showError(`Error displaying image preview for ${filename}: ${error.message}`);
      console.error('Error in displayImagePreview:', error);
    }
  }

  displayTextContent(textContent, filename) {
    try {
      console.log(`[DEBUG] Displaying text content for ${filename}`);
      
      const container = this.container;
      if (!container) return;

      // Show textarea and insert text content
      this.showTextareas('decode');
      
      const outputArea = container.querySelector('#decode-output');
      if (outputArea) {
        outputArea.value = textContent;
        outputArea.style.display = 'block';
        
        // Show success message
        this.showSuccess(`Text content from ${filename} loaded into textarea`);
      } else {
        throw new Error('Output textarea not found');
      }

      console.log(`[DEBUG] Text content inserted into textarea for ${filename}`);
    } catch (error) {
      this.showError(`Error displaying text content from ${filename}: ${error.message}`);
      console.error('Error in displayTextContent:', error);
    }
  }

  displayBinaryFileCard(bytes, contentType, filename) {
    try {
      console.log(`[DEBUG] Displaying file card for ${filename}, type: ${contentType}`);
      
      const fileData = {
        name: filename.replace('.txt', ''),
        content: bytes,
        type: contentType,
        size: bytes.length
      };

      // Display in processed files area
      this.displayProcessedFiles([{
        originalName: filename,
        processedName: fileData.name,
        content: fileData,
        isFile: true
      }], 'decode');

      this.showSuccess(`Binary file ${filename} processed and displayed as file card`);
    } catch (error) {
      this.showError(`Error displaying binary file card for ${filename}: ${error.message}`);
      console.error('Error in displayBinaryFileCard:', error);
    }
  }

  showError(message) {
    console.error(`[ERROR] ${message}`);
    // You can implement a proper error display mechanism here
    // For now, just log to console
  }

  displayFileCard(file, fileId, mode) {
    const container = this.container;

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
        
        // Check if decoded content is text (printable characters)
        const isTextContent = this.isTextContent(decoded);
        console.log("🔍 [DEBUG] Decoded content is text:", isTextContent);
        
        if (isTextContent) {
          // Show as text in textarea
          outputArea.value = decoded;
          console.log("✅ [DEBUG] Successfully decoded Base64 text and displayed in textarea");
        } else {
          // Hide textarea and show as downloadable file
          outputArea.value = "";
          outputArea.style.display = 'none';
          
          // Store the decoded binary data for download
          const uint8Array = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) {
            uint8Array[i] = decoded.charCodeAt(i);
          }
          this.decodedBlob = new Blob([uint8Array]);
          this.decodedFilename = "decoded_file";
          
          // Show file info
          this.showFileInfo({ name: this.decodedFilename, size: this.decodedBlob.size }, 'decode');
          console.log("✅ [DEBUG] Successfully decoded Base64 binary and prepared for download");
        }
        
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
        console.log("🔍 [DEBUG] Encoding file to Base64 with data URI format");
        // For encoding, read file as ArrayBuffer and convert to base64 with data URI
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        console.log("🔍 [DEBUG] File read as ArrayBuffer, size:", arrayBuffer.byteLength);
        
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        
        const base64Result = btoa(binary);
        
        // Detect MIME type from file extension and content
        const mimeType = this.getMimeTypeFromFile(file, uint8Array);
        console.log("🔍 [DEBUG] Detected MIME type:", mimeType);
        
        // Create data URI format
        const dataUri = `data:${mimeType};base64,${base64Result}`;
        console.log("🔍 [DEBUG] File encoded to data URI, result length:", dataUri.length);
        return dataUri;
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

  // New method to get MIME type from file
  getMimeTypeFromFile(file, uint8Array) {
    // First try to detect from file content (magic numbers)
    const detectedType = this.detectContentType(uint8Array);
    if (detectedType !== 'application/octet-stream') {
      return detectedType;
    }
    
    // Fallback to file extension
    const extension = file.name.toLowerCase().split('.').pop();
    const extensionMimeTypes = {
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'tiff': 'image/tiff',
      'tif': 'image/tiff',
      
      // Documents
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      
      // Text files
      'txt': 'text/plain',
      'html': 'text/html',
      'htm': 'text/html',
      'css': 'text/css',
      'js': 'text/javascript',
      'json': 'application/json',
      'xml': 'text/xml',
      'csv': 'text/csv',
      
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4',
      
      // Video
      'mp4': 'video/mp4',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'wmv': 'video/x-ms-wmv',
      'flv': 'video/x-flv',
      'webm': 'video/webm',
      
      // Archives
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      'tar': 'application/x-tar',
      'gz': 'application/gzip',
      
      // Other
      'exe': 'application/x-msdownload',
      'dmg': 'application/x-apple-diskimage',
      'iso': 'application/x-iso9660-image'
    };
    
    return extensionMimeTypes[extension] || 'application/octet-stream';
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

      // Handle different content types
      if (fileData.isImage) {
        this.createImageCard(fileCard, fileData, index);
      } else if (fileData.isFile) {
        this.createFileCard(fileCard, fileData, index);
      } else {
        // Default text file card
        this.createDefaultCard(fileCard, fileData, index);
      }

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

  createImageCard(fileCard, fileData, index) {
    const imageData = fileData.content;
    
    fileCard.innerHTML = `
      <div class="file-card-info image-card">
        <div class="image-preview">
          <img src="${imageData.url}" alt="${imageData.name}" style="max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 4px;">
        </div>
        <div class="file-card-details">
          <p class="file-card-name" title="${imageData.name}">${imageData.name}</p>
          <p class="file-card-size">${this.formatFileSize(imageData.size)}</p>
          <p class="file-card-meta">
            <span class="image-dimensions">${imageData.width} × ${imageData.height}</span>
            <span class="image-format">${imageData.type.split('/')[1].toUpperCase()}</span>
          </p>
        </div>
      </div>
      <button class="btn btn-sm download-btn" type="button" title="Download image">
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
      const blob = new Blob([imageData.content], { type: imageData.type });
      this.downloadBlob(blob, imageData.name);
    });
  }

  createFileCard(fileCard, fileData, index) {
    const fileInfo = fileData.content;
    const fileTypeIcon = this.getFileTypeIcon(fileInfo.type);
    
    fileCard.innerHTML = `
      <div class="file-card-info file-card">
        <div class="file-type-icon">
          ${fileTypeIcon}
        </div>
        <div class="file-card-details">
          <p class="file-card-name" title="${fileInfo.name}">${fileInfo.name}</p>
          <p class="file-card-size">${this.formatFileSize(fileInfo.size)}</p>
          <p class="file-card-meta">
            <span class="file-type">${this.getFileTypeLabel(fileInfo.type)}</span>
          </p>
        </div>
      </div>
      <button class="btn btn-sm download-btn" type="button" title="Download file">
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
      const blob = new Blob([fileInfo.content], { type: fileInfo.type });
      this.downloadBlob(blob, fileInfo.name);
    });
  }

  createDefaultCard(fileCard, fileData, index) {
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
      this.downloadProcessedFile(fileData);
    });
  }

  getFileTypeIcon(mimeType) {
    const iconMap = {
      'application/pdf': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #dc3545;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>`,
      'application/zip': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #ffc107;">
        <path d="M16 22h2a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v3"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <path d="M10 20v-1a2 2 0 1 1 4 0v1a2 2 0 1 1-4 0Z"></path>
        <path d="M10 7h4"></path>
        <path d="M10 11h4"></path>
      </svg>`,
      'text/html': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #e34c26;">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>`,
      'text/xml': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #28a745;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>`
    };

    return iconMap[mimeType] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #6c757d;">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>`;
  }

  getFileTypeLabel(mimeType) {
    const labelMap = {
      'application/pdf': 'PDF Document',
      'application/zip': 'ZIP Archive',
      'text/html': 'HTML Document',
      'text/xml': 'XML Document',
      'application/octet-stream': 'Binary File'
    };

    return labelMap[mimeType] || mimeType.split('/')[1].toUpperCase() + ' File';
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
    if (outputElement) {
      outputElement.value = "";
      outputElement.style.display = 'block'; // Ensure textarea is visible when cleared
    }

    // Clear processed files display
    this.clearProcessedFiles(mode);

    // Clear any stored decoded blob
    if (mode === "decode") {
      this.decodedBlob = null;
      this.decodedFilename = null;
    }

    // Clear file info display
    const fileInfoElement = container.querySelector(`#${mode}-file-info`);
    if (fileInfoElement) {
      fileInfoElement.style.display = "none";
      fileInfoElement.innerHTML = "";
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

  isTextContent(content) {
    // Check if content contains mostly printable characters
    // Allow common text characters: letters, numbers, spaces, punctuation, newlines, tabs
    const printableRegex = /^[\x20-\x7E\x09\x0A\x0D\u00A0-\u00FF\u0100-\u017F\u0180-\u024F]*$/;
    
    // Also check for common binary file signatures that should not be treated as text
    const binarySignatures = [
      '\x89PNG',     // PNG
      '\xFF\xD8\xFF', // JPEG
      'GIF8',        // GIF
      'PK\x03\x04',  // ZIP
      '%PDF',        // PDF
      '\x00\x00\x01\x00', // ICO
      'BM',          // BMP
      'RIFF'         // WAV, AVI, etc.
    ];
    
    // Check for binary signatures
    for (const signature of binarySignatures) {
      if (content.startsWith(signature)) {
        return false;
      }
    }
    
    // Check if content is mostly printable characters
    if (!printableRegex.test(content)) {
      return false;
    }
    
    // Additional check: if content has too many null bytes or control characters, it's likely binary
    const nullBytes = (content.match(/\x00/g) || []).length;
    const controlChars = (content.match(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
    
    // If more than 1% of content is null bytes or control characters, consider it binary
    const threshold = Math.max(1, content.length * 0.01);
    if (nullBytes > threshold || controlChars > threshold) {
      return false;
    }
    
    return true;
  }
}

window.Base64Tools = Base64Tools;
