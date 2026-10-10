import React, { useEffect, useState } from "react";
import { UsageTracker } from "../core/UsageTracker.js";
import { cleanAnalyticsMeta } from "../core/AnalyticsMeta.js";
import "../tools/uuid-generator/styles.css";

function track(event, meta = {}) {
  try {
    UsageTracker.trackEvent("uuid-generator", event, cleanAnalyticsMeta(meta));
  } catch (_) {}
}

export function UUIDGenerator() {
  const [single, setSingle] = useState(() => crypto.randomUUID());
  const [quantity, setQuantity] = useState("");
  const [multiple, setMultiple] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    track("mount");
    track("single_generate");
  }, []);

  function generateSingle() {
    setSingle(crypto.randomUUID());
    track("single_generate");
  }

  async function copy(value, type) {
    if (!value) return;
    const count = type === "single" ? 1 : value.split("\n").length;
    track("copy_action", { type, count });
    try {
      await navigator.clipboard.writeText(value);
      UsageTracker.trackToolUse("uuid-generator", type);
      setMessage("Copied to clipboard!");
    } catch (_) {
      setMessage("Failed to copy to clipboard");
    }
  }

  async function generateMultiple() {
    const count = Math.max(1, Math.min(parseInt(quantity, 10) || 1, 10000));
    const value = Array.from({ length: count }, () => crypto.randomUUID()).join("\n");
    setMultiple(value);
    track("bulk_generate", { quantity: count });
    await copy(value, "multiple");
  }

  return (
    <div className="tool-container uuid-generator">
      <section className="uuid-section">
        <h2>Single UUID</h2>
        <div className="uuid-display">
          <input className="uuid-input" aria-label="Single UUID" readOnly value={single} />
        </div>
        <div className="uuid-buttons">
          <button className="btn btn-primary" onClick={generateSingle}>
            Generate
          </button>
          <button className="btn btn-primary" onClick={() => copy(single, "single")}>
            Copy
          </button>
        </div>
      </section>
      <section className="uuid-section">
        <h2>Multiple UUIDs</h2>
        <div className="uuid-buttons">
          <input
            className="quantity-input"
            aria-label="How many UUIDs"
            type="number"
            min="1"
            max="10000"
            placeholder="How many? Max 10.000"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <button className="btn btn-primary" onClick={generateMultiple}>
            Generate
          </button>
          <button className="btn btn-primary" disabled={!multiple} onClick={() => copy(multiple, "multiple")}>
            Copy
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setMultiple("");
              setQuantity("");
            }}
          >
            Clear
          </button>
        </div>
        <div className="multiple-output">
          <textarea className="uuid-textarea" aria-label="Multiple UUIDs" readOnly value={multiple} />
        </div>
      </section>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
