const functionItem = (name, description, expression) => /* html */ `
  <article class="vtl-function-item" data-function-item>
    <div class="vtl-function-copy">
      <code>${name}</code>
      <span>${description}</span>
    </div>
    <div class="vtl-function-actions">
      <button class="vtl-function-copy-button" type="button" data-copy-expression="${expression}" aria-label="Copy ${name} expression">Copy</button>
      <button class="vtl-function-insert-button" type="button" data-insert-expression="${expression}">Insert</button>
    </div>
  </article>
`;

const dateFunctions = [
  ["dateShort(value, locale)", "Short date · 12/9/2026", "$format.dateShort($context.value, &quot;id-ID&quot;)"],
  ["dateLong(value, locale)", "Abbreviated month · 12 Sep 2026", "$format.dateLong($context.value, &quot;id-ID&quot;)"],
  ["dateFull(value, locale)", "Full month · 12 September 2026", "$format.dateFull($context.value, &quot;id-ID&quot;)"],
  ["time12(value, locale)", "12-hour time · 1:14:15 PM", "$format.time12($context.value, &quot;en-US&quot;)"],
  ["time24(value, locale)", "24-hour time · 13:14:15", "$format.time24($context.value, &quot;id-ID&quot;)"],
  [
    "formatDate(value, pattern, locale)",
    "Custom Java date pattern",
    "$format.formatDate($context.value, &quot;dd/MM/yyyy&quot;, &quot;id-ID&quot;)",
  ],
  ["$date.get(pattern)", "Format the current date and time", "$date.get(&quot;yyyy-MM-dd HH:mm:ss&quot;)"],
  [
    "$date.convertDate(value, pattern)",
    "Convert a timestamp or date",
    "$date.convertDate($context.value, &quot;yyyy-MM-dd&#39;T&#39;HH:mm:ss&quot;)",
  ],
];

const valueFunctions = [
  ["amount(value)", "Grouping and 2 decimals · 1,234.50", "$format.amount($context.value)"],
  ["smsCurrency(value)", "No grouping and 2 decimals · 1234.50", "$format.smsCurrency($context.value)"],
  ["currency(value)", "Indonesian separators · 1.234,50", "$format.currency($context.value)"],
  ["trimLeft10(value)", "Keep the first 10 characters", "$format.trimLeft10($context.value)"],
  ["trimLeft11(value)", "Keep the first 11 characters", "$format.trimLeft11($context.value)"],
  ["trimLeft25(value)", "Keep 25 characters and trim", "$format.trimLeft25($context.value)"],
  ["mask(value)", "Mask the first 4 of the rightmost 8", "$format.mask($context.value)"],
  ["add(...values)", "Add decimal values exactly", "$format.add($context.first, $context.second)"],
  ["encrypt(value, salt)", "SHA-256 of value plus salt", "$format.encrypt($context.value, &quot;salt&quot;)"],
  [
    "replaceByRegex(value, regex, replacement)",
    "Replace every Java-regex match",
    "$format.replaceByRegex($context.value, &quot;regex&quot;, &quot;replacement&quot;)",
  ],
];

