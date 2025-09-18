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
  }

  render() {
    return window.Base64ToolsTemplate;
  }

  async onMount() {
    this.bindToolEvents();
    this.setupTabs();
    this.setupFileHandling();
    this.processCurrentMode();
  }

  // Override the base bindEvents to prevent early binding
  bindEvents() {
    // Don't bind events during initialization - wait for onMount
  }

  bindToolEvents() {
    const container = this.container;
    if (!container) return;

    // Tab switching
    const tabButtons = container.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const mode = e.target.dataset.mode;
        if (mode) {
          this.switchMode(mode);
        }
      });
    });

    // Process buttons
    const encodeBtn = container.querySelector('#encode-btn');
    const decodeBtn = container.querySelector('#decode-btn');
    
    if (encodeBtn) {
      encodeBtn.addEventListener('click', () => this.encodeToBase64());
    }
    
    if (decodeBtn) {
      decodeBtn.addEventListener('click', () => this.decodeFromBase64());
    }

    // Copy buttons
    const copyButtons = container.querySelectorAll('[id$="-copy-btn"]');
    copyButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.target.id.replace('-copy-btn', '-output');
        this.copyToClipboard(targetId);
      });
    });

    // Paste buttons
    const pasteButtons = container.querySelectorAll('[id$="-paste-btn"]');
    pasteButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.target.id.replace('-paste-btn', '-input');
        this.pasteFromClipboard(targetId);
      });
    });

    // Clear buttons
    const clearButtons = container.querySelectorAll('[id$="-clear-btn"]');
    clearButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.target.id.replace('-clear-btn', '');
        this.clearField(targetId);
      });
    });

    // Download buttons
    const downloadButtons = container.querySelectorAll('[id$="-download-btn"]');
    downloadButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.target.id.includes('encode') ? 'encode' : 'decode';
        this.downloadResult(mode);
      });
    });

    // File upload inputs
    const fileInputs = container.querySelectorAll('input[type="file"]');
    fileInputs.forEach(input => {
      input.addEventListener('change', (e) => {
        const mode = e.target.id.includes('encode') ? 'encode' : 'decode';
        this.handleFileUpload(e, mode);
      });
    });
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

    // Setup file upload click handlers
    const uploadAreas = container.querySelectorAll('.file-drop-area');
    uploadAreas.forEach(area => {
      area.addEventListener('click', () => {
        const fileInput = area.querySelector('input[type="file"]');
        if (fileInput) {
          fileInput.click();
        }
      });
    });
  }

  switchMode(mode) {
    const container = this.container;
    if (!container) return;
    
    this.currentMode = mode;
    
    // Update tab buttons
    const tabButtons = container.querySelectorAll('.tab-button');
    tabButtons.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      }
    });
    
    // Update sections visibility
    const sections = container.querySelectorAll('.tool-section');
    sections.forEach(section => {
      section.style.display = section.classList.contains(`${mode}-section`) ? 'block' : 'none';
    });
  }

  processCurrentMode() {
    if (this.currentMode === 'encode') {
      this.encodeToBase64();
    } else {
      this.decodeFromBase64();
    }
  }

  async handleFileUpload(event, mode) {
    const files = Array.from(event.target.files);
    for (const file of files) {
      await this.processFile(file, mode);
    }
  }

  async processFile(file, mode) {
    const container = this.container;
    if (!container) return;

    try {
      if (mode === 'encode') {
        // For encoding, read file as ArrayBuffer and convert to base64
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        
        const outputArea = container.querySelector('#encode-output');
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
          const outputArea = container.querySelector('#decode-output');
          if (outputArea) {
            outputArea.value = `File decoded successfully. Size: ${this.formatFileSize(blob.size)}`;
          }
          
          // Store for download
          this.decodedBlob = blob;
          this.decodedFilename = file.name.replace(/\.[^/.]+$/, '') + '_decoded';
        } catch (error) {
          this.showError('Decode Error', 'Invalid Base64 content in file');
        }
      }
      
      this.showFileInfo(file, mode);
    } catch (error) {
      this.showError('File Error', `Failed to process file: ${error.message}`);
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
          <strong>Type:</strong> ${file.type || 'Unknown'}
        </div>
      `;
      infoDiv.style.display = 'block';
    }
  }

  encodeToBase64() {
    const container = this.container;
    if (!container) return;

    const inputArea = container.querySelector('#encode-input');
    const outputArea = container.querySelector('#encode-output');
    
    if (!inputArea || !outputArea) return;
    
    const text = inputArea.value;
    
    if (!text.trim()) {
      this.clearErrors();
      outputArea.value = '';
      return;
    }
    
    try {
      const encoded = btoa(unescape(encodeURIComponent(text)));
      outputArea.value = encoded;
      this.clearErrors();
    } catch (error) {
      this.showError('Encoding Error', 'Failed to encode text to Base64');
      outputArea.value = '';
    }
  }

  decodeFromBase64() {
    const container = this.container;
    if (!container) return;

    const inputArea = container.querySelector('#decode-input');
    const outputArea = container.querySelector('#decode-output');
    
    if (!inputArea || !outputArea) return;
    
    const base64Text = inputArea.value.trim();
    
    if (!base64Text) {
      this.clearErrors();
      outputArea.value = '';
      return;
    }
    
    try {
      const decoded = decodeURIComponent(escape(atob(base64Text)));
      outputArea.value = decoded;
      this.clearErrors();
    } catch (error) {
      this.showError('Decoding Error', 'Invalid Base64 string');
      outputArea.value = '';
    }
  }

  async copyToClipboard(targetId) {
    const container = this.container;
    if (!container) return;

    const element = container.querySelector(`#${targetId}`);
    if (!element || !element.value.trim()) {
      this.showError('Copy Error', 'No content to copy');
      return;
    }
    
    try {
      await navigator.clipboard.writeText(element.value);
      this.showSuccess('Copied to clipboard!');
    } catch (error) {
      this.showError('Copy Error', 'Failed to copy to clipboard');
      console.error('Clipboard error:', error);
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
        this.showSuccess('Pasted from clipboard!');
      }
    } catch (error) {
      this.showError('Paste Error', 'Failed to paste from clipboard');
      console.error('Clipboard error:', error);
    }
  }

  clearField(targetId) {
    const container = this.container;
    if (!container) return;

    const inputElement = container.querySelector(`#${targetId}-input`);
    const outputElement = container.querySelector(`#${targetId}-output`);
    const fileInfoElement = container.querySelector(`#${targetId}-file-info`);
    
    if (inputElement) inputElement.value = '';
    if (outputElement) outputElement.value = '';
    if (fileInfoElement) {
      fileInfoElement.style.display = 'none';
      fileInfoElement.innerHTML = '';
    }
    
    // Clear any stored decoded blob
    if (targetId === 'decode') {
      this.decodedBlob = null;
      this.decodedFilename = null;
    }
    
    this.clearErrors();
  }

  downloadResult(mode) {
    const container = this.container;
    if (!container) return;

    if (mode === 'encode') {
      const outputArea = container.querySelector('#encode-output');
      if (!outputArea || !outputArea.value.trim()) {
        this.showError('Download Error', 'No encoded content to download');
        return;
      }
      
      const blob = new Blob([outputArea.value], { type: 'text/plain' });
      this.downloadBlob(blob, 'encoded.txt');
    } else {
      // For decode mode, check if we have a decoded blob
      if (this.decodedBlob) {
        this.downloadBlob(this.decodedBlob, this.decodedFilename || 'decoded_file');
      } else {
        const outputArea = container.querySelector('#decode-output');
        if (!outputArea || !outputArea.value.trim()) {
          this.showError('Download Error', 'No decoded content to download');
          return;
        }
        
        const blob = new Blob([outputArea.value], { type: 'text/plain' });
        this.downloadBlob(blob, 'decoded.txt');
      }
    }
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
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
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  showError(title, message) {
    const container = this.container;
    if (!container) return;

    this.clearErrors();
    
    const errorDiv = this.createErrorDiv();
    errorDiv.innerHTML = `
      <div class="error-header">
        <strong>${title}</strong>
        <button class="error-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="error-message">${message}</div>
    `;
    
    container.insertBefore(errorDiv, container.firstChild);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.remove();
      }
    }, 5000);
  }

  showSuccess(message) {
    const container = this.container;
    if (!container) return;

    this.clearErrors();
    
    const successDiv = this.createSuccessDiv();
    successDiv.innerHTML = `
      <div class="success-header">
        <strong>Success</strong>
        <button class="success-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="success-message">${message}</div>
    `;
    
    container.insertBefore(successDiv, container.firstChild);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.remove();
      }
    }, 3000);
  }

  clearErrors() {
    const container = this.container;
    if (!container) return;

    const errorDivs = container.querySelectorAll('.error-message-container, .success-message-container');
    errorDivs.forEach(div => div.remove());
  }

  createErrorDiv() {
    const container = this.container;
    if (!container) return null;

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message-container';
    return errorDiv;
  }

  createSuccessDiv() {
    const container = this.container;
    if (!container) return null;

    const successDiv = document.createElement('div');
    successDiv.className = 'success-message-container';
    return successDiv;
  }

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