import { BaseTool } from "../../core/BaseTool.js";
import JSZip from "jszip";
import { UsageTracker } from "../../core/UsageTracker.js";
import { MAX_FILE_SIZE, fitDimensions } from "./service.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";

const size = (bytes) => `${(bytes / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} KB`;
const OPTIMIZER_LIMIT = "Image data uses existing PNG filters; further lossless optimization may be possible.";

export class CompressImage extends BaseTool {
  constructor(eventBus) {
    super({ id: "compress-image", eventBus });
    this.items = [];
    this.generation = 0;
    this.running = false;
  }
  getIconSvg() {
    return getIconSvg();
  }
  render() {
    return `<section class="tool-container compress-image" aria-label="Compress Image">
      <header class="ci-toolbar">
        <div><h2>Compress Image</h2><p>Optimize every PNG losslessly, or choose a smaller size for mobile. Everything stays on your device.</p></div>
        <div class="ci-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-ci="clear" disabled>Clear all</button>
          <button type="button" class="btn btn-primary btn-sm" data-ci="zip" disabled>Download ZIP</button>
        </div>
      </header>
      <div class="ci-drop">
        <input type="file" accept="image/png,.png" multiple id="ci-files" class="sr-only">
        <label for="ci-files" class="btn btn-secondary">Choose PNG images</label>
        <p>or drop multiple images here</p>
        <small>Below 300 KB per result · Up to 20 images · 32 MB per image · Processed on your device</small>
      </div>
      <p class="ci-summary" role="status" aria-live="polite">Add images to compare the original and compressed results.</p>
      <div class="ci-results"></div>
    </section>`;
  }
  onMount() {
    this.container.querySelector("#ci-files").addEventListener("change", (event) => {
      this.addFiles(event.target.files);
      event.target.value = "";
    });
    const drop = this.container.querySelector(".ci-drop");
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.classList.add("is-dragging");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("is-dragging");
      this.addFiles(event.dataTransfer.files);
    });
    this.container.querySelector('[data-ci="clear"]').addEventListener("click", () => this.clear());
    this.container.querySelector('[data-ci="zip"]').addEventListener("click", () => this.downloadZip());
  }
  addFiles(files) {
    let total = this.items.reduce((sum, item) => sum + item.file.size, 0);
    for (const file of files) {
      if (this.items.length >= 20 || total + file.size > 128 * 1024 * 1024) {
        this.showError("Add up to 20 images and 128 MB in total. Clear the current batch to add more.");
        break;
      }
      total += file.size;
      const item = { file, status: "Queued", urls: [], logs: [], startedAt: performance.now(), logId: this.items.length + 1 };
      this.items.push(item);
      this.createRow(item);
      this.log(item, "queued", { inputBytes: file.size, mime: file.type || "not provided" });
    }
    this.updateSummary();
    this.processQueue();
  }
  createRow(item) {
    const row = document.createElement("article");
    row.className = "ci-result";
    row.innerHTML = `<div class="ci-result-header"><div class="ci-file-info"><h3></h3><p class="ci-metrics"></p></div>
      <button type="button" class="btn btn-secondary btn-sm" disabled>Download PNG</button></div>
      <p class="ci-status" role="status"></p>
      <details class="ci-diagnostics"><summary>Processing log</summary>
        <button type="button" class="btn btn-secondary btn-sm" data-ci="copy-log">Copy log</button>
        <pre aria-label="Image processing log"></pre>
      </details><details class="ci-mobile" hidden><summary>For mobile? Try a smaller image</summary>
        <p>Resize to fit a phone screen, then compress the PNG. Resizing changes dimensions and pixels; PNG encoding is lossless.
        Colors are converted to sRGB. The full-size version stays available.</p>
        <div class="ci-resize-controls">
          <label>Size suggestion<select class="ci-resize-preset">
            <option value="1920">1920 px long edge</option><option value="1440">1440 px long edge</option>
            <option value="portrait">Portrait · 1080 × 1920</option><option value="landscape">Landscape · 1920 × 1080</option>
            <option value="custom">Custom bounds</option>
          </select></label>
          <label>Max width (px)<input class="ci-max-width" type="number" min="1" max="16384" step="1" value="1920"></label>
          <label>Max height (px)<input class="ci-max-height" type="number" min="1" max="16384" step="1" value="1920"></label>
          <button type="button" class="btn btn-secondary btn-sm ci-resize-apply" disabled>Resize + compress</button>
          <button type="button" class="btn btn-ghost btn-sm ci-restore" hidden>Use full-size version</button>
        </div><p class="ci-resize-note" role="status"></p>
      </details><div class="ci-preview" hidden></div>`;
    row.querySelector("h3").textContent = item.file.name;
    row.querySelector(".ci-metrics").textContent = `Original: ${size(item.file.size)}`;
    row.querySelector(".ci-status").textContent = item.status;
    row.querySelector("button").addEventListener("click", () => {
      if (item.result?.eligible) this.download(item.blob, item.file.name);
    });
    row.querySelector('[data-ci="copy-log"]').addEventListener("click", () => {
      this.copyToClipboard(JSON.stringify({ tool: "compress-image", image: item.logId, entries: item.logs }, null, 2));
    });
    row.querySelector(".ci-resize-preset").addEventListener("change", (event) => {
      const bounds = { 1920: [1920, 1920], 1440: [1440, 1440], portrait: [1080, 1920], landscape: [1920, 1080] }[event.target.value];
      if (bounds) {
        row.querySelector(".ci-max-width").value = bounds[0];
        row.querySelector(".ci-max-height").value = bounds[1];
      }
      this.updateResizeSuggestion(item);
    });
    row.querySelectorAll(".ci-mobile input").forEach((input) =>
      input.addEventListener("input", () => {
        row.querySelector(".ci-resize-preset").value = "custom";
        this.updateResizeSuggestion(item);
      }),
    );
    row.querySelector(".ci-resize-apply").addEventListener("click", () => this.resizeForMobile(item));
    row.querySelector(".ci-restore").addEventListener("click", () => {
      if (this.running || this.zipping) return;
      this.log(item, "variant.selected", { variant: "full-size", pixelIdenticalToOriginal: true });
      this.applyVariant(item, item.fullSize);
      this.updateSummary();
    });
    item.row = row;
    this.container.querySelector(".ci-results").appendChild(row);
  }
  async processQueue() {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    try {
      for (const item of this.items) {
        if (item.status !== "Queued") continue;
        item.status = "Compressing…";
        item.row.querySelector(".ci-status").textContent = item.status;
        try {
          if (item.file.type && item.file.type !== "image/png") throw new Error("Only PNG images are supported.");
          if (!item.file.type && !/\.png$/i.test(item.file.name)) throw new Error("Only PNG images are supported.");
          if (item.file.size > MAX_FILE_SIZE) throw new Error("PNG exceeds the 32 MB input limit.");
          this.log(item, "file.read.start", { inputBytes: item.file.size });
          const bytes = await item.file.arrayBuffer();
          if (generation !== this.generation) return;
          this.log(item, "file.read.complete", { inputBytes: bytes.byteLength });
          const result = await this.runWorker(bytes, (stage, details) => this.log(item, stage, details));
          if (generation !== this.generation) return;
          item.blob = new Blob([result.bytes], { type: "image/png" });
          const before = URL.createObjectURL(item.file);
          const after = URL.createObjectURL(item.blob);
          item.urls.push(before, after);
          // Browser decoding additionally checks palette/profile and PNG semantics.
          const original = new Image();
          const optimized = new Image();
          original.src = before;
          optimized.src = after;
          this.log(item, "browser.decode.start", {});
          await Promise.all([original.decode(), optimized.decode()]);
          if (generation !== this.generation) return;
          if (
            original.naturalWidth !== result.width ||
            original.naturalHeight !== result.height ||
            optimized.naturalWidth !== result.width ||
            optimized.naturalHeight !== result.height
          ) {
            throw new Error("Image dimension verification failed.");
          }
          this.log(item, "browser.decode.verified", { width: result.width, height: result.height });
          item.fullSize = { result, blob: item.blob, before, after, resized: false };
          this.applyVariant(item, item.fullSize);
          item.row.querySelector(".ci-mobile").hidden = false;
          this.updateResizeSuggestion(item);
          if (result.eligible) {
            try {
              UsageTracker.trackToolUse("compress-image", "compress");
            } catch (_) {
              // Analytics must not interrupt local image processing.
            }
          }
        } catch (error) {
          if (generation !== this.generation) return;
          item.status = error.message || "Unable to decode this PNG. Select a valid image.";
          this.log(item, "processing.failed", { message: item.status });
          item.row.querySelector(".ci-diagnostics").open = true;
          item.row.classList.add("ci-error");
          item.urls.forEach((url) => URL.revokeObjectURL(url));
          item.urls = [];
          item.blob = null;
        }
        item.row.querySelector(".ci-status").textContent = item.status;
        this.updateSummary();
      }
    } finally {
      if (generation === this.generation) {
        this.running = false;
        this.updateSummary();
      }
    }
  }
  applyVariant(item, variant) {
    item.result = variant.result;
    item.blob = variant.blob;
    item.selectedVariant = variant;
    const result = variant.result;
    const original = item.fullSize.result;
    item.status = result.eligible
      ? variant.resized
        ? "Ready · Resized for mobile · Dimensions and pixels changed; PNG encoding verified"
        : result.changed
          ? "Ready · Lossless image data verified"
          : "Ready · No smaller result found; original kept"
      : `Compression completed, but the result is ${(result.bytes.length - 299999).toLocaleString()} bytes above the limit. ${OPTIMIZER_LIMIT}`;
    if (result.metadataRemovedBytes) item.status += ` · Removed ${size(result.metadataRemovedBytes)} of text metadata.`;
    if (variant.resized && !result.eligible) item.status += " Resized output; original pixels have changed.";
    item.row.querySelector(".ci-status").textContent = item.status;
    item.row.classList.toggle("ci-error", !result.eligible);
    item.row.querySelector(".ci-result-header button").disabled = !result.eligible;
    const saved = (1 - result.bytes.length / item.file.size) * 100;
    const savingText = saved >= 0 ? `${saved.toFixed(1)}% smaller` : `${(-saved).toFixed(1)}% larger after resizing`;
    item.row.querySelector(".ci-metrics").textContent =
      `Original: ${original.width} × ${original.height} px, ${size(item.file.size)} · Result: ${result.width} × ${result.height} px, ${size(result.bytes.length)} · ${savingText}`;
    item.row.querySelector(".ci-restore").hidden = !variant.resized;
    this.showPreview(item, variant.before, variant.after);
    this.log(item, "download.decision", {
      variant: variant.resized ? "mobile" : "full-size",
      allowed: result.eligible,
      outputBytes: result.bytes.length,
      maxOutputBytes: 299999,
      reason: result.eligible ? "validated-and-below-limit" : "output-size-limit",
    });
    if (!result.eligible) item.row.querySelector(".ci-diagnostics").open = true;
  }
  updateResizeSuggestion(item) {
    if (!item.fullSize) return;
    const row = item.row;
    try {
      const { width, height } = item.fullSize.result;
      const target = fitDimensions(
        width,
        height,
        Number(row.querySelector(".ci-max-width").value),
        Number(row.querySelector(".ci-max-height").value),
      );
      item.resizeTarget = target;
      const smaller = target.width !== width || target.height !== height;
      row.querySelector(".ci-resize-note").textContent = smaller
        ? `${width} × ${height} → ${target.width} × ${target.height} px. Aspect ratio preserved; no cropping.`
        : `${width} × ${height} px already fits these bounds. Choose smaller bounds to reduce dimensions. Images are never upscaled.`;
      row.querySelector(".ci-resize-apply").disabled = !smaller || this.running || this.zipping;
    } catch (error) {
      item.resizeTarget = null;
      row.querySelector(".ci-resize-note").textContent = error.message;
      row.querySelector(".ci-resize-apply").disabled = true;
    }
    row.querySelector(".ci-restore").disabled = this.running || this.zipping;
  }
  async resizeForMobile(item) {
    if (this.running || this.zipping || !item.fullSize) return;
    this.updateResizeSuggestion(item);
    const target = item.resizeTarget;
    const source = item.fullSize.result;
    if (!target || (target.width === source.width && target.height === source.height)) return;
    const generation = this.generation;
    this.running = true;
    item.busy = true;
    this.updateSummary();
    item.row.querySelector(".ci-status").textContent = "Resizing for mobile and compressing…";
    const canvas = document.createElement("canvas");
    let after;
    try {
      this.log(item, "resize.start", {
        from: { width: source.width, height: source.height },
        to: target,
        pixelIdenticalToOriginal: false,
        colorSpace: "sRGB",
        sampling: "high",
      });
      const image = new Image();
      image.src = item.fullSize.before;
      await image.decode();
      if (generation !== this.generation) return;
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d", { colorSpace: "srgb" });
      if (!context) throw new Error("Image resizing is unavailable in this browser.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, target.width, target.height);
      const encoded = await new Promise((resolve, reject) =>
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Unable to encode the resized PNG."));
        }, "image/png"),
      );
      if (generation !== this.generation) return;
      this.log(item, "resize.encoded", { bytes: encoded.size, ...target, type: encoded.type });
      const bytes = await encoded.arrayBuffer();
      if (generation !== this.generation) return;
      const result = await this.runWorker(bytes, (stage, details) => this.log(item, stage, { variant: "mobile", ...details }));
      if (generation !== this.generation) return;
      if (result.width !== target.width || result.height !== target.height) throw new Error("Resized PNG dimensions failed verification.");
      const blob = new Blob([result.bytes], { type: "image/png" });
      after = URL.createObjectURL(blob);
      const output = new Image();
      output.src = after;
      await output.decode();
      if (generation !== this.generation) return;
      if (output.naturalWidth !== target.width || output.naturalHeight !== target.height)
        throw new Error("Resized preview dimensions failed verification.");
      if (item.mobile) {
        URL.revokeObjectURL(item.mobile.after);
        item.urls = item.urls.filter((url) => url !== item.mobile.after);
      }
      item.mobile = { result, blob, before: item.fullSize.before, after, resized: true };
      item.urls.push(after);
      after = null;
      this.log(item, "resize.verified", { ...target, pixelIdenticalToOriginal: false, pngEncodingVerified: true });
      this.applyVariant(item, item.mobile);
    } catch (error) {
      if (generation !== this.generation) return;
      this.log(item, "resize.failed", { message: error.message });
      item.row.querySelector(".ci-diagnostics").open = true;
      item.row.querySelector(".ci-status").textContent = item.status;
      this.showError(`Resize failed: ${error.message} The previous result is still selected.`);
    } finally {
      canvas.width = canvas.height = 1;
      if (after) URL.revokeObjectURL(after);
      if (generation === this.generation) {
        item.busy = false;
        this.running = false;
        this.updateSummary();
        this.processQueue();
      }
    }
  }
  log(item, stage, details) {
    const entry = { elapsedMs: Math.round(performance.now() - item.startedAt), stage, details };
    item.logs.push(entry);
    const output = item.row.querySelector(".ci-diagnostics pre");
    const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 24;
    output.textContent = item.logs.map((log) => `[${log.elapsedMs} ms] ${log.stage} ${JSON.stringify(log.details)}`).join("\n");
    if (atBottom) output.scrollTop = output.scrollHeight;
    console.info("[Compress Image]", { image: item.logId, ...entry });
  }
  runWorker(bytes, report) {
    return new Promise((resolve, reject) => {
      report("worker.start", {});
      const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      const finish = (error, result) => {
        clearTimeout(timer);
        worker.terminate();
        this.cancelWorker = null;
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        report("worker.timeout", { timeoutMs: 60000 });
        finish(new Error("Compression timed out. Please select a smaller image."));
      }, 60000);
      this.cancelWorker = () => {
        report("worker.cancelled", {});
        finish(new Error("Cancelled"));
      };
      worker.onmessage = ({ data }) => {
        if (data.log) {
          report(data.log.stage, data.log.details);
          return;
        }
        report(
          data.error ? "worker.failed" : "worker.complete",
          data.error ? { message: data.error } : { outputBytes: data.result.bytes.length },
        );
        finish(data.error ? new Error(data.error) : null, data.result);
      };
      worker.onerror = (event) => {
        report("worker.error", { message: event.message || "Worker could not load or execute" });
        finish(new Error("Compression worker failed. See the processing log for details."));
      };
      worker.onmessageerror = () => {
        report("worker.message-error", {});
        finish(new Error("Unable to read the compression worker response."));
      };
      worker.postMessage(bytes, [bytes]);
    });
  }
  showPreview(item, before, after) {
    const preview = item.row.querySelector(".ci-preview");
    preview.hidden = false;
    preview.innerHTML = `<div class="ci-preview-toolbar"><span>Visual comparison</span>
      <label><input type="checkbox"> Overlay comparison</label></div>
      <div class="ci-pair"><figure><figcaption>Before</figcaption><div class="ci-checker"><img alt="Original PNG"></div></figure>
      <figure><figcaption>After${item.selectedVariant?.resized ? " · Resized" : ""}${item.result.eligible ? "" : " · Above size limit"}</figcaption>
      <div class="ci-checker"><img alt="${item.selectedVariant?.resized ? "Resized and PNG-compressed image" : "Losslessly compressed PNG"}"></div></figure></div>
      <div class="ci-overlay" hidden><div class="ci-overlay-images ci-checker"><img class="ci-checker" alt="Original for comparison">
      <img class="ci-overlay-after ci-checker" alt="Compressed for comparison"></div>
      <label class="ci-slider">Before <input type="range" min="0" max="100" value="50" aria-label="Before and after comparison"> After</label></div>`;
    const images = preview.querySelectorAll("img");
    [before, after, before, after].forEach((url, index) => {
      images[index].src = url;
    });
    preview.querySelector('input[type="checkbox"]').addEventListener("change", (event) => {
      preview.querySelector(".ci-pair").hidden = event.target.checked;
      preview.querySelector(".ci-overlay").hidden = !event.target.checked;
    });
    const slider = preview.querySelector('input[type="range"]');
    const update = () => {
      images[3].style.clipPath = `inset(0 0 0 ${slider.value}%)`;
    };
    slider.addEventListener("input", update);
    update();
  }
  updateSummary() {
    if (!this.container) return;
    const ready = this.items.filter((item) => item.result?.eligible && !item.busy).length;
    const pending = this.items.filter((item) => item.busy || ["Queued", "Compressing…"].includes(item.status)).length;
    this.container.querySelector(".ci-summary").textContent = this.items.length
      ? `${this.items.length} images · ${ready} ready to download · ${pending} processing · ${this.items.length - ready - pending} unable to meet requirements`
      : "Add images to compare the original and compressed results.";
    this.container.querySelector('[data-ci="clear"]').disabled = !this.items.length;
    this.container.querySelector('[data-ci="zip"]').disabled = !ready || this.zipping || this.running;
    for (const item of this.items) {
      item.row.querySelector(".ci-result-header button").disabled = !item.result?.eligible || Boolean(item.busy);
      this.updateResizeSuggestion(item);
    }
  }
  download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = /\.png$/i.test(name) || /\.zip$/i.test(name) ? name : `${name}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async downloadZip() {
    const generation = this.generation;
    this.zipping = true;
    this.updateSummary();
    try {
      const zip = new JSZip();
      const names = new Set();
      for (const item of this.items.filter((entry) => entry.result?.eligible && !entry.busy)) {
        const base =
          item.file.name
            .replace(/\.png$/i, "")
            .replace(/[\\/]/g, "_")
            .replace(/\p{Cc}/gu, "_") || "image";
        let name = `${base}.png`;
        let suffix = 2;
        while (names.has(name.toLowerCase())) name = `${base} (${suffix++}).png`;
        names.add(name.toLowerCase());
        zip.file(name, await item.blob.arrayBuffer());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      if (generation === this.generation) this.download(blob, "compressed-images.zip");
    } catch (_) {
      if (generation === this.generation) this.showError("Unable to create ZIP. Download the PNG images individually.");
    } finally {
      this.zipping = false;
      this.updateSummary();
    }
  }
  clear() {
    this.generation++;
    this.cancelWorker?.();
    this.items.forEach((item) => item.urls.forEach((url) => URL.revokeObjectURL(url)));
    this.items = [];
    this.running = false;
    this.container?.querySelector(".ci-results").replaceChildren();
    this.updateSummary();
  }
  hasActiveBackgroundWork() {
    return this.running || this.zipping;
  }
  onUnmount() {
    this.clear();
  }
}
