import React, { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTool } from "@/hooks/useTool.jsx";
import { useMonaco } from "@/hooks/useMonaco.jsx";
import { extractVtlVariables, renderVtlTemplate } from "./service.js";
import MinifyWorker from "./minify.worker.js?worker";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

// VTL Modal Component
function VtlModal({ isOpen, onClose, variables, values, onValueChange, onReset }) {
  if (!isOpen) return null;

  return (
    <div className="vtl-modal" role="dialog" aria-modal="false" aria-label="VTL Variables">
      <div className="vtl-modal-header">
        <h4 className="vtl-modal-title">VTL Variables</h4>
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
          <Button size="sm" variant="outline" onClick={onReset} title="Reset All">
            Reset
          </Button>
          <Button size="sm" variant="outline" onClick={onClose} title="Close VTL">
            Close
          </Button>
        </div>
      </div>
      <div className="vtl-modal-body">
        {variables.length === 0 ? (
          <div>No VTL variables found.</div>
        ) : (
          <>
            <div
              className="vtl-info"
              style={{ margin: "0 0 .5rem 0", fontSize: "13px", color: "#8aa" }}
            >
              Provide values for detected variables:
            </div>
            {variables.map((varName) => (
              <div
                key={varName}
                className="vtl-field-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1fr",
                  alignItems: "center",
                  gap: ".5rem",
                  margin: "0 0 .5rem 0",
                }}
              >
                <label
                  htmlFor={`vtl_${varName.replace(/\./g, "__")}`}
                  style={{ fontWeight: "600", fontSize: "13px" }}
                >
                  {varName}
                </label>
                <Input
                  id={`vtl_${varName.replace(/\./g, "__")}`}
                  type="text"
                  placeholder="Enter value"
                  value={values[varName] || ""}
                  onChange={(e) => onValueChange(varName, e.target.value)}
                  className="vtl-input"
                />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default function HTMLEditor() {
  const { copyToClipboard, showSuccess, showError } = useTool("html-editor");
  const [vtlValues, setVtlValues] = useState({});
  const [vtlModalOpen, setVtlModalOpen] = useState(false);
  const [vtlVariables, setVtlVariables] = useState([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [environments, setEnvironments] = useState([]);
  const [selectedEnv, setSelectedEnv] = useState("");
  const minifyWorkerRef = useRef(null);
  const iframeRef = useRef(null);

  const VTL_VALUES_KEY = "tool:html-template:vtl-values";
  const ENV_KEY = "tool:html-template:env";

  // Track page mount
  useEffect(() => {
    try {
      UsageTracker.trackFeature("html-template", "mount", "", 5000);
    } catch (_) {}
  }, []);

  // Load VTL values from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VTL_VALUES_KEY);
      if (saved) {
        setVtlValues(JSON.parse(saved) || {});
      }
    } catch (_) {}
  }, []);

  // Load environments from config.baseUrls
  useEffect(() => {
    try {
      const raw = localStorage.getItem("config.baseUrls");
      const parsed = raw ? JSON.parse(raw) : [];
      const pairs = Array.isArray(parsed) ? parsed.filter((p) => p && p.key && p.value) : [];
      setEnvironments(pairs);

      // Restore selected environment
      if (pairs.length > 0) {
        const savedEnv = localStorage.getItem(ENV_KEY);
        const keys = new Set(pairs.map((p) => p.key));
        const env = savedEnv && keys.has(savedEnv) ? savedEnv : pairs[0]?.key || "";
        setSelectedEnv(env);

        // Set baseUrl in VTL values
        const pair = pairs.find((p) => p.key === env);
        if (pair) {
          setVtlValues((prev) => ({ ...prev, baseUrl: pair.value }));
        }
      }
    } catch (_) {}
  }, []);

  // Setup Monaco editor with HTML language and multiple workers
  const defaultHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 1rem; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>Hello, \${username}!</h1>
  <script>
    console.log('Inline script running');
  </script>
</body>
</html>`;

  const monaco = useMonaco({
    containerId: "htmlEditor",
    language: "html",
    theme: "vs-dark",
    value: defaultHtml,
    storageKey: "tool:html-template:editor",
    onChange: (value) => {
      updatePreview(value);
    },
  });

  // Initialize minify worker
  useEffect(() => {
    minifyWorkerRef.current = new MinifyWorker();
    minifyWorkerRef.current.onmessage = (e) => {
      const { success, result, error } = e.data || {};
      if (success && typeof result === "string") {
        monaco.setValue(result);
        updatePreview(result);
        showSuccess("HTML minified");
      } else if (!success && error) {
        showError(`Minify error: ${error}`);
      }
    };

    return () => {
      if (minifyWorkerRef.current) {
        minifyWorkerRef.current.terminate();
      }
    };
  }, [monaco.isReady]);

  // Update preview with VTL substitution
  const updatePreview = (html) => {
    const rendered = renderVtlTemplate(html, vtlValues);
    setPreviewHtml(rendered);
  };

  // Re-render preview when VTL values change
  useEffect(() => {
    if (monaco.isReady) {
      updatePreview(monaco.getValue());
    }
  }, [vtlValues, monaco.isReady]);

  // Update preview iframe
  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = previewHtml;
    }
  }, [previewHtml]);

  const handleFormat = async () => {
    const editor = monaco.getEditor();
    if (editor) {
      const action = editor.getAction("editor.action.formatDocument");
      if (action) {
        await action.run();
        updatePreview(monaco.getValue());
        showSuccess("HTML formatted");
      }
    }
  };

  const handleMinify = () => {
    const html = monaco.getValue();
    if (minifyWorkerRef.current) {
      minifyWorkerRef.current.postMessage({ type: "minify", html });
    }
  };

  const handleExtractVtl = () => {
    const html = monaco.getValue();
    const allVars = extractVtlVariables(html);
    const vars = allVars.filter((v) => v !== "baseUrl");
    setVtlVariables(vars);
    setVtlModalOpen(true);
  };

  const handleVtlValueChange = (varName, value) => {
    const newValues = { ...vtlValues, [varName]: value };
    setVtlValues(newValues);
    try {
      localStorage.setItem(VTL_VALUES_KEY, JSON.stringify(newValues));
    } catch (_) {}
  };

  const handleVtlReset = () => {
    const html = monaco.getValue();
    const vars = extractVtlVariables(html).filter((v) => v !== "baseUrl");
    const newValues = { ...vtlValues };
    vars.forEach((v) => {
      delete newValues[v];
    });
    setVtlValues(newValues);
    try {
      localStorage.setItem(VTL_VALUES_KEY, JSON.stringify(newValues));
    } catch (_) {}
  };

  const handleCopy = async () => {
    const html = monaco.getValue();
    await copyToClipboard(html);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        monaco.setValue(text);
        showSuccess("Pasted from clipboard");
      }
    } catch (err) {
      showError("Failed to paste");
    }
  };

  const handleClear = () => {
    monaco.setValue("");
    updatePreview("");
    showSuccess("Cleared");
  };

  const handleReload = () => {
    updatePreview(monaco.getValue());
    showSuccess("Preview reloaded");
  };

  const handleEnvChange = (envKey) => {
    setSelectedEnv(envKey);
    const pair = environments.find((p) => p.key === envKey);
    if (pair) {
      const newValues = { ...vtlValues, baseUrl: pair.value };
      setVtlValues(newValues);
      try {
        localStorage.setItem(VTL_VALUES_KEY, JSON.stringify(newValues));
        localStorage.setItem(ENV_KEY, envKey);
      } catch (_) {}
    }
  };

  return (
    <div className="tool-container html-template">
      <div className="html-template-layout">
        {/* Editor Pane */}
        <div className="pane editor-pane">
          <div className="pane-header">
            <h3>Editor</h3>
            <div className="toolbar-left">
              <Button size="sm" onClick={handleFormat} title="Format HTML">
                Format
              </Button>
              <Button size="sm" onClick={handleMinify} title="Minify HTML">
                Minify
              </Button>
              <Button size="sm" variant="secondary" onClick={handleExtractVtl} title="Extract VTL Fields">
                Extract VTL Fields
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopy} title="Copy HTML">
                Copy
              </Button>
              <Button size="sm" variant="outline" onClick={handlePaste} title="Paste HTML">
                Paste
              </Button>
              <Button size="sm" variant="outline" onClick={handleClear} title="Clear HTML">
                Clear
              </Button>
            </div>
          </div>
          <div
            id="htmlEditor"
            className="monaco-editor-container"
            style={{ minHeight: "300px" }}
          ></div>

          {/* VTL Modal */}
          <VtlModal
            isOpen={vtlModalOpen}
            onClose={() => setVtlModalOpen(false)}
            variables={vtlVariables}
            values={vtlValues}
            onValueChange={handleVtlValueChange}
            onReset={handleVtlReset}
          />
        </div>

        {/* Preview Pane */}
        <div className="pane renderer-pane">
          <div className="pane-header">
            <h3>Preview</h3>
            <div className="renderer-actions">
              {environments.length > 0 && (
                <div className="env-controls" style={{ display: "inline-flex", gap: ".5rem", alignItems: "center", marginRight: ".5rem" }}>
                  <label htmlFor="envSelector" className="env-label" style={{ fontSize: "13px" }}>
                    ENV:
                  </label>
                  <select
                    id="envSelector"
                    className="env-select"
                    value={selectedEnv}
                    onChange={(e) => handleEnvChange(e.target.value)}
                    style={{
                      padding: ".25rem .5rem",
                      borderRadius: "6px",
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--background))",
                      fontSize: "13px",
                    }}
                    title="Select environment"
                  >
                    {environments.map(({ key }) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button size="sm" variant="outline" onClick={handleReload} title="Reload Preview">
                Reload
              </Button>
            </div>
          </div>
          <iframe
            ref={iframeRef}
            id="htmlRenderer"
            className="renderer-iframe"
            sandbox="allow-scripts allow-forms allow-same-origin"
            title="HTML Preview"
          ></iframe>
        </div>
      </div>
    </div>
  );
}
