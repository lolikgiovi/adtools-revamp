export const imageCheckerTemplate = /*html*/ `
  <div class="check-image-tool-container">
    <section class="check-image-workspace" aria-labelledby="imageInputHeading">
      <div class="check-image-input-header">
        <div>
          <label id="imageInputHeading" class="check-image-field-label" for="batchImagePathsInput">Image IDs or paths</label>
        </div>
      </div>

      <div class="check-image-input-shell">
        <textarea
          id="batchImagePathsInput"
          class="check-image-textarea"
          rows="3"
          placeholder="e.g. 8f6c2f1a-4f2d-4a8f-9b1e-0fd1a75b21c4\n/content/v1/image/hero-banner.png"
          aria-describedby="inputMeta inputValidationMessage"
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
            <div class="environment-select-field">
              <span class="environment-select-label" id="envSelectorLabel">CDN environments</span>
              <button
                id="envSelector"
                class="env-selector"
                type="button"
                aria-haspopup="true"
                aria-expanded="false"
                aria-controls="envSelectorMenu"
                aria-describedby="environmentSelectionHint"
              >
                <span id="envSelectorValue" class="env-selector-value">All environments</span>
                <span class="env-selector-chevron" aria-hidden="true"></span>
              </button>
              <div
                id="envSelectorMenu"
                class="environment-select-menu app-popover-surface"
                role="group"
                aria-label="CDN environments"
                hidden
              ></div>
              <span id="environmentSelectionHint" class="environment-selection-hint">Choose one or more environments to compare.</span>
            </div>
            <span id="environmentStatus" class="environment-status" aria-live="polite" hidden></span>
            <button id="configureEnvironmentsButton" class="btn btn-secondary btn-sm" type="button" hidden>
              Set CDN Base URLs
            </button>
          </div>
          <div id="imageOracleControl" class="image-oracle-control environment-select-field">
            <span class="environment-select-label" id="oracleSelectorLabel">Oracle DB</span>
            <button
              id="oracleSelector"
              class="env-selector"
              type="button"
              aria-haspopup="true"
              aria-expanded="false"
              aria-controls="oracleSelectorMenu"
              aria-describedby="imageOracleHint"
              hidden
            >
              <span id="oracleSelectorValue" class="env-selector-value">No Oracle DB</span>
              <span class="env-selector-chevron" aria-hidden="true"></span>
            </button>
            <div
              id="oracleSelectorMenu"
              class="environment-select-menu app-popover-surface"
              role="group"
              aria-label="Oracle connections"
              hidden
            ></div>
            <button id="configureOracleButton" class="btn btn-secondary btn-sm" type="button" hidden>Set Oracle connections</button>
            <span id="imageOracleHint" class="environment-selection-hint"
              >Optional. Look up CONTENT.IMAGE in saved Oracle environments.</span
            >
          </div>
          <button id="checkImageButton" class="btn btn-primary" type="button" disabled>Check images</button>
          <button id="cancelCheckButton" class="btn btn-ghost btn-sm" type="button" hidden>Cancel</button>
          <button id="retryAllTimeoutsBtn" class="btn btn-secondary btn-sm" type="button" hidden>Retry timeouts</button>
        </div>
      </div>
    </section>

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
