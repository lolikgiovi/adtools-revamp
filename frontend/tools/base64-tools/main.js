import { Base64ToolsService } from "./service.js";
import { Base64ToolsConstants } from "./constants.js";
import { Base64ToolsTemplate } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import JSZip from "jszip";

class Base64Tools extends BaseTool {
  constructor(eventBus) {
    super({
      id: "base64-tools",
      name: "Base64 Tools",
      description: "Encode and decode Base64 with text and file support",
      icon: "base64",
      category: "application",
      eventBus: eventBus,
    });
    this.currentMode = "encode";
    this.selectedFiles = new Map();
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return Base64ToolsTemplate;
  }

  async onMount() {
    this.bindToolEvents();
    this.setupFileHandling();
    this.switchMode(this.currentMode);
  }

  bindToolEvents() {
    const container = this.validateContainer();

    // Tab switching
    const tabButtons = container.querySelectorAll(".tab-navigation .tab-button");
    tabButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        const mode = e.target.dataset.mode || e.target.closest(".tab-button")?.dataset.mode;
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

    // Load and persist text inputs to localStorage
    const encodeInput = container.querySelector("#encode-input");
    const decodeInput = container.querySelector("#decode-input");
    const encKey = "tool:base64-tools:encode-input";
    const decKey = "tool:base64-tools:decode-input";
    try {
      const savedEnc = localStorage.getItem(encKey);
      const savedDec = localStorage.getItem(decKey);
      if (encodeInput && savedEnc !== null) encodeInput.value = savedEnc;
      if (decodeInput && savedDec !== null) decodeInput.value = savedDec;
    } catch (_) {}
    let encTimer = null,
      decTimer = null;
    encodeInput?.addEventListener("input", () => {
      clearTimeout(encTimer);
      encTimer = setTimeout(() => {
        try {
          localStorage.setItem(encKey, encodeInput.value || "");
        } catch (_) {}
      }, 250);
    });
    decodeInput?.addEventListener("input", () => {
      clearTimeout(decTimer);
      decTimer = setTimeout(() => {
        try {
          localStorage.setItem(decKey, decodeInput.value || "");
        } catch (_) {}
      }, 250);
    });

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
    const tabButtons = container.querySelectorAll(".tab-navigation .tab-button");
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
    if (files.length === 0) return;

    // In decode mode, accept only .txt files that contain Base64 text
    const filesToAdd = mode === "decode" ? files.filter((file) => file.name.toLowerCase().endsWith(".txt")) : files;

    if (filesToAdd.length > 0) {
      filesToAdd.forEach((file) => {
        const fileId = `${mode}-${crypto.randomUUID()}-${Date.now()}`;
        this.selectedFiles.set(fileId, { file, mode });
        this.displayFileCard(file, fileId, mode);
      });
    }
    this.showInputFileContainer(mode);
  }

  displayFileCard(file, fileId, mode) {
    const container = this.validateContainer();

    const filesContainer = container.querySelector(`#${mode}-files-container`);
    if (!filesContainer) return;
    // Check if it's an image file and we're in encode mode
    const isImage = file.type && file.type.startsWith("image/");
    const isEncodeMode = mode === "encode";

    if (isImage && isEncodeMode) {
      // Use DataURL for preview in input cards
      const reader = new FileReader();
      reader.onload = (e) => {
        const card = this.buildFileCard(
          {
            variant: "image",
            name: file.name,
            size: file.size,
            type: file.type || "Unknown",
            previewUrl: e.target.result,
          },
          {
            remove: () => this.removeFileCard(fileId, mode),
          }
        );
        card.dataset.fileId = fileId;
        filesContainer.appendChild(card);
      };
      reader.readAsDataURL(file);
    } else {
      const card = this.buildFileCard(
        {
          variant: "binary",
          name: file.name,
          size: file.size,
          type: file.type || "Unknown",
        },
        {
          remove: () => this.removeFileCard(fileId, mode),
        }
      );
      card.dataset.fileId = fileId;
      filesContainer.appendChild(card);
    }
  }

