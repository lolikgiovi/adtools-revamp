import React, { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useTool } from "@/hooks/useTool.jsx";
import { QRToolsService } from "./service.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

export default function QRTools() {
  const { showSuccess, showError } = useTool("qr-tools");
  const service = useRef(new QRToolsService()).current;
  const canvasRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const [mode, setMode] = useState("text");
  const [content, setContent] = useState("");
  const [size, setSize] = useState(256);
  const [margin, setMargin] = useState(2);
  const [foreground, setForeground] = useState("#000000");
  const [background, setBackground] = useState("#FFFFFF");
  const [isValid, setIsValid] = useState(false);
  const [urlWarning, setUrlWarning] = useState("");
  const [contrastWarning, setContrastWarning] = useState("");

  // Track mount
  useEffect(() => {
    try {
      UsageTracker.trackFeature("qr-tools", "mount", "", 5000);
    } catch (_) {}
  }, []);

  // Update preview with debounce
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      updatePreview();
    }, 200);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [content, mode, size, margin, foreground, background]);

  const updatePreview = async () => {
    const trimmedContent = (content || "").trim();
    let valid = trimmedContent.length > 0;

    // URL validation
    if (mode === "url") {
      const urlValid = service.isValidUrl(trimmedContent);
      valid = valid && urlValid;
      setUrlWarning(
        urlValid ? "" : "Warning: This URL may be invalid. Ensure it includes a protocol or a valid domain."
      );
    } else {
      setUrlWarning("");
    }

    setIsValid(valid);

    // Contrast check
    const ratio = service.getContrastRatio(foreground, background);
    if (ratio < 3.0) {
      setContrastWarning(
        `Low contrast detected (~${ratio.toFixed(2)}:1). Darken foreground or lighten background for better scanability.`
      );
    } else {
      setContrastWarning("");
    }

    // Render canvas
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = size;
    canvas.height = size;

    if (!valid) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    try {
      await service.renderCanvas(canvas, trimmedContent, {
        size,
        margin,
        foreground,
        background,
      });
    } catch (err) {
      showError("Failed to render QR code.");
    }
  };

  const handleDownloadPng = () => {
    try {
      UsageTracker.trackEvent("qr-tools", "download_png", { size, margin, mode });
    } catch (_) {}

    const canvas = canvasRef.current;
    if (!canvas || !isValid) return;

    const link = document.createElement("a");
    link.download = "qr-code.png";

    try {
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          link.href = url;
          link.click();
          URL.revokeObjectURL(url);
          showSuccess("PNG downloaded");
        });
      } else {
        link.href = canvas.toDataURL("image/png");
        link.click();
        showSuccess("PNG downloaded");
      }
    } catch (e) {
      showError("Failed to download PNG");
      console.error(e);
    }
  };

  const handleDownloadSvg = async () => {
    try {
      UsageTracker.trackEvent("qr-tools", "download_svg", { size, margin, mode });
    } catch (_) {}

    const trimmedContent = (content || "").trim();
    if (!trimmedContent || !isValid) return;

    try {
      const svgString = await service.generateSvgString(trimmedContent, {
        size,
        margin,
        foreground,
        background,
      });
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "qr-code.svg";
      link.click();
      URL.revokeObjectURL(url);
      showSuccess("SVG downloaded");
    } catch (e) {
      showError("Failed to download SVG");
      console.error(e);
    }
  };

  const handleReset = () => {
    setMode("text");
    setContent("");
    setSize(256);
    setMargin(2);
    setForeground("#000000");
    setBackground("#FFFFFF");
    setIsValid(false);
    setUrlWarning("");
    setContrastWarning("");
  };

  return (
    <div className="tool-container qr-tools p-6">
      <div className="qr-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Configuration Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mode Selector */}
            <div>
              <Label htmlFor="qrMode">Content Type</Label>
              <select
                id="qrMode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full mt-1 p-2 border rounded-md"
              >
                <option value="text">Text</option>
                <option value="url">URL</option>
              </select>
            </div>

            {/* Content Input */}
            <div>
              <Label htmlFor="qrContent">
                {mode === "url" ? "URL" : "Text Content"}
              </Label>
              <Textarea
                id="qrContent"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={mode === "url" ? "https://example.com" : "Enter text to encode..."}
                rows={4}
                className="mt-1"
              />
              {urlWarning && (
                <p className="text-sm text-yellow-600 mt-1">{urlWarning}</p>
              )}
            </div>

            {/* Size and Margin */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="qrSize">Size (px)</Label>
                <Input
                  id="qrSize"
                  type="number"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  min="128"
                  max="1024"
                  step="32"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="qrMargin">Margin</Label>
                <Input
                  id="qrMargin"
                  type="number"
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                  min="0"
                  max="10"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="qrColorForeground">Foreground Color</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="qrColorForeground"
                    type="color"
                    value={foreground}
                    onChange={(e) => setForeground(e.target.value)}
                    className="w-16 h-10"
                  />
                  <Input
                    type="text"
                    value={foreground}
                    onChange={(e) => setForeground(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="qrColorBackground">Background Color</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="qrColorBackground"
                    type="color"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="w-16 h-10"
                  />
                  <Input
                    type="text"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            {contrastWarning && (
              <p className="text-sm text-yellow-600">{contrastWarning}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={handleDownloadPng} disabled={!isValid}>
                Download PNG
              </Button>
              <Button onClick={handleDownloadSvg} disabled={!isValid} variant="outline">
                Download SVG
              </Button>
              <Button onClick={handleReset} variant="outline">
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <canvas
              ref={canvasRef}
              id="qrCanvas"
              className="border rounded-md"
              style={{ maxWidth: "100%", height: "auto" }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
