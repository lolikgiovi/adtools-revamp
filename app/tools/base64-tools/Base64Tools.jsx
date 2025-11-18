import React, { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTool } from "@/hooks/useTool.jsx";
import { Base64ToolsService } from "./service.js";
import { Base64ToolsConstants } from "./constants.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

// File Card Component
function FileCard({ data, onRemove, onDownload }) {
  const { variant, name, size, type, previewUrl, dimensions } = data;

  return (
    <div className="file-card">
      {variant === "image" ? (
        <div className="file-card-info image-card">
          <div className="image-preview">
            <img
              src={previewUrl}
              alt={name}
              style={{ maxWidth: "200px", maxHeight: "150px", objectFit: "contain", borderRadius: "4px" }}
            />
          </div>
          <div className="file-card-details">
            <p className="file-card-name" title={name}>
              {name}
            </p>
            <p className="file-card-size">{Base64ToolsService.formatFileSize(size)}</p>
            {dimensions && (
              <p className="file-card-meta">
                <span className="image-dimensions">
                  {dimensions.width} × {dimensions.height}
                </span>
                <span className="image-format">{(type || "").split("/")[1]?.toUpperCase() || ""}</span>
              </p>
            )}
          </div>
        </div>
      ) : variant === "binary" ? (
        <div className="file-card-info binary-card">
          <div className="file-card-icon" dangerouslySetInnerHTML={{ __html: Base64ToolsConstants.getFileTypeIcon(type) }} />
          <div className="file-card-details">
            <p className="file-card-name" title={name}>
              {name}
            </p>
            <p className="file-card-size">{Base64ToolsService.formatFileSize(size)}</p>
            <p className="file-card-meta">
              <span className="file-type">{Base64ToolsConstants.getFileTypeLabel(type)}</span>
            </p>
          </div>
        </div>
      ) : (
        <div className="file-card-info">
          <div className="file-card-icon" dangerouslySetInnerHTML={{ __html: Base64ToolsConstants.getFileTypeIcon("text/plain") }} />
          <div className="file-card-details">
            <p className="file-card-name" title={name}>
              {name}
            </p>
            <p className="file-card-size">{Base64ToolsService.formatFileSize(size)}</p>
          </div>
        </div>
      )}
      {onRemove && (
        <button className="file-card-remove" type="button" title="Remove file" onClick={onRemove}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      )}
      {onDownload && (
        <Button size="sm" className="download-btn" onClick={onDownload} title="Download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download
        </Button>
      )}
    </div>
  );
}

