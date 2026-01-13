export const imageCheckerTemplate = /*html*/ `
    <div class="check-image-tool-container">
      <div class="input-container check-image-input-container">
        <div class="check-image-textarea-wrap">
          <textarea id="batchImagePathsInput" class="check-image-textarea" placeholder="Enter image UUIDs or /content/v1/image paths, one per line"></textarea>
        </div>
        <div class="button-group check-image-button-group">
        <button id="clearButton" class="btn btn-sm btn-secondary">Clear</button>
        <button id="pasteButton" class="btn btn-sm btn-secondary">Paste</button>
        <button id="checkImageButton" class="btn btn-sm btn-primary">Check Images</button>
        </div>
      </div>
      <div id="resultsContainer" class="results-container check-image-results-container" aria-live="polite">
        <!-- Results will be displayed here -->
      </div>
    </div>
`;
