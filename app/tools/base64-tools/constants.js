(() => {
  function getFileTypeIcon(mimeType) {
    const iconMap = {
      "application/pdf": `<svg id="base64-filecard-icon" class="file-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #dc3545;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>`,
      "application/zip": `<svg id="base64-filecard-icon" class="file-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ffc107;">
        <path d="M16 22h2a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v3"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <path d="M10 20v-1a2 2 0 1 1 4 0v1a2 2 0 1 1-4 0Z"></path>
        <path d="M10 7h4"></path>
        <path d="M10 11h4"></path>
      </svg>`,
      "text/html": `<svg id="base64-filecard-icon" class="file-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #e34c26;">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>`,
      "text/xml": `<svg id="base64-filecard-icon" class="file-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #28a745;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>`,
      // Text default icon
      "text/plain": `<svg id="base64-filecard-icon" class="file-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #6c757d;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 1 2 2h12a2 2 0 0 1 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>`,
    };

    return (
      iconMap[mimeType] ||
      `<svg id="base64-filecard-icon" class="file-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #6c757d;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>`
    );
  }

  function getFileTypeLabel(mimeType) {
    const labelMap = {
      "application/pdf": "PDF Document",
      "application/zip": "ZIP Archive",
      "text/html": "HTML Document",
      "text/xml": "XML Document",
      "application/octet-stream": "Binary File",
    };

    return labelMap[mimeType] || mimeType.split("/")[1].toUpperCase() + " File";
  }

  window.Base64ToolsConstants = {
    getFileTypeIcon,
    getFileTypeLabel,
  };
})();
