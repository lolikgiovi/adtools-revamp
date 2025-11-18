import React, { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import * as monaco from "monaco-editor";
import { useTool } from "@/hooks/useTool.jsx";
import { useMonaco } from "@/hooks/useMonaco.jsx";
import {
  formatVtlTemplate,
  minifyVtlTemplate,
  extractFieldsFromTemplate,
  splitByPipesSafely,
} from "./service.js";
import Handsontable from "handsontable";
import "handsontable/dist/handsontable.full.css";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

// Register VTL-Splunk language for Monaco
const registerVtlLanguage = () => {
  if (!monaco.languages.getLanguages().find((lang) => lang.id === "vtl-splunk")) {
    monaco.languages.register({ id: "vtl-splunk" });
    monaco.languages.setLanguageConfiguration("vtl-splunk", {
      comments: { lineComment: "##", blockComment: ["#*", "*#"] },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"', notIn: ["string", "comment"] },
        { open: "'", close: "'", notIn: ["string", "comment"] },
      ],
    });

    monaco.languages.setMonarchTokensProvider("vtl-splunk", {
      defaultToken: "",
      tokenPostfix: ".vtl",
      keywords: ["if", "elseif", "else", "end", "set", "foreach", "macro", "parse", "include", "define", "stop"],
      tokenizer: {
        root: [
          [/##.*$/, "comment"],
          [/\#\*[\s\S]*?\*\#/, "comment"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],
          [/\#(if|elseif|else|end|set|foreach|macro|parse|include|define|stop)\b/, "keyword"],
          [/\$!?\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\}/, "variable"],
          [/\$!?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/, "variable"],
          [/\|/, "delimiter"],
          [/=/, "operator"],
          [/\b\d+(?:\.\d+)?\b/, "number"],
        ],
      },
    });
  }
};

export default function SplunkTemplate() {
  const { showSuccess, showError } = useTool("splunk-template");
  const [fieldsData, setFieldsData] = useState([]);
  const tableRef = useRef(null);
  const tableContainerRef = useRef(null);
  const suppressTableEditRef = useRef(false);
  const trailingPipeRef = useRef(false);

  const STORAGE_KEY = "tool:splunk-template:editor";

  // Track page mount
  useEffect(() => {
    try {
      UsageTracker.trackFeature("splunk-template", "mount", "", 5000);
    } catch (_) {}
  }, []);

  // Register VTL language
  useEffect(() => {
    registerVtlLanguage();
  }, []);

  // Default template
  const defaultTemplate =
    "[$context.event.toUpperCase()] logdate=$!context.captureDate - IPAddress=$!context.clientIp|channelCode=$!context.channelId|channelName=$!context.channelId|cifNo=$!context.cif|deviceId=$!context.deviceId|emailAddress=$!context.email|eventType=$!context.event.toUpperCase()|isSuccess=false|mobilePhone=$!context.mobileNumber|statusCode=$!context.statusCode|statusName=$!context.status|transactionDate=$!context.captureDate|userActivationDate=$!context.registeredDate|userAgent=$!context.osVersion|userID=$!context.userId|sessionId=$!context.authorization|appsVersion=$!context.clientVersion";

  // Setup Monaco editor
  const editorHook = useMonaco({
    containerId: "vtlEditor",
    language: "vtl-splunk",
    theme: "vs-dark",
    value: defaultTemplate,
    storageKey: STORAGE_KEY,
    onChange: (value) => {
      updateFieldsTable(value);
    },
    options: {
      fontSize: 11,
    },
  });

  // Initialize Handsontable
  useEffect(() => {
    if (!tableContainerRef.current || tableRef.current) return;

    tableRef.current = new Handsontable(tableContainerRef.current, {
      data: [],
      columns: [
        { data: "field", type: "text", className: "v-align-middle" },
        {
          data: "source",
          type: "dropdown",
          source: ["context", "variable", "hardcoded"],
          allowInvalid: false,
          className: "v-align-middle",
        },
        { data: "value", type: "text", className: "v-align-middle" },
        { data: "functions", type: "text", className: "v-align-middle", readOnly: true },
      ],
      colHeaders: ["Field", "Source", "Value", "VTL Functions"],
      rowHeaders: true,
      stretchH: "all",
      licenseKey: "non-commercial-and-evaluation",
      width: "100%",
      height: "100%",
      manualColumnResize: true,
      fixedColumnsLeft: 1,
      className: "ht-theme-light",
      columnSorting: true,
      minSpareRows: 0,
      afterChange: (changes, src) => {
        if (suppressTableEditRef.current) return;
        if (!changes || src === "loadData") return;
        onTableChanged();
      },
      afterCreateRow: () => {
        if (suppressTableEditRef.current) return;
        onTableChanged();
      },
      afterRemoveRow: () => {
        if (suppressTableEditRef.current) return;
        onTableChanged();
      },
    });

    return () => {
      if (tableRef.current) {
        tableRef.current.destroy();
        tableRef.current = null;
      }
    };
  }, []);

  // Update fields table from editor content
  const updateFieldsTable = (content) => {
    if (!tableRef.current) return;

    const { trailingPipe } = splitByPipesSafely(content);
    trailingPipeRef.current = trailingPipe;

    const rows = extractFieldsFromTemplate(content);
    suppressTableEditRef.current = true;
    tableRef.current.loadData(rows);
    setTimeout(() => {
      suppressTableEditRef.current = false;
    }, 10);
  };

  // Build value expression from a row
  const rowToExpr = (row) => {
    const src = (row.source || "").toLowerCase();
    const val = (row.value ?? "").trim();
    if (!val) return "";
    if (src === "context") return `$!{context.${val}}`;
    if (src === "variable") return `$!{${val}}`;
    return val; // hardcoded literal
  };

  // Apply table rows back to template
  const applyTableToTemplate = (template, rows) => {
    const { segments } = splitByPipesSafely(String(template));
    const rowMap = new Map();
    rows.forEach((r) => {
      const f = (r.field ?? "").trim();
      if (!f) return;
      const expr = rowToExpr(r);
      if (!expr) return;
      rowMap.set(f, expr);
    });

    const updated = [];
    const seen = new Set();
    for (const raw of segments) {
      const m = String(raw).match(/^(\s*[^=|]+?)(\s*=\s*)([\s\S]*?)$/);
      if (!m) {
        updated.push(String(raw));
        continue;
      }
      const leftWithLead = m[1];
      const eqSpacing = m[2];
      const valuePart = m[3];
      const field = leftWithLead.trim();

      if (rowMap.has(field)) {
        const newExpr = rowMap.get(field);
        const valLeadMatch = valuePart.match(/^\s*/);
        const valTrailMatch = valuePart.match(/\s*$/);
        const valLead = valLeadMatch ? valLeadMatch[0] : "";
        const valTrail = valTrailMatch ? valTrailMatch[0] : "";
        updated.push(`${leftWithLead}${eqSpacing}${valLead}${newExpr}${valTrail}`);
        seen.add(field);
      } else {
        updated.push(String(raw));
      }
    }

    // Append new fields
    for (const [field, expr] of rowMap.entries()) {
      if (!seen.has(field)) {
        updated.push(`${field}=${expr}`);
      }
    }

    let out = updated.join("|");
    if (trailingPipeRef.current) out += "|";
    return out;
  };

  // Handle table changes
  const onTableChanged = () => {
    if (!tableRef.current || !editorHook.isReady) return;
    const rows = tableRef.current.getSourceData();
    const filtered = rows.filter((r) => (r.field ?? "").trim().length > 0);
    const current = editorHook.getValue();
    const next = applyTableToTemplate(current, filtered);
    editorHook.setValue(next);
  };

  const handleFormat = () => {
    const src = editorHook.getValue();
    const formatted = formatVtlTemplate(src);
    editorHook.setValue(formatted);
    updateFieldsTable(formatted);
    showSuccess("Template formatted");
  };

  const handleMinify = () => {
    const src = editorHook.getValue();
    const minified = minifyVtlTemplate(src);
    editorHook.setValue(minified);
    updateFieldsTable(minified);
    showSuccess("Template minified");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editorHook.getValue());
      showSuccess("Copied to clipboard");
    } catch (_) {
      showError("Failed to copy");
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        editorHook.setValue(text);
        updateFieldsTable(text);
        showSuccess("Pasted from clipboard");
      }
    } catch (_) {
      showError("Failed to paste");
    }
  };

  const handleClear = () => {
    editorHook.setValue("");
    updateFieldsTable("");
    try {
      localStorage.setItem(STORAGE_KEY, "");
    } catch (_) {}
    showSuccess("Cleared");
  };

  const handleAddField = () => {
    if (!tableRef.current) return;
    suppressTableEditRef.current = true;
    try {
      const idx = tableRef.current.countRows();
      tableRef.current.alter("insert_row", idx, 1);
      tableRef.current.setDataAtRowProp(idx, "field", "");
      tableRef.current.setDataAtRowProp(idx, "source", "hardcoded");
      tableRef.current.setDataAtRowProp(idx, "value", "");
      tableRef.current.setDataAtRowProp(idx, "functions", "");
      tableRef.current.selectCell(idx, 0);
    } catch (_) {}
    suppressTableEditRef.current = false;
  };

  return (
    <div className="tool-container splunk-template">
      <div className="vtl-layout">
        {/* Editor Pane */}
        <div className="pane editor-pane">
          <div className="pane-header">
            <h3>VTL Template</h3>
            <div className="toolbar-left">
              <Button size="sm" onClick={handleFormat} title="Format Template">
                Format
              </Button>
              <Button size="sm" onClick={handleMinify} title="Minify Template">
                Minify
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopy} title="Copy">
                Copy
              </Button>
              <Button size="sm" variant="outline" onClick={handlePaste} title="Paste">
                Paste
              </Button>
              <Button size="sm" variant="outline" onClick={handleClear} title="Clear">
                Clear
              </Button>
            </div>
          </div>
          <div
            id="vtlEditor"
            className="monaco-editor-container"
            style={{ minHeight: "300px", flex: 1 }}
          ></div>
        </div>

        {/* Fields Table Pane */}
        <div className="pane fields-pane">
          <div className="pane-header">
            <h3>Fields</h3>
            <div className="toolbar-right">
              <Button size="sm" variant="outline" onClick={handleAddField} title="Add Field">
                Add Field
              </Button>
            </div>
          </div>
          <div
            ref={tableContainerRef}
            id="fieldsTable"
            className="fields-table-container"
            style={{ flex: 1, overflow: "auto" }}
          ></div>
        </div>
      </div>
    </div>
  );
}