export const SplunkVTLEditorTemplate = /* html */ `
  <div class="tool-container splunk-vtl-editor">
    <div class="vtl-layout">
      <div class="pane editor-pane vtl-editor-pane">
        <div class="pane-header vtl-compact-header vtl-editor-header">
          <div class="vtl-editor-heading">
            <div class="vtl-title-group">
              <h3>Template Editor</h3>
              <span id="templateSaveStatus" class="vtl-save-status" role="status" aria-live="polite">Saved locally</span>
            </div>
            <div class="vtl-view-switch" role="tablist" aria-label="Template editor view" aria-orientation="horizontal">
              <button id="btnTextView" class="vtl-view-button is-active" type="button" role="tab" aria-selected="true" aria-controls="textEditorPanel" tabindex="0">Text</button>
              <button id="btnTableView" class="vtl-view-button" type="button" role="tab" aria-selected="false" aria-controls="tableEditorPanel" tabindex="-1">Table</button>
            </div>
          </div>
          <div id="textEditorActions" class="vtl-panel-actions">
            <button id="btnFunctions" class="btn btn-secondary btn-sm" type="button" aria-expanded="false" aria-controls="functionLibraryPanel" title="Browse functions; type $format. or $date. for autocomplete">Functions</button>
            <button id="btnFormatVtl" class="btn btn-primary btn-sm" type="button" title="Format template">Format</button>
            <button id="btnCopyVtl" class="btn btn-secondary btn-sm" type="button" title="Copy template">Copy</button>
            <details id="editorMoreActions" class="vtl-actions-menu">
              <summary class="btn btn-secondary btn-sm">More</summary>
              <div class="vtl-actions-menu-popover">
                <button id="btnMinifyVtl" type="button">Minify template</button>
                <button id="btnPasteVtl" type="button">Paste from clipboard</button>
                <button id="btnClearVtl" class="is-destructive" type="button">Clear template</button>
              </div>
            </details>
          </div>
          <div id="tableEditorActions" class="vtl-panel-actions" hidden>
            <button id="btnCopyInputsJson" class="btn btn-secondary btn-sm" type="button" title="Copy required template inputs as nested JSON">Inputs JSON</button>
            <button id="btnCopyInputsLines" class="btn btn-secondary btn-sm" type="button" title="Copy one required input path per line">Inputs Lines</button>
            <button id="btnAddField" class="btn btn-secondary btn-sm" type="button" title="Add field">Add Field</button>
          </div>
        </div>

        <div id="textEditorPanel" class="vtl-editor-view is-active" role="tabpanel" aria-labelledby="btnTextView">
          <div id="vtlEditor" class="monaco-editor-container"></div>
        </div>
        <div id="tableEditorPanel" class="vtl-editor-view" role="tabpanel" aria-labelledby="btnTableView" hidden>
          <div id="fieldsTable" class="handsontable-container"></div>
        </div>

        <dialog id="functionLibraryPanel" class="vtl-function-panel" aria-labelledby="functionLibraryTitle" aria-describedby="functionLibraryDescription">
          <div class="vtl-function-panel-header">
            <div>
              <h3 id="functionLibraryTitle">Functions</h3>
              <p id="functionLibraryDescription">Search, then insert a valid Velocity expression at the cursor.</p>
            </div>
            <button id="btnCloseFunctions" class="vtl-icon-button" type="button" aria-label="Close functions">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
            </button>
          </div>
          <label class="vtl-function-search-label" for="functionSearch">Search functions</label>
          <input id="functionSearch" class="vtl-function-search" type="search" placeholder="Try “date”, “currency”, or “mask”" autocomplete="off" />
          <div class="vtl-function-results">
            <details class="vtl-function-group" data-function-group open>
              <summary>Date &amp; time <span>8</span></summary>
              ${dateFunctions.map((item) => functionItem(...item)).join("")}
            </details>
            <details class="vtl-function-group" data-function-group>
              <summary>Values <span>10</span></summary>
              ${valueFunctions.map((item) => functionItem(...item)).join("")}
            </details>
            <p id="functionEmptyState" class="vtl-function-empty" hidden>No matching functions. Try a broader term.</p>
            <details class="vtl-function-details">
              <summary>Accepted input date formats</summary>
              <div class="vtl-code-list">
                <code>yyyy-MM-dd HH:mm:ss</code><code>yyyy-MM-dd HH:mm:ss.SSS</code><code>yyyy-MM-dd HH:mm:ss.SSSZ</code>
                <code>yyyy-MM-dd HH:mm:ss.SSS'Z'</code><code>yyyy-MM-dd'T'HH:mm:ss</code><code>yyyy-MM-dd'T'HH:mm:ss.SSS</code>
                <code>yyyy-MM-dd'T'HH:mm:ss.SSS'Z'</code><code>yyyy-MM-dd'T'HH:mm:ss.SSSZ</code><code>yyyy-MM-dd</code><code>yyyyMMdd</code>
              </div>
              <p>Formats are tried in this Java order. A valid prefix can match before a millisecond or timezone suffix is read.</p>
            </details>
            <details class="vtl-function-details">
              <summary>Java date pattern tokens</summary>
              <p>Repeat numeric letters for minimum width. Quote literals: <code>yyyy-MM-dd'T'HH:mm:ss</code>.</p>
              <div class="vtl-pattern-grid">
                <code>G</code><span>era</span><code>y</code><span>year</span><code>Y</code><span>week year</span><code>M / L</code><span>month</span>
                <code>w / W</code><span>week</span><code>D / d</code><span>day</span><code>F</code><span>weekday occurrence</span><code>E / u</code><span>weekday</span>
                <code>a</code><span>AM/PM</span><code>H / k</code><span>24-hour</span><code>K / h</code><span>12-hour</span><code>m / s / S</code><span>minute / second / ms</span>
                <code>z / Z / X</code><span>timezone</span>
              </div>
            </details>
          </div>
        </dialog>

        <div id="vtlUndoToast" class="vtl-undo-toast" role="status" hidden>
          <span>Template cleared.</span>
          <button id="btnUndoClear" type="button">Undo</button>
          <button id="btnDismissUndo" type="button" aria-label="Dismiss">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
          </button>
        </div>
      </div>

      <div id="vtlResizer" class="vtl-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize editor and result panes" aria-valuemin="25" aria-valuemax="75" aria-valuenow="60"></div>

      <div class="pane vtl-parameters-pane">
        <div class="pane-header vtl-compact-header vtl-context-header">
          <div class="vtl-title-group">
            <h3>Context Data</h3>
            <span id="contextSaveStatus" class="vtl-save-status" role="status" aria-live="polite">Saved locally</span>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnGenerateParameters" class="btn btn-secondary btn-sm" type="button" title="Add fields required by the template">Sync fields</button>
            <button id="btnFormatParameters" class="btn btn-secondary btn-sm" type="button" title="Format sample JSON">Format JSON</button>
          </div>
        </div>
        <div id="contextStatus" class="vtl-inline-error" role="alert" hidden></div>
        <div id="splunkParameters" class="vtl-parameters-input" aria-label="Sample parameters JSON"></div>
      </div>

      <div class="pane vtl-preview-pane">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group">
            <h3>Rendered Result</h3>
            <span id="previewStatus" class="vtl-pane-caption" role="status" hidden></span>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnTogglePreviewWrap" class="btn btn-secondary btn-sm" type="button" aria-pressed="true">Wrap</button>
            <button id="btnCopyPreview" class="btn btn-secondary btn-sm" type="button" title="Copy rendered preview">Copy</button>
          </div>
        </div>
        <pre id="splunkPreview" class="vtl-preview-output" aria-label="Rendered Splunk template"></pre>
      </div>
    </div>
  </div>
`;
