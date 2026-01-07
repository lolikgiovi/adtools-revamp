import MinifyWorker from "../../html-editor/minify.worker.js?worker";
import { UsageTracker } from "../../../core/UsageTracker.js";
export class AttachmentProcessorService {
  constructor() {
    this.attachmentsContainer = null;
    this.fileContents = {};
  }

  // The business process will be processing the file
  // based on its format, and returning it as three format for each file
  // 1. original value (for txt, html, json)
  // 2. base64 encoded value (for images, pdf)

  async processAttachments(files) {
    console.log("Processing attachments");
    const processedFiles = [];

    for (const file of files) {
      console.log("Processing file:", file.name);
      const sanitizedFileName = file.name.replace(/\s+/g, "_");
      const extension = sanitizedFileName.split(".").pop().toLowerCase();
      const processedFile = {
        name: sanitizedFileName,
        type: file.type,
        size: file.size,
        processedFormats: {
          original: null,
          base64: null,
          sizes: {
            original: 0,
            base64: 0,
          },
        },
      };

      try {
        switch (extension) {
          case "jpg":
          case "jpeg":
          case "png":
          case "pdf":
            await this.handleMediaFile(file, processedFile);
            break;
          case "txt":
          case "html":
          case "json":
            await this.handleTextFile(file, processedFile);
            break;
          default:
            console.warn(`Unsupported file type: ${extension}`);
        }
        processedFiles.push(processedFile);
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        UsageTracker.trackEvent("quick-query", "attachment_error", {
          type: "processing",
          file: sanitizedFileName,
          message: error.message,
        });
      }
    }

    return processedFiles;
  }

  async handleMediaFile(file, processedFile) {
    // Read as base64
    const base64Data = await this.readFileAs(file, "dataURL");
    processedFile.processedFormats.base64 = base64Data;
    processedFile.processedFormats.sizes.base64 = base64Data.length;
  }

  async handleTextFile(file, processedFile) {
    const textContent = await this.readFileAs(file, "text");
    processedFile.processedFormats.original = textContent;
    processedFile.processedFormats.contentType = "text/plain";

    const cleaned = textContent.trim();
    if (!cleaned) {
      processedFile.processedFormats.sizes.original = 0;
      return;
    }

    // Check for data URI base64 pattern
    if (cleaned.match(/^data:.*?;base64,/)) {
      processedFile.type = "text/base64";
      processedFile.processedFormats.contentType = "text/base64";
      processedFile.processedFormats.base64 = cleaned;

      // Extract and decode base64 content
      const base64Content = cleaned.split(",")[1];
      try {
        const decoded = atob(base64Content);
        processedFile.processedFormats.sizes.original = decoded.length;
        processedFile.processedFormats.sizes.base64 = cleaned.length;
      } catch (e) {
        UsageTracker.trackEvent("quick-query", "attachment_error", { type: "base64_decode_failed", file: processedFile.name });
        processedFile.processedFormats.sizes.original = new TextEncoder().encode(textContent).length;
      }
    } else {
      processedFile.processedFormats.sizes.original = new TextEncoder().encode(textContent).length;
    }
  }

  readFileAs(file, readAs) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = () => {
        UsageTracker.trackEvent("quick-query", "attachment_error", { type: "read_error", file: file.name, readAs });
        reject(new Error("Error reading file"));
      };

      switch (readAs) {
        case "arrayBuffer":
          reader.readAsArrayBuffer(file);
          break;
        case "dataURL":
          reader.readAsDataURL(file);
          break;
        case "text":
          reader.readAsText(file);
          break;
      }
    });
  }

  async minifyContent(file) {
    try {
      const original = (file.processedFormats && file.processedFormats.original) || "";
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const t = (file.type || "").toLowerCase();

      // Only attempt minify for text-like and specific known types
      if (!original || (!t.includes("text") && !t.includes("json") && !t.includes("html") && !["txt","html","htm","json"].includes(ext))) {
        return file;
      }

      let minified = original;

      if (ext === "html" || ext === "htm" || t.includes("html")) {
        try {
          minified = await this.#minifyHtmlWithWorker(original);
        } catch (err) {
          console.error("HTML Minify Worker failed, falling back to basic minify:", err);
          UsageTracker.trackEvent("quick-query", "attachment_error", { type: "minify_worker_fallback", file: file.name, message: err.message });
          // Fallback to previous simple minifier
          minified = original
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/>\s+</g, "><")
            .replace(/[\r\n\t]+/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        }
      } else if (ext === "json" || t.includes("json")) {
        try {
          minified = JSON.stringify(JSON.parse(original));
        } catch (e) {
          // Keep original if JSON parse fails
          console.warn("JSON minify failed, keeping original:", e);
          UsageTracker.trackEvent("quick-query", "attachment_error", { type: "json_minify_failed", file: file.name });
          minified = original;
        }
      } else {
        // Generic text: collapse extra whitespace and trim
        minified = original
          .split("\n")
          .map((line) => line.trim())
          .join(" ")
          .replace(/\s{2,}/g, " ")
          .trim();
      }

      return {
        ...file,
        processedFormats: {
          ...(file.processedFormats || {}),
          original: minified,
        },
      };
    } catch (e) {
      console.error("Unexpected error during minify:", e);
      UsageTracker.trackEvent("quick-query", "attachment_error", { type: "minify_unexpected", file: file.name, message: e.message });
      return file;
    }
  }

  async #minifyHtmlWithWorker(html) {
    return new Promise((resolve, reject) => {
      const worker = new MinifyWorker();
      const cleanup = () => {
        try { worker.terminate(); } catch (_) {}
      };
      worker.onmessage = (event) => {
        const data = event.data || {};
        const { success, result, error } = data;
        cleanup();
        if (success) {
          resolve(typeof result === "string" ? result : "");
        } else {
          UsageTracker.trackEvent("quick-query", "attachment_error", { type: "minify_worker_failed", message: error || "HTML minify failed" });
          reject(new Error(error || "HTML minify failed"));
        }
      };
      worker.onerror = (err) => {
        cleanup();
        UsageTracker.trackEvent("quick-query", "attachment_error", { type: "minify_worker_error", message: (err && err.message) || "Worker error" });
        reject(err instanceof Error ? err : new Error("Worker error"));
      };
      worker.postMessage({ type: "minify", html });
    });
  }
}
