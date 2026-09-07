export const CharCounterTemplate = /* html */ `
  <div class="tool-container char-counter">
    <section class="char-counter-workspace" aria-labelledby="charCounterHeading">
      <div class="char-counter-toolbar">
        <div class="char-counter-toolbar-copy">
          <h2 id="charCounterHeading">Text</h2>
          <p>Type or paste text to see its counts instantly.</p>
        </div>
        <div class="char-counter-toolbar-controls">
          <div class="char-counter-modes" role="group" aria-label="Counting mode">
            <button id="charCounterSummaryMode" class="char-counter-mode" type="button" aria-pressed="true">Summary</button>
            <button id="charCounterRowMode" class="char-counter-mode" type="button" aria-pressed="false">Per row</button>
          </div>
          <div class="char-counter-actions">
            <button id="charCounterPaste" class="btn btn-secondary btn-sm" type="button">Paste</button>
            <button id="charCounterCopy" class="btn btn-secondary btn-sm" type="button" disabled>Copy</button>
            <button id="charCounterClear" class="btn btn-ghost btn-sm" type="button" disabled>Clear</button>
          </div>
        </div>
      </div>

      <div class="char-counter-editor-layout">
        <label class="sr-only" for="charCounterInput">Text to count</label>
        <textarea
          id="charCounterInput"
          class="char-counter-input"
          placeholder="config-integration-service-code-01&#10;config-integration-service-code-0124234234"
          spellcheck="true"
          autofocus
        ></textarea>

        <aside class="char-counter-row-panel" aria-labelledby="charCounterRowsHeading">
          <div class="char-counter-row-header">
            <div>
              <h3 id="charCounterRowsHeading">Length per row</h3>
              <p id="charCounterRowsCaption">0 rows</p>
            </div>
            <span>Characters</span>
          </div>
          <div id="charCounterRows" class="char-counter-rows"></div>
        </aside>
      </div>

      <div class="char-counter-summary" aria-label="Text counts">
        <div class="char-counter-primary">
          <output id="charCounterCharacters">0</output>
          <span>characters</span>
        </div>
        <dl class="char-counter-details">
          <div>
            <dt>Without spaces</dt>
            <dd id="charCounterNoSpaces">0</dd>
          </div>
          <div>
            <dt>Words</dt>
            <dd id="charCounterWords">0</dd>
          </div>
          <div>
            <dt>Lines</dt>
            <dd id="charCounterLines">0</dd>
          </div>
          <div>
            <dt>UTF-8 bytes</dt>
            <dd id="charCounterBytes">0</dd>
          </div>
        </dl>
      </div>
    </section>
  </div>
`;
