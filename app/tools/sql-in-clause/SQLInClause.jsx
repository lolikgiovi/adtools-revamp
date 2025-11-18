import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTool } from "@/hooks/useTool.jsx";
import { useMonaco } from "@/hooks/useMonaco.jsx";
import { SQLInClauseService } from "./service.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

export default function SQLInClause() {
  const { copyToClipboard, showSuccess, showError } = useTool("sql-in-clause");
  const [format, setFormat] = useState("single");
  const [table, setTable] = useState("");
  const [column, setColumn] = useState("");
  const [output, setOutput] = useState("");

  // Track page mount
  useEffect(() => {
    try {
      UsageTracker.trackFeature("sql-in-clause", "mount", "", 5000);
    } catch (_) {}
  }, []);

  // Update output whenever input or settings change
  const updateOutput = (inputValue) => {
    const result = SQLInClauseService.format(inputValue, format, { table, column });
    setOutput(result);
  };

  // Setup Monaco editor
  const { getValue, setValue, isReady } = useMonaco({
    containerId: "sqlInEditor",
    language: "plaintext",
    theme: "vs-dark",
    value: "",
    storageKey: "tool:sql-in-clause:editor",
    onChange: updateOutput,
  });

  // Update output when format or table/column changes
  useEffect(() => {
    if (isReady) {
      updateOutput(getValue());
    }
  }, [format, table, column, isReady]);

  const handleCopy = async () => {
    if (output) {
      await copyToClipboard(output);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (typeof text === "string" && text.length > 0) {
        setValue(text);
        showSuccess("Pasted from clipboard");
        try {
          UsageTracker.trackFeature("sql-in-clause", "paste", { len: text.length }, 1000);
        } catch (_) {}
      } else {
        showError("Clipboard is empty");
      }
    } catch (err) {
      showError("Failed to paste from clipboard");
      console.error("Paste error:", err);
    }
  };

  const handleClear = () => {
    try {
      setValue("");
      showSuccess("Cleared editor");
      try {
        UsageTracker.trackFeature("sql-in-clause", "clear", "", 1000);
      } catch (_) {}
    } catch (err) {
      showError("Failed to clear editor");
      console.error("Clear error:", err);
    }
  };

  return (
    <div className="tool-container sql-in-clause p-6">
      <div className="sql-in-layout grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Input Pane */}
        <Card className="editor-pane">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Input</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter items, one per line
                </p>
              </div>
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
              id="sqlInEditor"
              className="monaco-editor-container"
              style={{ height: "400px", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
            ></div>
          </CardContent>
        </Card>

        {/* Output Pane */}
        <Card className="output-pane">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Output</CardTitle>
              <div className="flex items-center gap-2">
                <Label htmlFor="format-select" className="text-sm">
                  Format:
                </Label>
                <select
                  id="format-select"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="single">Single-line</option>
                  <option value="multi">Multi-line</option>
                  <option value="select">SELECT query</option>
                </select>
                <Button size="sm" onClick={handleCopy} disabled={!output}>
                  Copy
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {format === "select" && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="text"
                  placeholder="Table name"
                  value={table}
                  onChange={(e) => setTable(e.target.value)}
                />
                <Input
                  type="text"
                  placeholder="Column name"
                  value={column}
                  onChange={(e) => setColumn(e.target.value)}
                />
              </div>
            )}
            <Textarea
              value={output}
              readOnly
              className="font-mono text-sm"
              rows={format === "select" ? 10 : 12}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