  buildFileCard(data, actions = {}) {
    const { variant, name, size, type, previewUrl, dimensions } = data;
    const { remove, download, copy } = actions;

    const card = document.createElement("div");
    card.className = "file-card";

    let infoInner = "";
    if (variant === "image") {
      infoInner = /*html*/ `
        <div class="file-card-info image-card">
          <div class="image-preview">
            <img src="${previewUrl}" alt="${name}" style="max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 4px;">
          </div>
          <div class="file-card-details">
            <p class="file-card-name" title="${name}">${name}</p>
            <p class="file-card-size">${Base64ToolsService.formatFileSize(size)}</p>
            ${
              dimensions
                ? `<p class="file-card-meta"><span class="image-dimensions">${dimensions.width} × ${
                    dimensions.height
                  }</span><span class="image-format">${(type || "").split("/")[1]?.toUpperCase() || ""}</span></p>`
                : ""
            }
          </div>
        </div>`;
    } else if (variant === "binary") {
      const fileTypeIcon = Base64ToolsConstants.getFileTypeIcon(type);
      infoInner = /*html*/ `
        <div class="file-card-info binary-card">
          <div class="file-card-icon">${fileTypeIcon}</div>
          <div class="file-card-details">
            <p class="file-card-name" title="${name}">${name}</p>
            <p class="file-card-size">${Base64ToolsService.formatFileSize(size)}</p>
            <p class="file-card-meta"><span class="file-type">${Base64ToolsConstants.getFileTypeLabel(type)}</span></p>
          </div>
        </div>`;
    } else {
      // text/default
      const fileTypeIcon = Base64ToolsConstants.getFileTypeIcon("text/plain");
      infoInner = /*html*/ `
        <div class="file-card-info">
          <div class="file-card-icon">${fileTypeIcon}</div>
          <div class="file-card-details">
            <p class="file-card-name" title="${name}">${name}</p>
            <p class="file-card-size">${Base64ToolsService.formatFileSize(size)}</p>
          </div>
        </div>`;
    }

    const removeBtn = remove
      ? /*html*/ `
        <button class="file-card-remove" type="button" title="Remove file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>`
      : "";

    const copyBtn = copy
      ? /*html*/ `
        <button class="btn btn-sm copy-btn" type="button" title="Copy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy
        </button>`
      : "";

    const downloadBtn = download
      ? /*html*/ `
        <button class="btn btn-sm download-btn" type="button" title="Download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download
        </button>`
      : "";

    card.innerHTML = infoInner + removeBtn + copyBtn + downloadBtn;

    if (remove) {
      const btn = card.querySelector(".file-card-remove");
      btn?.addEventListener("click", remove);
    }
    if (copy) {
      const btn = card.querySelector(".copy-btn");
      btn?.addEventListener("click", copy);
      card.classList.add("processed-file-card");
    }
    if (download) {
      const btn = card.querySelector(".download-btn");
      btn?.addEventListener("click", download);
      card.classList.add("processed-file-card");
    }

    return card;
  }

