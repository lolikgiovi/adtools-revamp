import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { HTMLTemplateToolTemplate } from "./template.js";
import MinifyWorker from "./minify.worker.js?worker";
import { extractVtlVariables, debounce } from "./service.js";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";

class HTMLTemplateTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "html-template",
      name: "HTML Template",
      description: "Edit and preview HTML templates with live rendering",
      icon: "html",
      category: "config",
      eventBus,
    });

    this.editor = null;
    this.minifyWorker = null;
    this.lastRenderedHTML = "";
    this.sandboxSameOriginAllowed = false;
    this.debouncedRender = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return HTMLTemplateToolTemplate;
  }

  async onMount() {
    await this.initializeMonacoEditor();
    this.initializeWorker();
    this.bindToolEvents();
    this.setupDebouncedRendering();
    this.renderPreview(this.editor.getValue());
  }

  onUnmount() {
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    if (this.minifyWorker) {
      this.minifyWorker.terminate();
      this.minifyWorker = null;
    }
  }

  async initializeMonacoEditor() {
    // Configure Monaco workers for Vite ESM builds
    self.MonacoEnvironment = {
      getWorker(_, label) {
        switch (label) {
          case "css":
            return new cssWorker();
          case "html":
            return new htmlWorker();
          case "typescript":
          case "javascript":
            return new tsWorker();
          default:
            return new editorWorker();
        }
      },
    };

    const container = document.getElementById("htmlEditor");
    this.editor = monaco.editor.create(container, {
      value: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Preview</title>\n  <style>\n    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 1rem; }\n    h1 { color: #333; }\n  </style>\n</head>\n<body>\n  <h1>Hello, $user.name!</h1>\n  <script>\n    console.log('Inline script running');\n  </script>\n</body>\n</html>`,
      language: "html",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      insertSpaces: true,
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true,
    });
  }

  initializeWorker() {
    this.minifyWorker = new MinifyWorker();
    this.minifyWorker.onmessage = (e) => {
      const { success, result, error } = e.data || {};
      const btn = document.getElementById("btnMinifyHtml");
      if (btn) btn.disabled = false;
      if (success) {
        this.editor.setValue(result || "");
        this.renderPreview(result || "");
        UsageTracker.trackFeature("html-template", "minify", { bytes: (result || "").length });
      } else {
        this.showNotification(`Minify error: ${error}`, "error");
      }
    };
  }

  bindToolEvents() {
    const btnFormat = document.getElementById("btnFormatHtml");
    const btnMinify = document.getElementById("btnMinifyHtml");
    const btnExtract = document.getElementById("btnExtractVtl");
    const btnCopy = document.getElementById("btnCopyHtml");
    const btnPaste = document.getElementById("btnPasteHtml");
    const btnClear = document.getElementById("btnClearHtml");
    const btnReload = document.getElementById("btnReloadPreview");
    const toggleSameOrigin = document.getElementById("toggleSandboxSameOrigin");
    const btnCloseVtl = document.getElementById("btnCloseVtl");

    if (btnFormat) {
      btnFormat.addEventListener("click", async () => {
        const action = this.editor.getAction("editor.action.formatDocument");
        if (action) {
          await action.run();
          this.renderPreview(this.editor.getValue());
          UsageTracker.trackFeature("html-template", "format");
        }
      });
    }

    if (btnMinify) {
      btnMinify.addEventListener("click", async () => {
        const html = this.editor.getValue();
        btnMinify.disabled = true;
        this.minifyWorker.postMessage({ html });
      });
    }

    if (btnExtract) {
      btnExtract.addEventListener("click", () => {
        const html = this.editor.getValue();
        const vars = extractVtlVariables(html);
        const panel = document.getElementById("vtlPanel");
        const content = document.getElementById("vtlContent");
        if (content) {
          content.textContent = vars.length ? vars.join("\n") : "No VTL variables found.";
        }
        if (panel) panel.style.display = "block";
        UsageTracker.trackFeature("html-template", "vtl-extract", { count: vars.length });
      });
    }

    if (btnCloseVtl) {
      btnCloseVtl.addEventListener("click", () => {
        const panel = document.getElementById("vtlPanel");
        if (panel) panel.style.display = "none";
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(this.editor.getValue());
          this.showNotification("HTML copied", "success");
        } catch (e) {
          this.showNotification("Copy failed", "error");
        }
      });
    }

    if (btnPaste) {
      btnPaste.addEventListener("click", async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            const model = this.editor.getModel();
            if (model) {
              const fullRange = model.getFullModelRange();
              this.editor.executeEdits("paste", [{ range: fullRange, text }]);
            } else {
              this.editor.setValue(text);
            }
            this.renderPreview(this.editor.getValue());
          }
        } catch (e) {
          this.showNotification("Paste failed", "error");
        }
      });
    }

    if (btnClear) {
      btnClear.addEventListener("click", () => {
        this.editor.setValue("");
        this.renderPreview("");
      });
    }

    if (btnReload) {
      btnReload.addEventListener("click", () => {
        this.renderPreview(this.editor.getValue(), true);
      });
    }

    if (toggleSameOrigin) {
      toggleSameOrigin.addEventListener("change", (e) => {
        this.sandboxSameOriginAllowed = !!e.target.checked;
        this.applyIframeSandbox();
        // Re-render to apply new sandbox immediately
        this.renderPreview(this.editor.getValue(), true);
      });
    }

    // Render on content change with debounce
    this.editor.onDidChangeModelContent(() => {
      this.debouncedRender?.(this.editor.getValue());
    });
  }

  setupDebouncedRendering() {
    this.debouncedRender = debounce((html) => {
      if (html !== this.lastRenderedHTML) {
        this.renderPreview(html);
      }
    }, 300);
  }

  applyIframeSandbox() {
    const iframe = document.getElementById("htmlRenderer");
    if (!iframe) return;
    const base = ["allow-scripts", "allow-forms"]; // keep safe
    if (this.sandboxSameOriginAllowed) base.push("allow-same-origin");
    iframe.setAttribute("sandbox", base.join(" "));
  }

  renderPreview(html, force = false) {
    const iframe = document.getElementById("htmlRenderer");
    if (!iframe) return;

    if (!force && html === this.lastRenderedHTML) return;
    this.lastRenderedHTML = html;

    // Ensure sandbox set
    this.applyIframeSandbox();

    // Use srcdoc for atomic update and secure context
    iframe.srcdoc = html || "";
  }

  showNotification(message, type = "info", durationMs = 1200) {
    // Reuse app-level notification if available
    if (typeof window.__showNotification === "function") {
      window.__showNotification(message, type, durationMs);
      return;
    }
    // Fallback: basic toast
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.position = "fixed";
    toast.style.bottom = "1rem";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%)";
    toast.style.background = "hsl(var(--card))";
    toast.style.border = "1px solid hsl(var(--border))";
    toast.style.padding = "0.5rem 0.75rem";
    toast.style.borderRadius = "8px";
    toast.style.zIndex = 9999;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
  }
}

export { HTMLTemplateTool };