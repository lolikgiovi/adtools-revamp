import { editorThemeOptions } from "./themes.js";
import { workbenchIcon } from "./icon.js";

const button = (action, label, extra = "") =>
  `<button type="button" class="btn btn-secondary btn-sm" data-action="${action}" ${extra}>${label}</button>`;

const iconButton = (action, label, icon, extra = "") =>
  `<button type="button" class="puml-icon-button" data-action="${action}" aria-label="${label}" title="${label}" ${extra}>${workbenchIcon(icon)}</button>`;

export const template = `
  <div class="plantuml-tool tool-container">
    <div class="puml-workspace">
      <aside id="puml-explorer" aria-label="Workspace files">
        <header class="puml-explorer-header">
          <div class="puml-actions">
            ${iconButton("search-files", "Search files", "search", 'aria-expanded="false" aria-controls="puml-file-search"')}
            ${iconButton("new-file", "New file (Alt+N)", "filePlus")}
            ${iconButton("new-folder", "New folder", "folderPlus")}
            ${iconButton("import", "Import files", "upload")}
          </div>
        </header>
        <div id="puml-file-search" hidden>
          <input type="search" id="puml-search" aria-label="Search files" placeholder="Search files…" autocomplete="off" spellcheck="false"/>
          ${iconButton("close-search", "Close file search", "close")}
        </div>
        <div id="puml-tree"></div>
      </aside>
      <div class="puml-explorer-resizer" role="separator" tabindex="0" aria-label="Resize files" aria-orientation="vertical"></div>
      <section class="puml-editor-pane" aria-label="Source editor">
        <header class="puml-editor-toolbar">
          <div class="puml-actions">
            ${iconButton("explorer", "Hide workspace (⌘/Ctrl+B)", "sidebar", 'aria-expanded="true" aria-controls="puml-explorer"')}
            ${iconButton("format", "Format document (Shift+Alt+F)", "format")}
            <select id="puml-font-size" aria-label="Editor font size" title="Editor font size">
              ${[10, 11, 12, 13, 14, 16, 18, 20].map((size) => `<option value="${size}" ${size === 12 ? "selected" : ""}>${size} px</option>`).join("")}
            </select>
            <select id="puml-editor-theme" aria-label="Editor theme" title="Editor theme">
              ${editorThemeOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
            </select>
            ${iconButton("palette", "Colors", "palette", 'aria-haspopup="dialog"')}
            ${iconButton("source", "Save source (.puml)", "download")}
          </div>
          ${iconButton("preview", "Hide preview", "preview", 'aria-expanded="true" aria-controls="puml-preview-pane"')}
        </header>
        <div id="puml-tabs" role="tablist" aria-label="Open diagrams"></div>
        <div id="puml-editor"></div>
        <div id="puml-no-file" hidden>Open a file or create a new diagram.</div>
      </section>
      <div class="puml-resizer" role="separator" tabindex="0" aria-label="Resize source editor" aria-orientation="vertical"></div>
      <section id="puml-preview-pane" class="puml-preview-pane" aria-label="Diagram preview">
        <header class="puml-preview-header">
          <strong>Preview</strong>
          <div class="puml-actions">
            ${iconButton("restart", "Restart renderer", "restart")}
            ${button("svg", "SVG", "disabled")}
            ${button("png", "PNG", "disabled")}
            ${iconButton("maximize-preview", "Maximize preview", "maximize", 'aria-pressed="false"')}
            ${iconButton("hide-preview", "Hide preview", "close")}
          </div>
        </header>
        <div id="puml-preview" tabindex="0" aria-label="Diagram canvas. Drag to pan, pinch to zoom, double-click to fit.">
          <span id="puml-preview-empty">Loading PlantUML…</span>
          <img hidden draggable="false" alt="Rendered diagram"/>
        </div>
        <div id="puml-error" role="alert" hidden>
          <div class="puml-render-error">
            <div class="puml-error-heading">
              <strong id="puml-error-message"></strong>
              <button type="button" class="puml-error-link" data-action="error-line" hidden>Go to error</button>
            </div>
            <p id="puml-error-context"></p>
          </div>
        </div>
        <footer class="puml-preview-footer">
          <span id="puml-status" role="status" data-state="loading">Loading engine…</span>
          <div class="puml-actions">
            ${button("zoom-out", "−", 'aria-label="Zoom out"')}
            ${button("actual-size", "100%", 'aria-label="Reset zoom to 100%" title="Reset zoom to 100%"')}
            ${button("zoom-in", "+", 'aria-label="Zoom in"')}
            ${button("fit", "Fit", 'aria-pressed="true" title="Fit diagram to available space"')}
          </div>
        </footer>
      </section>
    </div>
    <footer class="puml-statusbar"><span id="puml-path"></span><span id="puml-save" role="status">Loading…</span></footer>
    <div id="puml-storage-error" role="alert" hidden></div>
    <input id="puml-import" type="file" accept=".puml,.plantuml,.iuml,.txt,.zip" multiple hidden/>
  </div>`;
