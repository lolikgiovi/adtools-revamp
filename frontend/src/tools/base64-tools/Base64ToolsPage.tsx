import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cleanAnalyticsMeta, summarizeFiles, summarizeText } from "../../../core/AnalyticsMeta.js";
import { isTauri } from "../../../core/Runtime.js";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { Base64ToolsConstants } from "../../../tools/base64-tools/constants.js";
import "./Base64ToolsPage.css";
import { Base64ToolsService } from "../../../tools/base64-tools/service.js";

type Mode = "encode" | "decode";
type SelectedFile = { id: string; file: File; mode: Mode };
type OutputFile = {
  originalName: string;
  name: string;
  type: string;
  size: number;
  kind: "text" | "image" | "binary";
  text?: string;
  bytes?: Uint8Array;
  width?: number;
  height?: number;
};
type ModeSession = { input: string; output: string; files: OutputFile[]; showFiles: boolean };

const ENCODE_KEY = "tool:base64-tools:encode-input";
const DECODE_KEY = "tool:base64-tools:decode-input";
const inputModeSession = { current: "encode" as Mode };
const selectedFileSession: SelectedFile[] = [];
const modeSession: Record<Mode, ModeSession> = {
  encode: { input: readStored(ENCODE_KEY), output: "", files: [], showFiles: false },
  decode: { input: readStored(DECODE_KEY), output: "", files: [], showFiles: false },
};
const activeDownloads = new Map<Mode, Promise<void>>();
let zipLoader: Promise<typeof import("jszip")> | null = null;
let decodeUnmountCleanupTimer: number | null = null;

function asError(error: unknown) {
  return error instanceof Error ? error : String(error);
}

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The text workflow remains available when storage is disabled.
  }
}

function loadZip() {
  if (!zipLoader) {
    zipLoader = import("jszip")
      .then((module) => {
        const loaded = module as unknown as { default?: typeof import("jszip") };
        return loaded.default ?? (module as unknown as typeof import("jszip"));
      })
      .catch((error) => {
        zipLoader = null;
        throw error;
      });
  }
  return zipLoader;
}

