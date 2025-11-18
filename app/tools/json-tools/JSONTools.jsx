import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useTool } from "@/hooks/useTool.jsx";
import { useMonaco } from "@/hooks/useMonaco.jsx";
import { JSONToolsService } from "./service.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

const TABS = [
  { id: "validator", label: "Validator" },
  { id: "prettify", label: "Prettify" },
  { id: "minify", label: "Minify" },
  { id: "stringify", label: "Stringify" },
  { id: "unstringify", label: "Unstringify" },
  { id: "escape", label: "Escape" },
  { id: "unescape", label: "Unescape" },
  { id: "extract-keys", label: "Extract Keys" },
];

export default function JSONTools() {
  const { copyToClipboard, showSuccess, showError } = useTool("json-tools");
  const [activeTab, setActiveTab] = useState("validator");
  const [outputValue, setOutputValue] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);
  const [includePaths, setIncludePaths] = useState(false);

  // Input Monaco Editor
  const inputMonaco = useMonaco({
    containerId: "json-editor",
    language: "json",
    theme: "vs-dark",
    value: "",
    storageKey: "tool:json-tools:editor",
    onChange: () => processCurrentTab(),
  });

  // Output Monaco Editor (editable)
  const outputMonaco = useMonaco({
    containerId: "json-output",
    language: "json",
    theme: "vs-dark",
    value: outputValue,
  });

  // Update output editor when outputValue changes
  useEffect(() => {
    if (outputMonaco.isReady && outputMonaco.getValue() !== outputValue) {
      outputMonaco.setValue(outputValue);
    }
  }, [outputValue, outputMonaco.isReady]);

  // Process current tab when active tab or input changes
  const processCurrentTab = () => {
    const content = inputMonaco.getValue();
    if (!content.trim()) {
      setOutputValue("");
      setErrorMessage(null);
      return;
    }

    let result;
    switch (activeTab) {
      case "validator":
        result = JSONToolsService.validate(content);
        break;
      case "prettify":
        result = JSONToolsService.prettify(content);
        break;
      case "minify":
        result = JSONToolsService.minify(content);
        break;
      case "stringify":
        result = JSONToolsService.stringify(content);
        break;
      case "unstringify":
        result = JSONToolsService.unstringify(content);
        break;
      case "escape":
        result = JSONToolsService.escape(content);
        break;
      case "unescape":
        result = JSONToolsService.unescape(content);
        break;
      case "extract-keys":
        result = JSONToolsService.extractKeys(content, includePaths);
        break;
      default:
        result = { result: null, error: null };
    }

    if (result.error) {
      setErrorMessage(result.error.message);
      setOutputValue("");
    } else {
      setErrorMessage(null);
      setOutputValue(result.result || "");
    }

    // Track usage
    try {
      UsageTracker.trackFeature("json-tools", activeTab);
    } catch (_) {}
  };

  // Re-process when active tab changes
  useEffect(() => {
    if (inputMonaco.isReady) {
      processCurrentTab();
    }
  }, [activeTab, includePaths, inputMonaco.isReady]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        inputMonaco.setValue(text);
        showSuccess("Pasted from clipboard");
      }
    } catch (err) {
      showError("Failed to paste");
    }
  };

  const handleClear = () => {
    inputMonaco.setValue("");
    showSuccess("Cleared");
  };

  const handleCopyOutput = async () => {
    const output = outputMonaco.getValue();
    if (output) {
      await copyToClipboard(output);
    }
  };

  return (
    <div className="tool-container json-tools p-6">
      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="json-layout grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Input Pane */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Input</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handlePaste}>
                  Paste
                </Button>
                <Button size="sm" variant="outline" onClick={handleClear}>
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              id="json-editor"
              className="monaco-editor-container"
              style={{ height: "500px", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
            ></div>
          </CardContent>
        </Card>

        {/* Output Pane */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Output</CardTitle>
              <div className="flex gap-2 items-center">
                {activeTab === "extract-keys" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includePaths}
                      onChange={(e) => setIncludePaths(e.target.checked)}
                    />
                    Include paths
                  </label>
                )}
                <Button size="sm" onClick={handleCopyOutput} disabled={!outputValue}>
                  Copy
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {errorMessage && (
              <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <strong>Error:</strong> {errorMessage}
              </div>
            )}
            <div
              id="json-output"
              className="monaco-editor-container"
              style={{ height: "500px", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
            ></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
