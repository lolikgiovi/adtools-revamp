import { trackWorkflowEvent } from "../../core/WorkflowAnalytics.js";
import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { ThemeManager } from "../../core/ThemeManager.js";
import { confirmAction } from "../../components/ConfirmationDialog.js";
import { monaco, setCompletionWorkspace } from "./editor.js";
import { PlantUmlStore } from "./service.js";
import { PlantUmlRenderer } from "./renderer.js";
import { DiagramPreview } from "./preview.js";
import { downloadBlob, exportPng, exportWorkspace, readWorkspaceZip } from "./files.js";
import { addNode, deleteNode, initialWorkspace, moveNode, nodePath, renameNode, validateName, validateWorkspace } from "./workspace.js";
import { colorNames, colorRows, confluencePalette, starterSequence } from "./plantuml.js";
import { getIconSvg, workbenchIcon } from "./icon.js";
import { editorThemeOptions } from "./themes.js";
import { template } from "./template.js";
import { diagramType } from "./diagram-type.js";
import "./styles.css";

const USAGE_COUNTED_KEY = "plantuml.usage.counted";
// Actions whose failure means the user did not get their file; navigation and layout actions are excluded.
const FAILURE_ACTIONS = { svg: "export_svg", png: "export_png", backup: "export_workspace", format: "format" };

// Composition: a quiet file rail, persistent source tabs, and a dominant diagram canvas.
// Content: file management in the explorer, source controls in the editor, and diagram controls in the preview.
// Interaction: direct tab/file manipulation, immediate stale feedback, and pan/zoom without animation.
export class PlantUmlTool extends BaseTool {
  constructor(eventBus) {
    super({ id: "plantuml", eventBus, isHeavyTool: true });
    this.models = new Map();
    this.views = new Map();
    this.editedFiles = new Set();
    this.workspace = null;
    this.sequence = 0;
  }

  getIconSvg() {
    return getIconSvg();
  }
  render() {
    return template;
  }
  $(selector) {
    return this.container?.querySelector(selector);
  }
  get activeFile() {
    return this.workspace?.nodes.find((node) => node.id === this.workspace.activeId && node.kind === "file");
  }