export default function Base64Tools() {
  const { copyToClipboard, showSuccess, showError } = useTool("base64-tools");
  const [activeMode, setActiveMode] = useState("encode");
  const [encodeInput, setEncodeInput] = useState("");
  const [decodeInput, setDecodeInput] = useState("");
  const [encodeOutput, setEncodeOutput] = useState("");
  const [decodeOutput, setDecodeOutput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState(new Map());
  const [processedFiles, setProcessedFiles] = useState([]);
  const [showProcessedFiles, setShowProcessedFiles] = useState(false);
  const encodeFileInputRef = useRef(null);
  const decodeFileInputRef = useRef(null);
  const decodedBlobRef = useRef(null);
  const decodedFilenameRef = useRef(null);

  // Track mount
  useEffect(() => {
    try {
      UsageTracker.trackFeature("base64-tools", "mount", "", 5000);
    } catch (_) {}
  }, []);

  // Load saved text inputs from localStorage
  useEffect(() => {
    try {
      const savedEnc = localStorage.getItem("tool:base64-tools:encode-input");
      const savedDec = localStorage.getItem("tool:base64-tools:decode-input");
      if (savedEnc !== null) setEncodeInput(savedEnc);
      if (savedDec !== null) setDecodeInput(savedDec);
    } catch (_) {}
  }, []);

  // Save text inputs to localStorage with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("tool:base64-tools:encode-input", encodeInput);
      } catch (_) {}
    }, 250);
    return () => clearTimeout(timer);
  }, [encodeInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("tool:base64-tools:decode-input", decodeInput);
      } catch (_) {}
    }, 250);
    return () => clearTimeout(timer);
  }, [decodeInput]);

  const handleFileUpload = async (e, mode) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const filesToAdd = mode === "decode" ? files.filter((file) => file.name.toLowerCase().endsWith(".txt")) : files;

    const newFiles = new Map(selectedFiles);
    for (const file of filesToAdd) {
      const fileId = `${mode}-${crypto.randomUUID()}-${Date.now()}`;
      newFiles.set(fileId, { file, mode, id: fileId });
    }
    setSelectedFiles(newFiles);
  };

  const removeFile = (fileId) => {
    const newFiles = new Map(selectedFiles);
    newFiles.delete(fileId);
    setSelectedFiles(newFiles);
  };

  const clearInput = (mode) => {
    if (mode === "encode") {
      setEncodeInput("");
      try {
        localStorage.setItem("tool:base64-tools:encode-input", "");
      } catch (_) {}
    } else {
      setDecodeInput("");
      try {
        localStorage.setItem("tool:base64-tools:decode-input", "");
      } catch (_) {}
    }

    // Clear files for this mode
    const newFiles = new Map(selectedFiles);
    for (const [fileId, data] of selectedFiles.entries()) {
      if (data.mode === mode) {
        newFiles.delete(fileId);
      }
    }
    setSelectedFiles(newFiles);

    // Reset file input
    if (mode === "encode" && encodeFileInputRef.current) {
      encodeFileInputRef.current.value = "";
    } else if (mode === "decode" && decodeFileInputRef.current) {
      decodeFileInputRef.current.value = "";
    }
  };

  const clearOutput = (mode) => {
    if (mode === "encode") {
      setEncodeOutput("");
    } else {
      setDecodeOutput("");
      decodedBlobRef.current = null;
      decodedFilenameRef.current = null;
    }
    setProcessedFiles([]);
    setShowProcessedFiles(false);
  };

  const handlePaste = async (mode) => {
    try {
      const text = await navigator.clipboard.readText();
      if (mode === "encode") {
        setEncodeInput(text);
      } else {
        setDecodeInput(text);
      }
      showSuccess("Pasted from clipboard");
    } catch (_) {
      showError("Failed to paste");
    }
  };

  const handleCopy = async (mode) => {
    const text = mode === "encode" ? encodeOutput : decodeOutput;
    if (text) {
      await copyToClipboard(text);
    }
  };

  const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const readFileAsDataURL = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const getImageDimensions = (url) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = url;
    });
  };

  const handleEncode = async () => {
    try {
      UsageTracker.trackFeature("base64-tools", "encode");
    } catch (_) {}

    const filesForMode = Array.from(selectedFiles.values()).filter((f) => f.mode === "encode");

    if (filesForMode.length > 0) {
      // Process files
      await processFiles("encode");
    } else {
      // Process text
      try {
        const encoded = Base64ToolsService.encodeText(encodeInput);
        setEncodeOutput(encoded);
        setShowProcessedFiles(false);
        showSuccess("Encoded to Base64!");
      } catch (error) {
        showError("Failed to encode text");
        setEncodeOutput("");
      }
    }
  };

  const handleDecode = async () => {
    try {
      UsageTracker.trackFeature("base64-tools", "decode");
    } catch (_) {}

    const filesForMode = Array.from(selectedFiles.values()).filter((f) => f.mode === "decode");

    if (filesForMode.length > 0) {
      // Process files
      await processFiles("decode");
    } else {
      // Process text
      const base64Text = decodeInput.trim();
      if (!base64Text) {
        setDecodeOutput("");
        return;
      }

      try {
        if (!Base64ToolsService.isValidBase64(base64Text)) {
          throw new Error("Invalid base64 format");
        }

        const { base64: actualBase64 } = Base64ToolsService.normalizeDataUri(base64Text);
        const decoded = Base64ToolsService.decodeToBinaryString(actualBase64);
        const isTextContent = Base64ToolsService.isTextContent(decoded);

        if (isTextContent) {
          setDecodeOutput(decoded);
          setShowProcessedFiles(false);
          showSuccess("Decoded from Base64!");
        } else {
          setDecodeOutput("");
          const uint8Array = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) {
            uint8Array[i] = decoded.charCodeAt(i);
          }
          const contentType = Base64ToolsService.detectContentType(uint8Array);
          decodedBlobRef.current = new Blob([uint8Array], { type: contentType });
          decodedFilenameRef.current = `decoded_base64-${Date.now()}`;
          setShowProcessedFiles(false);
          showSuccess("Decoded binary file - use Download button");
        }
      } catch (error) {
        showError("Invalid Base64 input");
        setDecodeOutput("");
      }
    }
  };

  const processFiles = async (mode) => {
    const filesForMode = Array.from(selectedFiles.values()).filter((f) => f.mode === mode);
    if (filesForMode.length === 0) return;

    clearOutput(mode);
    const processed = [];

    for (const { file } of filesForMode) {
      try {
        if (mode === "encode") {
          const arrayBuffer = await readFileAsArrayBuffer(file);
          const uint8Array = new Uint8Array(arrayBuffer);
          const base64Result = Base64ToolsService.toBase64FromBytes(uint8Array);
          const mimeType = Base64ToolsService.getMimeTypeFromBase64(file, uint8Array);
          const dataUri = `data:${mimeType};base64,${base64Result}`;

          processed.push({
            originalName: file.name,
            processedName: `${file.name.split(".")[0]}.txt`,
            content: dataUri,
            size: new Blob([dataUri]).size,
            type: "text/plain",
          });
        } else {
          const text = await readFileAsText(file);
          const base64Content = text.trim();
          if (!base64Content) {
            throw new Error("Empty file content");
          }

          if (!Base64ToolsService.isValidBase64(base64Content)) {
            throw new Error("Invalid base64 format");
          }

          const { base64: actualBase64 } = Base64ToolsService.normalizeDataUri(base64Content);
          const binaryString = Base64ToolsService.decodeToBinaryString(actualBase64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const contentType = Base64ToolsService.detectContentType(bytes);

          if (contentType.startsWith("image/")) {
            const blob = new Blob([bytes], { type: contentType });
            const url = URL.createObjectURL(blob);
            const { width, height } = await getImageDimensions(url);

            processed.push({
              originalName: file.name,
              processedName: `${file.name.split(".")[0]}.${contentType.split("/")[1]}`,
              isImage: true,
              variant: "image",
              name: `${file.name.split(".")[0]}.${contentType.split("/")[1]}`,
              size: blob.size,
              type: contentType,
              previewUrl: url,
              dimensions: { width, height },
              content: bytes,
            });
          } else if (Base64ToolsService.isTextContent(binaryString)) {
            processed.push({
              originalName: file.name,
              processedName: `${file.name.split(".")[0]}.txt`,
              content: binaryString,
              size: new Blob([binaryString]).size,
              type: "text/plain",
            });
          } else {
            const blob = new Blob([bytes], { type: contentType });
            const extension = contentType.split("/")[1] || "bin";
            const processedName = `${file.name.split(".")[0]}.${extension}`;

            processed.push({
              originalName: file.name,
              processedName,
              isFile: true,
              variant: "binary",
              name: processedName,
              size: blob.size,
              type: contentType,
              content: bytes,
            });
          }
        }
      } catch (error) {
        showError(`Failed to process ${file.name}: ${error.message}`);
      }
    }

    setProcessedFiles(processed);
    setShowProcessedFiles(true);
    showSuccess(`Processed ${processed.length} file(s)`);
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showSuccess(`Downloaded: ${filename}`);
  };

  const handleDownload = (mode) => {
    if (showProcessedFiles) {
      showError("Use per-file Download buttons for processed items");
      return;
    }

    if (mode === "encode") {
      if (!encodeOutput.trim()) {
        showError("No encoded content to download");
        return;
      }
      const blob = new Blob([encodeOutput], { type: "text/plain" });
      downloadBlob(blob, "encoded.txt");
    } else {
      if (decodedBlobRef.current) {
        downloadBlob(decodedBlobRef.current, decodedFilenameRef.current || "decoded_file");
      } else if (decodeOutput.trim()) {
        const blob = new Blob([decodeOutput], { type: "text/plain" });
        downloadBlob(blob, "decoded.txt");
      } else {
        showError("No decoded content to download");
      }
    }
  };

  const downloadProcessedFile = (fileData) => {
    if (fileData.isImage || fileData.isFile) {
      const blob = new Blob([fileData.content], { type: fileData.type });
      downloadBlob(blob, fileData.name || fileData.processedName);
    } else {
      const blob = new Blob([fileData.content], { type: "text/plain" });
      downloadBlob(blob, fileData.processedName);
    }
  };

  const filesForMode = (mode) => Array.from(selectedFiles.values()).filter((f) => f.mode === mode);

  const renderFileSection = (mode) => {
    const files = filesForMode(mode);
    const hasFiles = files.length > 0;

    return (
      <>
        {hasFiles && (
          <div className="files-display" style={{ marginBottom: "1rem" }}>
            <div className="files-header">
              <h4>Selected Files</h4>
            </div>
            <div className="files-container">
              {files.map(({ file, id }) => {
                const isImage = file.type && file.type.startsWith("image/");
                return (
                  <FileCard
                    key={id}
                    data={{
                      variant: isImage && mode === "encode" ? "image" : "binary",
                      name: file.name,
                      size: file.size,
                      type: file.type || "Unknown",
                      previewUrl: isImage && mode === "encode" ? URL.createObjectURL(file) : null,
                    }}
                    onRemove={() => removeFile(id)}
                  />
                );
              })}
            </div>
          </div>
        )}
        {!hasFiles && (
          <Textarea
            value={mode === "encode" ? encodeInput : decodeInput}
            onChange={(e) => (mode === "encode" ? setEncodeInput(e.target.value) : setDecodeInput(e.target.value))}
            placeholder={mode === "encode" ? "Enter text to encode to Base64..." : "Enter Base64 encoded data to decode..."}
            rows={4}
            className="form-textarea"
          />
        )}
      </>
    );
  };

  return (
    <div className="tool-container base64-tools p-6">
      {/* Tab Navigation */}
      <div className="flex gap-2 mb-4">
        <Button variant={activeMode === "encode" ? "default" : "outline"} size="sm" onClick={() => setActiveMode("encode")}>
          Encode to Base64
        </Button>
        <Button variant={activeMode === "decode" ? "default" : "outline"} size="sm" onClick={() => setActiveMode("decode")}>
          Decode from Base64
        </Button>
      </div>

      {/* Encode Section */}
      {activeMode === "encode" && (
        <div className="encode-section">
          <Card className="mb-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Input</CardTitle>
                <div className="flex gap-2">
                  <label className="btn btn-secondary file-upload-btn">
                    <input
                      ref={encodeFileInputRef}
                      type="file"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => handleFileUpload(e, "encode")}
                    />
                    Upload File(s)
                  </label>
                  <Button size="sm" variant="outline" onClick={() => handlePaste("encode")}>
                    Paste
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => clearInput("encode")}>
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>{renderFileSection("encode")}</CardContent>
          </Card>

          <div className="flex justify-center mb-4">
            <Button onClick={handleEncode}>Encode to Base64</Button>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Base64 Output</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleCopy("encode")} disabled={!encodeOutput && !showProcessedFiles}>
                    Copy
                  </Button>
                  <Button size="sm" onClick={() => handleDownload("encode")} disabled={!encodeOutput && !showProcessedFiles}>
                    Download
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => clearOutput("encode")}>
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {showProcessedFiles && processedFiles.length > 0 && (
                <div className="processed-files">
                  <div className="files-header">
                    <h4>Processed Files</h4>
                  </div>
                  <div className="files-container">
                    {processedFiles.map((fileData, index) => (
                      <FileCard
                        key={index}
                        data={{
                          variant: "text",
                          name: fileData.processedName,
                          size: fileData.size,
                          type: fileData.type,
                        }}
                        onDownload={() => downloadProcessedFile(fileData)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {!showProcessedFiles && (
                <Textarea value={encodeOutput} readOnly placeholder="Base64 encoded result will appear here..." rows={4} className="font-mono text-sm" />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Decode Section */}
      {activeMode === "decode" && (
        <div className="decode-section">
          <Card className="mb-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Base64 Input</CardTitle>
                <div className="flex gap-2">
                  <label className="btn btn-secondary file-upload-btn">
                    <input
                      ref={decodeFileInputRef}
                      type="file"
                      multiple
                      accept=".txt,.base64"
                      style={{ display: "none" }}
                      onChange={(e) => handleFileUpload(e, "decode")}
                    />
                    Upload Base64 File
                  </label>
                  <Button size="sm" variant="outline" onClick={() => handlePaste("decode")}>
                    Paste
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => clearInput("decode")}>
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>{renderFileSection("decode")}</CardContent>
          </Card>

          <div className="flex justify-center mb-4">
            <Button onClick={handleDecode}>Decode from Base64</Button>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Decoded Output</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleCopy("decode")} disabled={!decodeOutput && !showProcessedFiles}>
                    Copy
                  </Button>
                  <Button size="sm" onClick={() => handleDownload("decode")} disabled={!decodeOutput && !showProcessedFiles && !decodedBlobRef.current}>
                    Download
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => clearOutput("decode")}>
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {showProcessedFiles && processedFiles.length > 0 && (
                <div className="processed-files">
                  <div className="files-header">
                    <h4>Processed Files</h4>
                  </div>
                  <div className="files-container">
                    {processedFiles.map((fileData, index) => (
                      <FileCard key={index} data={fileData} onDownload={() => downloadProcessedFile(fileData)} />
                    ))}
                  </div>
                </div>
              )}
              {!showProcessedFiles && (
                <Textarea value={decodeOutput} readOnly placeholder="Decoded result will appear here..." rows={4} className="font-mono text-sm" />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
