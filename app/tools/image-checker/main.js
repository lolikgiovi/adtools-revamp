import { imageCheckerTemplate } from "./template.js";
import { ImageCheckerService, BaseUrlService } from "./service.js";
import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";

export class ImageCheckerUI {
  constructor(container) {
    this.container = container;
    this.baseUrlService = new BaseUrlService();
    this.imageCheckerService = new ImageCheckerService(this.baseUrlService);
    this.initializeUi();
    this.bindElements();
    this.setupEventListeners();
  }

  initializeUi() {
    this.container.innerHTML = imageCheckerTemplate;
  }

  bindElements() {
    this.elements = {
      batchImagePathsInput: document.getElementById("batchImagePathsInput"),
      checkImageButton: document.getElementById("checkImageButton"),
      clearButton: document.getElementById("clearButton"),
      resultsContainer: document.getElementById("resultsContainer"),
    };
  }

  setupEventListeners() {
    this.elements.checkImageButton.addEventListener("click", () => {
      this.checkImages();
      this.saveValues();
    });
    this.elements.clearButton.addEventListener("click", () => {
      this.clearResults();
      this.clearSavedValues();
      this.elements.batchImagePathsInput.value = "";
    });

    // Batch mode enter key handler
    this.elements.batchImagePathsInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && e.ctrlKey) {
        this.checkImages();
        this.saveValues();
      }
    });

    // Load saved values
    this.loadSavedValues();
  }

  async checkImages() {
    await this.checkBatchImages();
  }

  async checkBatchImages() {
    const batchInput = this.elements.batchImagePathsInput.value.trim();
    if (!batchInput) {
      this.showError("Please enter at least one image path or UUID");
      return;
    }

    // Split by newlines and filter out empty lines
    const imagePaths = batchInput.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (imagePaths.length === 0) {
      this.showError("Please enter at least one valid image path or UUID");
      return;
    }

    this.showLoading();
    try {
      const batchResults = await this.imageCheckerService.checkMultipleImagesAgainstAllUrls(imagePaths);
      this.displayBatchResults(batchResults);
    } catch (error) {
      this.showError(`Error checking images: ${error.message}`);
    }
  }

  displayResults(results) {
    this.clearResults();

    if (results.length === 0) {
      this.showError("No results found. Please check your input and try again.");
      return;
    }

    const resultsContainer = this.elements.resultsContainer;

    // Create a container for all results
    const resultsWrapper = document.createElement("div");
    resultsWrapper.className = "results-wrapper";

    // Add summary at the top
    const summary = document.createElement("div");
    summary.className = "results-summary";
    const existingCount = results.filter((r) => r.exists).length;
    summary.innerHTML = `
      <h4>Summary</h4>
      <p>Found in ${existingCount} of ${results.length} environments</p>
    `;
    resultsWrapper.appendChild(summary);

    // Add each result
    results.forEach((result) => {
      const resultCard = document.createElement("div");
      resultCard.className = `result-card ${result.exists ? "success" : "error"}`;

      let content = `
        <h4>${result.name || "Unknown"}</h4>
        <p class="status ${result.exists ? "success" : "error"}">
          ${result.exists ? "✅ Image Found" : "❌ Image Not Found"}
        </p>
        <p><a href="${result.url || "#"}" target="_blank">${result.url ? "Image URL" : "N/A"}</a></p>
      `;

      if (result.exists) {
        content += `
          <p><strong>Dimension:</strong> ${result.width}×${result.height} (${result.aspectRatio}:1)</p>
        `;

        // Add image preview
        content += `<div class="image-preview"><img src="${result.url}" alt="Image Preview" /></div>`;
      } else if (result.status) {
        content += `<p><strong>Status:</strong> ${result.status} ${result.statusText}</p>`;
      } else if (result.error) {
        content += `<p><strong>Error:</strong> ${result.error}</p>`;
      }

      resultCard.innerHTML = content;
      resultsWrapper.appendChild(resultCard);
    });

    resultsContainer.appendChild(resultsWrapper);
  }

  displayBatchResults(batchResults) {
    this.clearResults();

    if (batchResults.length === 0) {
      this.showError("No results found. Please check your input and try again.");
      return;
    }

    const resultsContainer = this.elements.resultsContainer;
    const resultsWrapper = document.createElement("div");
    resultsWrapper.className = "results-wrapper batch-results";

    // Create a table for the results
    const tableContainer = document.createElement("div");
    tableContainer.className = "batch-results-table-container";

    // Get all unique environment names from the first result
    const environments = batchResults[0]?.results.map((r) => r.name) || [];

    const table = document.createElement("table");
    table.className = "batch-results-table";

    // Create table header
    const thead = document.createElement("thead");
    let headerRow = document.createElement("tr");

    // Add image identifier column
    let th = document.createElement("th");
    th.textContent = "Image ID";
    headerRow.appendChild(th);

    // Add environment columns with fixed width
    environments.forEach((env) => {
      th = document.createElement("th");
      th.textContent = env || "Unknown";
      th.style.width = "200px"; // Match the width in CSS
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement("tbody");

    // Add a row for each image
    batchResults.forEach((imageResult) => {
      const row = document.createElement("tr");

      // Add image path cell with UUID only
      let td = document.createElement("td");
      td.className = "image-path-cell";

      // Extract UUID from path if possible
      const uuidMatch = imageResult.path.match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\.png)?$/i);
      td.textContent = uuidMatch ? uuidMatch[1] : imageResult.path;
      td.title = imageResult.path; // Keep full path as tooltip
      row.appendChild(td);

      // Add status cells for each environment
      imageResult.results.forEach((result) => {
        td = document.createElement("td");
        td.className = `status-cell ${result.exists ? "success" : "error"}`;

        if (result.exists) {
          // Create a container for the content
          const container = document.createElement("div");
          container.style.textAlign = "center";
          container.style.height = "100%";
          container.style.display = "flex";
          container.style.flexDirection = "column";
          container.style.justifyContent = "center";
          container.style.alignItems = "center";

          // Create a mini image preview instead of check mark
          const miniPreview = document.createElement("div");
          miniPreview.className = "mini-image-preview";
          const img = document.createElement("img");
          img.src = result.url;
          img.alt = "Image Preview";
          miniPreview.appendChild(img);
          container.appendChild(miniPreview);

          // Add size information below the image
          const sizeInfo = document.createElement("div");
          sizeInfo.className = "image-size-info";
          sizeInfo.textContent = `${result.width}×${result.height}`;
          container.appendChild(sizeInfo);

          td.appendChild(container);
        } else {
          const statusIcon = document.createElement("span");
          statusIcon.className = "status-icon";
          statusIcon.textContent = "❌";
          td.appendChild(statusIcon);
        }

        // Add tooltip with more details
        if (result.exists) {
          td.title = `Dimensions: ${result.width}×${result.height}\nAspect Ratio: ${result.aspectRatio}:1\nURL: ${result.url}`;

          // Make the cell clickable to view details
          td.addEventListener("click", () => {
            this.showImageDetails(result, imageResult.path);
          });
          td.style.cursor = "pointer";
        } else if (result.error) {
          td.title = `Error: ${result.error}`;
        } else {
          td.title = "Image not found";
        }

        row.appendChild(td);
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    resultsWrapper.appendChild(tableContainer);

    // Add a note about clicking on cells
    const note = document.createElement("div");
    note.className = "batch-results-note";
    note.textContent = "Click on an image preview to view full details";
    resultsWrapper.appendChild(note);

    resultsContainer.appendChild(resultsWrapper);
  }

  showImageDetails(result, imagePath) {
    // Create a modal or overlay to show image details
    const modal = document.createElement("div");
    modal.className = "image-details-modal";

    const modalContent = document.createElement("div");
    modalContent.className = "image-details-content";

    // Add close button
    const closeButton = document.createElement("button");
    closeButton.className = "close-modal-button";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => {
      document.body.removeChild(modal);
    });

    // Add image details
    const content = `
      <h3>Image Details</h3>
      <p><strong>Image ID:</strong> ${imagePath}</p>
      <p><strong>Environment:</strong> ${result.name || "Unknown"}</p>
      <p><strong>Dimension:</strong> ${result.width}×${result.height} (${result.aspectRatio}:1)</p>
      <p><a href="${result.url}" target="_blank" style="color: inherit;">Open Image in New Tab</a></p>
      <div class="image-preview large"><img src="${result.url}" alt="Image Preview" /></div>
    `;

    modalContent.innerHTML = content;
    modalContent.appendChild(closeButton);
    modal.appendChild(modalContent);

    // Add click outside to close
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });

    document.body.appendChild(modal);
  }

  showLoading() {
    this.elements.resultsContainer.innerHTML = '<div class="check-image-loading">Checking images...</div>';
  }

  showError(message) {
    this.elements.resultsContainer.innerHTML = `<div class="check-image-error-banner">${message}</div>`;
  }

  clearResults() {
    this.elements.resultsContainer.innerHTML = "";
  }

  saveValues() {
    const values = {
      batchImagePaths: this.elements.batchImagePathsInput.value,
    };
    localStorage.setItem("image_checker_last_value", JSON.stringify(values));
  }

  loadSavedValues() {
    try {
      const savedValues = localStorage.getItem("image_checker_last_value");
      if (savedValues) {
        const values = JSON.parse(savedValues);
        this.elements.batchImagePathsInput.value = values.batchImagePaths || "";
      }
    } catch (error) {
      console.error("Error loading saved values:", error);
    }
  }

  clearSavedValues() {
    localStorage.removeItem("image_checker_last_value");
  }
}

class CheckImageTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "check-image",
      name: "Check Image",
      description: "Verify image IDs across CDN environments",
      icon: "check-image",
      category: "application",
      eventBus,
    });
    // Blend UI responsibilities directly into the tool
    this.baseUrlService = new BaseUrlService();
    this.imageCheckerService = new ImageCheckerService(this.baseUrlService);
    this.root = null;
    this.elements = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return `<div class="check-image-tool" id="check-image-tool-root"></div>`;
  }

  onMount() {
    this.root = this.container.querySelector("#check-image-tool-root");
    this.initializeUi();
    this.bindElements();
    this.setupEventListeners();
    try {
      UsageTracker.trackFeature("check-image", "open");
    } catch (_) {}
  }

  onUnmount() {
    this.root = null;
    this.elements = null;
  }

  /* ──────────────── UI wiring ──────────────── */
  initializeUi() {
    this.root.innerHTML = imageCheckerTemplate;
  }

  bindElements() {
    this.elements = {
      batchImagePathsInput: this.root.querySelector("#batchImagePathsInput"),
      checkImageButton: this.root.querySelector("#checkImageButton"),
      clearButton: this.root.querySelector("#clearButton"),
      resultsContainer: this.root.querySelector("#resultsContainer"),
    };
  }

  setupEventListeners() {
    this.elements.checkImageButton.addEventListener("click", () => {
      this.checkImages();
      this.saveValues();
    });
    this.elements.clearButton.addEventListener("click", () => {
      this.clearResults();
      this.clearSavedValues();
      this.elements.batchImagePathsInput.value = "";
      this.elements.batchImagePathsInput.focus();
    });

    // Batch mode enter key handler
    this.elements.batchImagePathsInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && e.ctrlKey) {
        this.checkImages();
        this.saveValues();
      }
    });

    // Load saved values
    this.loadSavedValues();
  }

  /* ──────────────── Core actions ──────────────── */
  async checkImages() {
    await this.checkBatchImages();
  }

  async checkBatchImages() {
    const batchInput = this.elements.batchImagePathsInput.value.trim();
    if (!batchInput) {
      this.showError("Please enter at least one image path or UUID");
      return;
    }

    // Split by newlines and filter out empty lines
    const imagePaths = batchInput.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (imagePaths.length === 0) {
      this.showError("Please enter at least one valid image path or UUID");
      return;
    }

    this.showLoading();
    try {
      const batchResults = await this.imageCheckerService.checkMultipleImagesAgainstAllUrls(imagePaths);
      this.displayBatchResults(batchResults);
    } catch (error) {
      this.showError(`Error checking images: ${error.message}`);
    }
  }

  /* ──────────────── Rendering ──────────────── */
  displayResults(results) {
    this.clearResults();

    if (results.length === 0) {
      this.showError("No results found. Please check your input and try again.");
      return;
    }

    const resultsContainer = this.elements.resultsContainer;

    // Create a container for all results
    const resultsWrapper = document.createElement("div");
    resultsWrapper.className = "results-wrapper";

    // Add summary at the top
    const summary = document.createElement("div");
    summary.className = "results-summary";
    const existingCount = results.filter((r) => r.exists).length;
    summary.innerHTML = `
      <h4>Summary</h4>
      <p>Found in ${existingCount} of ${results.length} environments</p>
    `;
    resultsWrapper.appendChild(summary);

    // Add each result
    results.forEach((result) => {
      const resultCard = document.createElement("div");
      resultCard.className = `result-card ${result.exists ? "success" : "error"}`;

      let content = `
        <h4>${result.name || "Unknown"}</h4>
        <p class="status ${result.exists ? "success" : "error"}">
          ${result.exists ? "✅ Image Found" : "❌ Image Not Found"}
        </p>
        <p><a href="${result.url || "#"}" target="_blank">${result.url ? "Image URL" : "N/A"}</a></p>
      `;

      if (result.exists) {
        content += `
          <p><strong>Dimension:</strong> ${result.width}×${result.height} (${result.aspectRatio}:1)</p>
        `;

        // Add image preview
        content += `<div class="image-preview"><img src="${result.url}" alt="Image Preview" /></div>`;
      } else if (result.status) {
        content += `<p><strong>Status:</strong> ${result.status} ${result.statusText}</p>`;
      } else if (result.error) {
        content += `<p><strong>Error:</strong> ${result.error}</p>`;
      }

      resultCard.innerHTML = content;
      resultsWrapper.appendChild(resultCard);
    });

    resultsContainer.appendChild(resultsWrapper);
  }

  displayBatchResults(batchResults) {
    this.clearResults();

    if (batchResults.length === 0) {
      this.showError("No results found. Please check your input and try again.");
      return;
    }

    const resultsContainer = this.elements.resultsContainer;
    const resultsWrapper = document.createElement("div");
    resultsWrapper.className = "results-wrapper batch-results";

    // Create a table for the results
    const tableContainer = document.createElement("div");
    tableContainer.className = "batch-results-table-container";

    // Get all unique environment names from the first result
    const environments = batchResults[0]?.results.map((r) => r.name) || [];

    const table = document.createElement("table");
    table.className = "batch-results-table";

    // Create table header
    const thead = document.createElement("thead");
    let headerRow = document.createElement("tr");

    // Add image identifier column
    let th = document.createElement("th");
    th.textContent = "Image ID";
    headerRow.appendChild(th);

    // Add environment columns with fixed width
    environments.forEach((env) => {
      th = document.createElement("th");
      th.textContent = env || "Unknown";
      th.style.width = "200px"; // Match the width in CSS
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement("tbody");

    // Add a row for each image
    batchResults.forEach((imageResult) => {
      const row = document.createElement("tr");

      // Add image path cell with UUID only
      let td = document.createElement("td");
      td.className = "image-path-cell";

      // Extract UUID from path if possible
      const uuidMatch = imageResult.path.match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\.png)?$/i);
      td.textContent = uuidMatch ? uuidMatch[1] : imageResult.path;
      td.title = imageResult.path; // Keep full path as tooltip
      row.appendChild(td);

      // Add status cells for each environment
      imageResult.results.forEach((result) => {
        td = document.createElement("td");
        td.className = `status-cell ${result.exists ? "success" : "error"}`;

        if (result.exists) {
          // Create a container for the content
          const container = document.createElement("div");
          container.style.textAlign = "center";
          container.style.height = "100%";
          container.style.display = "flex";
          container.style.flexDirection = "column";
          container.style.justifyContent = "center";
          container.style.alignItems = "center";

          // Create a mini image preview instead of check mark
          const miniPreview = document.createElement("div");
          miniPreview.className = "mini-image-preview";
          const img = document.createElement("img");
          img.src = result.url;
          img.alt = "Image Preview";
          miniPreview.appendChild(img);
          container.appendChild(miniPreview);

          // Add size information below the image
          const sizeInfo = document.createElement("div");
          sizeInfo.className = "image-size-info";
          sizeInfo.textContent = `${result.width}×${result.height}`;
          container.appendChild(sizeInfo);

          td.appendChild(container);
        } else {
          const statusIcon = document.createElement("span");
          statusIcon.className = "status-icon";
          statusIcon.textContent = "❌";
          td.appendChild(statusIcon);
        }

        // Add tooltip with more details
        if (result.exists) {
          td.title = `Dimensions: ${result.width}×${result.height}\nAspect Ratio: ${result.aspectRatio}:1\nURL: ${result.url}`;

          // Make the cell clickable to view details
          td.addEventListener("click", () => {
            this.showImageDetails(result, imageResult.path);
          });
          td.style.cursor = "pointer";
        } else if (result.error) {
          td.title = `Error: ${result.error}`;
        } else {
          td.title = "Image not found";
        }

        row.appendChild(td);
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    resultsWrapper.appendChild(tableContainer);

    // Add a note about clicking on cells
    const note = document.createElement("div");
    note.className = "batch-results-note";
    note.textContent = "Click on an image preview to view full details";
    resultsWrapper.appendChild(note);

    resultsContainer.appendChild(resultsWrapper);
  }

  /* ──────────────── Modal ──────────────── */
  showImageDetails(result, imagePath) {
    // Create a modal or overlay to show image details
    const modal = document.createElement("div");
    modal.className = "image-details-modal";

    const modalContent = document.createElement("div");
    modalContent.className = "image-details-content";

    // Add close button
    const closeButton = document.createElement("button");
    closeButton.className = "close-modal-button";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => {
      document.body.removeChild(modal);
    });

    // Add image details
    const content = `
      <h3>Image Details</h3>
      <p><strong>Image ID:</strong> ${imagePath}</p>
      <p><strong>Environment:</strong> ${result.name || "Unknown"}</p>
      <p><strong>Dimension:</strong> ${result.width}×${result.height} (${result.aspectRatio}:1)</p>
      <p><a href="${result.url}" target="_blank" style="color: inherit;">Open Image in New Tab</a></p>
      <div class="image-preview large"><img src="${result.url}" alt="Image Preview" /></div>
    `;

    modalContent.innerHTML = content;
    modalContent.appendChild(closeButton);
    modal.appendChild(modalContent);

    // Add click outside to close
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });

    document.body.appendChild(modal);
  }

  /* ──────────────── Status helpers ──────────────── */
  showLoading() {
    this.elements.resultsContainer.innerHTML = '<div class="check-image-loading">Checking images...</div>';
  }

  showError(message) {
    this.elements.resultsContainer.innerHTML = `<div class="check-image-error-banner">${message}</div>`;
  }

  clearResults() {
    this.elements.resultsContainer.innerHTML = "";
  }

  /* ──────────────── Persistence ──────────────── */
  saveValues() {
    const values = {
      batchImagePaths: this.elements.batchImagePathsInput.value,
    };
    localStorage.setItem("image_checker_last_value", JSON.stringify(values));
  }

  loadSavedValues() {
    try {
      const savedValues = localStorage.getItem("image_checker_last_value");
      if (savedValues) {
        const values = JSON.parse(savedValues);
        this.elements.batchImagePathsInput.value = values.batchImagePaths || "";
      }
    } catch (error) {
      console.error("Error loading saved values:", error);
    }
  }

  clearSavedValues() {
    localStorage.removeItem("image_checker_last_value");
  }
}

export { CheckImageTool };
