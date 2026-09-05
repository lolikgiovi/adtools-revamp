export const imageCheckerTemplate = /*html*/ `
  <div class="check-image-tool-container">
    <section class="check-image-workspace" aria-labelledby="imageInputHeading">
      <div class="check-image-input-header">
        <div>
          <label id="imageInputHeading" class="check-image-field-label" for="batchImagePathsInput">Image IDs or paths</label>
        </div>
        <button
          id="savedReferencesButton"
          class="btn btn-ghost btn-sm saved-references-button"
          type="button"
          aria-expanded="false"
          aria-controls="referenceLibrary"
        >
          <span>Saved references</span>
          <span id="savedReferencesCount" class="saved-references-count">0</span>
        </button>
      </div>

      <div class="check-image-input-shell">
        <textarea
          id="batchImagePathsInput"
          class="check-image-textarea"
          rows="6"
          placeholder="e.g. 8f6c2f1a-4f2d-4a8f-9b1e-0fd1a75b21c4\n/content/v1/image/hero-banner.png"
          aria-describedby="imageInputHelp inputMeta inputValidationMessage"
          autocomplete="off"
          spellcheck="false"
        ></textarea>
        <div class="check-image-input-footer">
          <span id="inputMeta" class="input-meta">Paste one identifier per line.</span>
          <span class="shortcut-hint"><kbd>⌘</kbd><kbd>↵</kbd> to run</span>
        </div>
      </div>
      <p id="inputValidationMessage" class="input-validation-message" role="status" hidden></p>

      <div class="check-image-toolbar">
        <div class="check-image-input-actions">
          <button id="pasteButton" class="btn btn-secondary btn-sm" type="button">Paste IDs</button>
          <button id="clearButton" class="btn btn-ghost btn-sm" type="button">Clear</button>
        </div>
        <div class="check-image-run-actions">
          <div class="environment-control">
            <label class="environment-select-field" for="envSelector">
              <select id="envSelector" class="env-selector">
                <option value="all">All environments</option>
              </select>
            </label>
            <span id="environmentStatus" class="environment-status" aria-live="polite" hidden></span>
            <button id="configureEnvironmentsButton" class="btn btn-secondary btn-sm" type="button" hidden>
              Set CDN Base URLs
            </button>
          </div>
          <button id="checkImageButton" class="btn btn-primary" type="button" disabled>Check images</button>
          <button id="cancelCheckButton" class="btn btn-ghost btn-sm" type="button" hidden>Cancel</button>
          <button id="retryAllTimeoutsBtn" class="btn btn-secondary btn-sm" type="button" hidden>Retry timeouts</button>
        </div>
      </div>
    </section>

    <section id="referenceLibrary" class="reference-library" aria-labelledby="referenceLibraryHeading" hidden>
      <div class="reference-library-header">
        <div>
          <h2 id="referenceLibraryHeading">Image reference library</h2>
          <p>Keep a human-friendly name next to an identifier you use often.</p>
        </div>
        <button id="closeSavedReferencesButton" class="btn btn-ghost btn-sm" type="button">Close</button>
      </div>
      <div class="reference-library-grid">
        <section class="reference-list-section" aria-labelledby="savedReferencesHeading">
          <div class="reference-list-heading">
            <h3 id="savedReferencesHeading">Saved references</h3>
            <span id="savedReferencesListCount" class="reference-list-count">0</span>
          </div>
          <div id="savedReferencesList" class="reference-list"></div>
        </section>
        <section class="reference-list-section" aria-labelledby="recentReferencesHeading">
          <div class="reference-list-heading">
            <h3 id="recentReferencesHeading">Recent identifiers</h3>
            <span id="recentReferencesListCount" class="reference-list-count">0</span>
          </div>
          <div id="recentReferencesList" class="reference-list"></div>
        </section>
      </div>
    </section>

    <section id="referenceEditor" class="reference-editor" aria-labelledby="referenceEditorHeading" hidden>
      <div class="reference-editor-header">
        <div>
          <h2 id="referenceEditorHeading">Save image reference</h2>
          <p>Give this identifier a name you will recognize later.</p>
        </div>
        <button id="referenceEditorCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
      </div>
      <form id="referenceEditorForm" class="reference-editor-form">
        <div class="reference-editor-identifier">
          <span class="reference-form-label">Identifier</span>
          <code id="referenceEditorPath"></code>
        </div>
        <label class="reference-form-field">
          <span>Name <span aria-hidden="true">*</span></span>
          <input id="referenceLabelInput" type="text" maxlength="80" placeholder="e.g. Homepage hero" required />
        </label>
        <label class="reference-form-field reference-form-field-wide">
          <span>Note <span class="reference-form-optional">optional</span></span>
          <input id="referenceNoteInput" type="text" maxlength="160" placeholder="e.g. Approved campaign artwork" />
        </label>
        <button class="btn btn-primary" type="submit">Save reference</button>
      </form>
    </section>

    <div id="checkProgress" class="check-progress" hidden aria-live="polite">
      <div class="check-progress-header">
        <span id="progressLabel">Checking images</span>
        <span id="progressCount" class="progress-count">0 / 0</span>
      </div>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
        <div id="progressBar" class="progress-bar"></div>
      </div>
    </div>

    <section id="resultsEmptyState" class="check-image-empty-state" aria-labelledby="emptyStateHeading">
      <div class="empty-state-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="7" y="7" width="34" height="34" rx="8" stroke="currentColor" stroke-width="1.5" />
          <path d="M15 31l7.2-7.5 5.2 5.2 3.5-3.7L36 31" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="18.5" cy="17.5" r="2.5" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </div>
      <h2 id="emptyStateHeading">Nothing checked yet</h2>
      <p>Paste image identifiers above, choose an environment scope, then run the check.</p>
      <div class="empty-state-steps" aria-label="How to check an image">
        <span><strong>1</strong> Paste IDs</span>
        <span><strong>2</strong> Choose scope</span>
        <span><strong>3</strong> Check images</span>
      </div>
    </section>

    <div id="resultsContainer" class="results-container check-image-results-container" aria-live="polite"></div>
  </div>
`;
