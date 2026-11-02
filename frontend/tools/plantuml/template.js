const button = (action, label, extra = "") =>
  `<button type="button" class="btn btn-secondary btn-sm" data-action="${action}" ${extra}>${label}</button>`;

export const template = `
  <div class="plantuml-tool tool-container">
    <header class="puml-toolbar">
      <div class="puml-actions">
        ${button("explorer", "Files", 'aria-expanded="true" aria-controls="puml-explorer"')}
        ${button("new-file", "+ File", 'title="New file (Alt+N)"')}
        ${button("new-folder", "+ Folder")}
        ${button("import", "Import")}
        ${button("backup", "Export ZIP")}
      </div>
      <div class="puml-actions">
        ${button("format", "Format", 'title="Format document (Shift+Alt+F)"')}
        ${button("palette", "Colors", 'aria-haspopup="dialog"')}
        ${button("source", "Save .puml")}
      </div>
    </header>
    <div class="puml-workspace">
      <aside id="puml-explorer" aria-label="Workspace files">
        <button type="button" class="puml-root" data-action="root">Workspace</button>
        <div id="puml-tree"></div>
      </aside>
      <section class="puml-editor-pane" aria-label="Source editor">
        <div id="puml-tabs" role="tablist" aria-label="Open diagrams"></div>
        <div id="puml-editor"></div>
        <div id="puml-no-file" hidden>Open a file or create a new diagram.</div>
      </section>
      <div class="puml-resizer" role="separator" tabindex="0" aria-label="Resize source editor" aria-orientation="vertical"></div>
      <section class="puml-preview-pane" aria-label="Diagram preview">
        <header class="puml-preview-header">
          <strong>Preview</strong>
          <div class="puml-actions">
            ${button("restart", "↻", 'aria-label="Restart renderer" title="Restart renderer"')}
            ${button("svg", "SVG", "disabled")}
            ${button("png", "PNG", "disabled")}
          </div>
        </header>
        <div id="puml-preview" tabindex="0" aria-label="Diagram canvas. Drag to pan, pinch to zoom, double-click to fit.">
          <span id="puml-preview-empty">Loading PlantUML…</span>
          <img hidden draggable="false" alt="Rendered diagram"/>
        </div>
        <div id="puml-error" role="alert" hidden></div>
        <footer class="puml-preview-footer">
          <span id="puml-status" role="status" data-state="loading">Loading engine…</span>
          <div class="puml-actions">
            ${button("zoom-out", "−", 'aria-label="Zoom out"')}
            ${button("actual-size", "100%", 'title="Actual size"')}
            ${button("zoom-in", "+", 'aria-label="Zoom in"')}
            ${button("fit", "Fit")}
          </div>
        </footer>
      </section>
    </div>
    <footer class="puml-statusbar"><span id="puml-path"></span><span id="puml-save" role="status">Loading…</span></footer>
    <div id="puml-storage-error" role="alert" hidden></div>
    <input id="puml-import" type="file" accept=".puml,.plantuml,.iuml,.txt,.zip" multiple hidden/>
  </div>`;