  removeFileCard(fileId, mode) {
    const container = this.validateContainer();
    this.selectedFiles.delete(fileId);
    const fileCard = container.querySelector(`[data-file-id="${fileId}"]`);
    if (fileCard) {
      fileCard.remove();
    }

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
          <strong>Size:</strong> ${Base64ToolsService.formatFileSize(file.size)}
        </div>
        <div class="file-info-item">
          <strong>Type:</strong> ${file.type || "Unknown"}
        </div>
      `;
      infoDiv.style.display = "block";
    }
  }

  async encodeToBase64() {
    UsageTracker.trackFeature("base64-tools", "encode");
    const container = this.validateContainer();

    // Check if we have selected files to process
    const selectedFilesForMode = Array.from(this.selectedFiles.entries()).filter(([_, data]) => data.mode === "encode");

    if (selectedFilesForMode.length === 1) {
      // Single file: output to textarea
      const [fileId, { file }] = selectedFilesForMode[0];
      const outputArea = container.querySelector("#encode-output");
      
      try {
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64Result = Base64ToolsService.toBase64FromBytes(uint8Array);
        const mimeType = Base64ToolsService.getMimeTypeFromBase64(file, uint8Array);
        const dataUri = `data:${mimeType};base64,${base64Result}`;
        
        outputArea.value = dataUri;
        outputArea.style.display = "block";
        
        // Hide processed files display if it was shown
        const processedDisplay = container.querySelector("#encode-processed-files");
        if (processedDisplay) {
          processedDisplay.style.display = "none";
        }
        
        this.updateOutputHeaderButtons("encode", false); // false = not multi-file
        this.showSuccess("Encoded to Base64!");
      } catch (error) {
        UsageTracker.trackEvent("base64-tools", "encode_error", UsageTracker.enrichErrorMeta(error, { type: "file" }));
        this.showError("Failed to encode file to Base64");
        outputArea.value = "";
      }
    } else if (selectedFilesForMode.length > 1) {
      // Multiple files: use card display
      await this.processMultipleFiles("encode");
    } else {
      // No files, encode text input
      const inputArea = container.querySelector("#encode-input");
      const outputArea = container.querySelector("#encode-output");
      const text = inputArea.value;

      try {
        const encoded = Base64ToolsService.encodeText(text);
        this.showSuccess("Encoded to Base64!");
        outputArea.value = encoded;
        outputArea.style.display = "block";
        
        // Hide processed files display if it was shown
        const processedDisplay = container.querySelector("#encode-processed-files");
        if (processedDisplay) {
          processedDisplay.style.display = "none";
        }
        
        this.updateOutputHeaderButtons("encode", false); // false = not multi-file
      } catch (error) {
        this.showError("Failed to encode text to Base64");
        outputArea.value = "";
      }
    }
  }

  async decodeFromBase64() {
    UsageTracker.trackFeature("base64-tools", "decode");
    const container = this.validateContainer();

    // Check if we have selected files to process
    const selectedFilesForMode = Array.from(this.selectedFiles.entries()).filter(([_, data]) => data.mode === "decode");

    if (selectedFilesForMode.length > 0) {
      await this.processMultipleFiles("decode");
    } else {
      this.clearOutputFiles("decode");
      const inputArea = container.querySelector("#decode-input");
      const outputArea = container.querySelector("#decode-output");
      const base64Text = inputArea.value.trim();
      if (!base64Text) {
        outputArea.value = "";
        return;
      }

      try {
        if (!Base64ToolsService.isValidBase64(base64Text)) {
          throw new Error("Invalid base64 format");
        }

        const { base64: actualBase64 } = Base64ToolsService.normalizeDataUri(base64Text);

        const decoded = Base64ToolsService.decodeToBinaryString(actualBase64);
        const isTextContent = Base64ToolsService.isTextContent(decoded);

        if (isTextContent) {
          outputArea.value = decoded;
          outputArea.style.display = "block";
          this.decodedBlob = null;
          this.decodedFilename = null;
          
          // Enable copy button for text output
          this.updateOutputHeaderButtons("decode", false); // false = single file, text output
        } else {
          outputArea.value = "";
          outputArea.style.display = "none";
          const bytes = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) {
            bytes[i] = decoded.charCodeAt(i);
          }
          const contentType = Base64ToolsService.detectContentType(bytes);

          const processedFiles = [];
          if (contentType.startsWith("image/")) {
            const blob = new Blob([bytes], { type: contentType });
            const url = URL.createObjectURL(blob);
            const { width, height } = await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () =>
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
              img.onerror = (e) => reject(e);
              img.src = url;
            });
            processedFiles.push({
              originalName: "decoded_base64",
              processedName: `decoded_base64.${contentType.split("/")[1]}`,
              content: {
                url,
                name: `decoded_base64.${contentType.split("/")[1]}`,
                size: blob.size,
                width,
                height,
                type: contentType,
                content: bytes,
              },
              size: blob.size,
              isImage: true,
            });
          } else {
            const blob = new Blob([bytes], { type: contentType });
            const extension = contentType.split("/")[1] || "bin";
            const processedName = `decoded_base64.${extension}`;
            processedFiles.push({
              originalName: "decoded_base64",
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

          this.displayProcessedFiles(processedFiles, "decode");
          
          // Disable copy button for binary output (single file showing as card)
          const copyBtn = container.querySelector("#decode-copy-btn");
          if (copyBtn) {
            copyBtn.disabled = true;
            copyBtn.style.opacity = "0.5";
            copyBtn.style.cursor = "not-allowed";
          }
        }
      } catch (error) {
        console.error("❌ [DEBUG] Error decoding Base64:", error);
        UsageTracker.trackEvent("base64-tools", "decode_error", UsageTracker.enrichErrorMeta(error, { type: "text" }));
        this.showError("Invalid Base64 input");
        outputArea.value = "";
      }
    }
  }

  async processMultipleFiles(mode) {
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

          const contentType = Base64ToolsService.detectContentType(bytes);

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
          } else if (Base64ToolsService.isTextContent(binaryString)) {
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
        UsageTracker.trackEvent("base64-tools", mode === "encode" ? "encode_error" : "decode_error", 
          UsageTracker.enrichErrorMeta(error, { type: "multi_file", file: file.name }));
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
        const base64Result = Base64ToolsService.toBase64FromBytes(uint8Array);
        const mimeType = Base64ToolsService.getMimeTypeFromBase64(file, uint8Array);
        const dataUri = `data:${mimeType};base64,${base64Result}`;
        return dataUri;
      } else {
        const text = await this.readFileAsText(file);
        const base64Content = text.trim();
        if (!base64Content) {
          throw new Error("Empty file content");
        }

        // Validate base64 format
        if (!Base64ToolsService.isValidBase64(base64Content)) {
          throw new Error("Invalid base64 format");
        }
        const { base64: actualBase64 } = Base64ToolsService.normalizeDataUri(base64Content);
        const binaryString = Base64ToolsService.decodeToBinaryString(actualBase64);
        return binaryString;
      }
    } catch (error) {
      console.error("❌ [DEBUG] Error in processFileForMultiple:", error);
      this.showError("Invalid: Not a valid Base64 Text");
      throw error;
    }
  }

  displayProcessedFiles(processedFiles, mode) {
    const container = this.validateContainer();
    const processedContainer = container.querySelector(`#${mode}-processed-container`);
    const processedDisplay = container.querySelector(`#${mode}-processed-files`);
    const outputTextarea = container.querySelector(`#${mode}-output`);

    processedContainer.innerHTML = "";
    processedFiles.forEach((fileData, index) => {
      let card;
      if (fileData.isImage) {
        const imageData = fileData.content;
        const actions = {
          download: () => {
            const blob = new Blob([imageData.content], { type: imageData.type });
            this.downloadBlob(blob, imageData.name);
          },
        };
        
        // Add copy button for encode mode
        if (mode === "encode") {
          actions.copy = () => this.copyFileContent(fileData.content, index);
        }
        
        card = this.buildFileCard(
          {
            variant: "image",
            name: imageData.name,
            size: imageData.size,
            type: imageData.type,
            previewUrl: imageData.url,
            dimensions: { width: imageData.width, height: imageData.height },
          },
          actions
        );
      } else if (fileData.isFile) {
        const fileInfo = fileData.content;
        const actions = {
          download: () => {
            const blob = new Blob([fileInfo.content], { type: fileInfo.type });
            this.downloadBlob(blob, fileInfo.name);
          },
        };
        
        // Add copy button for encode mode
        if (mode === "encode") {
          actions.copy = () => this.copyFileContent(fileData.content, index);
        }
        
        card = this.buildFileCard(
          {
            variant: "binary",
            name: fileInfo.name,
            size: fileInfo.size,
            type: fileInfo.type,
          },
          actions
        );
      } else {
        // Text file (encoded result)
        const actions = {
          download: () => this.downloadProcessedFile(fileData),
        };
        
        // Add copy button for encode mode
        if (mode === "encode") {
          actions.copy = () => this.copyFileContent(fileData.content, index);
        }
        
        card = this.buildFileCard(
          {
            variant: "text",
            name: fileData.processedName,
            size: fileData.size,
            type: "text/plain",
          },
          actions
        );
      }
      card.dataset.fileIndex = index;
      processedContainer.appendChild(card);
    });

    processedDisplay.style.display = "block";
    outputTextarea.style.display = "none";
    
    // Update header buttons for multi-file mode
    if (mode === "encode" || mode === "decode") {
      this.updateOutputHeaderButtons(mode, true); // true = multi-file
    }
  }

