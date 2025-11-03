import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { HTMLTemplateToolTemplate } from "./template.js";
import MinifyWorker from "./minify.worker.js?worker";
import { extractVtlVariables, debounce, renderVtlTemplate } from "./service.js";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

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
    this.sandboxSameOriginAllowed = false; // default disabled for safer preview
    this.debouncedRender = null;
    // VTL values state and storage key
    this.vtlValues = {};
    this._vtlValuesStorageKey = "tool:html-template:vtl-values";
    this.baseUrls = [];
    this._envStorageKey = "tool:html-template:env";
    this._splitStorageKey = "tool:html-template:split-ratio";
    this._resizerCleanup = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return HTMLTemplateToolTemplate;
  }

  async onMount() {
    await this.initializeMonacoEditor();
    // Load any saved VTL values
    try {
      const savedVtl = localStorage.getItem(this._vtlValuesStorageKey);
      if (savedVtl) this.vtlValues = JSON.parse(savedVtl) || {};
    } catch (_) {
      this.vtlValues = {};
    }
    this.initializeWorker();
    this.bindToolEvents();
    // Setup ENV dropdown and baseUrl special handling
    this.setupEnvDropdown();
    this.setupDebouncedRendering();
    // Removed resizer for fixed split
    this.renderPreview(this.editor.getValue());
    try {
      UsageTracker.trackFeature("html-template", "mount", "", 5000);
    } catch (_) {}
  }

  onUnmount() {
    // Removed resizer cleanup for fixed split
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
      suggestOnTriggerCharacters: false,
    });

    // Load saved content from localStorage
    try {
      const key = "tool:html-template:editor";
      this._htmlStorageKey = key;
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        this.editor.setValue(saved);
      }
    } catch (_) {}
  }

  initializeWorker() {
    this.minifyWorker = new MinifyWorker();
    this.minifyWorker.onmessage = (e) => {
      const { success, result, error, engine } = e.data || {};
      const btn = document.getElementById("btnMinifyHtml");
      if (btn) btn.disabled = false;

      if (success && typeof result === "string") {
        this.editor.setValue(result);
        this.renderPreview(result);
      } else if (!success && error) {
        this.showError(`Minify error: ${error}`);
      }
    };
    // Probe worker for engine status on load
    this.minifyWorker.postMessage({ type: "probe" });
  }

  bindToolEvents() {
    const btnFormat = document.getElementById("btnFormatHtml");
    const btnMinify = document.getElementById("btnMinifyHtml");
    const btnExtract = document.getElementById("btnExtractVtl");
    const btnCopy = document.getElementById("btnCopyHtml");
    const btnPaste = document.getElementById("btnPasteHtml");
    const btnClear = document.getElementById("btnClearHtml");
    const btnReload = document.getElementById("btnReloadPreview");
    const btnCloseVtl = document.getElementById("btnCloseVtl");
    const btnResetVtl = document.getElementById("btnResetVtl");

    if (btnFormat) {
      btnFormat.addEventListener("click", async () => {
        const action = this.editor.getAction("editor.action.formatDocument");
        if (action) {
          await action.run();
          this.renderPreview(this.editor.getValue());
        }
      });
    }

    if (btnMinify) {
      btnMinify.addEventListener("click", async () => {
        const html = this.editor.getValue();
        btnMinify.disabled = true;
        this.minifyWorker.postMessage({ type: "minify", html });
      });
    }

    if (btnExtract) {
      btnExtract.addEventListener("click", () => {
        const html = this.editor.getValue();
        const allVars = extractVtlVariables(html);
        const vars = allVars.filter((v) => v !== "baseUrl");
        const modal = document.getElementById("vtlModal");
        const content = document.getElementById("vtlModalBody");
        if (content) {
          content.innerHTML = "";
          if (!vars.length) {
            content.textContent = "No VTL variables found.";
          } else {
            const info = document.createElement("div");
            info.className = "vtl-info";
            info.textContent = "Provide values for detected variables:";
            info.style.margin = "0 0 .5rem 0";
            info.style.fontSize = "13px";
            info.style.color = "#8aa";
            content.appendChild(info);

            vars.forEach((v) => {
              const row = document.createElement("div");
              row.className = "vtl-field-row";
              row.style.display = "grid";
              row.style.gridTemplateColumns = "160px 1fr";
              row.style.alignItems = "center";
              row.style.gap = ".5rem";
              row.style.margin = "0 0 .5rem 0";

              const label = document.createElement("label");
              label.setAttribute("for", `vtl_${v.replace(/\./g, "__")}`);
              label.textContent = v;
              label.style.fontWeight = "600";
              label.style.fontSize = "13px";

              const input = document.createElement("input");
              input.type = "text";
              input.id = `vtl_${v.replace(/\./g, "__")}`;
              input.className = "vtl-input";
              input.placeholder = "Enter value";
              input.value = this.vtlValues?.[v] ?? "";
              input.style.width = "100%";
              input.style.padding = ".375rem .5rem";
              input.style.border = "1px solid rgba(255,255,255,0.18)";
              input.style.borderRadius = "6px";
              input.style.fontSize = "13px";

              input.addEventListener("input", (e) => {
                this.vtlValues[v] = e.target.value;
                try {
                  localStorage.setItem(this._vtlValuesStorageKey, JSON.stringify(this.vtlValues));
                } catch (_) {}
                // Force re-render to apply latest substitutions
                this.renderPreview(this.editor.getValue(), true);
              });

              row.appendChild(label);
              row.appendChild(input);
              content.appendChild(row);
            });
          }
        }
        if (modal) modal.style.display = "block";
      });
    }

    if (btnCloseVtl) {
      btnCloseVtl.addEventListener("click", () => {
        const modal = document.getElementById("vtlModal");
        if (modal) modal.style.display = "none";
      });
    }

    if (btnResetVtl) {
      btnResetVtl.addEventListener("click", () => {
        const html = this.editor.getValue();
        const vars = extractVtlVariables(html).filter((v) => v !== "baseUrl");
        // Unset stored values so rendering falls back to variable names
        vars.forEach((v) => {
          try {
            delete this.vtlValues[v];
          } catch (_) {
            this.vtlValues[v] = null;
          }
        });
        const inputs = document.querySelectorAll("#vtlModalBody .vtl-input");
        inputs.forEach((input) => {
          input.value = "";
        });
        try {
          localStorage.setItem(this._vtlValuesStorageKey, JSON.stringify(this.vtlValues));
        } catch (_) {}
        // Re-render preview to show default variable tokens again
        this.renderPreview(this.editor.getValue(), true);
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(this.editor.getValue());
          this.showSuccess("HTML copied");
        } catch (e) {
          this.showError("Copy failed");
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
          this.showError("Paste failed");
        }
      });
    }

    if (btnClear) {
      btnClear.addEventListener("click", () => {
        this.editor.setValue("");
        try {
          localStorage.setItem(this._htmlStorageKey || "tool:html-template:editor", "");
        } catch (_) {}
        this.renderPreview("");
      });
    }

    if (btnReload) {
      btnReload.addEventListener("click", () => {
        this.renderPreview(this.editor.getValue(), true);
      });
    }

    // Render on content change with debounce and persist to localStorage
    this._persistTimer = this._persistTimer || null;
    this.editor.onDidChangeModelContent(() => {
      const value = this.editor.getValue();
      this.debouncedRender?.(value);
      clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => {
        try {
          localStorage.setItem(this._htmlStorageKey || "tool:html-template:editor", value);
        } catch (_) {}
      }, 300);
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

    // Apply VTL substitutions before rendering
    const rendered = renderVtlTemplate(html, this.vtlValues);

    // Use srcdoc for atomic update and secure context
    iframe.srcdoc = rendered || "";
  }

  setupEnvDropdown() {
    const select = document.getElementById("envSelector");
    const controls = document.getElementById("envControls");
    if (!select) return;

    // Load config.baseUrls from localStorage (kvlist of { key, value })
    let pairs = [];
    try {
      const raw = localStorage.getItem("config.baseUrls");
      const parsed = raw ? JSON.parse(raw) : [];
      pairs = Array.isArray(parsed) ? parsed.filter((p) => p && p.key && p.value) : [];
    } catch (_) {
      pairs = [];
    }
    this.baseUrls = pairs;

    // Hide controls if no environments configured
    if (!this.baseUrls.length) {
      if (controls) controls.style.display = "none";
      return;
    } else {
      if (controls) controls.style.display = "inline-flex";
    }

    // Populate options
    select.innerHTML = "";
    this.baseUrls.forEach(({ key }) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key;
      select.appendChild(opt);
    });

    // Restore last selection or default to first
    let selectedKey = null;
    try {
      const savedEnv = localStorage.getItem(this._envStorageKey);
      const keys = new Set(this.baseUrls.map((p) => p.key));
      selectedKey = savedEnv && keys.has(savedEnv) ? savedEnv : this.baseUrls[0]?.key || null;
    } catch (_) {
      selectedKey = this.baseUrls[0]?.key || null;
    }
    if (selectedKey) {
      select.value = selectedKey;
      this.updateVtlBaseUrlFromEnv(selectedKey);
    }

    // Bind change
    select.addEventListener("change", (e) => {
      const envKey = e.target.value;
      this.updateVtlBaseUrlFromEnv(envKey);
    });
  }

  updateVtlBaseUrlFromEnv(envKey) {
    const pair = this.baseUrls.find((p) => p.key === envKey);
    const url = pair?.value || "";

    // Update VTL special variable and persist
    this.vtlValues = { ...this.vtlValues, baseUrl: url };
    try {
      localStorage.setItem(this._vtlValuesStorageKey, JSON.stringify(this.vtlValues));
      localStorage.setItem(this._envStorageKey, envKey || "");
    } catch (_) {}

    // Reflect in VTL panel input if present
    const baseUrlInput = document.getElementById("vtl_baseUrl");
    if (baseUrlInput) baseUrlInput.value = url;

    // Re-render preview with updated substitution
    this.renderPreview(this.editor.getValue(), true);
  }

  initializeResizer() {
    const layout = document.querySelector(".html-template-layout");
    const resizer = document.getElementById("splitResizer");
    if (!layout || !resizer) return;

    const RESIZER_W = 6;
    const MIN_LEFT = 240;
    const MIN_RIGHT = 240;
    let dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = layout.getBoundingClientRect();
      const total = rect.width - RESIZER_W;
      let left = clientX - rect.left;
      left = Math.max(MIN_LEFT, Math.min(left, total - MIN_RIGHT));
      layout.style.gridTemplateColumns = `${left}px ${RESIZER_W}px ${total - left}px`;
      e.preventDefault();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };

    const onDown = (e) => {
      if (window.innerWidth <= 900) return; // disabled on mobile layout
      dragging = true;
      document.body.classList.add("is-resizing");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
      e.preventDefault();
    };

    resizer.addEventListener("mousedown", onDown);
    resizer.addEventListener("touchstart", onDown, { passive: false });

    this._resizerCleanup = () => {
      resizer.removeEventListener("mousedown", onDown);
      resizer.removeEventListener("touchstart", onDown);
      onUp();
    };
  }

  cleanupResizer() {
    if (this._resizerCleanup) {
      try {
        this._resizerCleanup();
      } catch (_) {}
      this._resizerCleanup = null;
    }
  }
}

export { HTMLTemplateTool };
