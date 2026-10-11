import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import "./UUIDGeneratorPage.css";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { cleanAnalyticsMeta } from "../../../core/AnalyticsMeta.js";

const TOOL_ID = "uuid-generator";

function track(event: string, meta: Record<string, string | number> = {}) {
  try {
    UsageTracker.trackEvent(TOOL_ID, event, cleanAnalyticsMeta(meta));
  } catch {
    // Analytics must not block UUID generation.
  }
}

export default function UUIDGeneratorPage() {
  const [single, setSingle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [multiple, setMultiple] = useState("");
  const quantityValid = quantity === "" || (Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 10000);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setSingle(crypto.randomUUID());
    track("single_generate");
    track("mount");
  }, []);

  async function copy(value: string, type: "single" | "multiple") {
    if (!value) return;
    track("copy_action", { type, count: type === "single" ? 1 : value.split("\n").length });
    try {
      await navigator.clipboard.writeText(value);
      toast.add({ title: "Copied to clipboard!", type: "success" });
    } catch (error) {
      toast.add({ title: "Failed to copy to clipboard", type: "error" });
      console.error("Clipboard error:", error);
      return;
    }
    try {
      UsageTracker.trackToolUse(TOOL_ID, type);
    } catch (error) {
      console.warn("Usage tracking failed:", error);
    }
  }

  function generateSingle() {
    setSingle(crypto.randomUUID());
    track("single_generate");
  }

  async function generateMultiple() {
    if (!quantityValid) return;
    const count = Number(quantity || 1);
    const values = Array.from({ length: Math.max(0, count) }, () => crypto.randomUUID()).join("\n");
    setMultiple(values);
    track("bulk_generate", { quantity: count });
    await copy(values, "multiple");
  }

  return (
    <div className="uuid-workspace">
      <Card className="uuid-section">
        <CardHeader>
          <CardTitle>Single UUID</CardTitle>
          <CardDescription className="sr-only">Generate and copy a version 4 UUID.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FieldGroup>
            <Field>
              <FieldLabel className="sr-only" htmlFor="singleUuidResult">
                UUID
              </FieldLabel>
              <Input id="singleUuidResult" value={single} readOnly placeholder="Generated UUID will appear here" className="font-mono" />
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button onClick={generateSingle}>Generate</Button>
            <Button variant="outline" disabled={!single} onClick={() => void copy(single, "single")}>
              Copy
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="uuid-section">
        <CardHeader>
          <CardTitle>Multiple UUIDs</CardTitle>
          <CardDescription className="sr-only">Generate up to 10,000 UUIDs and copy them automatically.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FieldGroup>
            <div className="uuid-bulk-toolbar">
              {" "}
              <Field data-invalid={!quantityValid}>
                <FieldLabel className="sr-only" htmlFor="uuidQuantity">
                  Quantity
                </FieldLabel>
                <Input
                  id="uuidQuantity"
                  type="number"
                  min="1"
                  max="10000"
                  placeholder="1 by default, up to 10,000"
                  value={quantity}
                  step="1"
                  aria-invalid={!quantityValid}
                  aria-describedby={!quantityValid ? "uuid-quantity-error" : undefined}
                  onChange={(event) => setQuantity(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void generateMultiple();
                  }}
                />
                {!quantityValid && <FieldError id="uuid-quantity-error">Enter a whole number from 1 to 10,000.</FieldError>}
              </Field>{" "}
              <div className="flex flex-wrap gap-2">
                <Button disabled={!quantityValid} onClick={() => void generateMultiple()}>
                  Generate
                </Button>
                <Button variant="outline" disabled={!multiple} onClick={() => void copy(multiple, "multiple")}>
                  Copy
                </Button>
                <Button
                  variant="outline"
                  disabled={!multiple && !quantity}
                  onClick={() => {
                    setMultiple("");
                    setQuantity("");
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
            <Field>
              <FieldLabel className="sr-only" htmlFor="multipleUuidResult">
                Generated UUIDs
              </FieldLabel>
              <Textarea
                id="multipleUuidResult"
                value={multiple}
                readOnly
                placeholder="Generated UUIDs will appear here"
                rows={6}
                className="field-sizing-fixed resize-y font-mono"
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}
