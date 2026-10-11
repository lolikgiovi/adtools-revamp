import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { QRToolsService } from "../../../tools/qr-tools/service.js";
import "./QRToolsPage.css";

const service = new QRToolsService();
const URL_WARNING = "Warning: This URL may be invalid. Ensure it includes a protocol or a valid domain.";
const contentTypeOptions = [
  { label: "Text", value: "text" },
  { label: "URL", value: "url" },
] as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function QRToolsPage() {
  const [mode, setMode] = useState<"text" | "url">("text");
  const [content, setContent] = useState("");
  const [margin, setMargin] = useState(2);
  const [foreground, setForeground] = useState("#000000");
  const [background, setBackground] = useState("#FFFFFF");
  const [isRendering, setIsRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef(0);

  const trimmedContent = content.trim();
  const urlValid = mode !== "url" || service.isValidUrl(trimmedContent);
  const isValid = trimmedContent.length > 0 && urlValid;
  const contrastRatio = service.getContrastRatio(foreground, background);

  useEffect(() => {
    try {
      UsageTracker.trackFeature("qr-tools", "mount", "", 5000);
    } catch {
      // Analytics must not interrupt the tool.
    }
  }, []);

  useEffect(() => {
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      if (!isValid) {
        setIsRendering(false);
        return;
      }

      setIsRendering(true);
      try {
        UsageTracker.trackEvent(
          "qr-tools",
          "qr_preview",
          {
            mode,
            content_length: trimmedContent.length,
            size: 256,
          },
          2000,
        );
        const nextCanvas = document.createElement("canvas");
        await service.renderCanvas(nextCanvas, trimmedContent, {
          size: 256,
          margin,
          foreground,
          background,
        });
        if (requestRef.current !== requestId || !canvasRef.current) return;
        canvas.width = nextCanvas.width;
        canvas.height = nextCanvas.height;
        canvas.getContext("2d")?.drawImage(nextCanvas, 0, 0);
      } catch (error) {
        if (requestRef.current === requestId) {
          console.error("QR render error:", error);
          toast.add({ title: "Failed to render QR code.", type: "error" });
        }
      } finally {
        if (requestRef.current === requestId) setIsRendering(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timer);
      if (requestRef.current === requestId) requestRef.current += 1;
    };
  }, [background, foreground, isValid, margin, mode, trimmedContent]);

  useEffect(() => {
    if (contrastRatio >= 3) return;
    try {
      UsageTracker.trackEvent(
        "qr-tools",
        "low_contrast_warning",
        {
          ratio: Number(contrastRatio.toFixed(2)),
          foreground,
          background,
        },
        5000,
      );
    } catch {
      // Analytics must not interrupt the warning.
    }
  }, [background, contrastRatio, foreground]);

  async function downloadPng() {
    if (!canvasRef.current || !isValid || isRendering) return;
    try {
      UsageTracker.trackEvent("qr-tools", "download_png", { size: 256, margin, mode });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const blob = canvas.toBlob
        ? await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("PNG conversion failed"))), "image/png");
          })
        : await (await fetch(canvas.toDataURL("image/png"))).blob();
      downloadBlob(blob, "qr-code.png");
      toast.add({ title: "PNG downloaded", type: "success" });
      UsageTracker.trackToolUse("qr-tools", "download_png", { size: 256, mode });
    } catch (error) {
      console.error(error);
      toast.add({ title: "Failed to download PNG", type: "error" });
    }
  }

  async function downloadSvg() {
    if (!isValid || isRendering) return;
    try {
      UsageTracker.trackEvent("qr-tools", "download_svg", { size: 256, margin, mode });
      const svg = await service.generateSvgString(trimmedContent, { size: 256, margin, foreground, background });
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "qr-code.svg");
      toast.add({ title: "SVG downloaded", type: "success" });
      UsageTracker.trackToolUse("qr-tools", "download_svg", { size: 256, mode });
    } catch (error) {
      console.error(error);
      toast.add({ title: "Failed to download SVG", type: "error" });
    }
  }

  function reset() {
    setMode("text");
    setContent("");
    setMargin(16);
    setForeground("#000000");
    setBackground("#FFFFFF");
  }

  return (
    <div className="qr-tools-react qr-tools-layout">
      <section className="qr-tools-left">
        <FieldGroup className="qr-form-fields">
          <Field>
            <FieldLabel htmlFor="qr-mode">Content Type</FieldLabel>
            <Select items={contentTypeOptions} value={mode} onValueChange={(value) => value && setMode(value as "text" | "url")}>
              <SelectTrigger id="qr-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="url">URL</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field data-invalid={mode === "url" && Boolean(trimmedContent) && !urlValid}>
            <FieldLabel htmlFor="qr-content">Content</FieldLabel>
            <Textarea
              id="qr-content"
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Enter URL or text"
              className="resize-y"
              aria-invalid={mode === "url" && Boolean(trimmedContent) && !urlValid}
            />
            {mode === "url" && trimmedContent && !urlValid && <FieldError className="text-sm">{URL_WARNING}</FieldError>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="qr-foreground">Foreground</FieldLabel>
              <Input
                id="qr-foreground"
                type="color"
                value={foreground}
                onChange={(event) => setForeground(event.target.value.toUpperCase())}
                className="h-8 w-full cursor-pointer p-1"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="qr-background">Background</FieldLabel>
              <Input
                id="qr-background"
                type="color"
                value={background}
                onChange={(event) => setBackground(event.target.value.toUpperCase())}
                className="h-8 w-full cursor-pointer p-1"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button disabled={!isValid || isRendering} onClick={() => void downloadPng()}>
              Download PNG
            </Button>
            <Button variant="outline" disabled={!isValid || isRendering} onClick={() => void downloadSvg()}>
              Download SVG
            </Button>
            <Button variant="ghost" onClick={reset}>
              Reset
            </Button>
          </div>
        </FieldGroup>
      </section>
      <section className="qr-tools-right">
        <header className="qr-preview-header">
          <h2 className="qr-preview-title">Preview</h2>
        </header>
        <div className="qr-preview-area">
          <canvas
            ref={canvasRef}
            aria-label={isValid ? "Generated QR code preview" : "QR code preview is empty"}
            className="block aspect-square w-full max-w-[288px] image-rendering-pixelated"
          />
        </div>
        {contrastRatio < 3 && (
          <Alert variant="destructive" className="qr-low-contrast" role="status">
            <AlertDescription className="text-sm font-medium">
              Low contrast detected (~{contrastRatio.toFixed(2)}:1). Darken foreground or lighten background for better scanability.
            </AlertDescription>
          </Alert>
        )}
      </section>
    </div>
  );
}
