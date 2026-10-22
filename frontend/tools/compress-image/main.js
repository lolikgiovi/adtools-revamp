import { BaseTool } from "../../core/BaseTool.js";
import JSZip from "jszip";
import { UsageTracker } from "../../core/UsageTracker.js";
import { MAX_FILE_SIZE, fitDimensions, validatePng } from "./service.js";
import { inspectImage } from "./image-info.js";
import { PRESETS, selectCandidate } from "./config.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";

const size = (bytes) =>
  bytes < 1000
    ? `${bytes.toLocaleString()} B`
    : `${(bytes / (bytes >= 1000000 ? 1000000 : 1000)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${bytes >= 1000000 ? "MB" : "KB"}`;
const savings = (before, after) => `${Math.abs((1 - after / before) * 100).toFixed(1)}% ${after <= before ? "smaller" : "larger"}`;
const extension = (type) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" })[type] || "png";

export class CompressImage extends BaseTool {
  constructor(eventBus) {
    super({ id: "compress-image", eventBus });
    this.items = [];
    this.generation = 0;
    this.running = false;
    this.view = "pair";
  }
  getIconSvg() {
    return getIconSvg();
  }
  $(name) {
    return this.container.querySelector(`[data-ci="${name}"]`);
  }
  render() {
    return `<section class="tool-container compress-image" aria-label="Compress Image">
      <header class="ci-toolbar"><div><h2>Compress Image</h2>
        <p>Smaller files. A clear view of what changed. Images stay on your device.</p></div>
        </header>
      <div class="ci-setup"><div class="ci-drop">
        <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple id="ci-files" data-ci="files" aria-label="Add images" tabindex="-1" class="sr-only">
        <button class="btn btn-secondary" data-ci="choose">Add images</button>
        <p>or drop your files here</p><small>PNG, JPEG, WebP · 20 files · 32 MB each</small>
      </div><fieldset class="ci-settings"><legend class="sr-only">Compression settings</legend>
        <div class="ci-settings-line"><label>Preset<select data-ci="preset" name="preset" data-searchable-dropdown-ignore>
          <option value="high">High Quality</option><option value="balanced" selected>Balanced</option>
          <option value="small">Smaller File</option></select></label>
          <label class="ci-quality"><span>JPEG / WebP quality <output data-ci="quality-value">85</output></span>
          <input data-ci="quality" name="quality" aria-label="JPEG and WebP quality" type="range" min="1" max="100" value="85"></label></div>
        <div class="ci-options"><div class="ci-option"><label class="ci-toggle"><input data-ci="lossy-png" type="checkbox"> Allow lossy PNG</label>
        <div class="ci-bounds" data-ci="png-quality" hidden>
          <label>PNG minimum quality<input data-ci="png-min" type="number" min="0" max="100" step="1" value="80"></label>
          <label>PNG target quality<input data-ci="png-target" type="number" min="0" max="100" step="1" value="95"></label>
          <small>Reduces colors. Compare the result visually. 16-bit PNG stays on the lossless path.</small>
        </div>
        <p data-ci="mode-note">PNG stays lossless by default. JPEG and WebP use lossy compression. Original format kept.</p>
        </div><div class="ci-option"><label class="ci-toggle"><input data-ci="resize" type="checkbox" name="resize"> Reduce dimensions</label>
        <p data-ci="settings-note">Original dimensions kept</p>
        <div class="ci-bounds" data-ci="bounds" hidden><label>Max width (px)<input data-ci="width" name="max-width" type="number" min="1" max="16384" step="1" value="1920"></label>
          <label>Max height (px)<input data-ci="height" name="max-height" type="number" min="1" max="16384" step="1" value="1920"></label>
          <small>Fits within these bounds. No cropping or upscaling. Resizing changes pixels and converts colors to sRGB.</small></div>
        </div></div><div class="ci-run"><button class="btn btn-primary" data-ci="compress" disabled>Compress images</button></div>
      </fieldset></div>
      <p id="ci-error" class="ci-error-message" data-ci="error" role="alert" hidden></p>
      <div class="ci-batch"><div class="ci-batch-header"><div><h3>Images <span data-ci="ready-count"></span></h3>
        <p class="ci-summary" role="status" aria-live="polite">Add images, choose compression, then compare the results.</p></div>
        <div class="ci-actions"><button class="btn btn-ghost btn-sm" data-ci="clear" disabled>Clear all</button>
        <button class="btn btn-primary btn-sm" data-ci="zip" disabled>Download ZIP</button></div></div>
        <p class="ci-settings-hint" data-ci="changed" hidden>Settings changed. Compress again to update your results.</p>
        <div class="ci-list" role="region" aria-label="Image results" tabindex="0" hidden>
          <table><thead><tr><th scope="col">Image</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Saved</th><th scope="col"><span class="sr-only">Download</span></th></tr></thead>
          <tbody class="ci-results"></tbody></table></div></div>
      <section class="ci-inspector" aria-label="Image comparison" hidden></section>
    </section>`;
  }
  onMount() {
    const input = this.container.querySelector("#ci-files");
    this.$("choose").addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      this.addFiles(input.files);
      input.value = "";
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
    this.$("clear").addEventListener("click", () => this.clear());
    this.$("zip").addEventListener("click", () => this.downloadZip());
    this.$("compress").addEventListener("click", () => this.processQueue());
    this.container.querySelectorAll(".ci-settings input, .ci-settings select").forEach((input) => {
      input.addEventListener("change", () => this.updateSettings());
    });
    this.$("preset").addEventListener("change", () => {
      const preset = PRESETS[this.$("preset").value];
      this.$("quality").value = preset.jpeg.quality;
      this.$("png-min").value = preset.quantize.quality.min;
      this.$("png-target").value = preset.quantize.quality.target;
      this.updateSettings();
    });
    this.$("quality").addEventListener("input", () => this.updateSettings());
  }
  updateSettings() {
    const lossy = this.$("lossy-png").checked;
    const resize = this.$("resize").checked;
    this.$("png-quality").hidden = !lossy;
    this.$("bounds").hidden = !resize;
    this.$("mode-note").textContent = lossy
      ? "PNG color reduction is enabled. JPEG and WebP are lossy. Original format kept; compare before downloading."
      : "PNG stays lossless by default. JPEG and WebP use lossy compression. Original format kept.";
    this.$("settings-note").textContent = resize ? "Resize first, then compress" : "Original dimensions kept";
    this.$("changed").hidden = !this.items.some((item) => item.result);
    this.$("quality-value").textContent = this.$("quality").value;
    this.$("compress").classList.add("btn-primary");
    this.$("compress").classList.remove("btn-secondary");
  }
  error(message, field) {
    this.container.querySelectorAll('[aria-invalid="true"]').forEach((input) => {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    });
    if (field) {
      this.$(field).setAttribute("aria-invalid", "true");
      this.$(field).setAttribute("aria-describedby", "ci-error");
      this.$(field).focus();
    }
    this.$("error").hidden = !message;
    this.$("error").textContent = message;
  }
  addFiles(files) {
    if (this.running || this.zipping) return this.error("Wait for this batch to finish before adding more images.");
    let total = this.items.reduce((sum, item) => sum + item.file.size, 0);
    for (const file of files) {
      if (this.items.length >= 20 || total + file.size > 128 * 1024 * 1024) {
        this.error("Add up to 20 images and 128 MB in total. Clear this batch to add more.");
        break;
      }
      total += file.size;
      const item = { file, status: "Queued", urls: [], logs: [], startedAt: performance.now(), logId: this.items.length + 1 };
      this.items.push(item);
      this.createRow(item);
    }
    this.updateSummary();
  }
  createRow(item) {
    const row = document.createElement("tr");
    row.className = "ci-file-row";
    row.innerHTML = `<th scope="row"><button class="ci-select" aria-pressed="false" disabled><span class="ci-filename"></span><span class="ci-file-state">Queued</span></button></th>
      <td class="ci-before"></td><td class="ci-after">—</td><td class="ci-saved">—</td>
      <td><button class="btn btn-ghost btn-sm ci-download" disabled>Download</button></td>`;
    row.querySelector(".ci-filename").textContent = item.file.name;
    row.querySelector(".ci-before").textContent = size(item.file.size);
    row.querySelector(".ci-select").addEventListener("click", () => this.selectItem(item));
    row.querySelector(".ci-download").addEventListener("click", () => this.download(item.blob, this.outputName(item)));
    row.querySelector(".ci-download").setAttribute("aria-label", `Download ${item.file.name}`);
    item.row = row;
    this.container.querySelector(".ci-results").appendChild(row);
  }
  async processQueue() {
    if (this.running || this.zipping || !this.items.length) return;
    const settings = {
      preset: this.$("preset").value,
      lossyPng: this.$("lossy-png").checked,
      pngQuality: { min: Number(this.$("png-min").value), target: Number(this.$("png-target").value) },
      resize: this.$("resize").checked,
      quality: Number(this.$("quality").value),
      width: Number(this.$("width").value),
      height: Number(this.$("height").value),
    };
    if (
      !PRESETS[settings.preset] ||
      !Number.isInteger(settings.quality) ||
      settings.quality < 1 ||
      settings.quality > 100 ||
      (settings.lossyPng &&
        (!Number.isInteger(settings.pngQuality.min) ||
          !Number.isInteger(settings.pngQuality.target) ||
          settings.pngQuality.min < 0 ||
          settings.pngQuality.target > 100 ||
          settings.pngQuality.min > settings.pngQuality.target))
    ) {
      const invalid = !PRESETS[settings.preset]
        ? "preset"
        : !this.$("quality").validity.valid
          ? "quality"
          : !this.$("png-min").validity.valid
            ? "png-min"
            : "png-target";
      this.error("Choose quality values between 0 and 100, with PNG minimum no higher than its target.", invalid);
      return;
    }
    if (settings.resize) {
      try {
        fitDimensions(1, 1, settings.width, settings.height);
      } catch (error) {
        this.error(error.message, this.$("width").validity.valid ? "height" : "width");
        return;
      }
    }
    this.error("");
    this.$("changed").hidden = true;
    this.running = true;
    const generation = this.generation;
    const pending = [...this.items];
    pending.forEach((item) => {
      item.status = "Queued";
      this.updateRow(item);
    });
    this.updateSummary();
    try {
      for (const item of pending) {
        if (generation !== this.generation) return;
        item.status = "Compressing…";
        this.updateRow(item);
        this.updateSummary();
        try {
          await this.compressItem(item, settings, generation);
          if (generation !== this.generation) return;
          item.status = "Ready";
          this.log(item, "Completed", { outcome: item.result.outcome });
          item.error = null;
          try {
            UsageTracker.trackToolUse("compress-image", "compress");
          } catch (_) {
            /* Analytics cannot interrupt local processing. */
          }
        } catch (error) {
          if (generation !== this.generation) return;
          item.status = "Error";
          item.error = `${error.message}${item.result ? " Previous result kept." : ""}`;
          this.log(item, "processing.failed", { message: error.message });
        }
        this.updateRow(item);
        this.updateSummary();
        if (!this.selected || this.selected === item) this.selectItem(item);
      }
    } finally {
      if (generation === this.generation) {
        this.running = false;
        this.updateSummary();
      }
    }
  }
  async compressItem(item, settings, generation) {
    item.logs = [];
    item.startedAt = performance.now();
    this.log(item, "Reading", { inputBytes: item.file.size });
    if (!item.file.size || item.file.size > MAX_FILE_SIZE) throw new Error("Choose an image between 1 byte and 32 MB.");
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    if (generation !== this.generation) return;
    this.log(item, "Validating", {});
    const info = inspectImage(bytes);
    const before = URL.createObjectURL(new Blob([bytes], { type: info.type }));
    const canvas = document.createElement("canvas");
    const temporaryUrls = new Set([before]);
    try {
      this.log(item, "Decoding", { decoder: "browser", colorSpace: "sRGB", orientation: "from image" });
      const image = new Image();
      image.src = before;
      await image.decode();
      if (generation !== this.generation) return;
      const width = image.naturalWidth,
        height = image.naturalHeight;
      if (!width || !height || width > 16384 || height > 16384 || width * height > 16000000) {
        throw new Error("Choose an image under 16 megapixels and 16,384 pixels per side.");
      }
      const target = settings.resize ? fitDimensions(width, height, settings.width, settings.height) : { width, height };
      const resized = target.width !== width || target.height !== height;
      let pixels;
      if (info.type !== "image/png" || resized || (settings.lossyPng && info.depth !== 16)) {
        if (resized) this.log(item, "Resizing", { ...target });
        canvas.width = target.width;
        canvas.height = target.height;
        const context = canvas.getContext("2d", { colorSpace: "srgb" });
        if (!context) throw new Error("Image decoding is unavailable in this browser.");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, target.width, target.height);
        pixels = context.getImageData(0, 0, target.width, target.height);
      }
      const result = await this.runWorker(
        {
          bytes: bytes.buffer,
          image: pixels,
          type: info.type,
          resized,
          ...settings,
        },
        (stage, details) => this.log(item, stage, details),
      );
      if (generation !== this.generation) return;
      if (result.type !== info.type || result.width !== target.width || result.height !== target.height) {
        throw new Error("Output format or dimensions failed verification.");
      }
      this.log(item, "Verifying", { codec: result.codec });
      const verify = async (candidate) => {
        if (info.type === "image/png") validatePng(candidate);
        const header = inspectImage(candidate);
        if (header.type !== info.type || header.width !== target.width || header.height !== target.height) {
          throw new Error("Candidate format or dimensions failed verification.");
        }
        const blob = new Blob([candidate], { type: info.type });
        const url = URL.createObjectURL(blob);
        temporaryUrls.add(url);
        const decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        if (decoded.naturalWidth !== target.width || decoded.naturalHeight !== target.height) {
          throw new Error("Candidate preview failed dimension verification.");
        }
        return { blob, url };
      };
      const candidate = await verify(result.bytes);
      const baseline = result.baseline ? await verify(result.baseline) : null;
      if (generation !== this.generation) return;
      const selection = selectCandidate({
        original: item.file.size,
        baseline: baseline ? baseline.blob.size : result.lossy ? undefined : candidate.blob.size,
        candidate: result.lossy ? candidate.blob.size : undefined,
        resized,
      });
      const originalKept = selection === "original";
      const selected = originalKept
        ? { blob: new Blob([item.file], { type: info.type }), url: before }
        : selection === "baseline" && baseline
          ? baseline
          : candidate;
      const lossy = !originalKept && selection === "candidate" && result.lossy;
      const outcome = originalKept
        ? "Original kept"
        : lossy
          ? info.type === "image/png"
            ? "Lossy PNG accepted"
            : "Optimized"
          : settings.lossyPng
            ? "Lossless result used"
            : "Optimized";
      item.urls.forEach((url) => URL.revokeObjectURL(url));
      item.before = before;
      item.after = selected.url;
      item.urls = [...new Set([before, selected.url])];
      item.urls.forEach((url) => temporaryUrls.delete(url));
      item.blob = selected.blob;
      item.result = {
        width: target.width,
        height: target.height,
        originalWidth: width,
        originalHeight: height,
        resized,
        lossy,
        originalKept,
        outcome,
        codec: lossy ? result.codec : info.type === "image/png" ? "Oxipng" : result.codec,
        quality: settings.quality,
        quantizationQuality: lossy ? result.quantizationQuality : undefined,
        fallbackReason: result.fallbackReason,
        metadataRemovedBytes: originalKept || lossy ? 0 : result.metadataRemovedBytes || 0,
      };
      this.log(item, "output.accepted", {
        outcome,
        selection,
        width: target.width,
        height: target.height,
        outputBytes: selected.blob.size,
        inputBytes: item.file.size,
        resized,
        lossy,
      });
    } finally {
      canvas.width = canvas.height = 1;
      temporaryUrls.forEach((url) => URL.revokeObjectURL(url));
    }
  }
  updateRow(item) {
    const row = item.row,
      result = item.result;
    row.querySelector(".ci-select").disabled = !result && item.status !== "Error";
    row.querySelector(".ci-download").disabled = !result || item.status === "Compressing…";
    row.classList.toggle("ci-error", item.status === "Error");
    const note =
      item.error ||
      (result ? `${result.width} × ${result.height} px · ${result.resized ? "Resized · " : ""}${result.outcome}` : item.status);
    row.querySelector(".ci-file-state").textContent =
      item.status === "Compressing…" ? `${item.stage || "Reading"}…` : item.status === "Queued" ? item.status : note;
    if (result) {
      row.querySelector(".ci-after").textContent = size(item.blob.size);
      row.querySelector(".ci-saved").textContent = savings(item.file.size, item.blob.size);
      row.querySelector(".ci-saved").classList.toggle("ci-reduced", item.blob.size < item.file.size);
    }
  }
  selectItem(item) {
    this.selected = item;
    this.items.forEach((entry) => {
      entry.row.classList.toggle("is-selected", entry === item);
      entry.row.querySelector(".ci-select").setAttribute("aria-pressed", String(entry === item));
    });
    const inspector = this.container.querySelector(".ci-inspector");
    inspector.hidden = false;
    inspector.innerHTML = `<header class="ci-inspector-header"><div><h3></h3><p class="ci-detail"></p></div>
      </header><div class="ci-comparison-toolbar"><div class="ci-view-controls" role="group" aria-label="Comparison view"><button class="btn btn-sm btn-secondary" data-ci="pair">Side by side</button>
      <button class="btn btn-sm btn-secondary" data-ci="overlay">Slider</button></div><div data-ci="preview-controls"></div></div>
      <div class="ci-preview"></div><details class="ci-diagnostics"><summary>Processing details</summary>
      <p>PNG uses Oxipng; optional color reduction uses libimagequant first. JPEG uses MozJPEG; WebP uses libwebp. Quality values across codecs are not equivalent. JPEG/WebP and lossy PNG are rendered in sRGB; orientation is applied before encoding. Other metadata is not copied on these paths.</p>
      <div class="ci-log-actions"><a href="./licenses/image-optimizer/NOTICE.txt" target="_blank" rel="noopener">Image library licenses</a>
      <button class="btn btn-secondary btn-sm" data-ci="copy-log">Copy log</button></div><pre tabindex="0" aria-label="Processing log"></pre></details>`;
    inspector.querySelector("h3").textContent = item.file.name;
    const result = item.result;
    inspector.querySelector(".ci-detail").textContent =
      item.error ||
      (result
        ? result.originalKept
          ? "No worthwhile reduction found. Original kept."
          : `${result.resized ? `Resized from ${result.originalWidth} × ${result.originalHeight} to ${result.width} × ${result.height} px. Pixels changed; rendered in sRGB. ` : "Dimensions unchanged. "}${result.lossy ? `${result.codec}. ${item.blob.type === "image/png" ? "PNG colors reduced." : `Quality ${result.quality}.`} Compare detail, colors and transparency before downloading.` : result.resized ? "PNG encoding is lossless relative to the resized pixels." : "PNG pixels and rendering metadata preserved."}${result.fallbackReason ? ` ${result.fallbackReason}` : ""}${result.metadataRemovedBytes ? ` Removed ${size(result.metadataRemovedBytes)} of text comments.` : ""}`
        : "Choose another file or correct the input and compress again.");
    inspector.querySelector("pre").textContent = item.logs.map((entry) => `${entry.stage} ${JSON.stringify(entry.details)}`).join("\n");
    this.$("copy-log").addEventListener("click", () =>
      this.copyToClipboard(JSON.stringify({ tool: "compress-image", entries: item.logs }, null, 2)),
    );
    this.$("pair").addEventListener("click", () => {
      this.view = "pair";
      this.showPreview(item);
    });
    this.$("overlay").addEventListener("click", () => {
      this.view = "overlay";
      this.showPreview(item);
    });
    this.showPreview(item);
  }
  showPreview(item) {
    const preview = this.container.querySelector(".ci-preview");
    this.$("pair").setAttribute("aria-pressed", String(this.view === "pair"));
    this.$("overlay").setAttribute("aria-pressed", String(this.view === "overlay"));
    if (!item.result) {
      preview.replaceChildren();
      return;
    }
    this.$("preview-controls").innerHTML =
      `<div class="ci-zoom-controls"><label>Zoom <input data-ci="zoom" type="range" min="1" max="8" step="0.25" value="1"><output data-ci="zoom-value">Fit</output></label>
      <button class="btn btn-ghost btn-sm" data-ci="fit">Reset view</button>
      </div><div class="ci-preview-downloads"><button class="btn btn-ghost btn-sm" data-ci="original">Download original</button>
      <button class="btn btn-secondary btn-sm" data-ci="result">Download result</button></div>`;
    this.$("result").disabled = this.running || this.zipping;
    this.$("result").addEventListener("click", () => this.download(item.blob, this.outputName(item)));
    preview.innerHTML = `<p class="ci-pan-hint">Zoom is linked. Drag to pan, or use arrow keys.</p>
      <div class="ci-pair" ${this.view === "pair" ? "" : "hidden"}>
      <figure><figcaption>Original <span>${size(item.file.size)}</span></figcaption><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Original image. Arrow keys pan; plus and minus zoom."><img alt="Original image"><span class="ci-cursor" hidden></span></div></figure>
      <figure><figcaption>Result <span>${size(item.blob.size)}</span></figcaption><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Result image. Arrow keys pan; plus and minus zoom."><img alt="Compressed result"><span class="ci-cursor" hidden></span></div></figure></div>
      <div class="ci-overlay" ${this.view === "overlay" ? "" : "hidden"}><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Image comparison. Arrow keys pan; plus and minus zoom.">
        <img alt="Original image"><div class="ci-reveal ci-checker"><img alt="Compressed result"></div><span class="ci-divider" aria-hidden="true"></span>
        <span class="ci-overlay-label ci-label-before">Original</span><span class="ci-overlay-label ci-label-after">Result</span></div>
        <label class="ci-slider">Original <input data-ci="split" type="range" min="0" max="100" value="50" aria-label="Before and after comparison"> Result</label></div>`;
    this.$("original").addEventListener("click", () => this.download(item.file, item.file.name));
    const images = preview.querySelectorAll("img");
    [item.before, item.after, item.before, item.after].forEach((url, i) => {
      images[i].src = url;
      images[i].draggable = false;
      images[i].width = i % 2 ? item.result.width : item.result.originalWidth;
      images[i].height = i % 2 ? item.result.height : item.result.originalHeight;
    });
    let zoom = 1,
      x = 0,
      y = 0,
      drag;
    const update = () => {
      const bound = (zoom - 1) / 2;
      x = Math.max(-bound, Math.min(bound, x));
      y = Math.max(-bound, Math.min(bound, y));
      images.forEach((img) => {
        img.style.transform = `translate(${x * 100}%, ${y * 100}%) scale(${zoom})`;
      });
      preview.querySelectorAll(".ci-viewport").forEach((pane) => {
        pane.style.touchAction = zoom > 1 ? "none" : "pan-y";
        pane.classList.toggle("is-zoomed", zoom > 1);
      });
      this.$("zoom").value = zoom;
      this.$("zoom-value").textContent = zoom === 1 ? "Fit" : `${zoom}×`;
    };
    this.$("zoom").addEventListener("input", () => {
      zoom = Number(this.$("zoom").value);
      update();
    });
    this.$("fit").addEventListener("click", () => {
      zoom = 1;
      x = y = 0;
      update();
    });
    preview.querySelectorAll(".ci-viewport").forEach((pane) => {
      pane.addEventListener("pointerdown", (event) => {
        if (zoom === 1 || event.button !== 0) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        pane.setPointerCapture(event.pointerId);
      });
      pane.addEventListener("pointermove", (event) => {
        const rect = pane.getBoundingClientRect();
        if (drag?.id === event.pointerId) {
          x += (event.clientX - drag.x) / rect.width;
          y += (event.clientY - drag.y) / rect.height;
          drag.x = event.clientX;
          drag.y = event.clientY;
          update();
        }
        preview.querySelectorAll(".ci-cursor").forEach((cursor) => {
          cursor.hidden = false;
          cursor.style.left = `${Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))}%`;
          cursor.style.top = `${Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))}%`;
        });
      });
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
        pane.addEventListener(name, () => {
          drag = null;
        });
      pane.addEventListener("pointerleave", () =>
        preview.querySelectorAll(".ci-cursor").forEach((cursor) => {
          cursor.hidden = true;
        }),
      );
      pane.addEventListener("keydown", (event) => {
        const delta = { ArrowLeft: [0.1, 0], ArrowRight: [-0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[event.key];
        if (delta) {
          event.preventDefault();
          x += delta[0];
          y += delta[1];
          update();
        }
        if (["+", "=", "-"].includes(event.key)) {
          event.preventDefault();
          zoom = Math.min(8, Math.max(1, zoom + (event.key === "-" ? -0.25 : 0.25)));
          update();
        }
      });
    });
    const split = () => {
      const value = this.$("split").value;
      preview.querySelector(".ci-reveal").style.clipPath = `inset(0 0 0 ${value}%)`;
      preview.querySelector(".ci-divider").style.left = `${value}%`;
    };
    this.$("split").addEventListener("input", split);
    split();
    update();
  }
  log(item, stage, details) {
    item.logs.push({ elapsedMs: Math.round(performance.now() - item.startedAt), stage, details });
    if (item.logs.length > 160) item.logs.shift();
    if (
      [
        "Reading",
        "Validating",
        "Decoding",
        "Resizing",
        "Loading optimizer",
        "Quantizing",
        "Encoding",
        "Optimizing",
        "Verifying",
        "Completed",
      ].includes(stage)
    ) {
      item.stage = stage;
      this.updateRow(item);
    }
  }
  runWorker(payload, report) {
    return new Promise((resolve, reject) => {
      const worker = (this.worker ||= new Worker(new URL("./worker.js", import.meta.url), { type: "module" }));
      let finished = false;
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        this.cancelWorker = null;
        if (error) {
          worker.terminate();
          if (this.worker === worker) this.worker = null;
          reject(error);
        } else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error("Compression timed out. Try a smaller image.")), 60000);
      this.cancelWorker = () => finish(new Error("Cancelled"));
      worker.onmessage = ({ data }) => {
        if (data.log) report(data.log.stage, data.log.details);
        else finish(data.error ? new Error(data.error) : null, data.result);
      };
      worker.onerror = (event) => finish(new Error(event.message || "Compression worker failed."));
      worker.onmessageerror = () => finish(new Error("Unable to read the compression worker response."));
      worker.postMessage(payload, [payload.bytes, ...(payload.image ? [payload.image.data.buffer] : [])]);
    });
  }

  updateSummary() {
    if (!this.container) return;
    const ready = this.items.filter((item) => item.result && item.status !== "Compressing…");
    const before = ready.reduce((sum, item) => sum + item.file.size, 0),
      after = ready.reduce((sum, item) => sum + item.blob.size, 0);
    const errors = this.items.filter((item) => item.status === "Error").length;
    this.$("ready-count").textContent = this.items.length ? `${ready.length} of ${this.items.length} ready` : "";
    this.container.querySelector(".ci-summary").textContent = this.zipping
      ? "Creating ZIP…"
      : this.items.length
        ? `${ready.length ? `${size(before)} → ${size(after)} · ${after <= before ? `${size(before - after)} saved` : `${size(after - before)} larger`} (${savings(before, after)})` : "Images are queued. Choose settings, then compress."}${errors ? ` · ${errors} failed` : ""}${this.running ? " · Compressing…" : ""}`
        : "Add images, choose compression, then compare the results.";
    this.container.querySelector(".ci-list").hidden = !this.items.length;
    this.$("clear").disabled = !this.items.length;
    this.$("zip").textContent = this.zipping ? "Creating ZIP…" : "Download ZIP";
    this.$("compress").classList.toggle("btn-primary", !ready.length || !this.$("changed").hidden);
    this.$("compress").classList.toggle("btn-secondary", ready.length > 0 && this.$("changed").hidden);
    if (this.$("result")) this.$("result").disabled = this.running || this.zipping;
    this.$("zip").disabled = !ready.length || this.running || this.zipping;
    this.$("compress").disabled = !this.items.length || this.running || this.zipping;
    this.$("compress").textContent = this.running
      ? "Compressing…"
      : this.items.some((item) => item.result)
        ? "Compress again"
        : "Compress images";
    this.container.querySelectorAll(".ci-settings input, .ci-settings select").forEach((input) => {
      input.disabled = this.running || this.zipping;
    });
    this.$("choose").disabled = this.running || this.zipping;
    this.items.forEach((item) => {
      item.row.querySelector(".ci-download").disabled = !item.result || this.running || this.zipping;
    });
  }
  outputName(item) {
    const sourceExtension = item.file.name.split(".").at(-1).toLowerCase();
    const ext = item.blob.type === "image/jpeg" && sourceExtension === "jpeg" ? "jpeg" : extension(item.blob.type);
    return `${item.file.name.replace(/\.[^.]+$/, "") || "image"}.${ext}`;
  }
  download(blob, name) {
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async downloadZip() {
    if (this.running || this.zipping || !this.items.some((item) => item.result)) return;
    const generation = this.generation;
    this.zipping = true;
    this.updateSummary();
    try {
      const zip = new JSZip(),
        names = new Set();
      for (const item of this.items.filter((entry) => entry.result)) {
        const ext = this.outputName(item).split(".").at(-1);
        const base = item.file.name.replace(/\.[^.]+$/, "").replace(/[\\/\p{Cc}]/gu, "_") || "image";
        let name = `${base}.${ext}`,
          suffix = 2;
        while (names.has(name.toLowerCase())) name = `${base} (${suffix++}).${ext}`;
        names.add(name.toLowerCase());
        zip.file(name, await item.blob.arrayBuffer());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      if (generation === this.generation) this.download(blob, "compressed-images.zip");
    } catch (_) {
      if (generation === this.generation) this.error("Unable to create ZIP. Download the images individually.");
    } finally {
      this.zipping = false;
      this.updateSummary();
    }
  }
  clear() {
    this.generation++;
    this.cancelWorker?.();
    this.worker?.terminate();
    this.worker = null;
    this.items.forEach((item) => item.urls.forEach((url) => URL.revokeObjectURL(url)));
    this.items = [];
    this.selected = null;
    this.running = false;
    this.container?.querySelector(".ci-results").replaceChildren();
    const inspector = this.container?.querySelector(".ci-inspector");
    if (inspector) {
      inspector.hidden = true;
      inspector.replaceChildren();
    }
    if (this.container) {
      this.error("");
      this.$("changed").hidden = true;
    }
    this.updateSummary();
  }
  hasActiveBackgroundWork() {
    return this.running || this.zipping;
  }
  onUnmount() {
    this.clear();
  }
}
