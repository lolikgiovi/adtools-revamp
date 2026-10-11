import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { cleanAnalyticsMeta, summarizeText } from "../../../core/AnalyticsMeta.js";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { TLVViewerService } from "../../../tools/tlv-viewer/service.js";
import "./TLVViewerPage.css";

type View = "tree" | "table" | "json";
type Format = "auto" | "qris" | "ber-hex" | "ber-base64";
const formatOptions = [
  { label: "Auto-detect", value: "auto" },
  { label: "QRIS / EMV QR", value: "qris" },
  { label: "BER-TLV (Hex)", value: "ber-hex" },
  { label: "BER-TLV (Base64)", value: "ber-base64" },
] as const;
type TlvNode = {
  tag: string;
  constructed?: boolean;
  children?: TlvNode[];
  tagName?: string;
  annotation?: string;
  value?: string;
  tagClass?: string;
  length?: number;
  offset?: number;
  valueHex?: string;
  valuePreview?: string;
};
type TlvRow = TlvNode & { rowIndex: number; depth: number; value?: string };
type TlvResult = {
  format: "qris" | "ber-hex" | "ber-base64";
  nodes: TlvNode[];
  rows: TlvRow[];
  jsonTree: unknown;
  summary: { charLength?: number; byteLength?: number; nodeCount: number; maxDepth: number };
  crc?: { present: boolean; valid?: boolean; actual?: string; expected?: string };
  validation?: Array<{ level: "error" | "warn"; message: string }>;
};

function asError(error: unknown) {
  return error instanceof Error ? error : String(error);
}

const STORAGE = {
  input: "tool:tlv-viewer:input",
  format: "tool:tlv-viewer:format",
  view: "tool:tlv-viewer:view",
} as const;
const TABLE_VIEW_LABELS: Record<View, string> = { tree: "Tree", table: "Table", json: "JSON" };

function readStorage(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The current parse remains usable when browser storage is unavailable.
  }
}