  downloadProcessedFile(fileData) {
    const blob = new Blob([fileData.content], { type: "text/plain" });
    this.downloadBlob(blob, fileData.processedName);
  }

  async copyFileContent(content, index) {
    try {
      // Handle different content types
      let textToCopy = "";
      
      if (typeof content === "string") {
        textToCopy = content;
      } else if (content && typeof content === "object") {
        // For binary/image content, we can't really copy binary data
        // So we'll show an appropriate message
        this.showError("Cannot copy binary content to clipboard");
        return;
      }
      
      await navigator.clipboard.writeText(textToCopy);
      this.showSuccess("Copied to clipboard!");
    } catch (error) {
      this.showError("Failed to copy to clipboard");
    }
  }

  updateOutputHeaderButtons(mode, isMultiFile) {
    const container = this.validateContainer();
    const copyBtn = container.querySelector(`#${mode}-copy-btn`);
    const downloadBtn = container.querySelector(`#${mode}-download-btn`);
    
    if (isMultiFile) {
      // Disable copy button for multi-file output
      if (copyBtn) {
        copyBtn.disabled = true;
        copyBtn.style.opacity = "0.5";
        copyBtn.style.cursor = "not-allowed";
      }
      
      // Update download button text to "Download All"
      if (downloadBtn) {
        const textNode = downloadBtn.childNodes[downloadBtn.childNodes.length - 1];
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          textNode.textContent = "Download All";
        }
      }
    } else {
      // Enable copy button for single file/text output
      if (copyBtn) {
        copyBtn.disabled = false;
        copyBtn.style.opacity = "1";
        copyBtn.style.cursor = "pointer";
      }
      
      // Reset download button text to "Download"
      if (downloadBtn) {
        const textNode = downloadBtn.childNodes[downloadBtn.childNodes.length - 1];
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          textNode.textContent = "Download";
        }
      }
    }
  }

  getFormattedDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async copyToClipboard(targetId) {
    try {
      const el = this.validateContainer()?.querySelector(`#${targetId}`);
      const val = el?.value || el?.textContent || "";
      await navigator.clipboard.writeText(val);
      this.showSuccess("Copied to clipboard!");
    } catch (error) {
      this.showError("Failed to copy to clipboard");
    }
  }

  async pasteFromClipboard(targetId) {
    try {
      const text = await navigator.clipboard.readText();
      const el = this.validateContainer()?.querySelector(`#${targetId}`);
      if (el) el.value = text;
    } catch (error) {
      this.showError("Failed to paste from clipboard");
    }
  }

  clearInputFiles(mode) {
    const container = this.validateContainer();

    // Clear the textarea input
    const inputElement = container.querySelector(`#${mode}-input`);
    if (inputElement) {
      inputElement.value = "";
      try {
        const key = mode === "encode" ? "tool:base64-tools:encode-input" : "tool:base64-tools:decode-input";
        localStorage.setItem(key, "");
      } catch (_) {}
    }

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
      // Revoke any object URLs in image cards to prevent memory leaks
      const imageImgs = processedContainer.querySelectorAll(".image-preview img");
      imageImgs.forEach((img) => {
        if (img.src && img.src.startsWith("blob:")) {
          URL.revokeObjectURL(img.src);
        }
      });
      processedContainer.innerHTML = "";
    }

    // Only clear output-related info panel; keep input panel untouched
    const outputInfo = container.querySelector(`#${mode}-processed-file`);
    if (outputInfo) {
      outputInfo.style.display = "none";
      outputInfo.innerHTML = "";
    }

    if (mode === "decode") {
      this.decodedBlob = null;
      this.decodedFilename = null;
    }
  }

  async downloadResult(mode) {
    const container = this.validateContainer();

    // Check if processed cards are visible for encode mode
    const processedDisplay = container.querySelector(`#${mode}-processed-files`);
    const processedContainer = container.querySelector(`#${mode}-processed-container`);
    
    if (mode === "encode" && processedDisplay && processedDisplay.style.display === "block") {
      // Multi-file encode: Create ZIP with all encoded files
      const fileCards = processedContainer.querySelectorAll(".file-card");
      if (fileCards.length === 0) {
        this.showError("No files to download");
        return;
      }
      
      try {
        const zip = new JSZip();
        const selectedFilesForMode = Array.from(this.selectedFiles.entries()).filter(([_, data]) => data.mode === "encode");
        
        // Process each file and add to ZIP
        for (const [fileId, { file }] of selectedFilesForMode) {
          const arrayBuffer = await this.readFileAsArrayBuffer(file);
          const uint8Array = new Uint8Array(arrayBuffer);
          const base64Result = Base64ToolsService.toBase64FromBytes(uint8Array);
          const mimeType = Base64ToolsService.getMimeTypeFromBase64(file, uint8Array);
          const dataUri = `data:${mimeType};base64,${base64Result}`;
          
          // Add to ZIP with .txt extension
          const fileName = `${file.name.split(".")[0]}.txt`;
          zip.file(fileName, dataUri);
        }
        
        // Generate and download ZIP with date format
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const dateStr = this.getFormattedDate();
        this.downloadBlob(zipBlob, `encoded_b64_${dateStr}.zip`);
        this.showSuccess("Downloaded all files as ZIP");
      } catch (error) {
        console.error("Failed to create ZIP:", error);
        this.showError("Failed to create ZIP file");
      }
      return;
    }
    
    // For decode mode with processed cards - create ZIP
    if (mode === "decode" && processedDisplay && processedDisplay.style.display === "block") {
      const fileCards = processedContainer.querySelectorAll(".file-card");
      if (fileCards.length === 0) {
        this.showError("No files to download");
        return;
      }
      
      try {
        const zip = new JSZip();
        const selectedFilesForMode = Array.from(this.selectedFiles.entries()).filter(([_, data]) => data.mode === "decode");
        
        // Process each file and add to ZIP
        for (const [fileId, { file }] of selectedFilesForMode) {
          const text = await this.readFileAsText(file);
          const base64Content = text.trim();
          
          if (!Base64ToolsService.isValidBase64(base64Content)) {
            continue; // Skip invalid files
          }
          
          const { base64: actualBase64 } = Base64ToolsService.normalizeDataUri(base64Content);
          const binaryString = Base64ToolsService.decodeToBinaryString(actualBase64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          const contentType = Base64ToolsService.detectContentType(bytes);
          
          // Determine file extension and content
          let fileName;
          let content;
          
          if (Base64ToolsService.isTextContent(binaryString)) {
            fileName = `${file.name.split(".")[0]}.txt`;
            content = binaryString;
          } else {
            const extension = contentType.split("/")[1] || "bin";
            fileName = `${file.name.split(".")[0]}.${extension}`;
            content = bytes;
          }
          
          zip.file(fileName, content);
        }
        
        // Generate and download ZIP with date format
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const dateStr = this.getFormattedDate();
        this.downloadBlob(zipBlob, `decoded_b64_${dateStr}.zip`);
        this.showSuccess("Downloaded all files as ZIP");
      } catch (error) {
        console.error("Failed to create ZIP:", error);
        this.showError("Failed to create ZIP file");
      }
      return;
    }

    // Single file or text output
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
}
export { Base64Tools };
