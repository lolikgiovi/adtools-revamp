import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type * as Monaco from "monaco-editor";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { bucketSize, cleanAnalyticsMeta, getJsonComplexityMeta, getObjectShapeMeta, summarizeText } from "../../../core/AnalyticsMeta.js";
import { isTauri } from "../../../core/Runtime.js";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { JSONToolsService } from "../../../tools/json-tools/service.js";
import { registerJsonToolsCompletions } from "../../../tools/json-tools/jsonCompletion.js";
import { configureMonacoWorkers } from "../../../core/MonacoWorkers.js";
import "./JSONToolsPage.css";

type Tab = "prettify" | "minify" | "stringify" | "unstringify" | "escape" | "unescape" | "extract-keys" | "json-to-table";
type ExtractType = "simple" | "paths";
type SortOrder = "natural" | "asc" | "desc";
type MonacoEditorProps = {
  label: string;
  input: string;
  onChange: (value: string) => void;
  markers: Monaco.editor.IMarkerData[];
};

const tabs: Array<{ id: Tab; label: string; outputTitle: string }> = [
  { id: "prettify", label: "Beautify", outputTitle: "Formatted JSON" },
  { id: "minify", label: "Minify", outputTitle: "Minified JSON" },
  { id: "stringify", label: "Stringify", outputTitle: "Stringified JSON" },
  { id: "unstringify", label: "Unstringify", outputTitle: "Parsed JSON" },
  { id: "escape", label: "Escape", outputTitle: "Escaped JSON" },
  { id: "unescape", label: "Unescape", outputTitle: "Unescaped JSON" },
  { id: "extract-keys", label: "Extract Keys", outputTitle: "Extracted Keys" },
  { id: "json-to-table", label: "To Table", outputTitle: "Table View" },
];

const extractTypeOptions = [
  { label: "Simple Keys", value: "simple" },
  { label: "Key Paths", value: "paths" },
] as const;
const sortOrderOptions = [
  { label: "Natural", value: "natural" },
  { label: "A-Z", value: "asc" },
  { label: "Z-A", value: "desc" },
] as const;
const EMPTY_MARKERS: Monaco.editor.IMarkerData[] = [];

function readTab(): Tab {
  try {
    const saved = window.localStorage.getItem("json-tools-tab");
    return tabs.some((tab) => tab.id === saved) ? (saved as Tab) : "prettify";
  } catch {
    return "prettify";
  }
}

function readInput() {
  try {
    const saved = window.localStorage.getItem("tool:json-tools:editor");
    return { value: saved ?? "", source: saved === null ? "empty" : "restored" };
  } catch {
    return { value: "", source: "empty" };
  }
}

function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The editor remains usable when browser storage is unavailable.
  }
}

function createAnalyticsId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function MonacoEditor({ input, onChange, markers, label }: MonacoEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const inputRef = useRef(input);
  const onChangeRef = useRef(onChange);
  const markersRef = useRef(markers);

  useEffect(() => {
    inputRef.current = input;
    onChangeRef.current = onChange;
  }, [input, onChange]);

  useEffect(() => {
    markersRef.current = markers;
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelMarkers(model, "json-tools", markers);
  }, [markers]);

  useEffect(() => {
    if (!host.current) return;
    configureMonacoWorkers(self, { editor: editorWorker, json: jsonWorker });
    const options: Monaco.editor.IStandaloneEditorConstructionOptions = {
      language: "json",
      ariaLabel: label,
      theme: document.documentElement.classList.contains("dark") ? "vs-dark" : "vs",
      automaticLayout: true,
      fontSize: 13,
      lineHeight: 22,
      padding: { top: 12, bottom: 12 },
      renderLineHighlightOnlyWhenFocus: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      scrollbar: { alwaysConsumeMouseWheel: false },
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      insertSpaces: true,
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: "off",
    };
    const editor = monaco.editor.create(host.current, { ...options, value: inputRef.current });
    editorRef.current = editor;
    const disposeCompletions = registerJsonToolsCompletions(monaco, [editor.getModel()]);
    const listener = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    const model = editor.getModel();
    const themeObserver = new MutationObserver(() => {
      monaco.editor.setTheme(document.documentElement.classList.contains("dark") ? "vs-dark" : "vs");
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    if (editor.getModel()) monaco.editor.setModelMarkers(editor.getModel()!, "json-tools", markersRef.current);

    return () => {
      listener.dispose();
      themeObserver.disconnect();
      disposeCompletions();
      editorRef.current = null;
      editor.dispose();
      model?.dispose();
    };
  }, [label]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== input) editor.setValue(input);
  }, [input]);

  return <div ref={host} className="json-monaco-host" aria-label={label} />;
}

