import { isTauri } from "../../core/Runtime.js";
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
import { findLargestFit } from "./target-dimensions.js";
import { attachPaneResizer } from "./pane-resizer.js";
import { attachPreviewControls } from "./preview-controls.js";
import { imageWorkflowDialog } from "../../components/ImageWorkflowDialog.js";
import { loadWorkspace, saveWorkspace } from "./workspace-store.js";
import { blobDataUrl, uniqueImageName } from "./image-transfer.js";
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
      timeoutFor: (job) => jobTimeoutMs(job.megapixels) * (job.targetBytes ? 9 : 1),
    });
  }
  getIconSvg() {
    return getIconSvg();
  }
  $(name) {
    return this.container.querySelector(`[data-ci="${name}"]`);
  }
  render() {
    const choice = (name, label, detail = "") =>
      `<button type="button" class="ci-choice" data-size="${name}" aria-pressed="false">${label}${detail ? `<span>${detail}</span>` : ""}</button>`;
    return `<section class="tool-container compress-image" aria-label="Compress Image">
      <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple id="ci-files" data-ci="files" aria-label="Add images" tabindex="-1" class="sr-only">
      <div class="ci-settings" id="ci-settings" data-ci="settings-panel" role="group" aria-label="Compression settings">
        <fieldset class="ci-format-settings" data-ci="all-settings"><legend class="sr-only">Max dimensions</legend>
          <label class="ci-toggle" title="Fit within max width and height. Preserves aspect ratio; never crops or upscales."><input data-ci="resize" type="checkbox" role="switch" name="resize" aria-description="Preserves aspect ratio; never crops or upscales."><span class="ci-switch" aria-hidden="true"></span>Max dimensions</label>
          <div class="ci-bounds" data-ci="bounds">
            <label>Max width<input data-ci="width" name="max-width" type="number" min="1" max="16384" step="1" value="1440"></label>
            <label>Max height<input data-ci="height" name="max-height" type="number" min="1" max="16384" step="1" value="3200"></label>
          </div>
          <div class="ci-advice" data-ci="advice-size" hidden><p data-ci="advice-size-title"></p>
            <div class="ci-choices" role="group" aria-label="Image size">${choice("full", "Portrait", "1440 × 3200")}${choice("square", "Square", "2670 × 2670")}${choice("original", "Original")}</div>
          </div>
        </fieldset>
        <fieldset class="ci-format-settings" data-ci="target-settings"><legend class="sr-only">Target file size</legend>
          <label title="Blank means no limit. Searches within your quality settings; reports when the target cannot be met.">Target size (KB)<input data-ci="target-kb" name="target-kb" type="number" min="1" max="33555" step="1" placeholder="No limit" aria-description="1 KB = 1,000 bytes. Output must be below this target. Quality and dimension limits are preserved."></label>
        </fieldset>
        <fieldset class="ci-format-settings" data-ci="png-settings" disabled><legend class="sr-only">PNG compression</legend>
          <div class="ci-png-controls">
            <label data-ci="png-quality" title="Minimum quantization quality: High 90, Balanced 80, Smaller file 65. Higher allows less quality loss.">PNG Lossy Quality<select data-ci="png-quality-preset" name="png-quality" data-searchable-dropdown-ignore disabled><option value="high">High quality</option><option value="balanced" selected>Balanced</option><option value="small">Smaller file</option></select></label>
          </div>
        </fieldset>
        <fieldset class="ci-format-settings" data-ci="photo-settings" disabled><legend class="sr-only">JPEG &amp; WebP compression</legend>
          <div class="ci-photo-controls"><label>JPEG &amp; WebP preset<select data-ci="preset" name="preset" data-searchable-dropdown-ignore><option value="high">High quality</option><option value="balanced" selected>Balanced</option><option value="small">Smaller file</option></select></label>
          <label class="ci-quality" title="Retained quality, 1–100. Higher allows less quality loss. With a target, this is the minimum. Lossless WebP stays lossless.">JPEG &amp; WebP quality<input data-ci="quality" name="quality" type="number" min="1" max="100" step="1" value="85" aria-description="Higher allows less quality loss. With a target size, this is the minimum retained quality. Lossless WebP stays lossless."></label></div>
        </fieldset>
      </div>
      <p id="ci-error" class="ci-error-message" data-ci="error" role="alert" hidden></p>
      <div class="ci-batch"><div class="ci-workspace" data-ci="workspace">
        <section class="ci-file-pane" aria-label="Image files"><header class="ci-batch-header">
          <div class="ci-actions"><button type="button" class="btn btn-secondary btn-sm" data-ci="add">Add images</button><button type="button" class="btn btn-ghost btn-sm" data-ci="clear">Clear</button></div>
          <div class="ci-actions"><button type="button" class="btn btn-secondary btn-sm" data-ci="zip" hidden>Download ZIP</button><button type="button" class="btn btn-secondary btn-sm" data-ci="quick-query" hidden>Add to Quick Query</button><button type="button" class="btn btn-primary btn-sm" data-ci="compress">Compress images</button></div>
        </header>
        <div class="ci-list" role="region" aria-label="Images" tabindex="0">
          <div class="ci-drop"><p>Drop images here</p><button type="button" class="btn btn-ghost btn-sm" data-ci="choose">Choose images</button></div>
          <table data-ci="table" hidden><thead><tr><th scope="col">File name</th><th scope="col">Dimensions (px)</th><th scope="col">Original size</th><th scope="col">Lossless size <button type="button" class="ci-format-info" aria-label="About lossless compression" title="Lossless keeps exact pixel colors at the output dimensions. Select a size to use that result.">ⓘ</button></th><th scope="col">Lossy size <button type="button" class="ci-format-info" aria-label="About lossy compression" title="Lossy allows quality loss for smaller files. Select a size to use that result. Resized results show their dimensions in the size tooltip.">ⓘ</button></th><th scope="col"><span class="sr-only">Download</span></th></tr></thead><tbody class="ci-results"></tbody></table>
        </div></section>
        <div class="ci-resizer" data-ci="resizer" role="separator" aria-orientation="vertical" aria-label="Resize file list and comparison panes" aria-valuemin="320" aria-valuenow="0" tabindex="0"></div>
        <section class="ci-inspector" aria-label="Image comparison"><p class="ci-preview-empty">Select an image to preview</p></section>
      </div></div>
    </section>`;
  }

  onMount() {
    this.workflow = new AbortController();
    this.restoring = true;
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
    this.$("quick-query").addEventListener("click", () => this.addToQuickQuery());
    this.$("zip").addEventListener("click", () => this.downloadZip());
    this.$("compress").addEventListener("click", () => this.processQueue());
    this.container.querySelectorAll(".ci-settings input, .ci-settings select").forEach((input) => {
      input.addEventListener("change", () => this.updateSettings());
    });
    this.$("preset").addEventListener("change", () => {
      const preset = PRESETS[this.$("preset").value];
      this.$("quality").value = preset.jpeg.quality;
      this.updateSettings();
    });
    this.$("quality").addEventListener("input", () => this.updateSettings());
    this.container.querySelectorAll(".ci-choice").forEach((button) => {
      button.addEventListener("click", () => this.chooseSize(button.dataset.size));
    });
    this.container.querySelectorAll(".ci-format-info").forEach((button) => {
      const tooltip = document.createElement("span");
      tooltip.className = "ci-kept-tooltip";
      tooltip.setAttribute("role", "tooltip");
      tooltip.setAttribute("popover", "manual");
      tooltip.id = `ci-format-${crypto.randomUUID()}`;
      tooltip.textContent = button.title;
      button.removeAttribute("title");
      button.setAttribute("aria-describedby", tooltip.id);
      button.after(tooltip);
      this.attachTooltip(button, tooltip);
    });
    this.updateSettings();
    this.resizerCleanup = attachPaneResizer(this.$("workspace"), this.$("resizer"));
    const header = this.container.querySelector(".ci-batch-header");
    const syncHeader = () => this.$("workspace").style.setProperty("--ci-header-height", `${header.getBoundingClientRect().height}px`);
    this.headerObserver = new ResizeObserver(syncHeader);
    this.headerObserver.observe(header);
    syncHeader();
    this.ready = this.restoreWorkspace();
    this._saveOnPageHide = () => void this.flushWorkspace();
    window.addEventListener("pagehide", this._saveOnPageHide);
  }
  async restoreWorkspace() {
    const lifecycle = this.workflow;
    try {
      const saved = await loadWorkspace();
      if (lifecycle.signal.aborted || !saved) return;
      for (const [name, value] of Object.entries(saved.controls || {})) {
        const input = this.$(name);
        if (input) {
          if (input.type === "checkbox") input.checked = value;
          else input.value = value;
        }
      }
      this.view = saved.view === "overlay" ? "overlay" : "pair";
      this.appliedSettings = saved.appliedSettings;
      for (const record of saved.items || []) {
        const file = new File([record.file], record.name, { type: record.file.type, lastModified: record.lastModified });
        const item = {
          ...record,
          file,
          urls: [],
          logs: [],
          startedAt: performance.now(),
          status: record.result ? "Ready" : "Queued",
          logId: this.items.length + 1,
        };
        if (item.result) {
          item.before = URL.createObjectURL(file);
          item.after = URL.createObjectURL(item.blob);
          item.urls.push(item.before, item.after);
          for (const variant of Object.values(item.variants || {})) {
            variant.after = URL.createObjectURL(variant.blob);
            item.urls.push(variant.after);
          }
        }
        this.items.push(item);
        this.createRow(item);
        void this.readDimensions(item);
      }
      const selected = this.items[saved.selected || 0];
      if (selected) this.selectItem(selected);
    } catch (_) {
      if (!lifecycle.signal.aborted) this.showError("Unable to restore the image cache. You can still add images.");
    } finally {
      if (!lifecycle.signal.aborted) {
        this.restoring = false;
        this.updateAdvice();
        this.updateSummary();
      }
    }
  }
  workspaceSnapshot() {
    const controls = {};
    for (const name of ["preset", "png-quality-preset", "quality", "resize", "width", "height", "target-kb"]) {
      const input = this.$(name);
      controls[name] = input.type === "checkbox" ? input.checked : input.value;
    }
    return {
      controls,
      appliedSettings: this.appliedSettings,
      selected: this.items.indexOf(this.selected),
      view: this.view,
      items: this.items.map((item) => ({
        file: item.file,
        name: item.file.name,
        lastModified: item.file.lastModified,
        blob: item.blob,
        result: item.result,
        type: item.type,
        dimensions: item.dimensions,
        settings: item.settings,
        selectedVariant: item.selectedVariant,
        lossyUnavailable: item.lossyUnavailable,
        variants: Object.fromEntries(
          Object.entries(item.variants || {}).map(([name, variant]) => [name, { blob: variant.blob, result: variant.result }]),
        ),
      })),
    };
  }
  persistWorkspace() {
    if (this.restoring || !this.container) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushWorkspace(), 250);
  }
  async flushWorkspace() {
    clearTimeout(this.saveTimer);
    if (this.restoring || !this.container) return;
    try {
      await saveWorkspace(this.workspaceSnapshot());
      this.cacheErrorShown = false;
    } catch (_) {
      if (!this.cacheErrorShown) this.showError("Image cache could not be saved. Keep this tab open to retain your images.");
      this.cacheErrorShown = true;
    }
  }
  onSoftDeactivate() {
    this.workflow?.abort();
    void this.flushWorkspace();
  }
  onWarmResume() {
    if (this.workflow?.signal.aborted) this.workflow = new AbortController();
  }
  async onRouteData({ imageFiles } = {}) {
    if (!imageFiles?.length) return;
    const lifecycle = this.workflow;
    await this.ready;
    if (lifecycle.signal.aborted) return;
    if (this.running || this.zipping) return this.showError("Wait for the current batch to finish before importing images.");
    let action = "append";
    if (this.items.length) {
      const choice = await imageWorkflowDialog({
        title: "Images from Quick Query",
        description: `${this.items.length} image${this.items.length === 1 ? " is" : "s are"} already in Compress Image.`,
        actions: [
          { value: "append", label: "Add to existing", primary: true },
          { value: "replace", label: "Replace existing" },
        ],
        signal: this.workflow.signal,
      });
      if (!choice) return;
      action = choice.action;
    }
    const count = action === "replace" ? 0 : this.items.length;
    const bytes = action === "replace" ? 0 : this.items.reduce((sum, item) => sum + item.file.size, 0);
    if (count + imageFiles.length > 20 || bytes + imageFiles.reduce((sum, file) => sum + file.size, 0) > 128 * 1024 * 1024) {
      return this.showError("This transfer exceeds the 20-image or 128 MB batch limit. Your existing images were kept.");
    }
    if (action === "replace") this.clear();
    this.addFiles(imageFiles);
    await this.flushWorkspace();
  }
  addToQuickQuery() {
    if (this.running || this.zipping || this.isStale()) return;
    const items = this.items.filter((item) => item.result && item.status === "Ready");
    if (!items.length) return;
    const names = new Set();
    const compressedImages = items.map(
      (item) =>
        new File([item.blob], uniqueImageName(this.outputName(item), names), {
          type: item.blob.type,
        }),
    );
    window.app.router.navigate("quick-query", { compressedImages });
  }
  // The settings controls are the single source of truth; cards and presets only write to them.
  readSettings() {
    return {
      preset: this.$("preset").value,
      lossyPng: false,
      pngQuality: { ...PRESETS[this.$("png-quality-preset").value]?.quantize.quality },
      resize: this.$("resize").checked,
      quality: Number(this.$("quality").value),
      targetBytes: this.$("target-kb").value === "" ? 0 : Number(this.$("target-kb").value) * 1000,
      width: Number(this.$("width").value),
      height: Number(this.$("height").value),
    };
  }
  // Results are stale when the settings differ from the ones they were made with.
  isStale() {
    return this.items.some((item) => item.result) && this.appliedSettings !== JSON.stringify(this.readSettings());
  }
  updateSettings() {
    this.persistWorkspace();
    this.updateAdvice();
    this.updateSummary();
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
    const large = this.items.filter((item) => this.isOversized(item)).length;
    const settings = this.readSettings();
    const chosen = !settings.resize
      ? "original"
      : Object.keys(PHONE_SIZES).find((name) => PHONE_SIZES[name].width === settings.width && PHONE_SIZES[name].height === settings.height);
    this.$("advice-size").hidden = !large;
    this.$("advice-size-title").textContent = `${large} oversized image${large === 1 ? "" : "s"} · Resize for a smaller file`;
    this.container.querySelectorAll(".ci-choice").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.size === chosen));
    });
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
    if (this.restoring) {
      const pending = Array.from(files);
      void this.ready.then(() => {
        if (this.container) this.addFiles(pending);
      });
      return;
    }
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
    this.persistWorkspace();
  }
  isOversized(item) {
    return largerThan(item.dimensions, PHONE_SIZES.full) && largerThan(item.dimensions, PHONE_SIZES.square);
  }
  // Header-only dimensions for the row and the size card; the worker still inspects every file.
  async readDimensions(item) {
    const head = new Uint8Array(await item.file.slice(0, 65536).arrayBuffer());
    if (!this.items.includes(item)) return;
    item.type = imageType(head);
    item.dimensions = headerDimensions(head) || undefined;
    this.updateRow(item);
    this.updateAdvice();
    this.updateSummary();
    if (!this.selected) this.selectItem(item);
  }
  createRow(item) {
    const row = document.createElement("tr");
    row.className = "ci-file-row";
    row.innerHTML = `<th scope="row"><button type="button" class="ci-select" aria-pressed="false"><span class="ci-filename"></span></button>
      <div class="ci-file-outcome"><span class="ci-file-state" role="status" aria-live="polite"></span>
      <button type="button" class="ci-kept-info" aria-label="Why the original was kept" hidden><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7v4"/><circle cx="8" cy="4.8" r=".6" fill="currentColor" stroke="none"/></svg></button>
      <span class="ci-kept-tooltip" role="tooltip" popover="manual"></span></div><button type="button" class="btn btn-secondary btn-sm ci-fit-target" hidden>Fit to target</button><span class="ci-file-warning" hidden>Resize suggestion</span></th>
      <td class="ci-dimensions">—</td><td class="ci-before"></td>
      <td class="ci-after"><button type="button" class="ci-variant" data-variant="lossless" aria-pressed="false" disabled>—</button></td>
      <td class="ci-after"><button type="button" class="ci-variant" data-variant="lossy" aria-pressed="false" disabled>—</button></td>
      <td><button type="button" class="btn btn-ghost btn-sm ci-download" disabled><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3"/></svg></button></td>`;
    row.querySelector(".ci-filename").textContent = item.file.name;
    row.querySelector(".ci-before").textContent = size(item.file.size);
    row.querySelector(".ci-select").addEventListener("click", () => {
      this.pinned = true;
      this.selectItem(item);
    });
    row.querySelectorAll("[data-variant]").forEach((button) => {
      button.addEventListener("click", () => this.selectVariant(item, button.dataset.variant));
    });
    row.querySelector(".ci-fit-target").addEventListener("click", () => this.fitToTarget(item));
    row.querySelector(".ci-download").addEventListener("click", () => this.download(item.blob, this.outputName(item)));
    row.querySelector(".ci-download").setAttribute("aria-label", `Download ${item.file.name}`);
    const info = row.querySelector(".ci-kept-info");
    const tooltip = row.querySelector(".ci-kept-tooltip");
    tooltip.id = `ci-kept-${crypto.randomUUID()}`;
    info.setAttribute("aria-describedby", tooltip.id);
    this.attachTooltip(info, tooltip);
    item.row = row;
    this.container.querySelector(".ci-results").appendChild(row);
    this.updateRow(item);
  }
  attachTooltip(info, tooltip) {
    const hideTip = () => tooltip.hidePopover();
    const showTip = () => {
      tooltip.showPopover();
      const anchor = info.getBoundingClientRect();
      const box = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, innerHeight - box.height - 8))}px`;
    };
    info.addEventListener("pointerenter", showTip);
    info.addEventListener("pointerleave", () => {
      if (document.activeElement !== info) hideTip();
    });
    info.addEventListener("focus", showTip);
    info.addEventListener("blur", hideTip);
    info.addEventListener("click", showTip);
    info.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideTip();
    });
  }
  async processQueue() {
    if (this.running || this.zipping || !this.items.length) return;
    const settings = this.readSettings();
    if (
      !PRESETS[settings.preset] ||
      !Number.isInteger(settings.quality) ||
      settings.quality < 1 ||
      settings.quality > 100 ||
      (this.items.some((item) => (item.type || item.file.type) === "image/png") &&
        (!Number.isInteger(settings.pngQuality.min) ||
          !Number.isInteger(settings.pngQuality.target) ||
          settings.pngQuality.min < 0 ||
          settings.pngQuality.target > 100 ||
          settings.pngQuality.min > settings.pngQuality.target))
    ) {
      const invalid = !PRESETS[settings.preset] ? "preset" : !this.$("quality").validity.valid ? "quality" : "png-quality-preset";
      this.error("Choose a valid quality setting.", invalid);
      return;
    }
    if (!this.$("target-kb").validity.valid || !Number.isSafeInteger(settings.targetBytes) || settings.targetBytes < 0) {
      this.error("Enter a target size between 1 and 33,555 KB, or leave it blank.", "target-kb");
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
      item.primaryPending = (item.type || item.file.type) === "image/jpeg" ? "lossy" : settings.lossyPng ? "lossy" : "lossless";
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
        this.persistWorkspace();
        this.offers = this.prepareOffers(settings, generation);
      }
    }
  }
  // Keep both PNG encodings available; choosing one never changes another row.
  async prepareOffers(settings, generation) {
    const candidates = this.items.filter((item) => item.status === "Ready" && item.blob.type === "image/png");
    if (!candidates.length) return;
    const batch = (this.offerBatch = new AbortController());
    await Promise.allSettled(
      candidates.map(async (item) => {
        for (const name of ["lossless", "lossy"]) {
          if (item.variants?.[name]) continue;
          try {
            item.variantPending = name;
            this.updateRow(item);
            const outcome = await this.encodeItem(
              item,
              { ...settings, lossyPng: name === "lossy", comparePng: true },
              generation,
              batch.signal,
              () => {},
              { before: item.before },
            );
            if (!outcome || generation !== this.generation || batch.signal.aborted) {
              if (outcome && outcome.selected.url !== item.before) URL.revokeObjectURL(outcome.selected.url);
              return;
            }
            if (name === "lossy" && !outcome.result.lossy) {
              item.lossyUnavailable = outcome.result.fallbackReason || "No lossy result meets the selected quality limit.";
              if (outcome.selected.url !== item.before) URL.revokeObjectURL(outcome.selected.url);
            } else {
              item.variants[name] = { after: outcome.selected.url, blob: outcome.selected.blob, result: outcome.result };
              item.urls.push(outcome.selected.url);
            }
          } catch (error) {
            if (generation !== this.generation || batch.signal.aborted) return;
            item.variantError = `Unable to prepare ${name}: ${error.message}`;
          } finally {
            if (generation === this.generation && this.offerBatch === batch) {
              delete item.variantPending;
              this.updateRow(item);
            }
          }
        }
        if (generation === this.generation && !batch.signal.aborted && item.variants[item.selectedVariant]) {
          Object.assign(item, item.variants[item.selectedVariant]);
          this.updateRow(item);
          if (this.selected === item) this.selectItem(item);
        }
      }),
    );
    if (generation === this.generation) this.persistWorkspace();
  }
  cancelOffers() {
    this.offerBatch?.abort();
  }
  selectVariant(item, name) {
    if (this.running || this.zipping || !item.variants?.[name]) return;
    item.selectedVariant = name;
    Object.assign(item, item.variants[name]);
    this.updateRow(item);
    this.selectItem(item);
    this.updateSummary();
    this.persistWorkspace();
  }
  async fitToTarget(item) {
    if (this.running || this.zipping || !item.result) return;
    if (this.isStale() || JSON.stringify(item.settings) !== JSON.stringify(this.readSettings())) {
      return this.error("Compress again to apply the current settings before fitting to the target.");
    }
    const settings = item.settings;
    if (!settings?.targetBytes || item.result.targetMet || item.variants?.lossy?.result.targetMet) return;
    this.cancelOffers();
    await this.offers;
    const generation = this.generation;
    if (this.running || this.zipping || !this.items.includes(item)) return;
    if (this.isStale() || JSON.stringify(item.settings) !== JSON.stringify(this.readSettings())) {
      return this.error("Compress again to apply the current settings before fitting to the target.");
    }
    const batch = (this.batch = new AbortController());
    this.running = true;
    item.fitting = true;
    item.status = "Compressing…";
    this.error("");
    this.updateSummary();
    const base = item.variants?.lossy || item;
    const original = item.result;
    const bounds = { width: base.result.width, height: base.result.height };
    const searchSettings = {
      ...settings,
      resize: true,
      targetBytes: settings.targetBytes,
      fitSearch: true,
      lossyPng: item.blob.type === "image/png" || settings.lossyPng,
      pngQuality: { min: settings.pngQuality.min, target: settings.pngQuality.min },
      comparePng: false,
    };
    const encode = async (width, height, options = searchSettings) =>
      this.encodeItem(item, { ...options, width, height }, generation, batch.signal, (stage, details) => this.log(item, stage, details), {
        before: item.before,
      });
    try {
      let attempts = 0;
      const best = await findLargestFit({
        ...bounds,
        targetBytes: settings.targetBytes,
        encode: async (width, height) => {
          const outcome = await encode(width, height);
          if (!outcome) throw new Error("Cancelled");
          attempts++;
          const bytes = outcome.selected.blob.size;
          if (outcome.selected.url !== item.before) URL.revokeObjectURL(outcome.selected.url);
          return { size: bytes };
        },
      });
      if (!best) throw new Error("Even the smallest image cannot fit this target. Increase the target size.");
      const outcome = await encode(best.width, best.height, {
        ...searchSettings,
        targetBytes: settings.targetBytes,
        pngQuality: settings.pngQuality,
        fitSearch: false,
      });
      if (!outcome || generation !== this.generation) return;
      if (!outcome.result.targetMet) {
        URL.revokeObjectURL(outcome.selected.url);
        throw new Error("The final encoding did not meet the target. Previous result kept; try a larger target.");
      }
      const variant = { after: outcome.selected.url, blob: outcome.selected.blob, result: outcome.result };
      const name = outcome.result.lossy ? "lossy" : "lossless";
      item.variants[name] = variant;
      item.selectedVariant = name;
      item.urls.push(outcome.selected.url);
      Object.assign(item, variant);
      this.log(item, "target.fitted", {
        width: best.width,
        height: best.height,
        outputBytes: item.blob.size,
        targetBytes: settings.targetBytes,
        attempts,
      });
      item.error = null;
    } catch (error) {
      if (generation === this.generation) {
        item.error = error.message;
        item.result = original;
      }
    } finally {
      if (generation === this.generation) {
        this.running = false;
        delete item.fitting;
        item.status = "Ready";
        this.updateRow(item);
        this.updateSummary();
        this.selectItem(item);
        this.persistWorkspace();
      }
    }
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
    item.variants = {};
    item.settings = structuredClone(settings);
    item.selectedVariant = item.file.type === "image/png" ? (settings.lossyPng ? "lossy" : "lossless") : undefined;
    delete item.lossyUnavailable;
    delete item.variantError;
    item.before = outcome.before;
    item.after = outcome.selected.url;
    item.urls = [...kept];
    item.blob = outcome.selected.blob;
    item.result = outcome.result;
    item.variants[item.blob.type === "image/jpeg" || item.result.lossy ? "lossy" : "lossless"] = {
      after: item.after,
      blob: item.blob,
      result: item.result,
    };
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
      targetBytes: settings.targetBytes,
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
      const selection =
        settings.comparePng && result.lossy
          ? "candidate"
          : selectCandidate({
              original: item.file.size,
              baseline: baseline ? baseline.blob.size : result.lossy ? undefined : candidate.blob.size,
              candidate: result.lossy ? candidate.blob.size : undefined,
              resized,
              targetBytes: settings.targetBytes,
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
          minimumSavingBytes: result.lossy ? minimumSavings(item.file.size) : 0,
          outcome,
          codec: lossy ? result.codec : expected.type === "image/png" ? "Oxipng" : result.codec,
          quality: result.quality ?? settings.quality,
          targetBytes: settings.targetBytes,
          targetMet: settings.targetBytes ? selected.blob.size < settings.targetBytes : undefined,
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
          targetBytes: settings.targetBytes || 0,
          targetMet: settings.targetBytes ? selected.blob.size < settings.targetBytes : undefined,
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
    row.querySelector(".ci-select").disabled = false;
    row.querySelector(".ci-file-warning").hidden = !this.isOversized(item) || !!result?.resized;
    row.setAttribute("aria-busy", String(item.status === "Compressing…"));
    const dimensions = row.querySelector(".ci-dimensions");
    const original = result ? { width: result.originalWidth, height: result.originalHeight } : item.dimensions;
    dimensions.textContent = original ? `${original.width} × ${original.height}` : "—";
    if (result?.resized) {
      const resized = document.createElement("small");
      resized.textContent = `→ ${result.width} × ${result.height}`;
      dimensions.append(resized);
    }
    row.querySelector(".ci-download").disabled = !result || item.status === "Compressing…";
    row.classList.toggle("ci-error", item.status === "Error");
    // Dimensions, plus an outcome only when it is news; the Saved column already says the rest.
    const news = result
      ? [
          !result.originalKept && "Compressed",
          result.resized && "Resized",
          result.originalKept && "Original kept",
          result.targetBytes && (result.targetMet ? "Target met" : "Target not met"),
        ]
      : [];
    const note = item.error || (result ? news.filter(Boolean).join(" · ") : item.status);
    const queued = "";
    row.querySelector(".ci-file-state").textContent =
      item.status === "Compressing…" ? `${item.stage || "Reading"}…` : item.status === "Queued" ? queued : note;
    const info = row.querySelector(".ci-kept-info");
    const tooltip = row.querySelector(".ci-kept-tooltip");
    info.hidden = !result?.originalKept || item.status !== "Ready" || !!item.error;
    if (info.hidden && tooltip.matches(":popover-open")) tooltip.hidePopover();
    tooltip.textContent = result?.minimumSavingBytes
      ? `The result did not meet the minimum saving of ${result.minimumSavingBytes.toLocaleString()} bytes for this file. ` +
        "Lossy compression must save at least 1% or 1,024 bytes, whichever is larger. The original was kept unchanged."
      : "Lossless optimization did not produce a smaller file. The original was kept unchanged.";
    const variants = item.variants || (result ? { [result.lossy ? "lossy" : "lossless"]: item } : {});
    row.querySelectorAll("[data-variant]").forEach((button) => {
      const name = button.dataset.variant;
      const variant = variants[name];
      const type = item.type || item.file.type;
      const unavailable = type === "image/jpeg" && name === "lossless";
      const processing = item.status === "Compressing…";
      const queued = item.status === "Queued";
      const loading =
        !unavailable &&
        (item.variantPending === name || (processing && (item.fitting || type !== "image/png" || name === item.primaryPending)));
      const waiting =
        !unavailable &&
        !loading &&
        (queued ||
          (processing && type === "image/png") ||
          (!variant && type === "image/png" && item.status === "Ready" && !item.lossyUnavailable && !item.variantError));
      const state = unavailable
        ? "unavailable"
        : loading
          ? "loading"
          : waiting
            ? "queued"
            : variant
              ? "ready"
              : item.status === "Error" || item.variantError
                ? "error"
                : "unavailable";
      button.dataset.state = state;
      button.setAttribute("aria-busy", String(loading));
      button.textContent =
        state === "ready" ? size(variant.blob.size) : { loading: "Loading", queued: "Queued", unavailable: "N/A", error: "Failed" }[state];
      button.disabled = state !== "ready" || this.running || this.zipping || processing;
      button.setAttribute("aria-pressed", String(!!variant && variant.blob === item.blob));
      button.setAttribute(
        "aria-label",
        `${name === "lossless" ? "Lossless" : "Lossy"} result for ${item.file.name}, ${state === "ready" ? size(variant.blob.size) : state}`,
      );
      button.title = loading
        ? "Compressing this result…"
        : waiting
          ? "Waiting to compress this result."
          : variant
            ? `${variant.result.originalKept ? "Original kept · " : ""}${variant.result.width} × ${variant.result.height} · ${savings(item.file.size, variant.blob.size)}${variant.result.targetBytes ? ` · Target ${variant.result.targetMet ? "met" : "not met"}` : ""}`
            : item.lossyUnavailable ||
              item.variantError ||
              (type === "image/jpeg" && name === "lossless"
                ? "JPEG has no lossless re-encoding. The original is available in the preview."
                : "No result available.");
      button.setAttribute("aria-description", button.title);
      button.closest("td").classList.toggle("ci-reduced", !!variant && variant.blob.size < item.file.size);
    });
    const fit = row.querySelector(".ci-fit-target");
    fit.hidden =
      !result?.targetBytes || !!result.targetMet || !!variants.lossy?.result.targetMet || !!item.variantPending || item.status !== "Ready";
    fit.disabled = this.running || this.zipping;
    fit.title = "Reduce dimensions to the largest image that fits the target, preserving aspect ratio and your quality limit.";
  }
  selectItem(item) {
    this.persistWorkspace();
    this.previewCleanup?.();
    this.selected = item;
    this.items.forEach((entry) => {
      entry.row.classList.toggle("is-selected", entry === item);
      entry.row.querySelector(".ci-select").setAttribute("aria-pressed", String(entry === item));
    });
    const inspector = this.container.querySelector(".ci-inspector");
    inspector.hidden = false;
    if (!item.result) {
      if (!item.previewUrl) {
        item.previewUrl = URL.createObjectURL(item.file);
        item.urls.push(item.previewUrl);
      }
      inspector.innerHTML = `<header class="ci-inspector-header"><div><h3></h3></div></header><div class="ci-inspector-body"><p class="ci-detail"></p><div class="ci-original-preview ci-checker"><img alt="Original image"></div></div>`;
      inspector.querySelector("h3").textContent = item.file.name;
      inspector.querySelector(".ci-detail").textContent =
        item.error || (item.dimensions ? `${item.dimensions.width} × ${item.dimensions.height} · Original` : "Original");
      if (item.dimensions) {
        inspector.querySelector("img").width = item.dimensions.width;
        inspector.querySelector("img").height = item.dimensions.height;
      }
      inspector.querySelector("img").src = item.previewUrl;
      return;
    }
    inspector.innerHTML = `<header class="ci-inspector-header"><div><h3></h3></div><div data-ci="preview-controls"></div><div class="ci-view-controls" role="group" aria-label="Comparison view"><button class="btn btn-sm btn-secondary" data-ci="pair"><span class="ci-label-wide">Side by side</span><span class="ci-label-narrow">Both</span></button>
      <button class="btn btn-sm btn-secondary" data-ci="overlay">Slider</button></div></header>
      <div class="ci-inspector-body"><p class="ci-detail"></p><div class="ci-preview"></div><details class="ci-diagnostics"><summary><svg class="ci-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Log</summary>
      <div class="ci-log-actions"><a href="./licenses/image-optimizer/NOTICE.txt" target="_blank" rel="noopener">Image library licenses</a>
      <button class="btn btn-secondary btn-sm" data-ci="copy-log">Copy log</button></div><pre tabindex="0" aria-label="Processing log"></pre></details></div>`;
    inspector.querySelector("h3").textContent = item.file.name;
    const result = item.result;
    inspector.querySelector(".ci-detail").textContent = item.error || (result ? this.describe(item) : "");
    inspector.querySelector("pre").textContent = item.logs.map((entry) => `${entry.stage} ${JSON.stringify(entry.details)}`).join("\n");
    this.$("copy-log").addEventListener("click", () =>
      this.copyToClipboard(JSON.stringify({ tool: "compress-image", entries: item.logs }, null, 2)),
    );
    this.$("pair").addEventListener("click", () => {
      this.view = "pair";
      this.persistWorkspace();
      this.showPreview(item);
    });
    this.$("overlay").addEventListener("click", () => {
      this.view = "overlay";
      this.persistWorkspace();
      this.showPreview(item);
    });
    this.showPreview(item);
  }
  // One line of facts about a result: size change, encoding, and anything the codec reported.
  describe(item) {
    const result = item.result;
    if (result.originalKept) return `${result.originalWidth} × ${result.originalHeight} · Unchanged · original kept`;
    const dimensions = result.resized
      ? `${result.originalWidth} × ${result.originalHeight} → ${result.width} × ${result.height}`
      : `${result.width} × ${result.height}`;
    const encoding = result.lossy
      ? item.blob.type === "image/png"
        ? "Lossy"
        : `Lossy · quality ${result.quality}`
      : item.blob.type === "image/webp"
        ? "Lossless WebP"
        : "Lossless";
    const removed = result.metadataRemovedBytes ? `${size(result.metadataRemovedBytes)} of text comments removed` : "";
    return [dimensions, encoding, result.fallbackReason, removed].filter(Boolean).join(" · ");
  }
  showPreview(item) {
    this.previewCleanup?.();
    const preview = this.container.querySelector(".ci-preview");
    this.$("pair").setAttribute("aria-pressed", String(this.view === "pair"));
    this.$("overlay").setAttribute("aria-pressed", String(this.view === "overlay"));
    if (!item.result) {
      preview.replaceChildren();
      return;
    }
    this.$("preview-controls").innerHTML =
      `<div class="ci-zoom-controls"><label>Zoom <input data-ci="zoom" type="range" min="1" max="32" step="0.25" value="1"><output data-ci="zoom-value">Fit</output></label>
      <button class="btn btn-ghost btn-sm ci-reset" data-ci="fit" aria-label="Reset zoom" title="Reset zoom"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7a5 5 0 1 1 0 4M3 2v5h5"/></svg></button></div>`;
    const downloads = document.createElement("div");
    downloads.className = "ci-preview-downloads";
    downloads.innerHTML = `<button class="btn btn-ghost btn-sm" data-ci="original">Download original</button><button class="btn btn-secondary btn-sm" data-ci="result">Download result</button>`;
    preview.innerHTML = `<div class="ci-pair" ${this.view === "pair" ? "" : "hidden"}>
      <figure><figcaption>Original <span>${size(item.file.size)}</span></figcaption><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Original image. Arrow keys pan; plus and minus zoom."><img alt="Original image"><span class="ci-cursor" hidden></span></div></figure>
      <figure><figcaption>Result <span>${size(item.blob.size)}</span></figcaption><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Result image. Arrow keys pan; plus and minus zoom."><img alt="Compressed result"><span class="ci-cursor" hidden></span></div></figure></div>
      <div class="ci-overlay" ${this.view === "overlay" ? "" : "hidden"}><div class="ci-viewport ci-checker" tabindex="0" role="group" aria-label="Image comparison. Arrow keys pan; plus and minus zoom.">
        <img alt="Original image"><div class="ci-reveal ci-checker"><img alt="Compressed result"></div><span class="ci-divider" role="slider" tabindex="0" aria-label="Comparison divider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></span>
        <span class="ci-overlay-label ci-label-before">Original</span><span class="ci-overlay-label ci-label-after">Result</span></div>
        <label class="ci-slider">Original <input data-ci="split" type="range" min="0" max="100" value="50" aria-label="Before and after comparison"> Result</label></div>`;
    preview.append(downloads);
    this.$("result").disabled = this.running || this.zipping;
    this.$("result").addEventListener("click", () => this.download(item.blob, this.outputName(item)));
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
    this.previewCleanup = attachPreviewControls({
      preview,
      zoomInput: this.$("zoom"),
      zoomValue: this.$("zoom-value"),
      fit: this.$("fit"),
      splitInput: this.$("split"),
    });
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
    const stale = this.isStale();
    const pending = !ready.length || stale || this.items.some((item) => item.status !== "Ready");
    const types = this.items.map((item) => item.type || item.file.type);
    this.$("all-settings").disabled = this.running || this.zipping;
    this.$("target-settings").disabled = this.running || this.zipping;
    this.$("png-settings").disabled = this.running || this.zipping || !types.includes("image/png");
    this.$("photo-settings").disabled =
      this.running || this.zipping || !types.some((type) => type === "image/jpeg" || type === "image/webp");
    this.container.querySelector(".ci-drop").hidden = this.items.length > 0;
    this.$("table").hidden = !this.items.length;
    const compress = this.$("compress");
    compress.hidden = !pending && !this.running;
    compress.classList.toggle("btn-primary", pending);
    compress.classList.toggle("btn-secondary", !pending);
    compress.disabled = !this.items.length || this.running || this.zipping || this.restoring;
    compress.textContent = this.running
      ? "Compressing…"
      : ready.length
        ? "Compress again"
        : this.items.length === 1
          ? "Compress image"
          : `Compress ${this.items.length} images`;
    const query = this.$("quick-query");
    query.hidden = !ready.length;
    query.disabled = !ready.length || this.running || this.zipping || stale || this.restoring;
    const zip = this.$("zip");
    zip.hidden = !ready.length;
    zip.textContent = this.zipping ? "Creating ZIP…" : "Download ZIP";
    zip.classList.toggle("btn-primary", !pending);
    zip.classList.toggle("btn-secondary", pending);
    zip.disabled = !ready.length || this.running || this.zipping || this.restoring;
    if (this.$("result")) this.$("result").disabled = this.running || this.zipping;
    this.container.querySelectorAll(".ci-settings input, .ci-settings select, .ci-choice").forEach((input) => {
      input.disabled = this.running || this.zipping || this.restoring;
    });
    this.$("width").disabled = this.$("height").disabled = this.running || this.zipping || this.restoring || !this.$("resize").checked;
    this.$("png-quality-preset").disabled = this.running || this.zipping || this.restoring;
    this.$("choose").disabled = this.$("add").disabled = this.$("clear").disabled = this.running || this.zipping || this.restoring;
    this.items.forEach((item) => {
      item.row.querySelector(".ci-download").disabled = !item.result || this.running || this.zipping;
      item.row.querySelectorAll("[data-variant]").forEach((button) => {
        button.disabled = button.dataset.state !== "ready" || this.running || this.zipping;
      });
      item.row.querySelector(".ci-fit-target").disabled = this.running || this.zipping;
    });
  }
  outputName(item) {
    const sourceExtension = item.file.name.split(".").at(-1).toLowerCase();
    const ext = item.blob.type === "image/jpeg" && sourceExtension === "jpeg" ? "jpeg" : extension(item.blob.type);
    return `${item.file.name.replace(/\.[^.]+$/, "") || "image"}.${ext}`;
  }
  async exportOptions(name, zip = false) {
    return imageWorkflowDialog({
      title: zip ? "Download ZIP" : "Download image",
      fields: [
        { name: "filename", label: "File name", value: name },
        {
          name: "format",
          label: zip ? "Files in ZIP" : "Format",
          options: [
            { value: "image", label: "Image" },
            { value: "base64", label: "Base64 (data URL)" },
          ],
        },
      ],
      actions: [{ value: "download", label: "Download", primary: true }],
      signal: this.workflow.signal,
    });
  }
  async download(blob, name) {
    if (this.running || this.zipping) return;
    const options = await this.exportOptions(name);
    if (!options) return;
    try {
      const base64 = options.format === "base64";
      const output = base64 ? new Blob([await blobDataUrl(blob)], { type: "text/plain;charset=utf-8" }) : blob;
      const ext = base64 ? "txt" : name.split(".").at(-1);
      const filename = this.exportName(options.filename, ext);
      if (!this.workflow.signal.aborted) await this.saveDownload(output, filename);
    } catch (_) {
      this.showError("Unable to download this image. Try again.");
    }
  }
  exportName(name, ext) {
    const safe = name.trim().replace(/[\\/\p{Cc}]/gu, "_") || "image";
    return `${safe.replace(/\.[^.]+$/, "") || "image"}.${ext}`;
  }
  async saveDownload(blob, name) {
    if (isTauri()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({ defaultPath: name, filters: [{ name: "Export", extensions: [name.split(".").at(-1)] }] });
      if (!path) return;
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      this.showSuccess(`Saved ${name}`);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.showSuccess(`Download started: ${name}`);
  }
  async downloadZip() {
    if (this.running || this.zipping || !this.items.some((item) => item.result)) return;
    const options = await this.exportOptions("compressed-images.zip", true);
    if (!options || this.running || this.zipping) return;
    const generation = this.generation;
    this.zipping = true;
    this.updateSummary();
    try {
      const zip = new JSZip();
      const names = new Set();
      for (const item of this.items.filter((entry) => entry.result)) {
        const base64 = options.format === "base64";
        const name = uniqueImageName(base64 ? this.exportName(this.outputName(item), "txt") : this.outputName(item), names);
        zip.file(name, base64 ? await blobDataUrl(item.blob) : await item.blob.arrayBuffer());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      if (generation === this.generation && !this.workflow.signal.aborted) {
        await this.saveDownload(blob, this.exportName(options.filename, "zip"));
      }
    } catch (_) {
      if (generation === this.generation) this.error("Unable to create ZIP. Download the images individually.");
    } finally {
      this.zipping = false;
      this.updateSummary();
    }
  }
  clear({ persist = true } = {}) {
    this.previewCleanup?.();
    this.previewCleanup = null;
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
      inspector.hidden = false;
      inspector.innerHTML = '<p class="ci-preview-empty">Select an image to preview</p>';
    }
    this.appliedSettings = undefined;
    if (this.container) {
      this.error("");
      this.updateAdvice();
    }
    this.updateSummary();
    if (persist) this.persistWorkspace();
  }
  hasActiveBackgroundWork() {
    return this.running || this.zipping;
  }
  onUnmount() {
    this.workflow?.abort();
    void this.flushWorkspace();
    window.removeEventListener("pagehide", this._saveOnPageHide);
    this.headerObserver?.disconnect();
    this.resizerCleanup?.();
    this.clear({ persist: false });
  }
}