  async onMount() {
    const sequence = ++this.sequence;
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.loading = true;
    this.dirty = false;
    this.saveFailed = false;
    this.selectedId = null;
    this.pendingCreation = null;
    this.store = new PlantUmlStore();
    const store = this.store;
    let workspace;
    try {
      workspace = await store.load();
    } catch (error) {
      if (sequence !== this.sequence) {
        void store.close();
        return;
      }
      workspace = initialWorkspace();
      this.saveFailed = true;
      this.storageError(`Cannot open local storage. Export your work before closing. ${error.message}`);
    }
    if (sequence !== this.sequence || !this.container) {
      void store.close();
      return;
    }
    this.workspace = workspace;
    this.loading = false;
    let fontSize = 12;
    try {
      const saved = Number(localStorage.getItem("plantuml.editorFontSize"));
      if ([10, 11, 12, 13, 14, 16, 18, 20].includes(saved)) fontSize = saved;
    } catch {
      /* The editor remains usable when browser preferences are unavailable. */
    }
    this.$("#puml-font-size").value = String(fontSize);
    this.$("#puml-font-size").addEventListener(
      "change",
      (event) => {
        const size = Number(event.target.value);
        this.editor.updateOptions({ fontSize: size, lineHeight: Math.round(size * 1.65) });
        try {
          localStorage.setItem("plantuml.editorFontSize", String(size));
        } catch {
          /* Keep the in-memory preference. */
        }
      },
      { signal },
    );
    this.editor = monaco.editor.create(this.$("#puml-editor"), {
      model: null,
      automaticLayout: true,
      fontSize,
      lineHeight: Math.round(fontSize * 1.65),
      tabSize: 2,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 20 },
      wordWrap: "off",
      fixedOverflowWidgets: true,
      quickSuggestions: { other: true, comments: false, strings: false },
      suggest: { showWords: false, showIcons: true },
      editContext: false,
      "semanticHighlighting.enabled": true,
      // Monaco 0.54 leaves a rejected highlight delay when switching models while focused.
      // PlantUML has completion providers but no document-highlight provider.
      occurrencesHighlight: "off",
    });
    this.editorTheme = "auto";
    try {
      const saved = localStorage.getItem("plantuml.editorTheme");
      if (editorThemeOptions.some(([value]) => value === saved)) this.editorTheme = saved;
    } catch {
      /* Keep the app theme when preferences are unavailable. */
    }
    this.$("#puml-editor-theme").value = this.editorTheme;
    this.$("#puml-editor-theme").addEventListener(
      "change",
      (event) => {
        this.editorTheme = event.target.value;
        this.applyEditorTheme();
        try {
          localStorage.setItem("plantuml.editorTheme", this.editorTheme);
        } catch {
          /* Keep the in-memory preference. */
        }
      },
      { signal },
    );
    this.applyEditorTheme();
    document.addEventListener(
      "themeChange",
      () => {
        if (this.isActive) this.applyEditorTheme();
      },
      { signal },
    );
    this.preview = new DiagramPreview(this.$("#puml-preview"), signal, (scale, fitting) => {
      this.$('[data-action="actual-size"]').textContent = `${Math.round(scale * 100)}%`;
      this.$('[data-action="fit"]').setAttribute("aria-pressed", String(fitting));
    });
    this.renderer = new PlantUmlRenderer(this.$(".plantuml-tool"), (result) => this.renderChanged(result));
    this.$(".plantuml-tool").addEventListener(
      "click",
      (event) => {
        if (event.target.closest("#puml-explorer") && !event.target.closest(".puml-explorer-header, #puml-file-search, .puml-node")) {
          this.selectedId = null;
          this.renderTree();
        }
        const button = event.target.closest("[data-action]");
        if (!button || button.disabled) return;
        void this.action(button.dataset.action, button).catch((error) => {
          this.reportActionFailure(button.dataset.action, error);
          this.showError(error.message);
        });
      },
      { signal },
    );
    this.$("#puml-import").addEventListener(
      "change",
      (event) => {
        const files = [...event.target.files];
        event.target.value = "";
        void this.importFiles(files).catch((error) => {
          trackWorkflowEvent("plantuml", "import_result", { outcome: "failure", file_count: files.length });
          this.reportImportFailure(error, files.length);
          this.showError(error.message);
        });
      },
      { signal },
    );
    this.$(".plantuml-tool").addEventListener("keydown", (event) => this.keydown(event), { signal, capture: true });
    window.addEventListener(
      "beforeunload",
      (event) => {
        if (this.dirty || this.saving || this.saveFailed) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      { signal },
    );
    window.addEventListener("pagehide", () => this.flushSave(), { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.flushSave();
      },
      { signal },
    );
    this.$("#puml-search").addEventListener("input", () => this.renderTree(), { signal });
    this.$("#puml-search").addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          this.closeFileSearch();
        }
      },
      { signal },
    );
    this.bindDragAndResize(signal);
    const compact = matchMedia("(max-width: 760px)");
    if (compact.matches) this.toggleExplorer(false);
    compact.addEventListener("change", (event) => this.toggleExplorer(!event.matches), { signal });
    this.refresh();
    this.scheduleSave();
    if (this.pendingRouteFileId) this.onRouteData({ fileId: this.pendingRouteFileId });
  }

  model(file) {
    if (this.models.has(file.id)) return this.models.get(file.id);
    const model = monaco.editor.createModel(file.content, "plantuml", monaco.Uri.parse(`plantuml://workspace/${file.id}.puml`));
    model.onDidChangeContent(() => {
      if (!this.workspace) return;
      this.workspace = {
        ...this.workspace,
        nodes: this.workspace.nodes.map((node) => (node.id === file.id ? { ...node, content: model.getValue() } : node)),
      };
      setCompletionWorkspace(this.workspace.nodes);
      this.editedFiles.add(file.id);
      this.scheduleSave();
      if (this.isActive) this.renderer?.render(this.activeFile, this.workspace.nodes, { delay: 1000 });
    });
    this.models.set(file.id, model);
    return model;
  }

  refresh() {
    if (!this.workspace || !this.editor) return;
    const file = this.activeFile;
    if (this.currentFileId !== file?.id) {
      if (this.currentFileId) this.views.set(this.currentFileId, this.editor.saveViewState());
      this.currentFileId = file?.id;
      this.editor.setModel(file ? this.model(file) : null);
      if (file && this.views.has(file.id)) this.editor.restoreViewState(this.views.get(file.id));
      this.diagram = null;
      this.preview.clear();
      this.preview.reset();
    }
    this.$("#puml-no-file").hidden = Boolean(file);
    this.$("#puml-path").textContent = file ? nodePath(this.workspace.nodes, file.id) : "PlantUML";
    for (const action of ["source", "format", "palette"]) this.$(`[data-action="${action}"]`).disabled = !file;
    this.renderTree();
    this.renderTabs();
    setCompletionWorkspace(this.workspace.nodes);
    this.renderer.render(file, this.workspace.nodes);
  }

  update(workspace) {
    this.workspace = workspace;
    this.refresh();
    this.scheduleSave();
  }

  renderTree() {
    const tree = this.$("#puml-tree");
    const draft = this.$("#puml-new-name");
    if (draft && this.pendingCreation) this.pendingCreation.name = draft.value;
    tree.replaceChildren();
    const query = this.$("#puml-search").value.trim().toLowerCase();
    const append = (parentId, depth) => {
      if (!query && this.pendingCreation?.parentId === parentId) tree.append(this.creationRow(depth));
      const children = this.workspace.nodes
        .filter((node) =>
          query
            ? node.kind === "file" && nodePath(this.workspace.nodes, node.id).toLowerCase().includes(query)
            : node.parentId === parentId,
        )
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
      for (const node of children) {
        const row = document.createElement("div");
        row.className = "puml-node";
        row.classList.toggle("selected", this.selectedId === node.id);
        row.style.paddingLeft = `${10 + depth * 12}px`;
        row.dataset.node = node.id;
        row.draggable = true;
        const open = document.createElement("button");
        open.type = "button";
        open.dataset.action = "open";
        open.dataset.id = node.id;
        open.title = nodePath(this.workspace.nodes, node.id);
        if (node.kind === "folder") open.setAttribute("aria-expanded", String(this.workspace.expanded.includes(node.id)));
        const icon = document.createElement("span");
        icon.innerHTML =
          node.kind === "folder"
            ? workbenchIcon(this.workspace.expanded.includes(node.id) ? "chevronDown" : "chevronRight") + workbenchIcon("folder")
            : workbenchIcon("file");
        icon.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.textContent = query ? nodePath(this.workspace.nodes, node.id) : node.name;
        open.append(icon, name);
        row.append(open);
        for (const [action, text, label] of [
          ["rename", "✎", "Rename"],
          ["delete", "×", "Delete"],
        ]) {
          const button = document.createElement("button");
          button.className = "puml-node-action";
          button.type = "button";
          button.dataset.action = action;
          button.dataset.id = node.id;
          button.textContent = text;
          button.title = `${label} ${node.name}`;
          button.setAttribute("aria-label", `${label} ${node.name}`);
          row.append(button);
        }
        tree.append(row);
        if (!query && node.kind === "folder" && this.workspace.expanded.includes(node.id)) append(node.id, depth + 1);
      }
    };
    append(null, 0);
    if (query && !tree.children.length) {
      const empty = document.createElement("div");
      empty.className = "puml-search-empty";
      empty.setAttribute("role", "status");
      empty.textContent = "No files found";
      tree.append(empty);
    }
  }

  startCreation(kind) {
    const selected = this.workspace.nodes.find((node) => node.id === this.selectedId);
    const parentId = selected?.kind === "folder" ? selected.id : selected?.parentId || null;
    this.pendingCreation = { kind, parentId, name: "" };
    this.toggleExplorer(true);
    this.closeFileSearch();
    if (parentId && !this.workspace.expanded.includes(parentId)) {
      this.workspace = { ...this.workspace, expanded: [...this.workspace.expanded, parentId] };
    }
    this.renderTree();
    const input = this.$("#puml-new-name");
    input.scrollIntoView({ block: "nearest" });
    input.focus();
  }

  creationRow(depth) {
    const creation = this.pendingCreation;
    const row = document.createElement("div");
    row.className = "puml-node puml-creation";
    row.style.paddingLeft = `${12 + depth * 12}px`;
    const icon = document.createElement("span");
    icon.className = "puml-creation-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = creation.kind === "folder" ? workbenchIcon("chevronRight") + workbenchIcon("folder") : workbenchIcon("file");
    const field = document.createElement("div");
    field.className = "puml-creation-field";
    const input = document.createElement("input");
    input.id = "puml-new-name";
    input.setAttribute("aria-label", creation.kind === "file" ? "New file name" : "New folder name");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = creation.name;
    const error = document.createElement("div");
    error.id = "puml-new-name-error";
    error.className = "puml-creation-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    input.setAttribute("aria-describedby", error.id);
    const validate = () => {
      try {
        validateName(input.value);
        if (
          this.workspace.nodes.some((node) => node.parentId === creation.parentId && node.name.toLowerCase() === input.value.toLowerCase())
        )
          throw new Error("That name already exists in this folder.");
        input.removeAttribute("aria-invalid");
        error.hidden = true;
        return true;
      } catch (failure) {
        input.setAttribute("aria-invalid", "true");
        error.textContent = failure.message;
        error.hidden = false;
        return false;
      }
    };
    const cancel = (restoreFocus) => {
      if (this.pendingCreation !== creation) return;
      this.pendingCreation = null;
      row.remove();
      if (restoreFocus) this.$(`[data-action="new-${creation.kind}"]`).focus();
    };
    input.addEventListener("input", () => {
      creation.name = input.value;
      validate();
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancel(true);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (!input.value) return cancel(true);
        if (!validate()) return;
        const next = addNode(
          this.workspace,
          input.value,
          creation.parentId,
          creation.kind,
          creation.kind === "file" ? starterSequence : "",
        );
        this.pendingCreation = null;
        this.selectedId = next.nodes.at(-1).id;
        this.update(next);
        if (creation.kind === "file") this.editor.focus();
        else this.$(`[data-action="open"][data-id="${this.selectedId}"]`).focus();
        trackWorkflowEvent("plantuml", "workspace_create_result", { outcome: "success", kind: creation.kind });
      }
    });
    input.addEventListener("blur", () => cancel(false));
    field.append(input, error);
    row.append(icon, field);
    return row;
  }

  renderTabs() {
    const tabs = this.$("#puml-tabs");
    tabs.replaceChildren();
    for (const id of this.workspace.tabs) {
      const file = this.workspace.nodes.find((node) => node.id === id);
      if (!file) continue;
      const tab = document.createElement("div");
      tab.className = "puml-tab";
      tab.classList.toggle("active", id === this.workspace.activeId);
      tab.draggable = true;
      tab.dataset.tab = id;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(id === this.workspace.activeId));
      button.dataset.action = "tab";
      button.dataset.id = id;
      button.textContent = file.name;
      button.title = nodePath(this.workspace.nodes, id);
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.dataset.action = "close-tab";
      close.dataset.id = id;
      close.setAttribute("aria-label", `Close ${file.name}`);
      tab.append(button, close);
      tabs.append(tab);
    }
  }

  onRouteData({ fileId } = {}) {
    if (!fileId) return;
    if (this.loading || !this.editor || !this.workspace) {
      this.pendingRouteFileId = fileId;
      return;
    }
    this.pendingRouteFileId = null;
    if (this.workspace.nodes.some((node) => node.id === fileId && node.kind === "file")) this.openFile(fileId);
  }

  openFile(id) {
    this.selectedId = id;
    this.update({ ...this.workspace, tabs: [...new Set([...this.workspace.tabs, id])], activeId: id });
    if (matchMedia("(max-width: 760px)").matches) this.toggleExplorer(false);
  }

  closeActiveTab(id = this.workspace?.activeId) {
    if (!id) return;
    const tabs = this.workspace.tabs.filter((tab) => tab !== id);
    this.update({ ...this.workspace, tabs, activeId: this.workspace.activeId === id ? tabs.at(-1) || null : this.workspace.activeId });
    if (this.models.has(id)) {
      this.models.get(id).dispose();
      this.models.delete(id);
    }
    this.views.delete(id);
  }

  createNewTab() {
    return this.action("new-file");
  }

  async action(action, button) {
    if (!this.workspace) return;
    const id = button?.dataset.id;
    const file = this.activeFile;
    if (action === "explorer") this.toggleExplorer();
    else if (action === "search-files") {
      this.toggleExplorer(true);
      this.$("#puml-file-search").hidden = false;
      this.$('[data-action="search-files"]').setAttribute("aria-expanded", "true");
      this.$("#puml-search").focus();
    } else if (action === "close-search") this.closeFileSearch();
    else if (action === "commands") this.quickPick(true);
    else if (action === "preview") this.togglePreview();
    else if (action === "hide-preview") {
      this.togglePreview(false);
      this.$('[data-action="preview"]').focus();
    } else if (action === "maximize-preview") this.maximizePreview();
    else if (action === "root") {
      this.selectedId = null;
      this.renderTree();
    } else if (action === "open") {
      const node = this.workspace.nodes.find((node) => node.id === id);
      this.selectedId = id;
      if (node.kind === "file") this.openFile(id);
      else
        this.update({
          ...this.workspace,
          expanded: this.workspace.expanded.includes(id)
            ? this.workspace.expanded.filter((item) => item !== id)
            : [...this.workspace.expanded, id],
        });
    } else if (action === "tab") this.openFile(id);
    else if (action === "close-tab") this.closeActiveTab(id);
    else if (action === "new-file" || action === "new-folder") {
      this.startCreation(action === "new-file" ? "file" : "folder");
    } else if (action === "rename") {
      const node = this.workspace.nodes.find((node) => node.id === id);
      this.nameDialog("Rename", node.name, (name) => this.update(renameNode(this.workspace, id, name)));
    } else if (action === "delete") {
      const node = this.workspace.nodes.find((node) => node.id === id);
      const workspace = this.workspace;
      if (
        await confirmAction({
          title: `Delete ${node.name}?`,
          description: node.kind === "folder" ? "All files inside this folder will be deleted." : "This file will be deleted.",
          confirmLabel: "Delete",
        })
      ) {
        if (!this.container || this.workspace !== workspace) return;
        const next = deleteNode(this.workspace, id);
        this.selectedId = null;
        this.update(next);
        for (const [key, model] of this.models)
          if (!next.nodes.some((node) => node.id === key)) {
            model.dispose();
            this.models.delete(key);
            this.views.delete(key);
          }
      }
    } else if (action === "error-line" && this.errorLine) {
      this.togglePreview(true);
      this.editor.setPosition({ lineNumber: this.errorLine, column: 1 });
      this.editor.revealLineInCenter(this.errorLine);
      this.editor.focus();
    } else if (action === "format") {
      try {
        await this.editor.getAction("editor.action.formatDocument").run();
        trackWorkflowEvent("plantuml", "format_result", { outcome: "success" });
      } catch (error) {
        trackWorkflowEvent("plantuml", "format_result", { outcome: "failure" });
        throw error;
      }
    } else if (action === "palette") this.paletteDialog();
    else if (action === "import") this.$("#puml-import").click();
    else if (action === "backup") {
      await exportWorkspace(this.workspace);
      UsageTracker.trackToolUse("plantuml", "export_workspace", {
        file_count: this.workspace.nodes.filter((node) => node.kind === "file").length,
      });
    } else if (action === "source" && file) downloadBlob(new Blob([file.content], { type: "text/plain;charset=utf-8" }), file.name);
    else if (action === "restart") {
      this.renderer.latest = [file, this.workspace.nodes];
      this.renderer.restart();
    } else if (action === "svg" || action === "png") {
      if (this.renderState !== "ready" || !this.diagram || this.diagram.fileId !== file?.id || this.diagram.source !== file.content) return;
      const svg = this.diagram.svg;
      if (action === "png") await exportPng(svg, file.name);
      else downloadBlob(new Blob([svg], { type: "image/svg+xml" }), file.name.replace(/\.[^.]+$/, "") + ".svg");
      UsageTracker.trackToolUse("plantuml", `export_${action}`, this.exportUseMeta(file));
    } else if (action === "zoom-in") this.preview.zoom(1.2);
    else if (action === "zoom-out") this.preview.zoom(1 / 1.2);
    else if (action === "fit") this.preview.reset();
    else if (action === "actual-size") {
      this.preview.reset();
      this.preview.scale = 1;
      this.preview.layout();
    }
  }

  // Renders follow typing pauses, file switches and resumes, so a diagram counts once per day as viewed and once as edited.
  trackDailyUse(action, fileId, meta) {
    const day = new Date().toLocaleDateString("en-CA");
    let counted = this.usageCounted;
    try {
      counted = JSON.parse(localStorage.getItem(USAGE_COUNTED_KEY)) || counted;
    } catch (_) {}
    if (counted?.day !== day || !Array.isArray(counted.keys)) counted = { day, keys: [] };
    const key = `${action}:${fileId}`;
    if (counted.keys.includes(key)) return;
    this.usageCounted = { day, keys: [...counted.keys, key] };
    try {
      localStorage.setItem(USAGE_COUNTED_KEY, JSON.stringify(this.usageCounted));
    } catch (_) {}
    UsageTracker.trackToolUse("plantuml", action, meta);
  }

  reportActionFailure(action, error) {
    if (FAILURE_ACTIONS[action]) UsageTracker.trackFailure("plantuml", FAILURE_ACTIONS[action], error);
  }

  reportImportFailure(error, fileCount) {
    UsageTracker.trackFailure("plantuml", "import", error, { file_count: fileCount });
  }

  // Which diagram a use was about: the file's own name (never its folder path), its type and size.
  fileName(fileId) {
    return this.workspace?.nodes?.find((node) => node.id === fileId)?.name;
  }

  renderUseMeta(result) {
    const fileName = this.fileName(result.fileId);
    return {
      input_size: result.source.length,
      duration_ms: result.milliseconds,
      diagram_type: diagramType(result.source),
      line_count: result.source.split("\n").length,
      ...(fileName ? { file_name: fileName } : {}),
    };
  }

  exportUseMeta(file) {
    return { file_name: file.name, diagram_type: diagramType(file.content), line_count: file.content.split("\n").length };
  }

  // Renders repeat on every typing pause, so a broken diagram is one failure until that file renders again.
  trackRenderOutcome(result) {
    this.brokenRenders ||= new Set();
    if (result.state === "ready") this.brokenRenders.delete(result.fileId);
    if (result.state !== "error") return;
    trackWorkflowEvent("plantuml", "render_result", { outcome: "failure", reason: "render_error" });
    if (this.brokenRenders.has(result.fileId)) return;
    this.brokenRenders.add(result.fileId);
    const category = result.line > 0 ? "invalid_input" : "internal";
    const fileName = this.fileName(result.fileId);
    UsageTracker.trackFailure("plantuml", "render", category, {
      diagram_type: diagramType(result.source),
      ...(fileName ? { file_name: fileName } : {}),
    });
  }

  renderChanged(result) {
    if (!this.container) return;
    this.renderState = result.state;
    this.trackRenderOutcome(result);
    const status = this.$("#puml-status");
    status.dataset.state = result.state;
    status.textContent = {
      ready: "",
      loading: "Loading engine…",
      waiting: "Editing…",
      rendering: "Rendering…",
      error: "Diagram needs a fix",
      empty: "No file open",
    }[result.state];
    this.$("#puml-error").hidden = result.state !== "error";
    this.$("#puml-error-message").textContent = result.error || "";
    this.$("#puml-error-context").textContent = this.diagram ? "Showing the last successful diagram." : "";
    this.errorLine =
      result.state === "error" && result.line > 0 && result.line <= (this.editor?.getModel()?.getLineCount() || 0) ? result.line : null;
    this.$('[data-action="error-line"]').hidden = !this.errorLine;
    const model = this.editor?.getModel();
    if (model)
      monaco.editor.setModelMarkers(
        model,
        "plantuml",
        this.errorLine
          ? [
              {
                startLineNumber: this.errorLine,
                endLineNumber: this.errorLine,
                startColumn: 1,
                endColumn: model.getLineMaxColumn(this.errorLine),
                message: result.error,
                severity: monaco.MarkerSeverity.Error,
              },
            ]
          : [],
      );
    if (result.state === "ready") {
      this.diagram = result;
      this.preview?.show(result.svg, this.activeFile?.name || "diagram");
      const meta = this.renderUseMeta(result);
      this.trackDailyUse("view", result.fileId, meta);
      if (this.editedFiles.has(result.fileId)) this.trackDailyUse("edit", result.fileId, meta);
    }
    if (!this.diagram) {
      const empty = this.$("#puml-preview-empty");
      empty.hidden = false;
      empty.textContent =
        result.state === "empty"
          ? "Open a diagram to preview"
          : result.state === "error"
            ? "Check the source to preview this diagram"
            : status.textContent;
    }
    this.$("#puml-preview img").classList.toggle("stale", result.state === "error");
    for (const action of ["svg", "png"]) this.$(`[data-action="${action}"]`).disabled = result.state !== "ready";
  }

  closeFileSearch() {
    this.$("#puml-search").value = "";
    this.$("#puml-file-search").hidden = true;
    this.$('[data-action="search-files"]').setAttribute("aria-expanded", "false");
    this.renderTree();
    this.$('[data-action="search-files"]').focus();
  }

  togglePreview(show = this.$(".puml-workspace").classList.contains("preview-hidden")) {
    this.maximizePreview(false);
    this.$(".puml-workspace").classList.toggle("preview-hidden", !show);
    const toggle = this.$('[data-action="preview"]');
    toggle.setAttribute("aria-expanded", String(show));
    toggle.setAttribute("aria-label", show ? "Hide preview" : "Show preview");
    toggle.title = show ? "Hide preview" : "Show preview";
    toggle.innerHTML = workbenchIcon(show ? "preview" : "previewClosed");
    this.editor.layout();
  }

  maximizePreview(maximize = !this.$(".puml-workspace").classList.contains("preview-maximized")) {
    const layout = this.$(".puml-workspace");
    if (maximize) {
      layout.classList.remove("preview-hidden");
      const toggle = this.$('[data-action="preview"]');
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Hide preview");
      toggle.title = "Hide preview";
      toggle.innerHTML = workbenchIcon("preview");
    }
    layout.classList.toggle("preview-maximized", maximize);
    const button = this.$('[data-action="maximize-preview"]');
    const label = maximize ? "Restore split view (Esc)" : "Maximize preview";
    button.setAttribute("aria-pressed", String(maximize));
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = workbenchIcon(maximize ? "restore" : "maximize");
    if (maximize) this.$("#puml-preview").focus();
    this.editor.layout();
  }

  toggleExplorer(show = this.$(".puml-workspace").classList.contains("explorer-hidden")) {
    this.$(".puml-workspace").classList.toggle("explorer-hidden", !show);
    const toggle = this.$('[data-action="explorer"]');
    const label = `${show ? "Hide" : "Show"} workspace (⌘/Ctrl+B)`;
    toggle.setAttribute("aria-expanded", String(show));
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.innerHTML = workbenchIcon(show ? "sidebar" : "sidebarClosed");
  }

  dialog(title) {
    this.dialogElement?.remove();
    const dialog = document.createElement("dialog");
    dialog.className = "puml-dialog";
    const heading = document.createElement("h2");
    heading.id = "puml-dialog-title";
    heading.textContent = title;
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.append(heading);
    document.body.append(dialog);
    this.dialogElement = dialog;
    dialog.addEventListener("close", () => {
      dialog.remove();
      this.editor?.focus();
    });
    return dialog;
  }

  nameDialog(title, initial, accept) {
    const dialog = this.dialog(title);
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.value = initial;
    input.required = true;
    input.maxLength = 180;
    input.setAttribute("aria-label", "Name");
    const error = document.createElement("div");
    error.className = "puml-dialog-error";
    error.setAttribute("role", "alert");
    const footer = document.createElement("footer");
    const cancel = document.createElement("button");
    cancel.className = "btn btn-secondary btn-sm";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => dialog.close();
    const save = document.createElement("button");
    save.className = "btn btn-primary btn-sm";
    save.textContent = "Save";
    footer.append(cancel, save);
    form.append(input, error, footer);
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        accept(input.value);
        dialog.close();
      } catch (failure) {
        error.textContent = failure.message;
      }
    };
    dialog.append(form);
    dialog.showModal();
    input.focus();
    input.select();
  }

  paletteDialog() {
    const dialog = this.dialog("Confluence colors");
    const grid = document.createElement("div");
    grid.className = "puml-colors";
    const insert = (text) => {
      const selection = this.editor.getSelection();
      if (!selection) return;
      this.editor.executeEdits("plantuml-palette", [{ range: selection, text, forceMoveMarkers: true }]);
      this.editor.pushUndoStop();
    };
    for (const row of colorRows)
      for (let index = 0; index < colorNames.length; index++) {
        const button = document.createElement("button");
        const token = `COLOR_${colorNames[index]}${row.suffix}`;
        button.type = "button";
        button.style.background = row.colors[index];
        button.title = `${token} · ${row.colors[index]}`;
        button.setAttribute("aria-label", token);
        button.onclick = () => {
          insert(token);
          dialog.close();
        };
        grid.append(button);
      }
    const footer = document.createElement("footer");
    for (const [label, handler] of [
      ["Copy definitions", () => this.copyToClipboard(confluencePalette)],
      [
        "Insert definitions",
        () => {
          const model = this.editor.getModel();
          const afterStart = /^\s*@start\w+[^\n]*\n/.exec(model.getValue());
          const position = model.getPositionAt(afterStart ? afterStart[0].length : 0);
          this.editor.executeEdits("plantuml-palette", [
            {
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
              text: `\n${confluencePalette}\n`,
            },
          ]);
        },
      ],
      ["Close", () => {}],
    ]) {
      const button = document.createElement("button");
      button.className = "btn btn-secondary btn-sm";
      button.textContent = label;
      button.onclick = () => {
        void handler();
        dialog.close();
      };
      footer.append(button);
    }
    dialog.append(grid, footer);
    dialog.showModal();
  }

  quickPick(commands = false) {
    const dialog = this.dialog(commands ? "Commands" : "Go to file");
    const input = document.createElement("input");
    input.type = "search";
    input.setAttribute("aria-label", commands ? "Find a command" : "Find a file");
    const list = document.createElement("div");
    list.className = "puml-quick-pick";
    const items = commands
      ? [
          ["New file", () => this.action("new-file")],
          ["New folder", () => this.action("new-folder")],
          ["Format document", () => this.action("format")],
          ["Confluence colors", () => this.action("palette")],
          [
            "Toggle word wrap",
            () => {
              this.wrap = !this.wrap;
              this.editor.updateOptions({ wordWrap: this.wrap ? "on" : "off" });
            },
          ],
          ["Import files or workspace", () => this.action("import")],
          ["Export workspace ZIP", () => this.action("backup")],
          ["Save source file", () => this.action("source")],
          ["Export SVG", () => this.action("svg")],
          ["Export PNG", () => this.action("png")],
          ["Restart renderer", () => this.action("restart")],
          ["Toggle preview", () => this.action("preview")],
          ["Maximize preview", () => this.action("maximize-preview")],
          ["Search files", () => this.action("search-files")],
          ["Fit diagram", () => this.action("fit")],
        ]
      : this.workspace.nodes
          .filter((node) => node.kind === "file")
          .map((node) => [nodePath(this.workspace.nodes, node.id), () => this.openFile(node.id)]);
    const populate = () => {
      list.replaceChildren();
      for (const [label, run] of items.filter(([label]) => label.toLowerCase().includes(input.value.toLowerCase()))) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.onclick = () => {
          dialog.close();
          Promise.resolve()
            .then(run)
            .catch((error) => this.showError(error.message));
        };
        list.append(button);
      }
      if (!list.children.length) list.textContent = "No results";
    };
    input.oninput = populate;
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === input) {
        event.preventDefault();
        list.querySelector("button")?.click();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...list.querySelectorAll("button")];
        const index = buttons.indexOf(document.activeElement);
        const next = index + (event.key === "ArrowDown" ? 1 : -1);
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }
    });
    populate();
    dialog.append(input, list);
    dialog.showModal();
    input.focus();
  }

  async importFiles(files) {
    if (!files.length) return;
    const sequence = this.sequence;
    const zip = files.find((file) => /\.zip$/i.test(file.name));
    if (zip) {
      if (files.length !== 1) throw new Error("Import one workspace ZIP at a time.");
      const next = await readWorkspaceZip(zip);
      if (sequence !== this.sequence) return;
      if (
        !(await confirmAction({
          title: "Replace PlantUML workspace?",
          description: "Current files will be replaced. Export a ZIP first to keep a backup.",
          confirmLabel: "Replace workspace",
        }))
      ) {
        trackWorkflowEvent("plantuml", "import_result", { outcome: "cancelled", file_count: files.length });
        return;
      }
      if (sequence !== this.sequence) return;
      this.editor.setModel(null);
      for (const model of this.models.values()) model.dispose();
      this.models.clear();
      this.views.clear();
      this.currentFileId = null;
      this.selectedId = null;
      this.update(next);
    } else {
      if (files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) throw new Error("Choose files totaling less than 20 MB.");
      const loaded = await Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() })));
      if (sequence !== this.sequence) return;
      let next = this.workspace;
      const selected = next.nodes.find((node) => node.id === this.selectedId);
      const parentId = selected?.kind === "folder" ? selected.id : selected?.parentId || null;
      for (const file of loaded) next = addNode(next, file.name, parentId, "file", file.content);
      this.update(validateWorkspace(next));
    }
    UsageTracker.trackToolUse("plantuml", "import", {
      file_count: files.length,
      ...(files.length === 1 ? { file_name: files[0].name } : {}),
    });
  }

  scheduleSave() {
    this.dirty = true;
    if (!this.saveFailed) this.$("#puml-save").textContent = "Saving…";
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 200);
  }

  flushSave() {
    clearTimeout(this.saveTimer);
    if (!this.dirty || this.saveFailed || !this.workspace) return;
    this.dirty = false;
    this.saving = (this.saving || 0) + 1;
    const sequence = this.sequence;
    void this.store
      .save(this.workspace)
      .then(() => {
        if (sequence === this.sequence && !this.dirty && this.saving === 1) this.$("#puml-save").textContent = "Saved locally";
      })
      .catch((error) => {
        if (sequence !== this.sequence) return;
        this.saveFailed = true;
        this.storageError(error.message);
      })
      .finally(() => {
        if (sequence === this.sequence) this.saving--;
      });
  }

  storageError(message) {
    this.$("#puml-save").textContent = "Not saved";
    this.$("#puml-storage-error").textContent = message;
    this.$("#puml-storage-error").hidden = false;
  }

  keydown(event) {
    const command = event.ctrlKey || event.metaKey;
    if (event.key === "Escape" && this.$(".puml-workspace").classList.contains("preview-maximized")) {
      event.preventDefault();
      event.stopPropagation();
      this.maximizePreview(false);
      this.$('[data-action="maximize-preview"]').focus();
    } else if (command && event.key.toLowerCase() === "p") {
      event.preventDefault();
      event.stopPropagation();
      this.quickPick(event.shiftKey);
    } else if (event.altKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      void this.action("new-file");
    } else if (command && event.key.toLowerCase() === "b") {
      event.preventDefault();
      this.toggleExplorer();
    } else if (command && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void this.action("source");
    } else if (event.altKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.wrap = !this.wrap;
      this.editor.updateOptions({ wordWrap: this.wrap ? "on" : "off" });
    }
  }

  bindDragAndResize(signal) {
    const root = this.$(".plantuml-tool");
    root.addEventListener(
      "dragstart",
      (event) => {
        const element = event.target.closest("[data-node], [data-tab]");
        if (!element) return;
        this.dragged = { id: element.dataset.node || element.dataset.tab, tab: Boolean(element.dataset.tab) };
        event.dataTransfer.setData("text/plain", this.dragged.id);
      },
      { signal },
    );
    root.addEventListener(
      "dragover",
      (event) => {
        if (this.dragged) event.preventDefault();
      },
      { signal },
    );
    root.addEventListener(
      "dragend",
      () => {
        this.dragged = null;
      },
      { signal },
    );
    root.addEventListener(
      "drop",
      (event) => {
        if (!this.dragged) return;
        event.preventDefault();
        const dragged = this.dragged;
        this.dragged = null;
        try {
          const tab = event.target.closest("[data-tab]");
          if (dragged.tab && tab) {
            const tabs = this.workspace.tabs.filter((id) => id !== dragged.id);
            tabs.splice(Math.max(0, tabs.indexOf(tab.dataset.tab)), 0, dragged.id);
            this.update({ ...this.workspace, tabs });
          } else if (event.target.closest("#puml-explorer")) {
            const target = this.workspace.nodes.find((node) => node.id === event.target.closest("[data-node]")?.dataset.node);
            const parentId = target?.kind === "folder" ? target.id : target?.parentId || null;
            this.update(moveNode(this.workspace, dragged.id, parentId));
          }
        } catch (error) {
          this.showError(error.message);
        }
      },
      { signal },
    );
    const layout = this.$(".puml-workspace");
    const editorDivider = this.$(".puml-resizer");
    const explorerDivider = this.$(".puml-explorer-resizer");
    const setShare = (share) => {
      this.share = Math.max(1 / 3, Math.min(3, share));
      layout.style.setProperty("--puml-editor-share", `${this.share}fr`);
      editorDivider.setAttribute("aria-valuenow", String(Math.round((this.share / (1 + this.share)) * 100)));
    };
    const setExplorerWidth = (width) => {
      this.explorerWidth = Math.max(140, Math.min(Math.min(400, layout.clientWidth * 0.4), width));
      layout.style.setProperty("--puml-explorer-width", `${this.explorerWidth}px`);
      explorerDivider.setAttribute("aria-valuenow", String(Math.round(this.explorerWidth)));
    };
    const bindResize = (divider, move, step) => {
      divider.addEventListener(
        "pointerdown",
        (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          divider.setPointerCapture(event.pointerId);
          this.resizing = divider;
          layout.classList.add("is-resizing");
        },
        { signal },
      );
      divider.addEventListener(
        "pointermove",
        (event) => {
          if (this.resizing === divider) move(event.clientX);
        },
        { signal },
      );
      for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
        divider.addEventListener(
          event,
          () => {
            if (this.resizing !== divider) return;
            this.resizing = null;
            layout.classList.remove("is-resizing");
          },
          { signal },
        );
      divider.addEventListener(
        "keydown",
        (event) => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          step(event.key === "ArrowLeft" ? -1 : 1);
        },
        { signal },
      );
    };
    editorDivider.setAttribute("aria-valuemin", "25");
    editorDivider.setAttribute("aria-valuemax", "75");
    setShare(this.share || 1);
    bindResize(
      editorDivider,
      (x) => {
        const editor = this.$(".puml-editor-pane").getBoundingClientRect();
        const preview = this.$(".puml-preview-pane").getBoundingClientRect();
        const available = preview.right - editor.left - editorDivider.offsetWidth;
        const fraction = Math.max(0.25, Math.min(0.75, (x - editor.left) / available));
        setShare(fraction / (1 - fraction));
      },
      (direction) => setShare((this.share || 1) + direction * 0.15),
    );
    explorerDivider.setAttribute("aria-valuemin", "140");
    explorerDivider.setAttribute("aria-valuemax", "400");
    explorerDivider.setAttribute("aria-valuenow", "190");
    bindResize(
      explorerDivider,
      (x) => setExplorerWidth(x - this.$("#puml-explorer").getBoundingClientRect().left),
      (direction) => setExplorerWidth(this.$("#puml-explorer").offsetWidth + direction * 16),
    );
  }

  onSoftDeactivate() {
    this.renderer?.pause();
    this.flushSave();
    this.dialogElement?.close();
  }
  applyEditorTheme() {
    const theme = document.documentElement.dataset.theme || "light";
    const selected =
      this.editorTheme === "auto" ? (ThemeManager.THEME_LABELS[theme]?.startsWith("[Dark]") ? "dark" : "light") : this.editorTheme;
    monaco.editor.setTheme(`plantuml-${selected}`);
  }
  onWarmResume() {
    this.editor?.layout();
    if (this.editor) this.applyEditorTheme();
    if (this.renderer && this.workspace) {
      if (this.renderer.ready) this.renderer.render(this.activeFile, this.workspace.nodes);
      else {
        this.renderer.latest = [this.activeFile, this.workspace.nodes];
        this.renderer.restart();
      }
    }
  }
  hasActiveBackgroundWork() {
    return Boolean(this.loading || this.dirty || this.saving || this.saveFailed);
  }
  onUnmount() {
    this.flushSave();
    this.sequence++;
    this.abort?.abort();
    this.renderer?.destroy();
    this.preview?.destroy();
    this.editor?.dispose();
    this.dialogElement?.remove();
    for (const model of this.models.values()) model.dispose();
    this.models.clear();
    this.views.clear();
    setCompletionWorkspace([]);
    void this.store?.close();
    this.editor = this.renderer = this.preview = this.workspace = this.currentFileId = null;
    this.saving = 0;
    this.pendingRouteFileId = null;
  }
}