function flattenJson(value: unknown, prefix = "", output: Array<{ key: string; value: string }> = []) {
  if (value === null) {
    output.push({ key: prefix || "(root)", value: "null" });
    return output;
  }
  if (value === undefined) {
    output.push({ key: prefix || "(root)", value: "" });
    return output;
  }
  if (typeof value !== "object") {
    output.push({ key: prefix || "(root)", value: String(value).replace(/[\t\n\r]/g, " ") });
    return output;
  }
  if (Array.isArray(value)) {
    if (!value.length) output.push({ key: prefix || "(root)", value: "[]" });
    else value.forEach((item, index) => flattenJson(item, prefix ? `${prefix}[${index}]` : `[${index}]`, output));
    return output;
  }
  const entries = Object.entries(value);
  if (!entries.length) output.push({ key: prefix || "(root)", value: "{}" });
  else entries.forEach(([key, child]) => flattenJson(child, prefix ? `${prefix}.${key}` : key, output));
  return output;
}

function displayError(tab: Tab, message: string, input: string, position: number | null) {
  const titles: Partial<Record<Tab, string>> = {
    prettify: "JSON Syntax Error",
    minify: "JSON Syntax Error",
    stringify: "JSON Syntax Error",
    unstringify: "JSON Unstringify Error",
    escape: "JSON Syntax Error",
    unescape: "JSON Unescape Error",
    "extract-keys": "JSON Syntax Error",
  };
  let location = "";
  if (position !== null) {
    const lines = input.substring(0, position).split("\n");
    location = `\nLine ${lines.length}, Column ${lines[lines.length - 1].length + 1}`;
  }
  return `${titles[tab] ?? "JSON processing error"}: ${message}${location}`;
}

