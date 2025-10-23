export const imageCheckerTemplate = /*html*/ `
    <div class="check-image-tool-container">
      <h3 id="sectionText" class="check-image-section-heading">Image ID</h3>
      <div class="input-container check-image-input-container">
        <div class="check-image-textarea-wrap">
          <textarea id="batchImagePathsInput" class="check-image-textarea" placeholder="Enter image UUIDs or /content/v1/image paths, one per line"></textarea>
        </div>
        <div class="button-group check-image-button-group">
          <button id="checkImageButton" class="check-image-button">Check Images</button>
          <button id="clearButton" class="check-image-clear-button">Clear</button>
        </div>
      </div>
      <div id="resultsContainer" class="results-container check-image-results-container" aria-live="polite">
        <!-- Results will be displayed here -->
      </div>
    </div>
`;
