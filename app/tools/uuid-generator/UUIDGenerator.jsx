import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useTool } from "@/hooks/useTool.jsx";
import { UsageTracker } from "../../core/UsageTracker.js";

export default function UUIDGenerator() {
  const { copyToClipboard } = useTool("uuid-generator");

  // Single UUID state
  const [singleUuid, setSingleUuid] = useState("");

  // Multiple UUIDs state
  const [quantity, setQuantity] = useState("");
  const [multipleUuids, setMultipleUuids] = useState("");

  // Generate single UUID on mount
  useEffect(() => {
    generateSingleUUID();
  }, []);

  const generateSingleUUID = () => {
    const uuid = crypto.randomUUID();
    setSingleUuid(uuid);
  };

  const copySingleUUID = async () => {
    if (singleUuid) {
      UsageTracker.trackFeature("uuid-generator", "single");
      await copyToClipboard(singleUuid);
    }
  };

  const generateMultipleUUIDs = () => {
    const count = parseInt(quantity) || 1;
    const uuids = [];

    for (let i = 0; i < Math.min(count, 10000); i++) {
      uuids.push(crypto.randomUUID());
    }

    setMultipleUuids(uuids.join("\n"));
  };

  const copyMultipleUUIDs = async () => {
    if (multipleUuids) {
      UsageTracker.trackFeature("uuid-generator", "multiple");
      await copyToClipboard(multipleUuids);
    }
  };

  const clearMultipleUUIDs = () => {
    setQuantity("");
    setMultipleUuids("");
  };

  return (
    <div className="tool-container uuid-generator p-6 space-y-6">
      {/* Single UUID Section */}
      <Card>
        <CardHeader>
          <CardTitle>Single UUID</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="text"
            value={singleUuid}
            readOnly
            placeholder="Generated UUID will appear here"
            className="font-mono"
          />
          <div className="flex gap-2">
            <Button onClick={generateSingleUUID}>
              Generate
            </Button>
            <Button
              onClick={copySingleUUID}
              disabled={!singleUuid}
              variant="secondary"
            >
              Copy
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Multiple UUIDs Section */}
      <Card>
        <CardHeader>
          <CardTitle>Multiple UUIDs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="How many?"
              min="1"
              max="10000"
              className="max-w-[200px]"
            />
            <Button onClick={generateMultipleUUIDs}>
              Generate
            </Button>
            <Button
              onClick={copyMultipleUUIDs}
              disabled={!multipleUuids}
              variant="secondary"
            >
              Copy
            </Button>
            <Button
              onClick={clearMultipleUUIDs}
              variant="outline"
            >
              Clear
            </Button>
          </div>
          <Textarea
            value={multipleUuids}
            readOnly
            placeholder="Generated UUIDs will appear here"
            className="min-h-[300px] font-mono text-sm"
          />
        </CardContent>
      </Card>
    </div>
  );
}