export default function JSONToolsPage() {
  const [initialInput] = useState(readInput);
  const [input, setInput] = useState(initialInput.value);
  const [output, setOutput] = useState("");
  const [tab, setTab] = useState<Tab>(readTab);
  const [extractType, setExtractType] = useState<ExtractType>("simple");
  const [sortOrder, setSortOrder] = useState<SortOrder>("natural");
  const [tableHtml, setTableHtml] = useState("");
  const [tableError, setTableError] = useState("");
  const [editorMarkers, setEditorMarkers] = useState<Monaco.editor.IMarkerData[]>([]);
  const [validatedJson, setValidatedJson] = useState<unknown>(null);
  const [hasTableData, setHasTableData] = useState(false);
  const [isTransposed, setIsTransposed] = useState(true);
  const [keySortOrder, setKeySortOrder] = useState<SortOrder>("natural");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCount, setSearchCount] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const tableRoot = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchMatches = useRef<HTMLElement[]>([]);
  const analyticsSessionId = useRef(createAnalyticsId());
  const inputSource = useRef(initialInput.source);
  const activeProcess = useRef<{ action: string; attemptId: string; startedAt: number } | null>(null);
  const lastProcess = useRef<Record<string, string | number | null> | null>(null);
  const searchTimer = useRef<number | null>(null);
  const restoreSortFocus = useRef(false);

  const currentTitle = tabs.find((item) => item.id === tab)?.outputTitle || "Output";
  const isTableMode = tab === "json-to-table";

  const trackAnalytics = useCallback((event: string, meta: Record<string, unknown> = {}, debounceMs?: number) => {
    try {
      UsageTracker.trackEvent("json-tools", event, cleanAnalyticsMeta(meta), debounceMs);
    } catch {
      // Analytics must never interrupt JSON processing.
    }
  }, []);

  const beginProcess = useCallback((action: string) => {
    activeProcess.current = { action, attemptId: createAnalyticsId(), startedAt: performance.now() };
  }, []);

  const getTiming = useCallback(() => {
    const active = activeProcess.current;
    return {
      attempt_id: active?.attemptId || createAnalyticsId(),
      duration_ms: active ? Math.round(Math.max(0, performance.now() - active.startedAt) * 10) / 10 : 0,
    };
  }, []);

  const trackError = useCallback(
    (action: string, value: string, errorType = "invalid_input", meta: Record<string, unknown> = {}) => {
      trackAnalytics("process_error", {
        action,
        error_type: String(errorType || "invalid_input").slice(0, 80),
        ...summarizeText(value, "input"),
        input_size_bucket: bucketSize(value.length),
        ...getTiming(),
        input_source: inputSource.current,
        session_id: analyticsSessionId.current,
        ...meta,
      });
      activeProcess.current = null;
    },
    [getTiming, trackAnalytics],
  );

  const trackSuccess = useCallback(
    (action: string, value: string, result: string, meta: Record<string, unknown> = {}) => {
      let shapeMeta: Record<string, unknown> = {};
      let complexityMeta: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(value);
        shapeMeta = getObjectShapeMeta(parsed);
        complexityMeta = getJsonComplexityMeta(parsed);
      } catch {
        // Some actions consume a JSON string; shape data is only available for JSON input.
      }
      const analyticsMeta = {
        action,
        ...shapeMeta,
        ...complexityMeta,
        ...summarizeText(value, "input"),
        ...summarizeText(result, "output"),
        input_size_bucket: bucketSize(value.length),
        ...getTiming(),
        input_source: inputSource.current,
        session_id: analyticsSessionId.current,
        ...meta,
      };
      try {
        UsageTracker.trackToolUse("json-tools", action, cleanAnalyticsMeta(analyticsMeta));
      } catch {
        // Analytics must never interrupt JSON processing.
      }
      trackAnalytics("process_success", analyticsMeta);
      lastProcess.current = analyticsMeta as Record<string, string | number | null>;
      activeProcess.current = null;
    },
    [getTiming, trackAnalytics],
  );

  const trackOutputUsed = useCallback(
    (target: string, meta: Record<string, unknown> = {}) => {
      const previous = lastProcess.current;
      const outputMeta = {
        target,
        source_action: previous?.action || tab,
        source_attempt_id: previous?.attempt_id || null,
        input_source: previous?.input_source || inputSource.current,
        top_level_type: previous?.top_level_type || null,
        max_depth_bucket: previous?.max_depth_bucket || null,
        field_count_bucket: previous?.field_count_bucket || null,
        session_id: analyticsSessionId.current,
        ...meta,
      };
      trackAnalytics("output_used", outputMeta);
      try {
        UsageTracker.trackToolUse("json-tools", target, cleanAnalyticsMeta(outputMeta));
      } catch {
        // Analytics must never interrupt copying or export.
      }
    },
    [tab, trackAnalytics],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => save("tool:json-tools:editor", input), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const flushDraft = useEffectEvent(() => save("tool:json-tools:editor", input));
  useEffect(() => () => flushDraft(), []);

  useEffect(() => {
    save("json-tools-tab", tab);
  }, [tab]);

  useEffect(() => {
    return () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    };
  }, []);

  const tableDisplay = useMemo(() => {
    if (!hasTableData) return "";
    const response = JSONToolsService.jsonToTable(JSON.stringify(validatedJson), isTransposed, keySortOrder);
    if (response.error) return "";
    const ariaSort = keySortOrder === "asc" ? "ascending" : keySortOrder === "desc" ? "descending" : "none";
    return (response.result || "").replace(
      /<th class="key-header key-header-sortable"[^>]*>([^<]*)<\/th>/,
      `<th class="key-header key-header-sortable" aria-sort="${ariaSort}"><button type="button" aria-label="Sort keys">$1</button></th>`,
    );
  }, [hasTableData, isTransposed, keySortOrder, validatedJson]);

  useEffect(() => {
    if (!restoreSortFocus.current) return;
    tableRoot.current?.querySelector<HTMLButtonElement>(".key-header-sortable button")?.focus();
    restoreSortFocus.current = false;
  }, [tableDisplay]);

  useEffect(() => {
    const root = tableRoot.current;
    if (!root || !tableDisplay) {
      searchMatches.current = [];
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
      searchTimer.current = window.setTimeout(() => {
        setSearchCount("");
        setSearchIndex(0);
      }, 0);
      return;
    }
    const query = searchQuery.trim().toLocaleLowerCase();
    root
      .querySelectorAll(".search-match, .search-current")
      .forEach((element) => element.classList.remove("search-match", "search-current"));
    const matches = query
      ? Array.from(root.querySelectorAll<HTMLElement>(".json-table td")).filter((cell) => {
          if (cell.querySelector(".nested-table") || cell.classList.contains("key-index")) return false;
          return cell.textContent?.toLocaleLowerCase().includes(query) ?? false;
        })
      : [];
    searchMatches.current = matches;
    if (query && matches.length) {
      matches[0].classList.add("search-match", "search-current");
      matches[0].scrollIntoView?.({ behavior: "instant", block: "nearest" });
    }
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setSearchIndex(0);
      setSearchCount(!query ? "" : matches.length ? `1/${matches.length}` : "0 matches");
      if (!query) return;
      trackAnalytics(
        "table_search",
        {
          query_length: searchQuery.length,
          match_count: matches.length,
          session_id: analyticsSessionId.current,
          source_action: lastProcess.current?.action || "json_to_table",
        },
        2000,
      );
    }, 0);
  }, [searchQuery, tableDisplay, trackAnalytics]);

  const clearMarkers = useCallback(() => setEditorMarkers([]), []);

  const processCurrent = useCallback(
    (tabOverride?: Tab, options?: { extractType?: ExtractType; sortOrder?: SortOrder }) => {
      const activeTab = tabOverride || tab;
      const nextExtractType = options?.extractType ?? extractType;
      const nextSortOrder = options?.sortOrder ?? sortOrder;
      const content = input.trim();
      const action = activeTab === "extract-keys" ? "extract_keys" : activeTab === "json-to-table" ? "json_to_table" : activeTab;
      clearMarkers();
      if (!content) {
        beginProcess(action);
        trackError(action, content, "empty_input");
        setOutput("");
        setValidatedJson(null);
        setHasTableData(false);
        setTableHtml("");
        setTableError("");
        return;
      }
      beginProcess(action);

      try {
        if (activeTab === "json-to-table") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(content);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const position = JSONToolsService.getErrorPosition(message);
            trackError(action, content, "invalid_json", { has_position: true });
            setValidatedJson(null);
            setHasTableData(false);
            setTableHtml("");
            setTableError(`Invalid JSON: ${message}`);
            if (position !== null) {
              const preceding = content.substring(0, position).split("\n");
              setEditorMarkers([
                {
                  severity: monaco.MarkerSeverity.Error,
                  message,
                  startLineNumber: preceding.length,
                  startColumn: preceding[preceding.length - 1].length + 1,
                  endLineNumber: preceding.length,
                  endColumn: preceding[preceding.length - 1].length + 2,
                },
              ]);
            }
            return;
          }
          const response = JSONToolsService.jsonToTable(JSON.stringify(parsed), true, "natural");
          if (response.error) {
            setValidatedJson(null);
            setHasTableData(false);
            setTableHtml("");
            setTableError(response.error.message);
            trackError(action, content, "table_render_error");
            return;
          }
          setValidatedJson(parsed);
          setHasTableData(true);
          setTableHtml(response.result || "");
          setTableError("");
          setIsTransposed(true);
          setKeySortOrder("natural");
          setIsExpanded(false);
          setSearchQuery("");
          const flattened = flattenJson(parsed);
          trackSuccess(action, content, "", { row_count: flattened.length, transposed: true, sort_order: "natural" });
          return;
        }

        const response =
          activeTab === "extract-keys"
            ? JSONToolsService.extractKeys(content, nextExtractType === "paths", nextSortOrder)
            : JSONToolsService[activeTab](content);
        if (response.error) {
          const errorType =
            activeTab === "unstringify" ? "invalid_stringified_json" : activeTab === "unescape" ? "invalid_escaped_json" : "invalid_json";
          const actionName = activeTab === "extract-keys" ? "extract_keys" : activeTab;
          trackError(actionName, content, errorType, { has_position: response.error.position != null });
          setOutput(displayError(activeTab, response.error.message, content, response.error.position));
          if (response.error.position !== null) {
            const preceding = content.substring(0, response.error.position).split("\n");
            setEditorMarkers([
              {
                severity: monaco.MarkerSeverity.Error,
                message: response.error.message,
                startLineNumber: preceding.length,
                startColumn: preceding[preceding.length - 1].length + 1,
                endLineNumber: preceding.length,
                endColumn: preceding[preceding.length - 1].length + 2,
              },
            ]);
          }
          return;
        }
        const result = response.result || "";
        setOutput(result);
        setTableHtml("");
        setTableError("");
        setHasTableData(false);
        const actionName = activeTab === "extract-keys" ? "extract_keys" : activeTab;
        const meta = activeTab === "extract-keys" ? { extract_type: nextExtractType, sort_order: nextSortOrder } : {};
        if (activeTab === "prettify") toast.add({ title: "JSON is valid ✅", type: "success" });
        trackSuccess(actionName, content, result, meta);
      } catch (error) {
        const actionName = activeTab === "extract-keys" ? "extract_keys" : activeTab;
        trackError(actionName, content, error instanceof Error ? error.name : "processing_error");
        setOutput(displayError(activeTab, "The operation could not be completed.", content, null));
      }
    },
    [beginProcess, clearMarkers, extractType, input, sortOrder, tab, trackError, trackSuccess],
  );

  function switchTab(nextTab: Tab) {
    if (nextTab === tab) return;
    trackAnalytics("tab_switch", { from_tab: tab, to_tab: nextTab, session_id: analyticsSessionId.current });
    setTab(nextTab);
    setOutput("");
    clearMarkers();
    if (isExpanded) setIsExpanded(false);
    if (nextTab !== "json-to-table") {
      setIsSearchOpen(false);
      setSearchQuery("");
    }
  }

  async function copyText(value: string, target: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.add({ title: "Copied to clipboard!", type: "success" });
      const meta = { ...summarizeText(value, "output"), session_id: analyticsSessionId.current };
      trackAnalytics(target, meta);
      trackOutputUsed(target, meta);
      if (target === "copy_input") inputSource.current = "manual";
    } catch (error) {
      console.error("Clipboard error:", error);
      toast.add({ title: "Failed to copy to clipboard", type: "error" });
    }
  }

  function updateInput(value: string) {
    setInput(value);
    setOutput("");
    setTableHtml("");
    setTableError("");
    setValidatedJson(null);
    setHasTableData(false);
    clearMarkers();
  }

  async function pasteInput() {
    try {
      const pasted = await navigator.clipboard.readText();
      inputSource.current = "manual";
      updateInput(pasted);
      clearMarkers();
      setOutput("");
      setTableError("");
    } catch (error) {
      trackAnalytics("input_error", { source: "paste", error_type: error instanceof Error ? error.name : "clipboard_error" });
      toast.add({ title: "Failed to paste from clipboard", type: "error" });
    }
  }

  function getTableTsv(data: unknown) {
    const pairs = flattenJson(data);
    return pairs.length ? ["Key\tValue", ...pairs.map((pair) => `${pair.key}\t${pair.value}`)].join("\n") : "";
  }

  async function copyTable() {
    const table = tableRoot.current?.querySelector(".json-table");
    if (!(table instanceof HTMLElement)) {
      trackAnalytics("output_error", { target: "copy_table", error_type: "no_table" });
      toast.add({ title: "No table to copy", type: "error" });
      return;
    }
    const html = table.outerHTML;
    const tsv = getTableTsv(validatedJson);
    try {
      if (isTauri()) {
        const { writeHtml } = await import("@tauri-apps/plugin-clipboard-manager");
        await writeHtml(html, tsv);
        toast.add({ title: "Copied to clipboard!", type: "success" });
        const meta = { format: "html", runtime: "tauri", ...summarizeText(html, "output") };
        trackAnalytics("copy_table", meta);
        trackOutputUsed("copy_table", meta);
        return;
      }
    } catch (error) {
      console.warn("Native HTML clipboard failed; trying browser clipboard.", error);
    }
    try {
      if (!navigator.clipboard.write || typeof ClipboardItem === "undefined") throw new Error("HTML clipboard is not available");
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([tsv], { type: "text/plain" }),
        }),
      ]);
      toast.add({ title: "Copied to clipboard!", type: "success" });
      const meta = { format: "html", runtime: "web", ...summarizeText(html, "output") };
      trackAnalytics("copy_table", meta);
      trackOutputUsed("copy_table", meta);
    } catch (error) {
      console.warn("HTML clipboard failed; falling back to TSV.", error);
      await copyText(tsv, "table_fallback");
      trackAnalytics("copy_table", { format: "tsv_fallback", ...summarizeText(tsv, "output") });
    }
  }

  async function exportExcel() {
    if (!hasTableData) {
      trackAnalytics("output_error", { target: "export_excel", error_type: "no_table" });
      toast.add({ title: "No data to export", type: "error" });
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const pairs = flattenJson(validatedJson);
      if (!pairs.length) {
        toast.add({ title: "No data to export", type: "error" });
        return;
      }
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([["Key", "Value"], ...pairs.map(({ key, value }) => [key, value])]);
      const maxKeyLength = Math.max(...pairs.map((pair) => pair.key.length), 3);
      const maxValueLength = Math.min(Math.max(...pairs.map((pair) => pair.value.length), 5), 100);
      worksheet["!cols"] = [{ wch: Math.min(maxKeyLength + 2, 60) }, { wch: Math.min(maxValueLength + 2, 100) }];
      XLSX.utils.book_append_sheet(workbook, worksheet, "JSON Data");
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
      const filename = `json_export_${timestamp}.xlsx`;
      XLSX.writeFile(workbook, filename);
      toast.add({ title: `Exported to ${filename}`, type: "success" });
      const shape = getObjectShapeMeta(validatedJson);
      trackAnalytics("export_excel", { row_count: pairs.length, top_level_type: shape.top_level_type });
      trackOutputUsed("export_excel", { row_count: pairs.length, top_level_type: shape.top_level_type });
    } catch (error) {
      console.error("Export failed:", error);
      trackAnalytics("output_error", { target: "export_excel", error_type: error instanceof Error ? error.name : "export_error" });
      toast.add({ title: "Failed to export to Excel", type: "error" });
    }
  }

  function navigateSearch(direction: number) {
    const matches = searchMatches.current;
    if (!matches.length) return;
    matches[searchIndex]?.classList.remove("search-current");
    const nextIndex = (searchIndex + direction + matches.length) % matches.length;
    setSearchIndex(nextIndex);
    matches[nextIndex].classList.add("search-current");
    matches[nextIndex].scrollIntoView?.({ behavior: "instant", block: "nearest" });
    setSearchCount(`${nextIndex + 1}/${matches.length}`);
  }

  function onTableClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || !event.target.closest(".key-header-sortable")) return;
    restoreSortFocus.current = event.target.matches("button");
    setKeySortOrder((current) => (current === "natural" ? "asc" : current === "asc" ? "desc" : "natural"));
    trackAnalytics("table_sort", {
      sort_order: keySortOrder === "natural" ? "asc" : keySortOrder === "asc" ? "desc" : "natural",
      session_id: analyticsSessionId.current,
      source_action: lastProcess.current?.action || "json_to_table",
    });
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => switchTab(value as Tab)}
      className={`json-tools-react w-full ${isExpanded ? "is-expanded" : ""}`}
    >
      <TabsList variant="line" aria-label="JSON operation" className="json-operation-tabs">
        {tabs.map((item) => (
          <TabsTrigger key={item.id} value={item.id} className="flex-none">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value={tab} className="json-tab-panel m-0 flex w-full flex-col">
        {tab === "extract-keys" && (
          <div className="json-options-row flex flex-wrap items-end gap-3 border-b bg-card px-3 py-2">
            <Field className="w-auto min-w-36">
              <FieldLabel htmlFor="json-extract-type">Key type</FieldLabel>
              <Select
                items={extractTypeOptions}
                value={extractType}
                onValueChange={(value) => {
                  if (value !== "simple" && value !== "paths") return;
                  setExtractType(value);
                  processCurrent("extract-keys", { extractType: value });
                }}
              >
                <SelectTrigger id="json-extract-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">Simple Keys</SelectItem>
                  <SelectItem value="paths">Key Paths</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field className="w-auto min-w-36">
              <FieldLabel htmlFor="json-sort-order">Sort</FieldLabel>
              <Select
                items={sortOrderOptions}
                value={sortOrder}
                onValueChange={(value) => {
                  if (value !== "natural" && value !== "asc" && value !== "desc") return;
                  setSortOrder(value);
                  processCurrent("extract-keys", { sortOrder: value });
                }}
              >
                <SelectTrigger id="json-sort-order" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">Natural</SelectItem>
                  <SelectItem value="asc">A-Z</SelectItem>
                  <SelectItem value="desc">Z-A</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <p className="pb-2 text-xs text-muted-foreground">Changing an option updates the current result.</p>
          </div>
        )}

        <div className={`json-workspace ${isExpanded ? "is-expanded" : ""}`}>
          {!isExpanded && (
            <section className="json-editor-panel">
              <header className="json-panel-header">
                <h2>Input</h2>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    title="Clear Editor"
                    onClick={() => {
                      setInput("");
                      inputSource.current = "empty";
                      save("tool:json-tools:editor", "");
                      setOutput("");
                      setTableHtml("");
                      setTableError("");
                      setValidatedJson(null);
                      setHasTableData(false);
                      clearMarkers();
                    }}
                  >
                    Clear
                  </Button>
                  <Button variant="ghost" title="Copy Input" disabled={!input} onClick={() => void copyText(input, "copy_input")}>
                    Copy
                  </Button>
                  <Button variant="ghost" title="Paste from Clipboard" onClick={() => void pasteInput()}>
                    Paste
                  </Button>
                  <Button disabled={!input.trim()} onClick={() => processCurrent()}>
                    {tabs.find((item) => item.id === tab)?.label === "To Table"
                      ? "Convert to Table"
                      : tabs.find((item) => item.id === tab)?.label}
                  </Button>
                </div>
              </header>
              <div className="json-panel-content">
                <MonacoEditor
                  label="JSON input"
                  input={input}
                  onChange={(value) => {
                    inputSource.current = "manual";
                    updateInput(value);
                  }}
                  markers={editorMarkers}
                />
              </div>
            </section>
          )}

          <section className="json-editor-panel json-output-panel">
            <header className="json-panel-header flex-col !items-stretch gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2>{currentTitle}</h2>
                <div className="flex flex-wrap items-center gap-1">
                  {isTableMode && (
                    <>
                      <Button
                        variant="outline"
                        disabled={!hasTableData}
                        aria-expanded={isSearchOpen}
                        ref={searchButton}
                        onClick={() => {
                          setIsSearchOpen((open) => !open);
                          if (isSearchOpen) setSearchQuery("");
                        }}
                      >
                        Search
                      </Button>
                      <Button variant="outline" disabled={!hasTableData} onClick={() => void exportExcel()}>
                        Export Excel
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!hasTableData}
                        aria-pressed={isTransposed}
                        onClick={() => {
                          setIsTransposed((current) => !current);
                          trackAnalytics("table_transpose", {
                            transposed: !isTransposed,
                            session_id: analyticsSessionId.current,
                            source_action: lastProcess.current?.action || "json_to_table",
                          });
                        }}
                      >
                        Transpose
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!hasTableData}
                        aria-expanded={isExpanded}
                        onClick={() => setIsExpanded((current) => !current)}
                      >
                        {isExpanded ? "Collapse" : "Expand"}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    disabled={isTableMode ? !hasTableData : !output}
                    onClick={() => (isTableMode ? void copyTable() : void copyText(output, "copy_output"))}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              {isTableMode && isSearchOpen && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="Search in table"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search table…"
                    className="h-8 max-w-xs"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsSearchOpen(false);
                        setSearchQuery("");
                        searchButton.current?.focus();
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        navigateSearch(event.shiftKey ? -1 : 1);
                      }
                    }}
                  />
                  <span className="min-w-16 text-xs text-muted-foreground" aria-live="polite">
                    {searchCount}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={!searchCount || searchCount === "0 matches"}
                    aria-label="Previous match"
                    onClick={() => navigateSearch(-1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!searchCount || searchCount === "0 matches"}
                    aria-label="Next match"
                    onClick={() => navigateSearch(1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </header>
            <div className="json-panel-content min-w-0">
              {isTableMode ? (
                <div className="json-table-scroll" onClick={onTableClick}>
                  {tableError ? (
                    <Alert variant="destructive" className="mx-3 my-2">
                      <AlertDescription>{tableError}</AlertDescription>
                    </Alert>
                  ) : null}
                  {tableHtml ? (
                    <div ref={tableRoot} className="json-table-content" dangerouslySetInnerHTML={{ __html: tableDisplay }} />
                  ) : !tableError ? (
                    <Empty className="json-table-empty flex-1 p-0">
                      <EmptyDescription className="text-sm">Paste JSON and choose Convert to Table.</EmptyDescription>
                    </Empty>
                  ) : null}
                </div>
              ) : (
                <MonacoEditor label="JSON output" input={output} onChange={setOutput} markers={EMPTY_MARKERS} />
              )}
            </div>
          </section>
        </div>
      </TabsContent>
    </Tabs>
  );
}
