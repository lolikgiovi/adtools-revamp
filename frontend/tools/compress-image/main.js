import { BaseTool } from "../../core/BaseTool.js";
import JSZip from "jszip";
import { UsageTracker } from "../../core/UsageTracker.js";
import { MAX_FILE_SIZE, fitDimensions } from "./service.js";
import { inspectImage, imageType, headerDimensions } from "./image-info.js";
import {
  PRESETS,
  PHONE_SIZES,
  selectCandidate,
  minimumSavings,
  largerThan,
  poolSize,
  jobMemoryBytes,
  jobTimeoutMs,
  MEMORY_BUDGET,
} from "./config.js";
import { WorkerPool } from "./worker-pool.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";

export const formatSize = (bytes) =>
  bytes < 1000
    ? `${bytes.toLocaleString()} B`
    : `${(bytes / (bytes >= 1000000 ? 1000000 : 1000)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${bytes >= 1000000 ? "MB" : "KB"}`;
const size = formatSize;
const savings = (before, after) => `${Math.abs((1 - after / before) * 100).toFixed(1)}% ${after <= before ? "smaller" : "larger"}`;
const extension = (type) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" })[type] || "png";

export class CompressImage extends BaseTool {
  constructor(eventBus) {
    super({ id: "compress-image", eventBus });
    this.items = [];
    this.generation = 0;
    this.running = false;
    this.view = "pair";
    // "auto" decodes in the worker when it can; "main" forces the main-thread fallback.
    this.decoder = "auto";
    // Resolves when the background pass that prepares the smaller-PNG offer settles.
    this.offers = Promise.resolve();
    const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 767px)").matches;
    this.pool = new WorkerPool({
      create: () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" }),
      size: poolSize(navigator.hardwareConcurrency, narrow),
      memoryBudget: narrow ? MEMORY_BUDGET.narrow : MEMORY_BUDGET.desktop,
      timeoutFor: (job) => jobTimeoutMs(job.megapixels),
    });
  }
  getIconSvg() {
    return getIconSvg();
  }
  $(name) {
    return this.container.querySelector(`[data-ci="${name}"]`);
  }
  render() {
    const choice = (size, label, detail) =>
      `<button type="button" class="ci-choice" data-size="${size}" aria-pressed="false">${label}${detail ? `<span>${detail}</span>` : ""}</button>`;
    return `<section class="tool-container compress-image" aria-label="Compress Image">
      <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple id="ci-files" data-ci="files" aria-label="Add images" tabindex="-1" class="sr-only">
      <div class="ci-drop">
        <svg class="ci-drop-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="7" y="7" width="34" height="34" rx="8" stroke="currentColor" stroke-width="1.5"/><path d="M15 31l7.2-7.5 5.2 5.2 3.5-3.7L36 31" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18.5" cy="17.5" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
        <p class="ci-drop-title">Drop images to compress</p>
        <button type="button" class="btn btn-primary" data-ci="choose">Add images</button>
      </div>
      <p id="ci-error" class="ci-error-message" data-ci="error" role="alert" hidden></p>
      <div class="ci-batch" hidden>
        <div class="ci-batch-header">
          <p class="ci-status"><span class="ci-count" data-ci="ready-count"></span> <span class="ci-summary" role="status" aria-live="polite"></span></p>
          <div class="ci-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-ci="settings-toggle" aria-expanded="false" aria-controls="ci-settings">Settings</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ci="add">Add</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ci="clear">Clear</button>
            <button type="button" class="btn btn-secondary btn-sm" data-ci="zip" hidden>Download ZIP</button>
            <button type="button" class="btn btn-primary btn-sm" data-ci="compress">Compress images</button>
          </div>
        </div>
        <fieldset class="ci-settings" id="ci-settings" data-ci="settings-panel" hidden>
          <legend class="sr-only">Compression settings</legend>
          <label>Preset<select data-ci="preset" name="preset" data-searchable-dropdown-ignore>
            <option value="high">High Quality</option><option value="balanced" selected>Balanced</option><option value="small">Smaller File</option></select></label>
          <label class="ci-quality"><span>JPEG / WebP quality <output data-ci="quality-value">85</output></span>
            <input data-ci="quality" name="quality" type="range" min="1" max="100" value="85"></label>
          <div class="ci-option"><label class="ci-toggle"><input data-ci="lossy-png" type="checkbox"> Reduce PNG colors</label>
            <div class="ci-bounds" data-ci="png-quality" hidden>
              <label>Minimum quality<input data-ci="png-min" type="number" min="0" max="100" step="1" value="80"></label>
              <label>Target quality<input data-ci="png-target" type="number" min="0" max="100" step="1" value="95"></label>
            </div></div>
          <div class="ci-option"><label class="ci-toggle"><input data-ci="resize" type="checkbox" name="resize"> Limit size</label>
            <div class="ci-bounds" data-ci="bounds" hidden>
              <label>Max width<input data-ci="width" name="max-width" type="number" min="1" max="16384" step="1" value="1920"></label>
              <label>Max height<input data-ci="height" name="max-height" type="number" min="1" max="16384" step="1" value="1920"></label>
            </div></div>
        </fieldset>
        <div class="ci-card" data-ci="advice-size" hidden>
          <p class="ci-card-title" data-ci="advice-size-title"></p>
          <div class="ci-choices ci-segmented" role="group" aria-label="Image size">${choice("full", "Full width", `${PHONE_SIZES.full.width} px`)}${choice("half", "Half width", `${PHONE_SIZES.half.width} px`)}${choice("original", "Original")}</div>
        </div>
        <div class="ci-card" data-ci="advice-lossy" hidden>
          <p class="ci-card-title" data-ci="advice-lossy-title"></p>
          <div class="ci-choices"><button type="button" class="btn btn-secondary btn-sm" data-ci="use-smaller">Use smaller</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ci="undo-smaller" hidden>Undo</button></div>
        </div>
        <div class="ci-list" role="region" aria-label="Images" tabindex="0">
          <table><thead><tr><th scope="col">Image</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Saved</th><th scope="col"><span class="sr-only">Download</span></th></tr></thead>
          <tbody class="ci-results"></tbody></table></div>
      </div>
      <section class="ci-inspector" aria-label="Image comparison" hidden></section>
    </section>`;
  }
  onMount() {
    const input = this.container.querySelector("#ci-files");
    const pick = () => input.click();
    this.$("choose").addEventListener("click", pick);
    this.$("add").addEventListener("click", pick);
    input.addEventListener("change", () => {
      this.addFiles(input.files);
      input.value = "";
    });
    // The whole tool accepts drops, so adding more images never needs the empty state.
    const surface = this.container.querySelector(".compress-image");
    surface.addEventListener("dragover", (event) => {
      event.preventDefault();
      surface.classList.add("is-dragging");
    });
    surface.addEventListener("dragleave", (event) => {
      if (!surface.contains(event.relatedTarget)) surface.classList.remove("is-dragging");
    });
    surface.addEventListener("drop", (event) => {
      event.preventDefault();
      surface.classList.remove("is-dragging");
      this.addFiles(event.dataTransfer.files);
    });
    this.$("clear").addEventListener("click", () => this.clear());
    this.$("zip").addEventListener("click", () => this.downloadZip());
    this.$("compress").addEventListener("click", () => this.processQueue());
    this.$("settings-toggle").addEventListener("click", () => this.toggleSettings(this.$("settings-panel").hidden));
    this.container.querySelectorAll(".ci-settings input, .ci-settings select").forEach((input) => {
      input.addEventListener("change", () => this.updateSettings());
    });
    this.$("preset").addEventListener("change", () => {
      const preset = PRESETS[this.$("preset").value];
      this.$("quality").value = preset.jpeg.quality;
      this.$("png-min").value = preset.quantize.quality.min;
      this.$("png-target").value = preset.quantize.quality.target;
      if (preset.enablesLossyPng) this.$("lossy-png").checked = true;
      this.updateSettings();
    });
    this.$("quality").addEventListener("input", () => this.updateSettings());
    this.container.querySelectorAll(".ci-choice").forEach((button) => {
      button.addEventListener("click", () => this.chooseSize(button.dataset.size));
    });
    this.$("use-smaller").addEventListener("click", () => this.useSmaller(true));
    this.$("undo-smaller").addEventListener("click", () => this.useSmaller(false));
    this.updateSettings();
  }
  // The settings controls are the single source of truth; cards and presets only write to them.
  readSettings() {
    return {
      preset: this.$("preset").value,
      lossyPng: this.$("lossy-png").checked,
      pngQuality: { min: Number(this.$("png-min").value), target: Number(this.$("png-target").value) },
      resize: this.$("resize").checked,
      quality: Number(this.$("quality").value),
      width: Number(this.$("width").value),
      height: Number(this.$("height").value),
    };
  }
  // Results are stale when the settings differ from the ones they were made with.
  isStale() {
    return this.items.some((item) => item.result) && this.appliedSettings !== JSON.stringify(this.readSettings());
  }
  updateSettings() {
    this.$("png-quality").hidden = !this.$("lossy-png").checked;
    this.$("bounds").hidden = !this.$("resize").checked;
    this.$("quality-value").textContent = this.$("quality").value;
    this.updateAdvice();
    this.updateSummary();
  }
  toggleSettings(open) {
    this.$("settings-panel").hidden = !open;
    this.$("settings-toggle").setAttribute("aria-expanded", String(open));
  }
  chooseSize(name) {
    const bounds = PHONE_SIZES[name];
    this.$("resize").checked = !!bounds;
    if (bounds) {
      this.$("width").value = bounds.width;
      this.$("height").value = bounds.height;
    }
    this.updateSettings();
  }
  // Decision cards: one per finding, built from the files and the current settings.
  updateAdvice() {
    if (!this.container) return;
    const large = this.items.filter((item) => largerThan(item.dimensions, PHONE_SIZES.full)).length;
    const settings = this.readSettings();
    const chosen = !settings.resize
      ? "original"
      : Object.keys(PHONE_SIZES).find((name) => PHONE_SIZES[name].width === settings.width && PHONE_SIZES[name].height === settings.height);
    this.$("advice-size").hidden = !large;
    this.$("advice-size-title").textContent = `${large} image${large === 1 ? " is" : "s are"} larger than a phone screen`;
    this.container.querySelectorAll(".ci-choice").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.size === chosen));
    });
    const offered = this.items.filter((item) => item.alternative);
    const used = offered.filter((item) => item.previous);
    this.$("advice-lossy").hidden = !offered.length;
    if (offered.length) {
      const before = offered.reduce((sum, item) => sum + (item.previous || item).blob.size, 0);
      const after = offered.reduce((sum, item) => sum + item.alternative.blob.size, 0);
      const count = `${offered.length} PNG${offered.length === 1 ? "" : "s"}`;
      this.$("advice-lossy-title").textContent =
        `${used.length ? "Colors reduced in" : "Reduce colors in"} ${count}: ${size(before)} → ${size(after)}`;
      this.$("use-smaller").hidden = !!used.length;
      this.$("undo-smaller").hidden = !used.length;
      this.$("use-smaller").disabled = this.$("undo-smaller").disabled = this.running || this.zipping;
    }
  }
  error(message, field) {
    this.container.querySelectorAll('[aria-invalid="true"]').forEach((input) => {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    });
    if (field) {
      if (this.$("settings-panel").contains(this.$(field))) this.toggleSettings(true);
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
      this.readDimensions(item);
    }
    this.updateSummary();
  }
  // Header-only dimensions for the row and the size card; the worker still inspects every file.
  async readDimensions(item) {
    const head = new Uint8Array(await item.file.slice(0, 65536).arrayBuffer());
    if (!this.items.includes(item)) return;
    item.dimensions = headerDimensions(head) || undefined;
    this.updateRow(item);
    this.updateAdvice();
  }
  createRow(item) {
    const row = document.createElement("tr");
    row.className = "ci-file-row";
    row.innerHTML = `<th scope="row"><button type="button" class="ci-select" aria-pressed="false" disabled><span class="ci-filename"></span><span class="ci-file-state"></span></button></th>
      <td class="ci-before"></td><td class="ci-after">—</td><td class="ci-saved">—</td>
      <td><button type="button" class="btn btn-ghost btn-sm ci-download" disabled>Download</button></td>`;
    row.querySelector(".ci-filename").textContent = item.file.name;
    row.querySelector(".ci-before").textContent = size(item.file.size);
    row.querySelector(".ci-select").addEventListener("click", () => {
      this.pinned = true;
      this.selectItem(item);
    });
    row.querySelector(".ci-download").addEventListener("click", () => this.download(item.blob, this.outputName(item)));
    row.querySelector(".ci-download").setAttribute("aria-label", `Download ${item.file.name}`);
    item.row = row;
    this.container.querySelector(".ci-results").appendChild(row);
    this.updateRow(item);
  }
  async processQueue() {
    if (this.running || this.zipping || !this.items.length) return;
    const settings = this.readSettings();
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
    this.cancelOffers();
    this.appliedSettings = JSON.stringify(settings);
    this.running = true;
    const generation = this.generation;
    const batch = (this.batch = new AbortController());
    const pending = [...this.items];
    pending.forEach((item) => {
      item.status = "Queued";
      this.updateRow(item);
    });
    this.updateSummary();
    // Every item goes to the pool at once; the pool decides how many run together. Rows and
    // the summary update as each one finishes, in whatever order that happens.
    const process = async (item) => {
      try {
        await this.compressItem(item, settings, generation, batch.signal);
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
      // Jobs finish in any order: show the first success, unless the user picked a row.
      const replaceFailure = !this.pinned && !this.selected?.result && item.result;
      if (!this.selected || this.selected === item || replaceFailure) this.selectItem(item);
    };
    try {
      await Promise.allSettled(pending.map(process));
    } finally {
      if (generation === this.generation) {
        this.running = false;
        this.updateSummary();
        this.offers = this.prepareOffers(settings, generation);
      }
    }
  }
  // While idle, build reduced-color versions of lossless PNG results, so the offer can show
  // real sizes and apply instantly. Logs and row status stay untouched.
  async prepareOffers(settings, generation) {
    if (settings.lossyPng) return;
    const candidates = this.items.filter((item) => item.status === "Ready" && !item.result.lossy && item.blob.type === "image/png");
    if (!candidates.length) return;
    const batch = (this.offerBatch = new AbortController());
    const lossy = { ...settings, lossyPng: true };
    await Promise.allSettled(
      candidates.map(async (item) => {
        const logs = (item.offerLogs = []);
        const report = (stage, details) => logs.push({ stage, details });
        const outcome = await this.encodeItem(item, lossy, generation, batch.signal, report, { before: item.before });
        if (!outcome) return;
        const keep =
          generation === this.generation &&
          !batch.signal.aborted &&
          outcome.result.lossy &&
          item.blob.size - outcome.selected.blob.size >= minimumSavings(item.blob.size);
        if (keep) {
          item.alternative = { after: outcome.selected.url, blob: outcome.selected.blob, result: outcome.result };
          item.urls.push(outcome.selected.url);
        } else if (outcome.selected.url !== item.before) URL.revokeObjectURL(outcome.selected.url);
      }),
    );
    if (generation === this.generation && !batch.signal.aborted) this.updateAdvice();
  }
  cancelOffers() {
    this.offerBatch?.abort();
    for (const item of this.items) {
      if (item.alternative && !item.previous) {
        URL.revokeObjectURL(item.alternative.after);
        item.urls = item.urls.filter((url) => url !== item.alternative.after);
      }
      delete item.alternative;
      delete item.previous;
    }
    if (this.container) this.updateAdvice();
  }
  // Swaps reduced-color results in (true) or back out (false). Both versions stay in memory.
  useSmaller(apply) {
    if (this.running || this.zipping) return;
    for (const item of this.items.filter((entry) => entry.alternative)) {
      if (apply && !item.previous) {
        item.previous = { after: item.after, blob: item.blob, result: item.result };
        Object.assign(item, item.alternative);
      } else if (!apply && item.previous) {
        Object.assign(item, item.previous);
        delete item.previous;
      }
      this.updateRow(item);
    }
    this.$("lossy-png").checked = apply;
    this.appliedSettings = JSON.stringify(this.readSettings());
    this.updateSettings();
    if (this.selected?.result) this.selectItem(this.selected);
  }
  async compressItem(item, settings, generation, signal) {
    item.logs = [];
    item.startedAt = performance.now();
    const outcome = await this.encodeItem(item, settings, generation, signal, (stage, details) => this.log(item, stage, details), {
      onStart: () => {
        item.status = "Compressing…";
        this.log(item, "worker.started", { at: performance.now() });
        this.updateSummary();
      },
      onFinish: () => this.log(item, "worker.finished", { at: performance.now() }),
    });
    if (!outcome || generation !== this.generation) return;
    const kept = new Set([outcome.before, outcome.selected.url]);
    item.urls.forEach((url) => kept.has(url) || URL.revokeObjectURL(url));
    delete item.alternative;
    delete item.previous;
    item.before = outcome.before;
    item.after = outcome.selected.url;
    item.urls = [...kept];
    item.blob = outcome.selected.blob;
    item.result = outcome.result;
    this.log(item, "output.accepted", outcome.details);
  }
  // Runs one image through the pool and verifies the result. Returns the chosen output without
  // touching the item, so the offer pass can reuse it. `before` reuses an existing original URL.
  async encodeItem(item, settings, generation, signal, report, { onStart, onFinish, before: reuse } = {}) {
    report("Reading", { inputBytes: item.file.size });
    if (!item.file.size || item.file.size > MAX_FILE_SIZE) throw new Error("Choose an image between 1 byte and 32 MB.");
    const head = new Uint8Array(await item.file.slice(0, 65536).arrayBuffer());
    const type = imageType(head);
    if (!type) throw new Error("Choose a valid PNG, JPEG or still WebP image.");
    if (generation !== this.generation) return null;
    // The pool schedules by estimated memory and sizes the timeout by megapixels.
    const dimensions = headerDimensions(head);
    const job = {
      name: item.file.name,
      signal,
      memory: jobMemoryBytes(dimensions?.width, dimensions?.height, item.file.size),
      megapixels: dimensions ? (dimensions.width * dimensions.height) / 1e6 : undefined,
      onStart,
      onFinish,
    };
    const before = reuse || URL.createObjectURL(new Blob([item.file], { type }));
    const temporaryUrls = new Set(reuse ? [] : [before]);
    try {
      // The worker reads, decodes and resizes the file. It asks for pixels instead when it
      // cannot decode there, and the main thread then prepares them the way it used to.
      let result = await this.runWorker({ file: item.file, decoder: this.decoder, ...settings }, report, job);
      if (generation !== this.generation) return null;
      let expected;
      if (result.needsPixels) {
        const prepared = await this.preparePixels(item, settings, generation, before, report);
        if (!prepared) return null;
        result = await this.runWorker(prepared.payload, report, job);
        expected = prepared.expected;
      } else {
        const width = result.originalWidth,
          height = result.originalHeight;
        const target = settings.resize ? fitDimensions(width, height, settings.width, settings.height) : { width, height };
        expected = { type, width, height, target, resized: target.width !== width || target.height !== height };
      }
      if (generation !== this.generation) return null;
      const { target, resized, width, height } = expected;
      if (
        result.type !== expected.type ||
        result.width !== target.width ||
        result.height !== target.height ||
        (result.displayChecked && result.resized !== resized)
      ) {
        throw new Error("Output format or dimensions failed verification.");
      }
      report("Verifying", { codec: result.codec });
      const verify = async (candidate) => {
        const header = inspectImage(candidate);
        if (header.type !== expected.type || header.width !== target.width || header.height !== target.height) {
          throw new Error("Candidate format or dimensions failed verification.");
        }
        const blob = new Blob([candidate], { type: expected.type });
        const url = URL.createObjectURL(blob);
        temporaryUrls.add(url);
        // The worker has already decoded worker-prepared results at the target size.
        if (!result.displayChecked) {
          const decoded = new Image();
          decoded.src = url;
          await decoded.decode();
          if (decoded.naturalWidth !== target.width || decoded.naturalHeight !== target.height) {
            throw new Error("Candidate preview failed dimension verification.");
          }
        }
        return { blob, url };
      };
      const candidate = await verify(result.bytes);
      const baseline = result.baseline ? await verify(result.baseline) : null;
      if (generation !== this.generation) return null;
      const selection = selectCandidate({
        original: item.file.size,
        baseline: baseline ? baseline.blob.size : result.lossy ? undefined : candidate.blob.size,
        candidate: result.lossy ? candidate.blob.size : undefined,
        resized,
      });
      const originalKept = selection === "original";
      const selected = originalKept
        ? { blob: new Blob([item.file], { type: expected.type }), url: before }
        : selection === "baseline" && baseline
          ? baseline
          : candidate;
      const lossy = !originalKept && selection === "candidate" && result.lossy;
      const outcome = originalKept
        ? "Original kept"
        : lossy
          ? expected.type === "image/png"
            ? "Lossy PNG accepted"
            : "Optimized"
          : settings.lossyPng && expected.type === "image/png"
            ? "Lossless result used"
            : "Optimized";
      temporaryUrls.delete(before);
      temporaryUrls.delete(selected.url);
      return {
        before,
        selected,
        result: {
          width: target.width,
          height: target.height,
          originalWidth: width,
          originalHeight: height,
          resized,
          lossy,
          originalKept,
          outcome,
          codec: lossy ? result.codec : expected.type === "image/png" ? "Oxipng" : result.codec,
          quality: settings.quality,
          quantizationQuality: lossy ? result.quantizationQuality : undefined,
          fallbackReason: result.fallbackReason,
          metadataRemovedBytes: originalKept || lossy ? 0 : result.metadataRemovedBytes || 0,
        },
        details: {
          outcome,
          selection,
          width: target.width,
          height: target.height,
          outputBytes: selected.blob.size,
          inputBytes: item.file.size,
          resized,
          lossy,
        },
      };
    } finally {
      temporaryUrls.forEach((url) => URL.revokeObjectURL(url));
    }
  }
  // Main-thread fallback: decode with <img>, resize on a canvas, and send the pixels.
  async preparePixels(item, settings, generation, before, report) {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    if (generation !== this.generation) return null;
    report("Validating", {});
    const info = inspectImage(bytes);
    const canvas = document.createElement("canvas");
    try {
      // PNG dimensions come from its header. JPEG and WebP are decoded first because
      // orientation can change their displayed size.
      let image;
      const decode = async () => {
        report("Decoding", { decoder: "main-thread fallback", colorSpace: "sRGB", orientation: "from image" });
        image = new Image();
        image.src = before;
        await image.decode();
      };
      if (info.type !== "image/png") await decode();
      if (generation !== this.generation) return null;
      const width = image ? image.naturalWidth : info.width,
        height = image ? image.naturalHeight : info.height;
      if (!width || !height || width > 16384 || height > 16384 || width * height > 16000000) {
        throw new Error("Choose an image under 16 megapixels and 16,384 pixels per side.");
      }
      const target = settings.resize ? fitDimensions(width, height, settings.width, settings.height) : { width, height };
      const resized = target.width !== width || target.height !== height;
      let pixels;
      if (info.type !== "image/png" || resized || (settings.lossyPng && info.depth !== 16)) {
        if (!image) await decode();
        if (generation !== this.generation) return null;
        if (resized) report("Resizing", { ...target });
        canvas.width = target.width;
        canvas.height = target.height;
        const context = canvas.getContext("2d", { colorSpace: "srgb" });
        if (!context) throw new Error("Image decoding is unavailable in this browser.");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, target.width, target.height);
        pixels = context.getImageData(0, 0, target.width, target.height);
      }
      return {
        payload: {
          bytes: bytes.buffer,
          image: pixels,
          type: info.type,
          resized,
          losslessWebp: info.type === "image/webp" && info.lossless,
          ...settings,
        },
        expected: { type: info.type, width, height, target, resized },
      };
    } finally {
      canvas.width = canvas.height = 1;
    }
  }
  updateRow(item) {
    const row = item.row,
      result = item.result;
    row.querySelector(".ci-select").disabled = !result && item.status !== "Error";
    row.querySelector(".ci-download").disabled = !result || item.status === "Compressing…";
    row.classList.toggle("ci-error", item.status === "Error");
    // Dimensions, plus an outcome only when it is news; the Saved column already says the rest.
    const news = result
      ? [
          result.resized && "Resized",
          result.originalKept && "Original kept",
          result.lossy && item.blob.type === "image/png" && "Colors reduced",
        ]
      : [];
    const note = item.error || (result ? [`${result.width} × ${result.height}`, ...news.filter(Boolean)].join(" · ") : item.status);
    const queued = item.dimensions ? `${item.dimensions.width} × ${item.dimensions.height}` : "Queued";
    row.querySelector(".ci-file-state").textContent =
      item.status === "Compressing…" ? `${item.stage || "Reading"}…` : item.status === "Queued" ? queued : note;
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
      </header><div class="ci-comparison-toolbar"><div class="ci-view-controls" role="group" aria-label="Comparison view"><button class="btn btn-sm btn-secondary" data-ci="pair"><span class="ci-label-wide">Side by side</span><span class="ci-label-narrow">Both</span></button>
      <button class="btn btn-sm btn-secondary" data-ci="overlay">Slider</button></div><div data-ci="preview-controls"></div></div>
      <div class="ci-preview"></div><details class="ci-diagnostics"><summary><svg class="ci-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Log</summary>
      <div class="ci-log-actions"><a href="./licenses/image-optimizer/NOTICE.txt" target="_blank" rel="noopener">Image library licenses</a>
      <button class="btn btn-secondary btn-sm" data-ci="copy-log">Copy log</button></div><pre tabindex="0" aria-label="Processing log"></pre></details>`;
    inspector.querySelector("h3").textContent = item.file.name;
    const result = item.result;
    inspector.querySelector(".ci-detail").textContent = item.error || (result ? this.describe(item) : "");
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
  // One line of facts about a result: size change, encoding, and anything the codec reported.
  describe(item) {
    const result = item.result;
    if (result.originalKept) return "No worthwhile reduction. Original kept.";
    const dimensions = result.resized
      ? `${result.originalWidth} × ${result.originalHeight} → ${result.width} × ${result.height}`
      : `${result.width} × ${result.height}`;
    const encoding = result.lossy
      ? item.blob.type === "image/png"
        ? "Colors reduced"
        : `Quality ${result.quality}`
      : item.blob.type === "image/webp"
        ? "Lossless WebP"
        : "Lossless";
    const removed = result.metadataRemovedBytes ? `${size(result.metadataRemovedBytes)} of text comments removed` : "";
    return [dimensions, encoding, result.fallbackReason, removed].filter(Boolean).join(" · ");
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
    preview.innerHTML = `<div class="ci-pair" ${this.view === "pair" ? "" : "hidden"}>
      <figure><figcaption>Original <span>${size(item.file.size)}</span></figcaption><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Original image. Arrow keys pan; plus and minus zoom."><img alt="Original image"><span class="ci-cursor" hidden></span></div></figure>
      <figure><figcaption>Result <span>${size(item.blob.size)}</span></figcaption><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Result image. Arrow keys pan; plus and minus zoom."><img alt="Compressed result"><span class="ci-cursor" hidden></span></div></figure></div>
      <div class="ci-overlay" ${this.view === "overlay" ? "" : "hidden"}><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Image comparison. Arrow keys pan; plus and minus zoom.">
        <img alt="Original image"><div class="ci-reveal ci-checker"><img alt="Compressed result"></div><span class="ci-divider" aria-hidden="true"></span>
        <span class="ci-overlay-label ci-label-before">Original</span><span class="ci-overlay-label ci-label-after">Result</span></div>
        <label class="ci-slider">Original <input data-ci="split" type="range" min="0" max="100" value="50" aria-label="Before and after comparison"> Result</label></div>`;
    this.$("original").addEventListener("click", () => this.download(item.file, item.file.name));
    const images = preview.querySelectorAll("img");
    // Narrow screens size each pane from the image's shape instead of a fixed height.
    preview
      .querySelectorAll(".ci-viewport")
      .forEach((pane) => pane.style.setProperty("--ci-aspect", `${item.result.width} / ${item.result.height}`));
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
  async runWorker(payload, report, job = {}) {
    const transfer = [...(payload.bytes ? [payload.bytes] : []), ...(payload.image ? [payload.image.data.buffer] : [])];
    return this.pool.run(payload, { ...job, onLog: report, transfer });
  }

  updateSummary() {
    if (!this.container) return;
    const ready = this.items.filter((item) => item.result && item.status !== "Compressing…");
    const before = ready.reduce((sum, item) => sum + item.file.size, 0),
      after = ready.reduce((sum, item) => sum + item.blob.size, 0);
    const errors = this.items.filter((item) => item.status === "Error").length;
    const finished = this.items.filter((item) => item.status === "Ready" || item.status === "Error").length;
    const total = this.items.reduce((sum, item) => sum + item.file.size, 0);
    const stale = this.isStale();
    const pending = !ready.length || stale || this.items.some((item) => item.status !== "Ready");
    this.container.querySelector(".ci-drop").hidden = this.items.length > 0;
    this.container.querySelector(".ci-batch").hidden = !this.items.length;
    this.container.querySelector(".ci-list").classList.toggle("is-pending", !this.items.some((item) => item.result));
    this.$("ready-count").textContent = !this.items.length
      ? ""
      : ready.length || this.running
        ? `${ready.length} of ${this.items.length} ready`
        : `${this.items.length} image${this.items.length === 1 ? "" : "s"}`;
    const saved = after <= before ? `${size(before - after)} saved` : `${size(after - before)} larger`;
    this.container.querySelector(".ci-summary").textContent = this.zipping
      ? "Creating ZIP…"
      : this.running
        ? `Compressing… ${finished} of ${this.items.length} done`
        : `${ready.length ? `${size(before)} → ${size(after)} · ${saved} (${savings(before, after)})` : size(total)}${errors ? ` · ${errors} failed` : ""}`;
    const compress = this.$("compress");
    compress.hidden = !pending && !this.running;
    compress.classList.toggle("btn-primary", pending);
    compress.classList.toggle("btn-secondary", !pending);
    compress.disabled = !this.items.length || this.running || this.zipping;
    compress.textContent = this.running
      ? "Compressing…"
      : ready.length
        ? "Compress again"
        : this.items.length === 1
          ? "Compress image"
          : `Compress ${this.items.length} images`;
    const zip = this.$("zip");
    zip.hidden = !ready.length;
    zip.textContent = this.zipping ? "Creating ZIP…" : "Download ZIP";
    zip.classList.toggle("btn-primary", !pending);
    zip.classList.toggle("btn-secondary", pending);
    zip.disabled = !ready.length || this.running || this.zipping;
    if (this.$("result")) this.$("result").disabled = this.running || this.zipping;
    this.container.querySelectorAll(".ci-settings input, .ci-settings select, .ci-choice").forEach((input) => {
      input.disabled = this.running || this.zipping;
    });
    this.$("choose").disabled = this.$("add").disabled = this.$("clear").disabled = this.running || this.zipping;
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
    this.batch?.abort();
    this.offerBatch?.abort();
    this.pool.terminate();
    this.items.forEach((item) => item.urls.forEach((url) => URL.revokeObjectURL(url)));
    this.items = [];
    this.selected = null;
    this.pinned = false;
    this.running = false;
    this.container?.querySelector(".ci-results").replaceChildren();
    const inspector = this.container?.querySelector(".ci-inspector");
    if (inspector) {
      inspector.hidden = true;
      inspector.replaceChildren();
    }
    this.appliedSettings = undefined;
    if (this.container) {
      this.error("");
      this.toggleSettings(false);
      this.updateAdvice();
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
