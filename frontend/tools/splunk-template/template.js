export const SplunkVTLEditorTemplate = /* html */ `
  <div class="tool-container splunk-vtl-editor">
    
    <div class="vtl-layout">
      <div class="pane editor-pane vtl-editor-pane">
        <div class="pane-header vtl-editor-header">
          <div class="vtl-editor-heading">
            <h3>Template Editor</h3>
            <div class="vtl-view-switch" role="tablist" aria-label="Template editor view">
              <button id="btnTextView" class="vtl-view-button is-active" type="button" role="tab" aria-selected="true">Text</button>
              <button id="btnTableView" class="vtl-view-button" type="button" role="tab" aria-selected="false">Table</button>
            </div>
            <details class="vtl-function-library">
              <summary>Functions</summary>
              <div class="vtl-function-library-menu">
                <div class="vtl-function-library-title">Velocity function reference</div>
                <p class="vtl-function-library-intro">
                  Call helpers with <code>$format.method(...)</code> or <code>$date.method(...)</code>. Values can be literals or references such as
                  <code>$context.amount</code>.
                </p>
                <div class="vtl-function-examples">
                  <code>$format.amount($context.amount)</code>
                  <code>$format.formatDate($context.captureDate, "dd/MM/yyyy", "id-ID")</code>
                  <code>$date.convertDate($context.captureDate, "yyyy-MM-dd'T'HH:mm:ss")</code>
                  <code>$date.get("yyyy-MM-dd HH:mm:ss")</code>
                </div>

                <section class="vtl-function-section">
                  <h4>$format date and time</h4>
                  <div class="vtl-function-table">
                    <code>dateShort(value, locale)</code><span><code>d/M/yyyy</code> — e.g. <code>12/9/2026</code></span>
                    <code>dateLong(value, locale)</code><span><code>d MMM yyyy</code> — e.g. <code>12 Sep 2026</code></span>
                    <code>dateFull(value, locale)</code><span><code>d MMMM yyyy</code> — e.g. <code>12 September 2026</code></span>
                    <code>time12(value, locale)</code><span><code>h:mm:ss a</code> — e.g. <code>1:14:15 PM</code></span>
                    <code>time24(value, locale)</code><span><code>HH:mm:ss</code> — e.g. <code>13:14:15</code></span>
                    <code>formatDate(value, pattern, locale)</code><span>Formats with any output pattern documented below.</span>
                  </div>
                  <p>Locale examples: <code>id-ID</code>, <code>en-US</code>, <code>en-GB</code>. It controls month/day names and AM/PM text.</p>
                  <details class="vtl-function-details">
                    <summary>Accepted input date formats</summary>
                    <div class="vtl-code-list">
                      <code>yyyy-MM-dd HH:mm:ss</code><code>yyyy-MM-dd HH:mm:ss.SSS</code><code>yyyy-MM-dd HH:mm:ss.SSSZ</code>
                      <code>yyyy-MM-dd HH:mm:ss.SSS'Z'</code><code>yyyy-MM-dd'T'HH:mm:ss</code><code>yyyy-MM-dd'T'HH:mm:ss.SSS</code>
                      <code>yyyy-MM-dd'T'HH:mm:ss.SSS'Z'</code><code>yyyy-MM-dd'T'HH:mm:ss.SSSZ</code><code>yyyy-MM-dd</code><code>yyyyMMdd</code>
                    </div>
                    <p>These are tried in this exact Java order. Parsing accepts a valid prefix, so an earlier seconds-only format can ignore a later millisecond or timezone suffix.</p>
                  </details>
                </section>

                <section class="vtl-function-section">
                  <h4>$format values</h4>
                  <div class="vtl-function-table">
                    <code>amount(value)</code><span>Grouping plus 2 decimals: <code>1234.5 → 1,234.50</code></span>
                    <code>smsCurrency(value)</code><span>No grouping, 2 decimals: <code>1234.5 → 1234.50</code></span>
                    <code>currency(value)</code><span>Indonesian separators: <code>1234.5 → 1.234,50</code></span>
                    <code>trimLeft10(value)</code><span>Returns the first 10 characters.</span>
                    <code>trimLeft11(value)</code><span>Returns the first 11 characters.</span>
                    <code>trimLeft25(value)</code><span>Returns the first 25 characters, then trims outer whitespace.</span>
                    <code>mask(value)</code><span>Keeps the rightmost 8 characters and replaces their first 4 with <code>****</code>.</span>
                    <code>add(...values)</code><span>Adds any number of decimal values; blank values count as zero.</span>
                    <code>encrypt(value, salt)</code><span>Returns SHA-256 hex of the directly concatenated value and salt.</span>
                    <code>replaceByRegex(value, regex, replacement)</code><span>Replaces every Java-regex match.</span>
                  </div>
                </section>

                <section class="vtl-function-section">
                  <h4>$date</h4>
                  <div class="vtl-function-table">
                    <code>get(pattern)</code><span>Formats the current date/time.</span>
                    <code>convertDate(value, pattern)</code><span>Parses a timestamp or date, then applies the output pattern.</span>
                  </div>
                  <p>
                    <code>convertDate</code> accepts <code>yyyy-[m]m-[d]d HH:mm:ss[.fffffffff]</code>, then falls back to <code>yyyy-MM-dd</code> and
                    <code>yyyy-MM-dd'T'HH:mm.ss.SSSZ</code>.
                  </p>
                </section>

                <section class="vtl-function-section">
                  <h4>Java SimpleDateFormat output patterns</h4>
                  <p>Repeat numeric letters to set minimum width: <code>M → 9</code>, <code>MM → 09</code>. Use single quotes for literals: <code>yyyy-MM-dd'T'HH:mm:ss</code>.</p>
                  <div class="vtl-pattern-grid">
                    <code>G</code><span>era</span><code>y</code><span>year</span><code>Y</code><span>week-based year</span>
                    <code>M</code><span>month; 3 = short name, 4+ = full name</span><code>L</code><span>stand-alone month</span>
                    <code>w</code><span>week in year</span><code>W</code><span>week in month</span><code>D</code><span>day in year</span>
                    <code>d</code><span>day in month</span><code>F</code><span>day-of-week occurrence in month</span>
                    <code>E</code><span>day name; 4+ = full name</span><code>u</code><span>day number; Monday 1 … Sunday 7</span>
                    <code>a</code><span>AM/PM marker</span><code>H</code><span>hour 0–23</span><code>k</code><span>hour 1–24</span>
                    <code>K</code><span>hour 0–11</span><code>h</code><span>hour 1–12</span><code>m</code><span>minute</span>
                    <code>s</code><span>second</span><code>S</code><span>millisecond</span><code>z</code><span>general timezone name</span>
                    <code>Z</code><span>RFC 822 timezone, e.g. <code>+0700</code></span><code>X</code><span>ISO 8601 timezone; use <code>X</code>, <code>XX</code>, or <code>XXX</code></span>
                  </div>
                  <p>Examples: <code>dd/MM/yyyy</code>, <code>EEEE, d MMMM yyyy</code>, <code>yyyy-MM-dd HH:mm:ss.SSS</code>, <code>yyyy-MM-dd'T'HH:mm:ssXXX</code>.</p>
                </section>
              </div>
            </details>
          </div>
          <div id="textEditorActions" class="vtl-panel-actions">
            <button id="btnFormatVtl" class="btn btn-primary btn-sm" title="Format template">Format</button>
            <button id="btnMinifyVtl" class="btn btn-primary btn-sm" title="Minify template">Minify</button>
            <button id="btnCopyVtl" class="btn btn-secondary btn-sm" title="Copy">Copy</button>
            <button id="btnPasteVtl" class="btn btn-secondary btn-sm" title="Paste">Paste</button>
            <button id="btnClearVtl" class="btn btn-secondary btn-sm" title="Clear">Clear</button>
          </div>
          <div id="tableEditorActions" class="vtl-panel-actions" hidden>
            <button id="btnCopyInputsJson" class="btn btn-secondary btn-sm" title="Copy required template inputs as nested JSON">Inputs JSON</button>
            <button id="btnCopyInputsLines" class="btn btn-secondary btn-sm" title="Copy one required input path per line">Inputs Lines</button>
            <button id="btnAddField" class="btn btn-secondary btn-sm" title="Add field">Add Field</button>
          </div>
        </div>
        <div id="textEditorPanel" class="vtl-editor-view is-active" role="tabpanel" aria-labelledby="btnTextView">
          <div id="vtlEditor" class="monaco-editor-container"></div>
        </div>
        <div id="tableEditorPanel" class="vtl-editor-view" role="tabpanel" aria-labelledby="btnTableView" hidden>
          <div id="fieldsTable" class="handsontable-container"></div>
        </div>
      </div>

      <div id="vtlResizer" class="vtl-resizer" role="separator" aria-orientation="vertical" aria-label="Resize panes"></div>

      <div class="pane vtl-parameters-pane">
        <div class="pane-header vtl-context-header">
          <h3>Context Data</h3>
          <div class="vtl-panel-actions">
            <button id="btnGenerateParameters" class="btn btn-secondary btn-sm" title="Add fields required by the template">Sync</button>
            <button id="btnFormatParameters" class="btn btn-secondary btn-sm" title="Format sample JSON">Format</button>
          </div>
        </div>
        <div id="splunkParameters" class="vtl-parameters-input" aria-label="Sample parameters JSON"></div>
      </div>

      <div class="pane vtl-preview-pane">
        <div class="pane-header">
          <div>
            <h3>Rendered Result</h3>
            <span id="previewStatus" class="vtl-pane-caption" role="status" hidden></span>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnCopyPreview" class="btn btn-secondary btn-sm" title="Copy rendered preview">Copy</button>
          </div>
        </div>
        <pre id="splunkPreview" class="vtl-preview-output" aria-label="Rendered Splunk template"></pre>
      </div>
    </div>
  </div>
`;