function makeId(mode: Mode) {
  return `${mode}-${crypto.randomUUID()}-${Date.now()}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toByteArray(bytes: Uint8Array) {
  return bytes.slice().buffer as ArrayBuffer;
}

function toBytes(binary: string) {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function baseName(name: string) {
  return name.split(".")[0] || name;
}

function getDateLabel() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getNativeMimeType(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeTypes: Record<string, string> = {
    txt: "text/plain",
    base64: "text/plain",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    json: "application/json",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    xml: "application/xml",
    zip: "application/zip",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

function FileThumbnail({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const image = imageRef.current;
    if (!image) return;
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    return () => {
      image.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  return file.type.startsWith("image/") ? (
    <img ref={imageRef} alt={`Preview of ${file.name}`} className="h-16 w-16 rounded-md border object-contain" />
  ) : null;
}

function OutputPreview({ file, onClose }: { file: OutputFile; onClose: () => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    const frame = frameRef.current;
    const objectUrl = file.bytes ? URL.createObjectURL(new Blob([toByteArray(file.bytes)], { type: file.type })) : null;
    if (objectUrl && image) image.src = objectUrl;
    if (objectUrl && frame) frame.src = objectUrl;
    return () => {
      image?.removeAttribute("src");
      frame?.removeAttribute("src");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90vh] max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-lg border bg-background p-0 text-foreground shadow-xl sm:max-w-4xl"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-4 py-3 text-left">
          <div className="min-w-0">
            <DialogTitle className="truncate font-medium">{file.name}</DialogTitle>
            <DialogDescription className="text-sm">
              {Base64ToolsService.formatFileSize(file.size)} · {Base64ToolsConstants.getFileTypeLabel(file.type)}
            </DialogDescription>
          </div>
          <DialogClose render={<Button variant="outline" size="sm" />}>Close</DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {file.kind === "image" && file.bytes ? (
            <img ref={imageRef} alt={file.name} className="mx-auto max-h-[70vh] max-w-full object-contain" />
          ) : null}
          {file.type === "application/pdf" && file.bytes ? (
            <iframe ref={frameRef} title={file.name} className="h-[70vh] w-full rounded border" />
          ) : null}
          {file.kind === "text" ? <pre className="whitespace-pre-wrap break-words font-mono text-sm">{file.text}</pre> : null}
          {file.kind === "binary" && file.type !== "application/pdf" && (
            <p className="text-sm text-muted-foreground">Preview is not available for this file type.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Base64ToolsPage() {
  const [mode, setMode] = useState<Mode>(() => inputModeSession.current);
  const [encodeInput, setEncodeInput] = useState(() => modeSession.encode.input);
  const [decodeInput, setDecodeInput] = useState(() => modeSession.decode.input);
  const [encodeOutput, setEncodeOutput] = useState(() => modeSession.encode.output);
  const [decodeOutput, setDecodeOutput] = useState(() => modeSession.decode.output);
  const [encodeFiles, setEncodeFiles] = useState<OutputFile[]>(() => modeSession.encode.files);
  const [decodeFiles, setDecodeFiles] = useState<OutputFile[]>(() => modeSession.decode.files);
  const [showEncodeFiles, setShowEncodeFiles] = useState(() => modeSession.encode.showFiles);
  const [showDecodeFiles, setShowDecodeFiles] = useState(() => modeSession.decode.showFiles);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>(() => selectedFileSession);
  const [preview, setPreview] = useState<OutputFile | null>(null);
  const [busy, setBusy] = useState(false);
  const encodeFileInput = useRef<HTMLInputElement>(null);
  const decodeFileInput = useRef<HTMLInputElement>(null);

  const inputs: Record<Mode, string> = { encode: encodeInput, decode: decodeInput };
  const outputs: Record<Mode, string> = { encode: encodeOutput, decode: decodeOutput };
  const outputFiles: Record<Mode, OutputFile[]> = { encode: encodeFiles, decode: decodeFiles };
  const visibleOutputFiles: Record<Mode, boolean> = { encode: showEncodeFiles, decode: showDecodeFiles };
  const modeFiles = selectedFiles.filter((entry) => entry.mode === mode);
  const currentFiles = outputFiles[mode];
  const currentOutput = outputs[mode];
  const showFiles = visibleOutputFiles[mode];
  const isBinarySingleOutput =
    mode === "decode" &&
    showDecodeFiles &&
    selectedFiles.filter((entry) => entry.mode === "decode").length === 0 &&
    decodeFiles.length === 1 &&
    decodeFiles[0].kind !== "text";
  const isMultiOutput = showFiles && !isBinarySingleOutput;

  useEffect(() => {
    inputModeSession.current = mode;
    modeSession.encode.input = encodeInput;
    modeSession.decode.input = decodeInput;
    modeSession.encode.output = encodeOutput;
    modeSession.decode.output = decodeOutput;
    modeSession.encode.files = encodeFiles;
    modeSession.decode.files = decodeFiles;
    modeSession.encode.showFiles = showEncodeFiles;
    modeSession.decode.showFiles = showDecodeFiles;
    selectedFileSession.splice(0, selectedFileSession.length, ...selectedFiles);
  }, [
    decodeFiles,
    decodeInput,
    decodeOutput,
    encodeFiles,
    encodeInput,
    encodeOutput,
    mode,
    selectedFiles,
    showDecodeFiles,
    showEncodeFiles,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => save(ENCODE_KEY, encodeInput), 250);
    return () => window.clearTimeout(timer);
  }, [encodeInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => save(DECODE_KEY, decodeInput), 250);
    return () => window.clearTimeout(timer);
  }, [decodeInput]);

  useEffect(() => {
    if (decodeUnmountCleanupTimer !== null) window.clearTimeout(decodeUnmountCleanupTimer);
    return () => {
      decodeUnmountCleanupTimer = window.setTimeout(() => {
        modeSession.decode.output = "";
        modeSession.decode.files = [];
        modeSession.decode.showFiles = false;
      }, 0);
    };
  }, []);

  function trackAnalytics(event: string, meta: Record<string, unknown> = {}) {
    try {
      const cleanMeta = cleanAnalyticsMeta(meta);
      UsageTracker.trackEvent("base64-tools", event, cleanMeta);
      const producedOutput = !("output_file_count" in cleanMeta) || Number(cleanMeta.output_file_count) > 0;
      if (producedOutput && event === "encode_success") UsageTracker.trackToolUse("base64-tools", "encode", cleanMeta);
      if (producedOutput && event === "decode_success") UsageTracker.trackToolUse("base64-tools", "decode", cleanMeta);
    } catch {
      // Analytics must never interrupt file processing.
    }
  }

  function setInputForMode(target: Mode, value: string) {
    if (target === "encode") setEncodeInput(value);
    else setDecodeInput(value);
  }

  function setOutputForMode(target: Mode, value: string) {
    if (target === "encode") setEncodeOutput(value);
    else setDecodeOutput(value);
  }

  function setFilesForMode(target: Mode, files: OutputFile[], visible = true) {
    if (target === "encode") {
      setEncodeFiles(files);
      setShowEncodeFiles(visible);
    } else {
      setDecodeFiles(files);
      setShowDecodeFiles(visible);
    }
  }

  async function pasteInput(target: Mode) {
    try {
      const pasted = await navigator.clipboard.readText();
      setInputForMode(target, pasted);
    } catch (error) {
      console.error("Paste error:", error);
      toast.add({ title: "Failed to paste from clipboard", type: "error" });
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ title: "Copied to clipboard!", type: "success" });
    } catch (error) {
      console.error("Copy error:", error);
      toast.add({ title: "Failed to copy to clipboard", type: "error" });
    }
  }

  function addSelectedFiles(target: Mode, files: File[]) {
    const usableFiles = target === "decode" ? files.filter((file) => /\.(txt|base64)$/i.test(file.name)) : files;
    if (!usableFiles.length) {
      toast.add({ title: "Choose a .txt or .base64 file containing Base64 text", type: "error" });
      return;
    }
    const added = usableFiles.map((file) => ({ id: makeId(target), file, mode: target }));
    setSelectedFiles((current) => [...current, ...added]);
    trackAnalytics("file_upload", { mode: target, source: "web", ...summarizeFiles(usableFiles) });
  }

  async function chooseFiles(target: Mode) {
    if (!isTauri()) {
      (target === "encode" ? encodeFileInput.current : decodeFileInput.current)?.click();
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const options: { multiple: boolean; title: string; filters?: Array<{ name: string; extensions: string[] }> } = {
        multiple: true,
        title: target === "encode" ? "Select Files to Encode" : "Select Base64 Files to Decode",
      };
      if (target === "decode") options.filters = [{ name: "Base64 Files", extensions: ["txt", "base64"] }];
      const selection = await open(options);
      if (!selection || (Array.isArray(selection) && selection.length === 0)) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      const loaded: File[] = [];
      for (const path of paths) {
        try {
          const fileName = path.split(/[/\\]/).pop() || "file";
          const bytes = await readFile(path);
          const file = new File([toByteArray(bytes)], fileName, { type: getNativeMimeType(fileName), lastModified: Date.now() });
          loaded.push(file);
        } catch (error) {
          console.error(`Failed to read file ${path}:`, error);
        }
      }
      if (loaded.length) {
        setSelectedFiles((current) => [...current, ...loaded.map((file) => ({ id: makeId(target), file, mode: target }))]);
        trackAnalytics("file_upload", { mode: target, source: "tauri", file_count: paths.length });
        toast.add({ title: `Added ${paths.length} file(s)`, type: "success" });
      }
    } catch (error) {
      console.error(`Failed to upload ${target} files:`, error);
      toast.add({ title: `Failed to upload files: ${error instanceof Error ? error.message : "Unknown error"}`, type: "error" });
    }
  }

  async function encodeFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = Base64ToolsService.toBase64FromBytes(bytes);
    const mime = Base64ToolsService.getMimeTypeFromBase64(file, bytes);
    return `data:${mime};base64,${base64}`;
  }

  async function decodeBase64(value: string) {
    const inputValue = value.trim();
    if (!Base64ToolsService.isValidBase64(inputValue)) throw new Error("Invalid base64 format");
    const { base64 } = Base64ToolsService.normalizeDataUri(inputValue);
    return Base64ToolsService.decodeToBinaryString(base64);
  }

  async function getImageDimensions(bytes: Uint8Array, mime: string) {
    const url = URL.createObjectURL(new Blob([toByteArray(bytes)], { type: mime }));
    try {
      return await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("Unable to preview image"));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function binaryOutput(
    originalName: string,
    name: string,
    mime: string,
    bytes: Uint8Array,
    dimensions?: { width: number; height: number },
  ): OutputFile {
    return {
      originalName,
      name,
      type: mime,
      size: bytes.length,
      kind: mime.startsWith("image/") ? "image" : "binary",
      bytes,
      ...dimensions,
    };
  }

  async function decodeOutputFromBinary(originalName: string, binary: string): Promise<OutputFile> {
    const bytes = toBytes(binary);
    const mime = Base64ToolsService.detectContentType(bytes);
    if (Base64ToolsService.isTextContent(binary)) {
      return {
        originalName,
        name: `${baseName(originalName)}.txt`,
        type: "text/plain",
        size: new Blob([binary]).size,
        kind: "text",
        text: binary,
      };
    }
    const extension = mime.split("/")[1] || "bin";
    const fileName = `${baseName(originalName)}.${extension}`;
    const dimensions = mime.startsWith("image/") ? await getImageDimensions(bytes, mime) : undefined;
    return binaryOutput(originalName, fileName, mime, bytes, dimensions);
  }

  async function runEncode() {
    const files = selectedFiles.filter((entry) => entry.mode === "encode");
    if (files.length === 1) {
      try {
        const encoded = await encodeFile(files[0].file);
        setEncodeOutput(encoded);
        setFilesForMode("encode", [], false);
        toast.add({ title: "Encoded to Base64!", type: "success" });
        trackAnalytics("encode_success", {
          input_mode: "file",
          output_format: "data_uri",
          output_size: encoded.length,
          ...summarizeFiles([files[0].file]),
        });
      } catch (error) {
        UsageTracker.trackEvent("base64-tools", "encode_error", UsageTracker.enrichErrorMeta(asError(error), { type: "file" }));
        setEncodeOutput("");
        toast.add({ title: "Failed to encode file to Base64", type: "error" });
      }
      return;
    }
    if (files.length > 1) {
      setBusy(true);
      const output: OutputFile[] = [];
      let outputSize = 0;
      for (const entry of files) {
        try {
          const encoded = await encodeFile(entry.file);
          const name = `${baseName(entry.file.name)}.txt`;
          const size = new Blob([encoded]).size;
          output.push({ originalName: entry.file.name, name, type: "text/plain", size, kind: "text", text: encoded });
          outputSize += size;
        } catch (error) {
          console.error("Failed to process file:", entry.file.name, error);
          toast.add({ title: `Failed to process ${entry.file.name}`, type: "error" });
          UsageTracker.trackEvent(
            "base64-tools",
            "encode_error",
            UsageTracker.enrichErrorMeta(asError(error), { type: "multi_file", file: entry.file.name }),
          );
        }
      }
      setEncodeOutput("");
      setFilesForMode("encode", output, true);
      trackAnalytics("encode_success", {
        input_mode: "multi_file",
        output_file_count: output.length,
        output_size: outputSize,
        ...summarizeFiles(files.map((entry) => entry.file)),
      });
      setBusy(false);
      return;
    }
    try {
      const encoded = Base64ToolsService.encodeText(encodeInput);
      setEncodeOutput(encoded);
      setFilesForMode("encode", [], false);
      toast.add({ title: "Encoded to Base64!", type: "success" });
      trackAnalytics("encode_success", {
        input_mode: "text",
        output_format: "base64",
        output_size: encoded.length,
        ...summarizeText(encodeInput, "input"),
      });
    } catch (error) {
      setEncodeOutput("");
      toast.add({ title: "Failed to encode text to Base64", type: "error" });
      UsageTracker.trackEvent("base64-tools", "encode_error", UsageTracker.enrichErrorMeta(asError(error), { type: "text" }));
    }
  }

  async function runDecode() {
    const files = selectedFiles.filter((entry) => entry.mode === "decode");
    if (files.length) {
      setBusy(true);
      const output: OutputFile[] = [];
      for (const entry of files) {
        try {
          const inputText = await entry.file.text();
          if (!inputText.trim()) throw new Error("Empty file content");
          const binary = await decodeBase64(inputText);
          output.push(await decodeOutputFromBinary(entry.file.name, binary));
        } catch (error) {
          console.error("Failed to process file:", entry.file.name, error);
          UsageTracker.trackEvent(
            "base64-tools",
            "decode_error",
            UsageTracker.enrichErrorMeta(asError(error), { type: "multi_file", file: entry.file.name }),
          );
          toast.add({
            title: `Failed to process ${entry.file.name}: ${error instanceof Error ? error.message : "Invalid Base64"}`,
            type: "error",
          });
        }
      }
      setDecodeOutput("");
      setFilesForMode("decode", output, true);
      trackAnalytics("decode_success", {
        input_mode: "multi_file",
        output_file_count: output.length,
        output_size: output.reduce((sum, file) => sum + file.size, 0),
        ...summarizeFiles(files.map((entry) => entry.file)),
      });
      setBusy(false);
      return;
    }

    setFilesForMode("decode", [], false);
    if (!decodeInput.trim()) {
      setDecodeOutput("");
      return;
    }
    try {
      const binary = await decodeBase64(decodeInput);
      if (Base64ToolsService.isTextContent(binary)) {
        setDecodeOutput(binary);
        setFilesForMode("decode", [], false);
        trackAnalytics("decode_success", {
          input_mode: "text",
          output_kind: "text",
          output_size: binary.length,
          ...summarizeText(decodeInput, "input"),
        });
      } else {
        const bytes = toBytes(binary);
        const mime = Base64ToolsService.detectContentType(bytes);
        const extension = mime.split("/")[1] || "bin";
        const name = `decoded_base64.${extension}`;
        const dimensions = mime.startsWith("image/") ? await getImageDimensions(bytes, mime) : undefined;
        const file = binaryOutput("decoded_base64", name, mime, bytes, dimensions);
        setDecodeOutput("");
        setFilesForMode("decode", [file], true);
        trackAnalytics("decode_success", {
          input_mode: "text",
          output_kind: mime,
          output_size: bytes.length,
          ...summarizeText(decodeInput, "input"),
        });
      }
    } catch (error) {
      console.error("Base64 decode error:", error);
      UsageTracker.trackEvent("base64-tools", "decode_error", UsageTracker.enrichErrorMeta(asError(error), { type: "text" }));
      setDecodeOutput("");
      setFilesForMode("decode", [], false);
      toast.add({ title: "Invalid Base64 input", type: "error" });
    }
  }

  async function copyOutput(target: Mode) {
    const visibleFiles = target === "encode" ? showEncodeFiles : showDecodeFiles;
    const value = target === "encode" ? encodeOutput : decodeOutput;
    if (visibleFiles && target === "decode") {
      toast.add({ title: "Cannot copy binary content to clipboard", type: "error" });
      return;
    }
    if (!value) return;
    await copyText(value);
  }

  function removeSelectedFile(id: string) {
    setSelectedFiles((current) => current.filter((entry) => entry.id !== id));
  }

  function clearInput(target: Mode) {
    setInputForMode(target, "");
    save(target === "encode" ? ENCODE_KEY : DECODE_KEY, "");
    setSelectedFiles((current) => current.filter((entry) => entry.mode !== target));
    const inputRef = target === "encode" ? encodeFileInput : decodeFileInput;
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearOutput(target: Mode) {
    setOutputForMode(target, "");
    setFilesForMode(target, [], false);
    if (target === "decode") setPreview(null);
  }

  async function processZip(modeToDownload: Mode) {
    if (modeToDownload === "encode") {
      const inputs = selectedFiles.filter((entry) => entry.mode === "encode");
      if (!inputs.length) throw new Error("No files to download");
      const JSZip = await loadZip();
      const zip = new JSZip();
      for (const entry of inputs) {
        const encoded = await encodeFile(entry.file);
        zip.file(`${baseName(entry.file.name)}.txt`, encoded);
      }
      const blob = (await zip.generateAsync({ type: "blob" })) as Blob;
      downloadBlob(blob, `encoded_b64_${getDateLabel()}.zip`);
      UsageTracker.trackEvent("base64-tools", "download_result", {
        mode: "encode",
        format: "zip",
        file_count: inputs.length,
        output_size: blob.size,
      });
      toast.add({ title: "Downloaded all files as ZIP", type: "success" });
      return;
    }
    const inputs = selectedFiles.filter((entry) => entry.mode === "decode");
    if (!inputs.length && decodeFiles.length === 1) {
      const file = decodeFiles[0];
      downloadBlob(new Blob([file.bytes ? toByteArray(file.bytes) : file.text || ""], { type: file.type }), file.name);
      toast.add({ title: `Downloaded: ${file.name}`, type: "success" });
      return;
    }
    if (!inputs.length) throw new Error("No files to download");
    const JSZip = await loadZip();
    const zip = new JSZip();
    for (const entry of inputs) {
      const text = (await entry.file.text()).trim();
      if (!Base64ToolsService.isValidBase64(text)) continue;
      const { base64 } = Base64ToolsService.normalizeDataUri(text);
      const binary = Base64ToolsService.decodeToBinaryString(base64);
      const bytes = toBytes(binary);
      const mime = Base64ToolsService.detectContentType(bytes);
      if (Base64ToolsService.isTextContent(binary)) zip.file(`${baseName(entry.file.name)}.txt`, binary);
      else zip.file(`${baseName(entry.file.name)}.${mime.split("/")[1] || "bin"}`, bytes);
    }
    const blob = (await zip.generateAsync({ type: "blob" })) as Blob;
    downloadBlob(blob, `decoded_b64_${getDateLabel()}.zip`);
    UsageTracker.trackEvent("base64-tools", "download_result", {
      mode: "decode",
      format: "zip",
      file_count: inputs.length,
      output_size: blob.size,
    });
    toast.add({ title: "Downloaded all files as ZIP", type: "success" });
  }

  async function downloadResult(target: Mode) {
    const active = activeDownloads.get(target);
    if (active) return active;
    const task = (async () => {
      const fileCount = selectedFiles.filter((entry) => entry.mode === target).length;
      const filesVisible = target === "encode" ? showEncodeFiles : showDecodeFiles;
      const output = target === "encode" ? encodeOutput : decodeOutput;
      const binary = target === "decode" && filesVisible && decodeFiles.length === 1 && fileCount === 0;
      const zip = filesVisible && (fileCount > 1 || (target === "decode" && fileCount > 0));
      if (zip) {
        await processZip(target);
        return;
      }
      if (binary) {
        await processZip(target);
        return;
      }
      if (target === "encode") {
        if (!output.trim()) throw new Error("No encoded content to download");
        const blob = new Blob([output], { type: "text/plain" });
        downloadBlob(blob, "encoded.txt");
        trackAnalytics("download_result", { mode: target, format: "txt", output_size: blob.size });
        toast.add({ title: "Downloaded: encoded.txt", type: "success" });
        return;
      }
      if (!output.trim()) throw new Error("No decoded content to download");
      const blob = new Blob([output], { type: "text/plain" });
      downloadBlob(blob, "decoded.txt");
      trackAnalytics("download_result", { mode: target, format: "txt", output_size: blob.size });
      toast.add({ title: "Downloaded: decoded.txt", type: "success" });
    })();
    activeDownloads.set(target, task);
    try {
      await task;
    } catch (error) {
      console.error("Download failed:", error);
      toast.add({ title: error instanceof Error ? error.message : "Failed to download output", type: "error" });
    } finally {
      if (activeDownloads.get(target) === task) activeDownloads.delete(target);
    }
  }

  function downloadOneFile(file: OutputFile) {
    const blob = new Blob([file.bytes ? toByteArray(file.bytes) : file.text || ""], { type: file.type });
    downloadBlob(blob, file.name);
    toast.add({ title: `Downloaded: ${file.name}`, type: "success" });
  }

  const currentInput = inputs[mode];
  const canCopy = Boolean(currentOutput) && !(mode === "decode" && showFiles);
  const canDownload = Boolean(currentOutput.trim() || showFiles);

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        const nextMode = value as Mode;
        if (mode !== nextMode) trackAnalytics("mode_switch", { from_mode: mode, to_mode: nextMode });
        setMode(nextMode);
      }}
      className="base64-tools-react w-full"
    >
      <TabsList
        aria-label="Base64 mode"
        className="base64-mode-tabs mb-2 h-auto w-fit max-w-full flex-none flex-wrap justify-start gap-1 border bg-muted p-1"
      >
        <TabsTrigger value="encode" className="h-9 flex-none px-3 text-sm">
          Encode to Base64
        </TabsTrigger>
        <TabsTrigger value="decode" className="h-9 flex-none px-3 text-sm">
          Decode from Base64
        </TabsTrigger>
      </TabsList>
      <TabsContent value={mode} className="base64-mode-panel flex w-full flex-col">
        <Field className="base64-input-group">
          <div className="base64-input-header">
            <FieldLabel htmlFor={`${mode}-input`}>{mode === "encode" ? "Input" : "Base64 Input"}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <input
                ref={mode === "encode" ? encodeFileInput : decodeFileInput}
                type="file"
                multiple
                accept={mode === "decode" ? ".txt,.base64" : undefined}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  addSelectedFiles(mode, Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" onClick={() => void chooseFiles(mode)}>
                {mode === "encode" ? "Upload Any File(s)" : "Upload Base64 File"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void pasteInput(mode)}>
                Paste
              </Button>
              <Button variant="ghost" size="sm" onClick={() => clearInput(mode)}>
                Clear
              </Button>
            </div>
          </div>
          <Textarea
            id={`${mode}-input`}
            rows={4}
            value={currentInput}
            onChange={(event) => setInputForMode(mode, event.target.value)}
            placeholder={mode === "encode" ? "Enter text to encode to Base64…" : "Enter Base64 encoded data to decode…"}
            className="base64-textarea resize-y font-mono text-sm"
          />
          {modeFiles.length > 0 && (
            <section className="rounded-md border" aria-label="Selected files">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <h3 className="text-sm font-medium">Selected Files</h3>
                <span className="text-xs text-muted-foreground">{modeFiles.length}</span>
              </div>
              <ul className="max-h-56 divide-y overflow-auto">
                {modeFiles.map(({ id, file }) => (
                  <li key={id} className="flex min-w-0 items-center gap-3 p-3">
                    <FileThumbnail file={file} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {Base64ToolsService.formatFileSize(file.size)} · {file.type || "Unknown type"}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" aria-label={`Remove ${file.name}`} onClick={() => removeSelectedFile(id)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </Field>
        <div className="base64-action-row">
          <Button disabled={busy} onClick={() => void (mode === "encode" ? runEncode() : runDecode())}>
            {busy ? "Processing…" : mode === "encode" ? "Encode to Base64" : "Decode from Base64"}
          </Button>
        </div>

        <Field className="base64-output-group">
          <div className="base64-output-header">
            <FieldLabel htmlFor={showFiles ? undefined : `${mode}-output`}>
              {mode === "encode" ? "Base64 Output" : "Decoded Output"}
            </FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!canCopy} onClick={() => void copyOutput(mode)}>
                Copy
              </Button>
              <Button variant="outline" size="sm" disabled={!canDownload || busy} onClick={() => void downloadResult(mode)}>
                {isMultiOutput ? "Download All" : "Download"}
              </Button>
              <Button variant="ghost" size="sm" disabled={!currentOutput && !currentFiles.length} onClick={() => clearOutput(mode)}>
                Clear
              </Button>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {showFiles ? (
              <section className="rounded-md border" aria-label="Processed files">
                <div className="border-b px-3 py-2 text-sm font-medium">
                  Processed Files <span className="ml-1 text-xs font-normal text-muted-foreground">{currentFiles.length}</span>
                </div>
                {currentFiles.length ? (
                  <ul className="max-h-96 divide-y overflow-auto">
                    {currentFiles.map((file, index) => (
                      <li key={`${file.originalName}-${file.name}-${index}`} className="flex min-w-0 flex-wrap items-center gap-3 p-3">
                        {file.kind === "image" && file.bytes ? (
                          <OutputImage bytes={file.bytes} name={file.name} type={file.type} />
                        ) : (
                          <span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-xs font-semibold text-muted-foreground">
                            {file.type.split("/")[1]?.slice(0, 5).toUpperCase() || "FILE"}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="break-all text-sm font-medium" title={file.name}>
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {Base64ToolsService.formatFileSize(file.size)} · {Base64ToolsConstants.getFileTypeLabel(file.type)}
                            {file.width && file.height ? ` · ${file.width} × ${file.height}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {mode === "encode" && file.text !== undefined && (
                            <Button variant="ghost" size="sm" onClick={() => void copyText(file.text || "")}>
                              Copy
                            </Button>
                          )}
                          {mode === "decode" &&
                            (file.kind === "text" || file.type.startsWith("image/") || file.type === "application/pdf") && (
                              <Button variant="ghost" size="sm" onClick={() => setPreview(file)}>
                                Preview
                              </Button>
                            )}
                          <Button variant="outline" size="sm" onClick={() => downloadOneFile(file)}>
                            Download
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">No files were processed.</p>
                )}
              </section>
            ) : null}
            {!showFiles && (
              <Textarea
                id={`${mode}-output`}
                readOnly
                value={currentOutput}
                placeholder={mode === "encode" ? "Base64 encoded result will appear here…" : "Decoded result will appear here…"}
                rows={4}
                className="base64-textarea base64-output-textarea resize-y overflow-auto font-mono text-sm"
              />
            )}
          </div>
        </Field>

        {preview && <OutputPreview file={preview} onClose={() => setPreview(null)} />}
      </TabsContent>
    </Tabs>
  );
}

function OutputImage({ bytes, name, type }: { bytes: Uint8Array; name: string; type: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const objectUrl = URL.createObjectURL(new Blob([toByteArray(bytes)], { type }));
    image.src = objectUrl;
    return () => {
      image.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    };
  }, [bytes, type]);
  return <img ref={imageRef} alt={`Preview of ${name}`} className="h-12 w-12 shrink-0 rounded-md border object-contain" />;
}