function trimHex(value: string | undefined, max = 60) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)} ...` : text;
}

function Annotation({ tag, value }: { tag: string; value: string }) {
  if (tag === "52") {
    return (
      <span className="text-xs text-muted-foreground">
        ({value} - based on{" "}
        <a
          className="text-primary underline-offset-4 hover:underline"
          href="https://www.iso.org/standard/33365.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          ISO 18245
        </a>
        )
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">({value})</span>;
}

function TreeNodes({ nodes, format }: { nodes: TlvNode[]; format: TlvResult["format"] }) {
  return (
    <ul className="flex flex-col gap-1 pl-3">
      {nodes.map((node, index) => {
        const key = `${node.tag}-${index}`;
        if (format === "qris") {
          return (
            <li key={key} className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded px-2 py-1 text-sm hover:bg-muted/40">
                <code className="shrink-0 font-semibold text-primary">{node.tag}</code>
                {node.tagName && <span className="text-muted-foreground">{node.tagName}</span>}
                {!node.constructed && (
                  <code className="min-w-0 break-all">
                    {(node.value || "").length > 80 ? `${node.value?.slice(0, 80)}...` : node.value}
                  </code>
                )}
                {node.annotation && <Annotation tag={node.tag} value={node.annotation} />}
              </div>
              {node.constructed && node.children?.length ? <TreeNodes nodes={node.children} format={format} /> : null}
            </li>
          );
        }
        return (
          <li key={key} className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded px-2 py-1 text-sm hover:bg-muted/40">
              <code className="shrink-0 font-semibold text-primary">{node.tag}</code>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{node.tagClass}</span>
              {!node.constructed && <code className="min-w-0 break-all">{trimHex(node.valueHex) || "(empty)"}</code>}
              {node.valuePreview && <span className="break-all text-muted-foreground">“{node.valuePreview}”</span>}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {node.length}B @{node.offset}
              </span>
            </div>
            {node.constructed && node.children?.length ? <TreeNodes nodes={node.children} format={format} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function tableCopyText(result: TlvResult) {
  if (result.format === "qris") {
    const header = ["#", "tag", "name", "length", "value"].join("\t");
    const lines = result.rows.map((row) =>
      [row.rowIndex, row.tag, row.tagName || "", row.length, row.constructed ? "(template)" : row.value || ""].join("\t"),
    );
    return [header, ...lines].join("\n");
  }
  const header = ["#", "depth", "offset", "class", "tag", "constructed", "length", "preview", "value_hex"].join("\t");
  const lines = result.rows.map((row) =>
    [
      row.rowIndex,
      row.depth,
      row.offset,
      row.tagClass,
      row.tag,
      row.constructed ? "Y" : "N",
      row.length,
      row.valuePreview || "",
      row.valueHex || "",
    ].join("\t"),
  );
  return [header, ...lines].join("\n");
}

export default function TLVViewerPage() {
  const [input, setInput] = useState(() => readStorage(STORAGE.input, ""));
  const [format, setFormat] = useState<Format>(() => {
    const saved = readStorage(STORAGE.format, "auto");
    return ["auto", "qris", "ber-hex", "ber-base64"].includes(saved) ? (saved as Format) : "auto";
  });
  const [view, setView] = useState<View>(() => {
    const saved = readStorage(STORAGE.view, "tree");
    return ["tree", "table", "json"].includes(saved) ? (saved as View) : "tree";
  });
  const [result, setResult] = useState<TlvResult | null>(null);
  const [error, setError] = useState("");
  const persistTimer = useRef<number | null>(null);
  const restoredParse = useRef(false);
  const mountTracked = useRef(false);
  const initialView = useRef(view);

  const parseInput = useCallback((rawInput: string, selectedFormat: Format) => {
    if (!rawInput.trim()) {
      setResult(null);
      setError("Input is empty.");
      return;
    }
    try {
      const parsed = TLVViewerService.parse(rawInput, selectedFormat) as TlvResult;
      setResult(parsed);
      setError("");
      UsageTracker.trackToolUse("tlv-viewer", "parse");
      UsageTracker.trackEvent(
        "tlv-viewer",
        "parse",
        cleanAnalyticsMeta({
          format: parsed.format,
          node_count: parsed.summary.nodeCount,
          max_depth: parsed.summary.maxDepth,
          crc_present: Boolean(parsed.crc?.present),
          crc_valid: Boolean(parsed.crc?.valid),
          validation_count: parsed.validation?.length ?? 0,
          ...summarizeText(rawInput, "input"),
        }),
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to parse TLV payload.";
      setResult(null);
      setError(message);
      UsageTracker.trackEvent("tlv-viewer", "parse_error", UsageTracker.enrichErrorMeta(asError(caught), { format: selectedFormat }));
    }
  }, []);

  useEffect(() => {
    if (mountTracked.current) return;
    mountTracked.current = true;
    try {
      UsageTracker.trackEvent("tlv-viewer", "mount", { view: initialView.current });
    } catch {
      // Analytics must not interrupt the tool.
    }
  }, []);

  useEffect(() => {
    if (restoredParse.current) return;
    const timer = window.setTimeout(() => {
      restoredParse.current = true;
      if (input.trim()) parseInput(input, format);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [format, input, parseInput]);

  useEffect(() => {
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => store(STORAGE.input, input), 250);
    return () => {
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
    };
  }, [input]);

  const flushDraft = useEffectEvent(() => store(STORAGE.input, input));
  useEffect(() => () => flushDraft(), []);

  function changeView(nextView: View) {
    setView(nextView);
    store(STORAGE.view, nextView);
    try {
      UsageTracker.trackEvent("tlv-viewer", "view_switch", { view: nextView, has_result: Boolean(result) });
    } catch {
      // Analytics must not interrupt view switching.
    }
  }

  function changeFormat(nextFormat: Format) {
    setFormat(nextFormat);
    store(STORAGE.format, nextFormat);
    if (input.trim()) parseInput(input, nextFormat);
  }

  async function pasteInput() {
    try {
      const pasted = await navigator.clipboard.readText();
      setInput(pasted || "");
      UsageTracker.trackEvent("tlv-viewer", "paste_input", summarizeText(pasted, "input"));
      parseInput(pasted || "", format);
    } catch (caught) {
      UsageTracker.trackEvent("tlv-viewer", "input_error", {
        source: "paste",
        error_type: caught instanceof Error ? caught.name : "clipboard_error",
      });
      toast.add({
        title: "Failed to paste from clipboard",
        description: "Make sure you have granted clipboard permissions.",
        type: "error",
      });
    }
  }

  function loadSample(type: "qris" | "ber") {
    const sample = type === "qris" ? TLVViewerService.buildQrisSample() : "6F0E8407A0000000031010A503500141";
    const sampleFormat: Format = type === "qris" ? "qris" : "ber-hex";
    setInput(sample);
    setFormat(sampleFormat);
    store(STORAGE.format, sampleFormat);
    store(STORAGE.input, sample);
    UsageTracker.trackEvent("tlv-viewer", "sample_loaded", { sample_type: type, format: sampleFormat });
    parseInput(sample, sampleFormat);
  }

  async function copyOutput() {
    if (!result) return;
    const text = view === "table" ? tableCopyText(result) : JSON.stringify(result.jsonTree, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ title: "Copied to clipboard!", type: "success" });
      UsageTracker.trackEvent("tlv-viewer", "copy_output", { view, format: result.format, ...summarizeText(text, "output") });
      UsageTracker.trackToolUse("tlv-viewer", "copy_output");
    } catch (caught) {
      console.error("Copy error:", caught);
      toast.add({ title: "Failed to copy output", type: "error" });
    }
  }

  const jsonText = result ? JSON.stringify(result.jsonTree, null, 2) : "";

  return (
    <div className="tlv-viewer-react">
      <section className="tlv-panel tlv-input-panel">
        <header className="tlv-panel-header">
          <h2>TLV Input</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="sr-only" htmlFor="tlv-format">
              Input format
            </Label>
            <Select items={formatOptions} value={format} onValueChange={(value) => value && changeFormat(value as Format)}>
              <SelectTrigger id="tlv-format" className="max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="qris">QRIS / EMV QR</SelectItem>
                <SelectItem value="ber-hex">BER-TLV (Hex)</SelectItem>
                <SelectItem value="ber-base64">BER-TLV (Base64)</SelectItem>
              </SelectContent>
            </Select>
            <Button disabled={!input.trim()} onClick={() => parseInput(input, format)}>
              Parse
            </Button>
          </div>
        </header>
        <div className="tlv-input-content">
          <Label className="sr-only" htmlFor="tlv-input">
            Paste QRIS string, hex TLV, or base64 payload
          </Label>
          <Textarea
            id="tlv-input"
            value={input}
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "tlv-input-error" : undefined}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                parseInput(input, format);
              }
            }}
            placeholder="Paste QRIS string, hex TLV, or base64 payload…"
            className="min-h-[220px] flex-1 resize-y font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void pasteInput()}>
              Paste
            </Button>
            <Button variant="outline" onClick={() => loadSample("qris")}>
              QRIS Sample
            </Button>
            <Button variant="outline" onClick={() => loadSample("ber")}>
              BER-TLV Sample
            </Button>
            <Button
              variant="ghost"
              disabled={!input && !result && !error}
              onClick={() => {
                setInput("");
                setResult(null);
                setError("");
                store(STORAGE.input, "");
              }}
            >
              Clear
            </Button>
            <span className="ml-auto self-center text-xs text-muted-foreground">Ctrl/Cmd + Enter to parse</span>
          </div>
          {error && (
            <Alert id="tlv-input-error" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">
            QRIS tags per{" "}
            <a
              className="text-primary underline-offset-4 hover:underline"
              href="https://www.emvco.com/emv-technologies/qrcodes/"
              target="_blank"
              rel="noopener noreferrer"
            >
              EMVCo QRCPS Merchant-Presented Mode
            </a>{" "}
            spec.
          </p>
        </div>
      </section>

      <Tabs value={view} onValueChange={(value) => changeView(value as View)} className="tlv-output-tabs">
        <section className="tlv-panel tlv-output-panel">
          <header className="tlv-panel-header tlv-output-header">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <TabsList aria-label="TLV result view" variant="line" className="tlv-result-tabs">
                {(Object.keys(TABLE_VIEW_LABELS) as View[]).map((item) => (
                  <TabsTrigger key={item} value={item} className="flex-none">
                    {TABLE_VIEW_LABELS[item]}
                  </TabsTrigger>
                ))}
              </TabsList>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {result?.format === "qris"
                  ? `${result.summary.charLength} chars · ${result.summary.nodeCount} fields · depth ${result.summary.maxDepth}`
                  : result
                    ? `${result.summary.byteLength} bytes · ${result.summary.nodeCount} nodes · depth ${result.summary.maxDepth}`
                    : ""}
              </p>
            </div>
            <Button variant="outline" disabled={!result} onClick={() => void copyOutput()}>
              Copy
            </Button>
          </header>
          {result?.format === "qris" && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-y px-4 py-2 text-xs">
              {result.crc && (
                <span className={result.crc.present ? (result.crc.valid ? "text-primary" : "text-destructive") : "text-muted-foreground"}>
                  {!result.crc.present
                    ? "CRC tag (63) not found"
                    : result.crc.valid
                      ? `✓ CRC valid (${result.crc.actual})`
                      : `✗ CRC invalid — expected ${result.crc.expected}; tag 63 contains ${result.crc.actual}`}
                </span>
              )}
              {result.validation?.length === 0 && <span className="text-primary">✓ All mandatory tags present</span>}
              {result.validation?.map((item, index) => (
                <span key={`${item.level}-${index}`} className={item.level === "error" ? "text-destructive" : "text-muted-foreground"}>
                  {item.level === "error" ? "✗" : "⚠"} {item.message}
                </span>
              ))}
            </div>
          )}
          <div className="tlv-output-content">
            <TabsContent value={view} className="tlv-view-content m-0 min-w-0 overflow-auto bg-background p-3 text-xs">
              {!result ? (
                <Empty className="h-full min-h-0 gap-2 border-0 p-0">
                  <EmptyHeader>
                    <EmptyTitle>Ready to parse</EmptyTitle>
                    <EmptyDescription className="text-sm">Paste a QRIS string or TLV payload, then choose Parse.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : view === "tree" ? (
                result.nodes.length ? (
                  <TreeNodes nodes={result.nodes} format={result.format} />
                ) : (
                  <p className="text-sm text-muted-foreground">No TLV nodes found.</p>
                )
              ) : view === "json" ? (
                <pre className="whitespace-pre-wrap break-all font-mono text-xs">{jsonText}</pre>
              ) : (
                <Table className="w-full border-collapse text-left text-xs">
                  <TableHeader className="sticky top-0 bg-muted text-muted-foreground">
                    <TableRow className="hover:bg-transparent">
                      {(result.format === "qris"
                        ? ["#", "Tag", "Name", "Len", "Value"]
                        : ["#", "Depth", "Offset", "Class", "Tag", "C", "Len", "Preview", "Value (Hex)"]
                      ).map((heading) => (
                        <TableHead key={heading} scope="col" className="h-8 whitespace-nowrap border-b px-2 py-2">
                          {heading}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((row) =>
                      result.format === "qris" ? (
                        <TableRow key={row.rowIndex} className="border-b last:border-0 hover:bg-transparent">
                          <TableCell className="px-2 py-2 tabular-nums">{row.rowIndex}</TableCell>
                          <TableCell className="px-2 py-2 font-mono" style={{ paddingLeft: `${8 + row.depth * 12}px` }}>
                            {row.tag}
                          </TableCell>
                          <TableCell className="px-2 py-2">{row.tagName}</TableCell>
                          <TableCell className="px-2 py-2 tabular-nums">{row.length}</TableCell>
                          <TableCell className="max-w-64 whitespace-normal px-2 py-2">
                            {row.constructed ? "(template)" : (row.value || "").length > 100 ? `${row.value?.slice(0, 100)}...` : row.value}
                            {row.annotation && (
                              <>
                                {" "}
                                <Annotation tag={row.tag} value={row.annotation} />
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      ) : (
                        <TableRow key={row.rowIndex} className="border-b last:border-0 hover:bg-transparent">
                          <TableCell className="px-2 py-2 tabular-nums">{row.rowIndex}</TableCell>
                          <TableCell className="px-2 py-2 tabular-nums">{row.depth}</TableCell>
                          <TableCell className="px-2 py-2 tabular-nums">{row.offset}</TableCell>
                          <TableCell className="px-2 py-2">{row.tagClass}</TableCell>
                          <TableCell className="px-2 py-2 font-mono" style={{ paddingLeft: `${8 + row.depth * 12}px` }}>
                            {row.tag}
                          </TableCell>
                          <TableCell className="px-2 py-2">{row.constructed ? "Y" : "N"}</TableCell>
                          <TableCell className="px-2 py-2 tabular-nums">{row.length}</TableCell>
                          <TableCell className="px-2 py-2 whitespace-normal">{row.valuePreview}</TableCell>
                          <TableCell className="px-2 py-2 font-mono">{trimHex(row.valueHex)}</TableCell>
                        </TableRow>
                      ),
                    )}
                    {result.rows.length === 0 && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={result.format === "qris" ? 5 : 9} className="px-3 py-8 text-center text-muted-foreground">
                          No rows.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </div>
        </section>
      </Tabs>
    </div>
  );
}
