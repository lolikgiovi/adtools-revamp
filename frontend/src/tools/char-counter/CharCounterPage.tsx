import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/toast";
import { cleanAnalyticsMeta } from "../../../core/AnalyticsMeta.js";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { getLineCounts, getTextCounts } from "../../../tools/char-counter/service.js";
import "./CharCounterPage.css";

const TEXT_KEY = "tool:char-counter:text";
const MODE_KEY = "tool:char-counter:mode";

function readStoredValue(key: string, fallback = "") {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Draft persistence is optional when browser storage is unavailable.
  }
}

function CountSummary({ counts }: { counts: ReturnType<typeof getTextCounts> }) {
  return (
    <div className="char-counter-summary" role="status" aria-label="Text counts" aria-atomic="true">
      <div className="char-count-primary">
        <output className="tabular-nums">{counts.characters.toLocaleString()}</output>
        <span>characters</span>
      </div>
      <dl className="char-count-details">
        <div className="char-count-detail">
          <dt>Without spaces</dt>
          <dd className="tabular-nums">{counts.charactersNoSpaces.toLocaleString()}</dd>
        </div>
        <div className="char-count-detail">
          <dt>Words</dt>
          <dd className="tabular-nums">{counts.words.toLocaleString()}</dd>
        </div>
        <div className="char-count-detail">
          <dt>Lines</dt>
          <dd className="tabular-nums">{counts.lines.toLocaleString()}</dd>
        </div>
        <div className="char-count-detail">
          <dt>UTF-8 bytes</dt>
          <dd className="tabular-nums">{counts.bytes.toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function CharCounterPage() {
  const [text, setText] = useState(() => readStoredValue(TEXT_KEY));
  const [mode, setMode] = useState<"summary" | "rows">(() => (readStoredValue(MODE_KEY) === "rows" ? "rows" : "summary"));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const trackedCount = useRef(false);
  const counts = useMemo(() => getTextCounts(text), [text]);
  const rows = useMemo(() => (mode === "rows" ? getLineCounts(text) : []), [mode, text]);

  useEffect(() => {
    inputRef.current?.focus();
    try {
      UsageTracker.trackEvent("char-counter", "mount");
    } catch {
      // Analytics must not interrupt the tool.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => writeStoredValue(TEXT_KEY, text), 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  const flushDraft = useEffectEvent(() => writeStoredValue(TEXT_KEY, text));
  useEffect(() => () => flushDraft(), []);

  useEffect(() => {
    if (!text || trackedCount.current) return;
    trackedCount.current = true;
    try {
      UsageTracker.trackToolUse("char-counter", "count", cleanAnalyticsMeta({ characters: counts.characters, words: counts.words }));
    } catch {
      // Analytics must not interrupt counting.
    }
  }, [counts.characters, counts.words, text]);

  function changeMode(nextMode: "summary" | "rows") {
    if (nextMode === mode) {
      inputRef.current?.focus();
      return;
    }
    setMode(nextMode);
    writeStoredValue(MODE_KEY, nextMode);
    try {
      UsageTracker.trackEvent("char-counter", "mode_changed", { mode: nextMode });
    } catch {
      // Analytics must not interrupt the tool.
    }
    inputRef.current?.focus();
  }

  async function pasteText() {
    try {
      const pasted = await navigator.clipboard.readText();
      if (!pasted) {
        toast.add({ title: "Clipboard is empty", type: "error" });
        return;
      }
      setText(pasted);
      writeStoredValue(TEXT_KEY, pasted);
      inputRef.current?.focus();
      toast.add({ title: "Pasted from clipboard", type: "success" });
    } catch (error) {
      console.error("Paste error:", error);
      toast.add({ title: "Failed to paste from clipboard", type: "error" });
    }
  }

  async function copyText() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ title: "Copied to clipboard!", type: "success" });
      try {
        UsageTracker.trackEvent("char-counter", "copy");
      } catch {
        // Analytics must not interrupt copying.
      }
    } catch (error) {
      console.error("Copy error:", error);
      toast.add({ title: "Failed to copy to clipboard", type: "error" });
    }
    inputRef.current?.focus();
  }

  const hasText = text.length > 0;

  return (
    <div className="char-counter-react w-full">
      <section
        className={`char-counter-workspace ${mode === "rows" ? "is-row-mode" : ""} ${hasText ? "has-text" : ""}`}
        aria-labelledby="char-counter-heading"
      >
        <header className="char-counter-toolbar">
          <div className="char-counter-toolbar-copy">
            <h1 id="char-counter-heading">Text</h1>
            <p>Type or paste text to see its counts instantly.</p>
          </div>
          <div className="char-counter-toolbar-controls">
            <ToggleGroup
              value={[mode]}
              onValueChange={(values) => {
                const nextMode = values[0];
                if (nextMode === "summary" || nextMode === "rows") changeMode(nextMode);
              }}
              aria-label="Counting mode"
              spacing={0}
              className="char-counter-modes h-auto rounded-md border bg-background p-0.5"
            >
              <ToggleGroupItem value="summary" className="flex-none">
                Summary
              </ToggleGroupItem>
              <ToggleGroupItem value="rows" className="flex-none">
                Per row
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="char-counter-actions">
              <Button variant="outline" onClick={() => void pasteText()}>
                Paste
              </Button>
              <Button variant="outline" disabled={!hasText} onClick={() => void copyText()}>
                Copy
              </Button>
              <Button
                variant="ghost"
                disabled={!hasText}
                onClick={() => {
                  setText("");
                  writeStoredValue(TEXT_KEY, "");
                  inputRef.current?.focus();
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        </header>

        <div className="char-counter-editor-layout">
          <Field className="char-counter-input-field min-h-0 min-w-0 gap-0">
            <FieldLabel className="sr-only" htmlFor="char-counter-input">
              Text to count
            </FieldLabel>
            <Textarea
              id="char-counter-input"
              ref={inputRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste or type text here to see live counts."
              className="char-counter-input font-mono text-sm"
            />
          </Field>
          {mode === "rows" && (
            <aside className="char-counter-row-panel" aria-labelledby="char-counter-rows-title">
              <div className="char-counter-row-header">
                <div>
                  <h2 id="char-counter-rows-title">Length per row</h2>
                  <p>
                    {rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"}
                  </p>
                </div>
                <span>Characters</span>
              </div>
              <div className="char-counter-rows">
                {rows.length === 0 ? (
                  <Empty className="char-counter-empty-rows text-left">
                    <EmptyHeader className="items-start">
                      <EmptyDescription className="text-left">Enter one value per row to compare character lengths.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <ol>
                    {rows.map((row) => (
                      <li key={row.line}>
                        <span className="char-counter-row-number">{row.line.toLocaleString()}</span>
                        <code className={row.content ? "" : "is-empty"}>{row.content || "Empty row"}</code>
                        <strong className="tabular-nums">{row.characters.toLocaleString()}</strong>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </aside>
          )}
        </div>
        <CountSummary counts={counts} />
      </section>
    </div>
  );
}
