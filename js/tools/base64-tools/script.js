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
    this.selectedFiles = new Map();
  }

  render() {
    return window.Base64ToolsTemplate;
  }

  async onMount() {
    this.bindToolEvents();
    this.setupTabs();
    this.setupFileHandling();
  }

  bindToolEvents() {
    const container = this.validateContainer();

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

    if (encodeBtn) {
      encodeBtn.addEventListener("click", () => {
        this.encodeToBase64();
      });
    }

    if (decodeBtn) {
      decodeBtn.addEventListener("click", () => {
        this.decodeFromBase64();
      });
    }

    // Copy buttons
    const encodeCopyBtn = container.querySelector("#encode-copy-btn");
    const decodeCopyBtn = container.querySelector("#decode-copy-btn");

    if (encodeCopyBtn) {
      encodeCopyBtn.addEventListener("click", () => this.copyToClipboard("encode-output"));
    }

    if (decodeCopyBtn) {
      decodeCopyBtn.addEventListener("click", () => this.copyToClipboard("decode-output"));
    }

    // Paste buttons
    const encodePasteBtn = container.querySelector("#encode-paste-btn");
    const decodePasteBtn = container.querySelector("#decode-paste-btn");

    if (encodePasteBtn) {
      encodePasteBtn.addEventListener("click", () => this.pasteFromClipboard("encode-input"));
    }

    if (decodePasteBtn) {
      decodePasteBtn.addEventListener("click", () => this.pasteFromClipboard("decode-input"));
    }

    // Clear buttons
    const encodeClearBtn = container.querySelector("#encode-clear-btn");
    const decodeClearBtn = container.querySelector("#decode-clear-btn");
    const encodeOutputClearBtn = container.querySelector("#encode-output-clear-btn");
    const decodeOutputClearBtn = container.querySelector("#decode-output-clear-btn");

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

    // Download buttons
    const encodeDownloadBtn = container.querySelector("#encode-download-btn");
    const decodeDownloadBtn = container.querySelector("#decode-download-btn");

    if (encodeDownloadBtn) {
      encodeDownloadBtn.addEventListener("click", () => this.downloadResult("encode"));
    }

    if (decodeDownloadBtn) {
      decodeDownloadBtn.addEventListener("click", () => this.downloadResult("decode"));
    }
  }

  validateContainer() {
    const container = this.container;
    if (!container) return;
    return container;
  }

  setupTabs() {
    const container = this.validateContainer();

    // Set initial active tab
    this.switchMode(this.currentMode);
  }

  setupFileHandling() {
    const container = this.validateContainer();

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
    const container = this.validateContainer();

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
      section.style.display = section.classList.contains(`${mode}-section`) ? "block" : "none";
    });
  }

  async handleMultipleFileUpload(event, mode) {
    const files = Array.from(event.target.files);
    let txtFiles = [];
    if (files.length === 0) return;

    if (mode === "decode") {
      txtFiles = files.filter((file) => file.name.toLowerCase().endsWith(".txt"));
    }

    const otherFiles = txtFiles.length > 0 && mode === "encode" ? files.filter((file) => !txtFiles.includes(file)) : files;

    if (otherFiles.length > 0) {
      otherFiles.forEach((file) => {
        const fileId = `${mode}-${crypto.randomUUID()}-${Date.now()}`;
        this.selectedFiles.set(fileId, { file, mode });
        this.displayFileCard(file, fileId, mode);
      });
    }
    this.showInputFileContainer(mode);
  }

  isValidBase64(str) {
    try {
      // Check if string is empty or contains only whitespace
      if (!str || typeof str !== "string" || !str.trim()) {
        return false;
      }

      // Remove all whitespace (including newlines, tabs, etc.)
      const cleanStr = str.replace(/\s+/g, "");

      // Handle data URI format
      let base64Content = cleanStr;
      if (cleanStr.startsWith("data:")) {
        const dataUriMatch = cleanStr.match(/^data:[^;]*;base64,(.+)$/);
        if (dataUriMatch) {
          base64Content = dataUriMatch[1];
        } else {
          return false; // Invalid data URI format
        }
      }

      // Base64 should only contain valid characters
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Regex.test(base64Content)) {
        return false;
      }

      // Length should be multiple of 4 (after padding)
      if (base64Content.length % 4 !== 0) {
        return false;
      }

      // Try to decode to verify it's valid
      atob(base64Content);
      return true;
    } catch (error) {
      return false;
    }
  }

  detectContentType(bytes) {
    // Check for common file signatures
    const signatures = {
      "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "image/jpeg": [0xff, 0xd8, 0xff],
      "image/gif": [0x47, 0x49, 0x46, 0x38],
      "image/webp": [0x52, 0x49, 0x46, 0x46],
      "image/bmp": [0x42, 0x4d],
      "image/svg+xml": [0x3c, 0x73, 0x76, 0x67], // <svg
      "application/pdf": [0x25, 0x50, 0x44, 0x46],
      "application/zip": [0x50, 0x4b, 0x03, 0x04],
      "text/html": [0x3c, 0x68, 0x74, 0x6d, 0x6c], // <html
      "text/xml": [0x3c, 0x3f, 0x78, 0x6d, 0x6c], // <?xml
    };

    for (const [mimeType, signature] of Object.entries(signatures)) {
      if (this.matchesSignature(bytes, signature)) {
        return mimeType;
      }
    }

    // Default to binary if no signature matches
    return "application/octet-stream";
  }

  matchesSignature(bytes, signature) {
    if (bytes.length < signature.length) return false;

    for (let i = 0; i < signature.length; i++) {
      if (bytes[i] !== signature[i]) {
        return false;
      }
    }
    return true;
  }

  displayFileCard(file, fileId, mode) {
    const container = this.validateContainer();

    const filesContainer = container.querySelector(`#${mode}-files-container`);
    if (!filesContainer) return;

    const fileCard = document.createElement("div");
    fileCard.className = "file-card";
    fileCard.dataset.fileId = fileId;

    // Check if it's an image file and we're in encode mode
    const isImage = file.type && file.type.startsWith("image/");
    const isEncodeMode = mode === "encode";

    if (isImage && isEncodeMode) {
      // Create image preview card
      this.createImageFileCard(fileCard, file, fileId, mode);
    } else {
      // Create default file card
      this.createDefaultFileCard(fileCard, file, fileId, mode);
    }

    filesContainer.appendChild(fileCard);
  }

  createImageFileCard(fileCard, file, fileId, mode) {
    // Create image preview
    const reader = new FileReader();
    reader.onload = (e) => {
      fileCard.innerHTML = /*html*/ `
        <div class="file-card-preview">
          <img src="${e.target.result}" alt="${file.name}" class="file-card-image" />
        </div>
        <div class="file-card-info">
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
      const removeBtn = fileCard.querySelector(".file-card-remove");
      removeBtn.addEventListener("click", () => {
        this.removeFileCard(fileId, mode);
      });
    };
    reader.readAsDataURL(file);
  }

  createDefaultFileCard(fileCard, file, fileId, mode) {
    fileCard.innerHTML = /*html*/ `
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
    const removeBtn = fileCard.querySelector(".file-card-remove");
    removeBtn.addEventListener("click", () => {
      this.removeFileCard(fileId, mode);
    });
  }

  removeFileCard(fileId, mode) {
    const container = this.validateContainer();

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
      this.hideInputFileContainer(mode);
    }
  }

  showInputFileContainer(mode) {
    const container = this.validateContainer();

    const filesDisplay = container.querySelector(`#${mode}-files-display`);
    const textField = container.querySelector(`#${mode}-input`);
    if (filesDisplay) {
      filesDisplay.style.display = "block";
      textField.style.display = "none";
    }
  }

  hideInputFileContainer(mode) {
    const container = this.validateContainer();

    const filesDisplay = container.querySelector(`#${mode}-files-display`);
    const textField = container.querySelector(`#${mode}-input`);
    if (filesDisplay) {
      filesDisplay.style.display = "none";
      textField.style.display = "block";
    }
  }

  showFileInfo(file, mode) {
    const container = this.validateContainer();

    const infoDiv = container.querySelector(`#${mode}-processed-file`);
    if (infoDiv) {
      infoDiv.innerHTML = /*html*/ `
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
    const container = this.container;

    // Check if we have selected files to process
    const selectedFilesForMode = Array.from(this.selectedFiles.entries()).filter(([_, data]) => data.mode === "encode");

    if (selectedFilesForMode.length > 0) {
      await this.processMultipleFiles("encode");
    } else {
      const inputArea = container.querySelector("#encode-input");
      const outputArea = container.querySelector("#encode-output");
      const text = inputArea.value;

      try {
        // const encoded = btoa(unescape(encodeURIComponent(text)));
        const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
        this.showSuccess("Encoded to Base64!");
        outputArea.value = encoded;
      } catch (error) {
        this.showError("Failed to encode text to Base64");
        outputArea.value = "";
      }
    }
  }

  async decodeFromBase64() {
    const container = this.container;
    if (!container) {
      return;
    }

    // Check if we have selected files to process
    const selectedFilesForMode = Array.from(this.selectedFiles.entries()).filter(([_, data]) => data.mode === "decode");

    if (selectedFilesForMode.length > 0) {
      await this.processMultipleFiles("decode");
    } else {
      const inputArea = container.querySelector("#decode-input");
      const outputArea = container.querySelector("#decode-output");
      const base64Text = inputArea.value.trim();
      if (!base64Text) {
        outputArea.value = "";
        return;
      }

      try {
        if (!this.isValidBase64(base64Text)) {
          throw new Error("Invalid base64 format");
        }

        // Extract actual base64 content and detect MIME type from data URI
        let actualBase64 = base64Text.replace(/\s+/g, "");
        let detectedMimeType = null;

        if (actualBase64.startsWith("data:")) {
          const dataUriMatch = actualBase64.match(/^data:([^;]*);base64,(.+)$/);
          if (dataUriMatch) {
            detectedMimeType = dataUriMatch[1];
            actualBase64 = dataUriMatch[2];
          } else {
            throw new Error("Invalid data URI format");
          }
        }

        // Decode the base64 content
        const decoded = atob(actualBase64);
        const isTextContent = this.isTextContent(decoded);

        if (isTextContent) {
          outputArea.value = decoded;
        } else {
          outputArea.value = "";
          outputArea.style.display = "none";
          const uint8Array = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) {
            uint8Array[i] = decoded.charCodeAt(i);
          }
          this.decodedBlob = new Blob([uint8Array]);
          this.decodedFilename = `decoded_base64-${Date.now()}`;

          this.showFileInfo({ name: this.decodedFilename, size: this.decodedBlob.size }, "decode");
        }
      } catch (error) {
        console.error("❌ [DEBUG] Error decoding Base64:", error);
        this.showError("Invalid Base64 input");
        outputArea.value = "";
      }
    }
  }

  async processMultipleFiles(mode) {
    const container = this.container;
    if (!container) {
      return;
    }

    const selectedFilesForMode = Array.from(this.selectedFiles.entries()).filter(([_, data]) => data.mode === mode);

    if (selectedFilesForMode.length === 0) {
      return;
    }

    this.clearOutputFiles(mode);

    // Process each file
    const processedFiles = [];

    for (const [fileId, { file }] of selectedFilesForMode) {
      try {
        const result = await this.processFileForMultiple(file, mode);

        if (mode === "encode") {
          // Maintain current encoding packaging (text output)
          processedFiles.push({
            originalName: file.name,
            processedName: `${file.name.split(".")[0]}.txt`,
            content: result,
            size: new Blob([result]).size,
          });
        } else {
          // New: Decoding packaging with format preservation and preview support
          const binaryString = result;
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const contentType = this.detectContentType(bytes);

          if (contentType.startsWith("image/")) {
            const blob = new Blob([bytes], { type: contentType });
            const url = URL.createObjectURL(blob);

            // Measure image dimensions for preview card
            const { width, height } = await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () =>
                resolve({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                });
              img.onerror = (e) => reject(e);
              img.src = url;
            });

            processedFiles.push({
              originalName: file.name,
              processedName: `${file.name.split(".")[0]}.${contentType.split("/")[1]}`,
              content: {
                url,
                name: `${file.name.split(".")[0]}.${contentType.split("/")[1]}`,
                size: blob.size,
                width,
                height,
                type: contentType,
                content: bytes,
              },
              size: blob.size,
              isImage: true,
            });
          } else if (this.isTextContent(binaryString)) {
            // Treat as text content
            processedFiles.push({
              originalName: file.name,
              processedName: `${file.name.split(".")[0]}.txt`,
              content: binaryString,
              size: new Blob([binaryString]).size,
            });
          } else {
            // Generic binary file (non-image)
            const blob = new Blob([bytes], { type: contentType });
            const extension = contentType.split("/")[1] || "bin";
            const processedName = `${file.name.split(".")[0]}.${extension}`;

            processedFiles.push({
              originalName: file.name,
              processedName,
              content: {
                name: processedName,
                size: blob.size,
                type: contentType,
                content: bytes,
              },
              size: blob.size,
              isFile: true,
            });
          }
        }
      } catch (error) {
        console.error("❌ [DEBUG] Failed to process file:", file.name, error);
        this.showError(`Failed to process ${file.name}: ${error.message}`);
      }
    }

    // Display processed files
    this.displayProcessedFiles(processedFiles, mode);
  }

  async processFileForMultiple(file, mode) {
    try {
      if (mode === "encode") {
        // For encoding, read file as ArrayBuffer and convert to base64 with data URI
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }

        const base64Result = btoa(binary);
        const mimeType = this.getMimeTypeFromBase64(file, uint8Array);
        const dataUri = `data:${mimeType};base64,${base64Result}`;
        return dataUri;
      } else {
        const text = await this.readFileAsText(file);
        const base64Content = text.trim();
        if (!base64Content) {
          throw new Error("Empty file content");
        }

        // Validate base64 format
        if (!this.isValidBase64(base64Content)) {
          throw new Error("Invalid base64 format");
        }

        // Extract actual base64 content and detect MIME type from data URI
        let actualBase64 = base64Content.replace(/\s+/g, "");
        let detectedMimeType = null;

        if (actualBase64.startsWith("data:")) {
          const dataUriMatch = actualBase64.match(/^data:([^;]*);base64,(.+)$/);
          if (dataUriMatch) {
            detectedMimeType = dataUriMatch[1];
            actualBase64 = dataUriMatch[2];
          } else {
            throw new Error("Invalid data URI format");
          }
        }

        // Decode the base64 content
        const binaryString = atob(actualBase64);
        return binaryString;
      }
    } catch (error) {
      console.error("❌ [DEBUG] Error in processFileForMultiple:", error);
      this.showError("Invalid: Not a valid Base64 Text");
      throw error;
    }
  }

  getMimeTypeFromBase64(file, uint8Array) {
    // First try to detect from file content (magic numbers)
    const detectedType = this.detectContentType(uint8Array);
    if (detectedType !== "application/octet-stream") {
      return detectedType;
    }

    // Fallback to file extension
    const extension = file.name.toLowerCase().split(".").pop();
    const extensionMimeTypes = {
      // Images
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      tiff: "image/tiff",
      tif: "image/tiff",

      // Documents
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

      // Text files
      txt: "text/plain",
      html: "text/html",
      htm: "text/html",
      css: "text/css",
      js: "text/javascript",
      json: "application/json",
      xml: "text/xml",
      csv: "text/csv",

      // Audio
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      flac: "audio/flac",
      m4a: "audio/mp4",

      // Video
      mp4: "video/mp4",
      avi: "video/x-msvideo",
      mov: "video/quicktime",
      wmv: "video/x-ms-wmv",
      flv: "video/x-flv",
      webm: "video/webm",

      // Archives
      zip: "application/zip",
      rar: "application/x-rar-compressed",
      "7z": "application/x-7z-compressed",
      tar: "application/x-tar",
      gz: "application/gzip",

      // Other
      exe: "application/x-msdownload",
      dmg: "application/x-apple-diskimage",
      iso: "application/x-iso9660-image",
    };

    return extensionMimeTypes[extension] || "application/octet-stream";
  }

  displayProcessedFiles(processedFiles, mode) {
    const container = this.validateContainer();
    const processedContainer = container.querySelector(`#${mode}-processed-container`);
    const processedDisplay = container.querySelector(`#${mode}-processed-files`);
    const outputTextarea = container.querySelector(`#${mode}-output`);

    processedContainer.innerHTML = "";
    processedFiles.forEach((fileData, index) => {
      const fileCard = document.createElement("div");
      fileCard.className = "file-card processed-file-card";
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
      processedContainer.appendChild(fileCard);
    });

    processedDisplay.style.display = "block";
    outputTextarea.style.display = "none";
  }

  createImageCard(fileCard, fileData, index) {
    const imageData = fileData.content;

    fileCard.innerHTML = /*html*/ `
      <div class="file-card-info image-card">
        <div class="image-preview">
          <img src="${imageData.url}" alt="${
      imageData.name
    }" style="max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 4px;">
        </div>
        <div class="file-card-details">
          <p class="file-card-name" title="${imageData.name}">${imageData.name}</p>
          <p class="file-card-size">${this.formatFileSize(imageData.size)}</p>
          <p class="file-card-meta">
            <span class="image-dimensions">${imageData.width} × ${imageData.height}</span>
            <span class="image-format">${imageData.type.split("/")[1].toUpperCase()}</span>
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
    const downloadBtn = fileCard.querySelector(".download-btn");
    downloadBtn.addEventListener("click", () => {
      const blob = new Blob([imageData.content], { type: imageData.type });
      this.downloadBlob(blob, imageData.name);
    });
  }

  createFileCard(fileCard, fileData, index) {
    const fileInfo = fileData.content;
    const fileTypeIcon = this.getFileTypeIcon(fileInfo.type);

    fileCard.innerHTML = /*html*/ `
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
    const downloadBtn = fileCard.querySelector(".download-btn");
    downloadBtn.addEventListener("click", () => {
      const blob = new Blob([fileInfo.content], { type: fileInfo.type });
      this.downloadBlob(blob, fileInfo.name);
    });
  }

  createDefaultCard(fileCard, fileData, index) {
    fileCard.innerHTML = /*html*/ `
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
    const downloadBtn = fileCard.querySelector(".download-btn");
    downloadBtn.addEventListener("click", () => {
      this.downloadProcessedFile(fileData);
    });
  }

  getFileTypeIcon(mimeType) {
    const iconMap = {
      "application/pdf": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #dc3545;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>`,
      "application/zip": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #ffc107;">
        <path d="M16 22h2a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v3"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <path d="M10 20v-1a2 2 0 1 1 4 0v1a2 2 0 1 1-4 0Z"></path>
        <path d="M10 7h4"></path>
        <path d="M10 11h4"></path>
      </svg>`,
      "text/html": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #e34c26;">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>`,
      "text/xml": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #28a745;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>`,
    };

    return (
      iconMap[mimeType] ||
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: #6c757d;">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>`
    );
  }

  getFileTypeLabel(mimeType) {
    const labelMap = {
      "application/pdf": "PDF Document",
      "application/zip": "ZIP Archive",
      "text/html": "HTML Document",
      "text/xml": "XML Document",
      "application/octet-stream": "Binary File",
    };

    return labelMap[mimeType] || mimeType.split("/")[1].toUpperCase() + " File";
  }

  downloadProcessedFile(fileData) {
    const blob = new Blob([fileData.content], { type: "text/plain" });
    this.downloadBlob(blob, fileData.processedName);
  }

  async copyToClipboard(targetId) {
    const container = this.validateContainer();

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
    const container = this.validateContainer();

    try {
      const text = await navigator.clipboard.readText();
      const element = container.querySelector(`#${targetId}`);
      if (element) {
        element.value = text;
        this.showSuccess("Pasted from clipboard!");
      }
    } catch (error) {
      this.showError("Failed to paste from clipboard");
      console.error("Clipboard error:", error);
    }
  }

  clearInputFiles(mode) {
    const container = this.validateContainer();

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
    const filesToRemove = Array.from(this.selectedFiles.entries())
      .filter(([_, data]) => data.mode === mode)
      .map(([fileId]) => fileId);

    filesToRemove.forEach((fileId) => {
      this.selectedFiles.delete(fileId);
    });

    // Clear file cards
    const filesContainer = container.querySelector(`#${mode}-files-container`);
    if (filesContainer) {
      filesContainer.innerHTML = "";
    }

    // Hide files display
    this.hideInputFileContainer(mode);

    // Reset file input
    const fileInput = container.querySelector(`#${mode}-file-input`);
    if (fileInput) {
      fileInput.value = "";
    }
  }

  clearOutputFiles(mode) {
    const container = this.validateContainer();

    const outputTextfield = container.querySelector(`#${mode}-output`);
    if (outputTextfield) {
      outputTextfield.value = "";
      outputTextfield.style.display = "block";
    }

    const processedDisplay = container.querySelector(`#${mode}-processed-files`);
    const processedContainer = container.querySelector(`#${mode}-processed-container`);

    if (processedDisplay) {
      processedDisplay.style.display = "none";
    }

    if (processedContainer) {
      processedContainer.innerHTML = "";
    }

    if (mode === "decode") {
      this.decodedBlob = null;
      this.decodedFilename = null;
    }
  }

  downloadResult(mode) {
    const container = this.validateContainer();

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
        this.downloadBlob(this.decodedBlob, this.decodedFilename || "decoded_file");
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

  isTextContent(content) {
    // Check if content contains mostly printable characters
    // Allow common text characters: letters, numbers, spaces, punctuation, newlines, tabs
    const printableRegex = /^[\x20-\x7E\x09\x0A\x0D\u00A0-\u00FF\u0100-\u017F\u0180-\u024F]*$/;

    // Also check for common binary file signatures that should not be treated as text
    const binarySignatures = [
      "\x89PNG", // PNG
      "\xFF\xD8\xFF", // JPEG
      "GIF8", // GIF
      "PK\x03\x04", // ZIP
      "%PDF", // PDF
      "\x00\x00\x01\x00", // ICO
      "BM", // BMP
      "RIFF", // WAV, AVI, etc.
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
