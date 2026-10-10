import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
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
    const count = Math.min(parseInt(quantity, 10) || 1, 10000);
    const values = Array.from({ length: Math.max(0, count) }, () => crypto.randomUUID()).join("\n");
    setMultiple(values);
    track("bulk_generate", { quantity: count });
    await copy(values, "multiple");
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Single UUID</CardTitle>
          <CardDescription>Generate and copy a version 4 UUID.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="singleUuidResult">UUID</FieldLabel>
              <Input id="singleUuidResult" value={single} readOnly placeholder="Generated UUID will appear here" className="font-mono" />
            </Field>
          </FieldGroup>
          <div className="flex gap-2">
            <Button onClick={generateSingle}>Generate</Button>
            <Button variant="outline" disabled={!single} onClick={() => void copy(single, "single")}>
              Copy
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Multiple UUIDs</CardTitle>
          <CardDescription>Generate up to 10,000 UUIDs and copy them automatically.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="uuidQuantity">Quantity</FieldLabel>
              <Input
                id="uuidQuantity"
                type="number"
                min="1"
                max="10000"
                placeholder="How many? Max 10,000"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="multipleUuidResult">Generated UUIDs</FieldLabel>
              <Textarea
                id="multipleUuidResult"
                value={multiple}
                readOnly
                placeholder="Generated UUIDs will appear here"
                className="min-h-32 font-mono"
              />
            </Field>
          </FieldGroup>
          <div className="flex gap-2">
            <Button onClick={() => void generateMultiple()}>Generate</Button>
            <Button variant="outline" disabled={!multiple} onClick={() => void copy(multiple, "multiple")}>
              Copy
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setMultiple("");
                setQuantity("");
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
