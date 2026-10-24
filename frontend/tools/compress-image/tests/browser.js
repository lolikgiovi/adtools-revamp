import pako from "pako";
import JSZip from "jszip";
import { UsageTracker } from "../../../core/UsageTracker.js";

// Fixture processing must not change real usage counts.
UsageTracker.trackToolUse = () => {};
import { CompressImage, formatSize } from "../main.js";
import { makeChunk } from "../service.js";
import { inspectImage } from "../image-info.js";
import encodeWebp, { init as initWebp } from "@jsquash/webp/encode.js";
import webpWasm from "@jsquash/webp/codec/enc/webp_enc.wasm?url";
import webpSimdWasm from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";

document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("theme") === "dark");

const checks = [];
function check(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}
function join(parts) {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
function fixture(width, height, noise = false, level = 0) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const data = new Uint8Array((width * 4 + 1) * height);
  let seed = 42;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width * 4; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[y * (width * 4 + 1) + 1 + x] =
        noise === "gentle"
          ? x % 4 === 3
            ? 127
            : Math.max(0, Math.min(255, Math.floor((x % 4 === 1 ? y / height : x / 4 / width) * 200) + 28 + (seed >>> 28)))
          : noise
            ? seed >>> 24
            : x % 4 === 3
              ? 127
              : x % 4 === 0
                ? Math.floor((x / 4 / width) * 255)
                : x % 4 === 1
                  ? Math.floor((y / height) * 255)
                  : ((Math.floor(x / 4 / 32) + Math.floor(y / 32)) % 2) * 160;
    }
  }
  return join([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk("IHDR", header),
    makeChunk("sRGB", new Uint8Array([0])),
    makeChunk("IDAT", pako.deflate(data, { level })),
    makeChunk("IEND", new Uint8Array()),
  ]);
}
function withText(bytes, chunkBytes) {
  const text = new Uint8Array(chunkBytes - 12).fill(65);
  text.set(new TextEncoder().encode("Comment"));
  text[7] = 0;
  return join([bytes.slice(0, 33), makeChunk("tEXt", text), bytes.slice(33)]);
}
function interlacedFixture() {
  const width = 17,
    height = 13;
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  header[12] = 1;
  const rows = [];
  for (const [sx, sy, dx, dy] of [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ]) {
    for (let y = sy; y < height; y += dy) {
      const row = [0];
      for (let x = sx; x < width; x += dx) row.push(x * 13, y * 17, 80, (x + y) % 2 ? 127 : 255);
      if (row.length > 1) rows.push(new Uint8Array(row));
    }
  }
  return join([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk("IHDR", header),
    makeChunk("IDAT", pako.deflate(join(rows), { level: 0 })),
    makeChunk("IEND", new Uint8Array()),
  ]);
}
function depth16Fixture() {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, 16);
  new DataView(header.buffer).setUint32(4, 16);
  header[8] = 16;
  header[9] = 6;
  const raw = new Uint8Array((16 * 8 + 1) * 16);
  const view = new DataView(raw.buffer);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const offset = y * 129 + 1 + x * 8;
      view.setUint16(offset, 0x1234 + x);
      view.setUint16(offset + 2, 0x4567 + y);
      view.setUint16(offset + 4, 0x89ab);
      view.setUint16(offset + 6, 65535);
    }
  return join([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk("IHDR", header),
    makeChunk("IDAT", pako.deflate(raw, { level: 0 })),
    makeChunk("IEND", new Uint8Array()),
  ]);
}
function select(files) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  const input = document.querySelector("#ci-files");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function settle(tool) {
  const deadline = Date.now() + 60000;
  while (tool.running) {
    if (Date.now() > deadline) throw new Error("Browser processing timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
function pixels(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}
// Failure scenarios: corrupt input must not stop a batch; no invented savings;
// lossy fallback must not masquerade as WebP; resizing must be opt-in;
// linked transforms, slider endpoints, unique ZIP filenames and clearing in flight.
const tool = new CompressImage();
tool.mount(document.querySelector("#tool"));
const root = document.querySelector("#tool");
const control = (name) => root.querySelector(`[data-ci="${name}"]`);
function change(name, value) {
  const input = control(name);
  if (input.type === "checkbox" || input.type === "radio") input.checked = value;
  else input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function compress() {
  control("compress").click();
  await settle(tool);
}
try {
  check(
    control("preset").value === "balanced" && control("png-mode").value === "lossless" && !control("resize").checked,
    "Lossless with original dimensions is the default.",
  );
  // Flow failures (empty state): more than the drop target competing for attention.
  // Rendered and not visibility-hidden: hidden placeholder cells keep their space but are not shown.
  const visible = (element) =>
    !!element &&
    element.getClientRects().length > 0 &&
    (element.checkVisibility ? element.checkVisibility({ visibilityProperty: true }) : getComputedStyle(element).visibility !== "hidden");

  check(
    visible(control("settings-panel")) && visible(root.querySelector(".ci-drop")) && visible(control("add")),
    "Empty state keeps settings and pane actions visible alongside the drop target.",
  );
  select([
    new File([fixture(320, 320, "gentle")], "transparent.png", { type: "image/png" }),
    new File([fixture(320, 320, true)], "noise.png", { type: "image/png" }),
    new File(["invalid"], "invalid.png", { type: "image/png" }),
    new File([withText(fixture(800, 500, false, 9), 343421)], "text-heavy.png", { type: "image/png" }),
  ]);
  check(tool.items.length === 4 && !tool.running && !tool.items[0].result, "Multiple files queue before explicit compression.");
  await compress();
  const [first, noise, invalid, text] = tool.items;
  check(first.blob.size < first.file.size && noise.blob.size > 300000, "Real savings and verified results above 300 KB are downloadable.");
  check(invalid.status === "Error" && !!text.result, "An invalid image fails independently; later files still complete.");
  check(text.result.metadataRemovedBytes === 343421, "Lossless compression removes text comments and preserves rendering metadata.");
  check(text.row.textContent.includes("800 × 500"), "File rows show output dimensions.");
  check(root.querySelector(".ci-summary").textContent.includes("saved"), "Batch totals report actual byte savings.");
  const original = new Image();
  original.src = first.before;
  await original.decode();
  const output = new Image();
  output.src = first.after;
  await output.decode();
  const beforePixels = pixels(original),
    afterPixels = pixels(output);
  check(
    beforePixels.every((v, i) => v === afterPixels[i]),
    "Lossless output has identical browser-rendered RGBA including transparency.",
  );
  check(tool.view === "pair", "Side by side opens first.");
  const separator = control("resizer");
  if (innerWidth > 960) {
    const start = Number(separator.getAttribute("aria-valuenow"));
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    check(Number(separator.getAttribute("aria-valuenow")) > start, "Pane separator supports keyboard resizing.");
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  }
  check(first.row.querySelector(".ci-method").textContent === "Lossless", "Table reports the actual compression method.");
  const gesturePane = root.querySelector(".ci-pair .ci-viewport");
  gesturePane.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
  check(Number(control("zoom").value) > 1, "Trackpad pinch wheel events zoom the linked preview.");
  control("fit").click();
  // Synthetic pointers exercise gesture math; pointer capture requires physical input,
  // so only that browser primitive is replaced for these dispatched events.
  const savedCapture = gesturePane.setPointerCapture;
  gesturePane.setPointerCapture = () => {};
  const pointer = (name, id, x, y, type = "touch") =>
    gesturePane.dispatchEvent(
      new PointerEvent(name, {
        pointerId: id,
        pointerType: type,
        clientX: x,
        clientY: y,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  const gestureRect = gesturePane.getBoundingClientRect();
  const gx = gestureRect.left + gestureRect.width / 2;
  const gy = gestureRect.top + gestureRect.height / 2;
  try {
    pointer("pointerdown", 31, gx - 50, gy);
    pointer("pointerdown", 32, gx + 50, gy);
    pointer("pointermove", 32, gx + 150, gy);
    check(Number(control("zoom").value) === 2, "Two touch pointers pinch from fit to 2× zoom.");
    pointer("pointerup", 31, gx - 50, gy);
    pointer("pointerup", 32, gx + 150, gy);
    const beforeDrag = root.querySelector(".ci-pair img").style.transform;
    pointer("pointerdown", 33, gx, gy, "mouse");
    pointer("pointermove", 33, gx - 30, gy + 30, "mouse");
    const afterDrag = [...root.querySelectorAll(".ci-pair img")].map((img) => img.style.transform);
    check(afterDrag[0] !== beforeDrag && afterDrag[0] === afterDrag[1], "Dragging pans both images by the same amount.");
    pointer("pointercancel", 33, gx - 30, gy + 30, "mouse");
    pointer("pointermove", 33, gx - 50, gy + 50, "mouse");
    check(root.querySelector(".ci-pair img").style.transform === afterDrag[0], "Cancelled gestures cannot leave pan stuck.");
  } finally {
    gesturePane.setPointerCapture = savedCapture;
    control("fit").click();
  }
  control("zoom").value = "3";
  control("zoom").dispatchEvent(new Event("input", { bubbles: true }));
  const pane = root.querySelector(".ci-viewport");
  pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  const transforms = [...root.querySelectorAll(".ci-pair img")].map((img) => img.style.transform);
  check(transforms[0] === transforms[1] && transforms[0].includes("scale(3)"), "Zoom and keyboard pan stay linked between panes.");
  pane.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 100, bubbles: true }));
  check(root.querySelectorAll(".ci-cursor:not([hidden])").length === 2, "Hover indicates matching positions in both panes.");
  control("overlay").click();
  const slider = control("split");
  slider.value = "75";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  check(
    root.querySelector(".ci-reveal").style.clipPath.includes("75%"),
    "Slider changes the clipping boundary while image geometry stays aligned.",
  );
  check(root.querySelector(".ci-divider").style.left === "75%", "Visible divider tracks the slider.");
  const divider = root.querySelector(".ci-divider");
  divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  check(control("split").value === "74", "The on-image divider has a keyboard alternative to dragging.");
  const captureDivider = divider.setPointerCapture;
  divider.setPointerCapture = () => {};
  try {
    const rect = divider.parentElement.getBoundingClientRect();
    divider.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 41,
        button: 0,
        clientX: rect.left + rect.width * 0.25,
        bubbles: true,
        cancelable: true,
      }),
    );
    divider.dispatchEvent(new PointerEvent("pointermove", { pointerId: 41, clientX: rect.left + rect.width * 0.75, bubbles: true }));
    divider.dispatchEvent(new PointerEvent("pointerup", { pointerId: 41, bubbles: true }));
    check(Math.abs(Number(control("split").value) - 75) < 1, "Dragging the on-image divider updates both clipping and the range control.");
  } finally {
    divider.setPointerCapture = captureDivider;
  }

  let downloaded;
  tool.download = (blob, name) => {
    downloaded = { blob, name };
  };
  control("original").click();
  check(
    downloaded.blob === tool.selected.file && downloaded.name === tool.selected.file.name,
    "Original bytes remain directly downloadable alongside the comparison.",
  );
  check(
    tool.outputName({ file: { name: "photo.jpeg" }, blob: { type: "image/jpeg" } }) === "photo.jpeg",
    "JPEG output preserves the original jpeg extension.",
  );
  await tool.downloadZip();
  const zip = await JSZip.loadAsync(await downloaded.blob.arrayBuffer());
  check(
    Object.keys(zip.files).length === 3 && downloaded.name.endsWith(".zip"),
    "ZIP includes every successful image and excludes failures.",
  );
  // Settle the background offer pass first: cancelling it mid-job replaces that worker by design.
  await tool.offers;
  const workersBeforeRerun = tool.pool.stats.created;
  change("png-mode", "lossy");
  await compress();
  check(first.blob.type === "image/png" && first.result.lossy, "Opt-in lossy PNG stays PNG and accepts a useful quantized result.");
  check(
    first.logs.some((entry) => entry.stage === "Quantizing"),
    "Quantization reports a named stage.",
  );
  check(
    first.logs.some((entry) => entry.stage === "png.lossless-skipped"),
    "Lossy PNG that is clearly smaller skips the lossless pass.",
  );
  check(tool.pool.stats.created === workersBeforeRerun, "Warm workers are reused across files and runs.");
  const previousLossy = first.blob;
  const originalRunWorker = tool.runWorker;
  // The worker fully validates every codec output (checked by the png.validated counts
  // below); the main thread still rejects a structurally broken result.
  tool.runWorker = async function () {
    const source = fixture(320, 320);
    const bytes = join([source.slice(0, 33), makeChunk("IDAT", new Uint8Array(1024 * 1024)), makeChunk("IEND", new Uint8Array())]);
    bytes[bytes.length - 20] ^= 1;
    return { bytes, width: 320, height: 320, type: "image/png", lossy: true };
  };
  try {
    await compress();
  } finally {
    tool.runWorker = originalRunWorker;
  }
  check(
    first.blob === previousLossy && first.status === "Error",
    "Invalid candidates preserve prior results and cannot hide behind size fallback.",
  );
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 400;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 640, 400);
  gradient.addColorStop(0, "#e73658");
  gradient.addColorStop(1, "#1946ea");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 640, 400);
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 1));
  context.clearRect(0, 0, 640, 400);
  context.globalAlpha = 0.5;
  context.fillRect(0, 0, 640, 400);
  // WebKit's canvas cannot encode WebP (toBlob silently returns PNG), so the fixture comes from
  // the same libwebp encoder the tool bundles: a lossy, semi-transparent WebP in every engine.
  await initWebp({ locateFile: (path) => (path.includes("simd") ? webpSimdWasm : webpWasm) });
  const webp = new Blob([await encodeWebp(context.getImageData(0, 0, 640, 400), { quality: 90, alpha_quality: 100 })], {
    type: "image/webp",
  });
  const transfer = new DataTransfer();
  transfer.items.add(new File([jpeg], "photo.jpeg", { type: "image/jpeg" }));
  transfer.items.add(new File([webp], "asset.webp", { type: "image/webp" }));
  const exif = new Uint8Array([
    255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
  transfer.items.add(new File([join([jpegBytes.slice(0, 2), exif, jpegBytes.slice(2)])], "rotated.jpg", { type: "image/jpeg" }));
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: transfer });
  root.querySelector(".ci-drop").dispatchEvent(drop);
  change("preset", "small");
  check(control("quality").value === "75" && tool.readSettings().pngQuality.min === 80, "JPEG/WebP presets preserve PNG quality controls.");
  await compress();
  const jpegItem = tool.items.find((item) => item.file.name === "photo.jpeg"),
    webpItem = tool.items.find((item) => item.file.name === "asset.webp");
  const rotated = tool.items.find((item) => item.file.name === "rotated.jpg");
  check(rotated.result?.width === 400 && rotated.result.height === 640, "EXIF-rotated JPEG retains displayed orientation and dimensions.");
  const originalWebp = new Image(),
    optimizedWebp = new Image();
  originalWebp.src = webpItem.before;
  optimizedWebp.src = webpItem.after;
  await Promise.all([originalWebp.decode(), optimizedWebp.decode()]);
  check(pixels(originalWebp)[3] === pixels(optimizedWebp)[3], "WebP preserves the semi-transparent alpha sample.");
  check(
    jpegItem.result && jpegItem.blob.type === "image/jpeg" && tool.outputName(jpegItem) === "photo.jpeg",
    "MozJPEG preserves JPEG format and extension.",
  );
  check(webpItem.result && webpItem.blob.type === "image/webp", "libwebp preserves WebP format.");
  check(
    jpegItem.logs.some((entry) => entry.details.codec === "MozJPEG") && webpItem.logs.some((entry) => entry.details.codec === "libwebp"),
    "Real WASM codecs report their identities.",
  );
  change("png-mode", "lossless");
  change("resize", true);
  change("width", "160");
  change("height", "120");
  await compress();
  check(
    text.result.width === 160 && text.result.height === 100 && text.result.resized,
    "Resize happens before optimization and fits bounds without stretching.",
  );
  check(
    jpegItem.result.width === 160 && jpegItem.result.height === 100 && jpegItem.blob.type === "image/jpeg",
    "JPEG resizing retains target dimensions and format.",
  );
  check(text.row.textContent.includes("Resized"), "Resized output is never labeled identical to original pixels.");
  change("png-mode", "lossy");
  change("png-quality-preset", "high");
  // The UI offers named presets; exercise an unattainable floor at the codec boundary.
  const readSettings = tool.readSettings.bind(tool);
  tool.readSettings = () => ({ ...readSettings(), pngQuality: { min: 100, target: 100 } });
  await compress();
  tool.readSettings = readSettings;
  check(
    !text.result.lossy && text.blob.type === "image/png",
    "Unattainable quantization quality falls back to lossless PNG at the target dimensions.",
  );
  change("png-quality-preset", "");
  const previousQuality = first.blob;
  await compress();
  check(first.blob === previousQuality && !tool.running, "Invalid PNG quality selections preserve previous results.");
  change("preset", "balanced");
  change("png-quality-preset", "balanced");
  change("png-mode", "lossless");
  change("width", "0");
  const previous = first.blob;
  await compress();
  check(first.blob === previous && !tool.running, "Invalid resize bounds preserve existing results.");
  change("resize", false);
  change("width", "160");
  control("compress").click();
  tool.clear();
  await settle(tool);
  check(
    tool.items.length === 0 && root.querySelectorAll(".ci-file-row").length === 0 && control("zip").disabled,
    "Clear cancels in-flight work and removes stale results.",
  );
  select([
    new File([fixture(640, 400)], "sample.png", { type: "image/png" }),
    new File([fixture(240, 320)], "sample.png", { type: "image/png" }),
    new File([fixture(640, 240, false, 9)], "color-study.png", { type: "image/png" }),
    new File([interlacedFixture()], "interlaced.png", { type: "image/png" }),
    new File([depth16Fixture()], "depth16.png", { type: "image/png" }),
  ]);
  await compress();
  const interlaced = tool.items[3];
  const interlacedBefore = new Image(),
    interlacedAfter = new Image();
  interlacedBefore.src = interlaced.before;
  interlacedAfter.src = interlaced.after;
  await Promise.all([interlacedBefore.decode(), interlacedAfter.decode()]);
  const adamBefore = pixels(interlacedBefore),
    adamAfter = pixels(interlacedAfter);
  check(
    adamBefore.every((value, i) => value === adamAfter[i]),
    "Adam7 PNG remains pixel-identical after deinterlacing optimization.",
  );
  change("png-mode", "lossy");
  await compress();
  check(
    !tool.items[4].result.lossy && tool.items[4].logs.some((entry) => entry.stage === "png.lossless-fallback"),
    "16-bit PNG stays on the lossless path even when color reduction is enabled.",
  );
  change("png-mode", "lossless");
  await tool.downloadZip();
  const finalZip = await JSZip.loadAsync(await downloaded.blob.arrayBuffer());
  check(finalZip.files["sample.png"] && finalZip.files["sample (2).png"], "ZIP keeps duplicate filenames as separate files.");
  tool.items[0].row.querySelector(".ci-download").click();
  check(
    downloaded.name === "sample.png" && downloaded.blob.type === "image/png",
    "Individual download uses the selected result with the matching extension.",
  );
  check(
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    "The tool does not overflow the viewport horizontally.",
  );
  tool.view = "pair";
  tool.selectItem(tool.items[0]);
  check(control("files").getAttribute("aria-label") === "Add images", "File input has an accessible name.");
  check(control("zip").closest(".ci-batch-header"), "Batch download is grouped with results.");
  check(
    tool.items[0].row.querySelector(".ci-select").getAttribute("aria-pressed") === "true",
    "Selected image is exposed to assistive technology.",
  );
  change("resize", true);
  change("height", "0");
  await compress();
  check(
    document.activeElement === control("height") && control("height").getAttribute("aria-invalid") === "true",
    "Invalid height is identified and focused.",
  );
  change("resize", false);
  change("height", "1920");
  tool.error("");
  const zipTask = tool.downloadZip();
  check(control("zip").textContent === "Creating ZIP…", "ZIP generation exposes a busy label.");
  await zipTask;
  tool.clear();
  const profile = Uint8Array.from({ length: 600 }, (_, i) => (i * 7) % 251);
  const iccp = makeChunk(
    "iCCP",
    join([new TextEncoder().encode("sRGB IEC61966-2.1"), new Uint8Array([0, 0]), pako.deflate(profile, { level: 0 })]),
  );
  const withProfile = fixture(320, 320, "gentle");
  select([new File([join([withProfile.slice(0, 33), iccp, withProfile.slice(33)])], "profile.png", { type: "image/png" })]);
  await compress();
  const profiled = tool.items[0];
  check(
    profiled.status === "Ready" && profiled.blob.size < profiled.file.size && profiled.result.outcome === "Optimized",
    "PNG with an embedded ICC profile compresses losslessly instead of failing.",
  );
  // Oxipng level is effort, not quality: presets must not trade size for nothing.
  // This fixture compresses differently at levels 2 and 4 (1,361 vs 1,114 bytes).
  tool.clear();
  select([new File([fixture(320, 320)], "levels.png", { type: "image/png" })]);
  const presetOutput = async (preset) => {
    change("preset", preset);
    change("png-mode", "lossless");
    await compress();
    return new Uint8Array(await tool.items[0].blob.arrayBuffer());
  };
  const highBytes = await presetOutput("high");
  const smallBytes = await presetOutput("small");
  check(
    highBytes.length === smallBytes.length && highBytes.every((value, i) => value === smallBytes[i]),
    "Lossless PNG output is identical across presets.",
  );
  // Lossless WebP failures: re-encoded as lossy VP8, pixels changed, the JPEG/WebP
  // quality slider leaking into lossless output, output larger than the original,
  // resize not switching to lossy, and the detail text describing it as lossy or PNG.
  const art = document.createElement("canvas");
  art.width = 320;
  art.height = 200;
  const artContext = art.getContext("2d");
  for (let y = 0; y < 200; y += 20)
    for (let x = 0; x < 320; x += 20) {
      artContext.fillStyle = `rgb(${x % 256}, ${(y * 3) % 256}, ${(x + y) % 2 ? 200 : 40})`;
      artContext.fillRect(x, y, 20, 20);
    }
  const artPixels = artContext.getImageData(0, 0, 320, 200);
  const losslessWebp = async (quality, method) =>
    new File([await encodeWebp(artPixels, { lossless: 1, exact: 1, quality, method })], "lossless.webp", { type: "image/webp" });
  const webpRun = async (file, quality) => {
    tool.clear();
    change("resize", false);
    change("quality", String(quality));
    select([file]);
    await compress();
    return tool.items[0];
  };
  const quickWebp = await losslessWebp(0, 0);
  check(inspectImage(new Uint8Array(await quickWebp.arrayBuffer())).lossless, "The lossless WebP fixture is VP8L.");
  const kept = await webpRun(quickWebp, 30);
  const keptBytes = new Uint8Array(await kept.blob.arrayBuffer());
  check(kept.blob.type === "image/webp" && inspectImage(keptBytes).lossless, "Lossless WebP input stays lossless WebP.");
  check(
    kept.logs.some((entry) => entry.stage === "Encoding" && entry.details.codec === "libwebp" && entry.details.lossless === 1),
    "Lossless WebP reports libwebp lossless encoding.",
  );
  const webpBefore = new Image(),
    webpAfter = new Image();
  webpBefore.src = kept.before;
  webpAfter.src = kept.after;
  await Promise.all([webpBefore.decode(), webpAfter.decode()]);
  const beforeWebpPixels = pixels(webpBefore),
    afterWebpPixels = pixels(webpAfter);
  check(
    beforeWebpPixels.length === afterWebpPixels.length && beforeWebpPixels.every((v, i) => v === afterWebpPixels[i]),
    "Lossless WebP output decodes to identical pixels.",
  );
  tool.selectItem(kept);
  const keptDetail = root.querySelector(".ci-detail").textContent;
  check(/lossless/i.test(keptDetail) && !/Quality \d|PNG/.test(keptDetail), "Lossless WebP detail text says lossless, not quality or PNG.");
  const highQualityBytes = new Uint8Array(await (await webpRun(quickWebp, 90)).blob.arrayBuffer());
  check(
    highQualityBytes.length === keptBytes.length && highQualityBytes.every((v, i) => v === keptBytes[i]),
    "The JPEG/WebP quality slider does not change lossless WebP output.",
  );
  const tightWebp = await losslessWebp(100, 6);
  const tight = await webpRun(tightWebp, 85);
  check(tight.status === "Ready" && tight.blob.size <= tightWebp.size, "Lossless WebP never comes back larger than the original.");
  tool.clear();
  change("resize", true);
  change("width", "160");
  change("height", "160");
  select([quickWebp]);
  await compress();
  const resizedWebp = new Uint8Array(await tool.items[0].blob.arrayBuffer());
  check(
    tool.items[0].result.resized && !inspectImage(resizedWebp).lossless && inspectImage(resizedWebp).width === 160,
    "Resized lossless WebP uses lossy encoding at the target size.",
  );
  change("resize", false);
  // Main-thread decode failures: lossless PNG still decoded only to read its size,
  // wrong dimensions once the decode is skipped (including Adam7), and the resize
  // or lossy PNG paths losing the decode they need for pixels.
  const decodedSources = [];
  const nativeDecode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () {
    decodedSources.push(this.src);
    return nativeDecode.call(this);
  };
  const sourceDecoded = async (file, { lossy = false, resize = false } = {}) => {
    tool.clear();
    change("png-mode", lossy ? "lossy" : "lossless");
    change("resize", resize);
    if (resize) {
      change("width", "100");
      change("height", "100");
    }
    decodedSources.length = 0;
    select([file]);
    await compress();
    // Since phase 2 the decode usually runs in the worker, so count its Decoding stage too.
    const item = tool.items[0];
    return { item, decoded: decodedSources.includes(item.before) || item.logs.some((entry) => entry.stage === "Decoding") };
  };
  try {
    const lossless = await sourceDecoded(new File([fixture(320, 200)], "lossless.png", { type: "image/png" }));
    check(
      lossless.item.status === "Ready" && lossless.item.result.width === 320 && lossless.item.result.height === 200,
      "Lossless PNG keeps its dimensions without a main-thread decode.",
    );
    check(!lossless.decoded, "Lossless PNG is not decoded at all just to read its size.");
    const adam7 = await sourceDecoded(new File([interlacedFixture()], "adam7.png", { type: "image/png" }));
    check(
      adam7.item.status === "Ready" && !adam7.decoded && adam7.item.result.width === 17,
      "Adam7 PNG keeps its size without the decode.",
    );
    const resized = await sourceDecoded(new File([fixture(320, 200)], "resize.png", { type: "image/png" }), { resize: true });
    check(resized.decoded && resized.item.result.width === 100, "Resized PNG still decodes its pixels.");
    const quantized = await sourceDecoded(new File([fixture(320, 200, "gentle")], "lossy.png", { type: "image/png" }), { lossy: true });
    check(quantized.decoded && quantized.item.status === "Ready", "Lossy PNG still decodes its pixels.");
  } finally {
    HTMLImageElement.prototype.decode = nativeDecode;
    change("png-mode", "lossless");
    change("resize", false);
  }
  // Validation failures: the source decompressed more than once, a codec output that is
  // never fully validated, and full PNG decompression left on the main thread.
  const NativeInflate = pako.Inflate;
  let mainThreadInflates = 0;
  pako.Inflate = function (...args) {
    mainThreadInflates++;
    return new NativeInflate(...args);
  };
  const validatedRoles = async (file, { lossy = false, resize = false } = {}) => {
    tool.clear();
    change("png-mode", lossy ? "lossy" : "lossless");
    change("resize", resize);
    if (resize) {
      change("width", "100");
      change("height", "100");
    }
    select([file]);
    await compress();
    const item = tool.items[0];
    return item.status === "Ready" ? item.logs.filter((entry) => entry.stage === "png.validated").map((entry) => entry.details.role) : [];
  };
  try {
    const roles = (list) => list.join(", ");
    const lossless = await validatedRoles(new File([fixture(320, 200)], "once.png", { type: "image/png" }));
    const quantized = await validatedRoles(new File([fixture(320, 200, "gentle")], "once-lossy.png", { type: "image/png" }), {
      lossy: true,
    });
    const resizedRoles = await validatedRoles(new File([fixture(320, 200)], "once-resized.png", { type: "image/png" }), { resize: true });
    check(mainThreadInflates === 0, "PNG data is never decompressed on the main thread.");
    check(roles(lossless) === "source, output", "Lossless PNG validates the source and the output once each.");
    check(roles(quantized) === "source, output", "Lossy PNG that skips the lossless pass validates the source and its one output.");
    check(roles(resizedRoles) === "source, output", "Resized PNG validates the source and the output once each.");
  } finally {
    pako.Inflate = NativeInflate;
    change("png-mode", "lossless");
    change("resize", false);
  }
  // Presets must affect JPEG/WebP only; PNG mode and quality remain explicit choices.
  tool.clear();
  change("preset", "balanced");
  change("png-mode", "lossless");
  change("preset", "high");
  check(control("png-mode").value === "lossless", "High Quality leaves PNG lossless.");
  change("preset", "small");
  check(control("png-mode").value === "lossless", "JPEG/WebP presets leave PNG lossless.");
  change("png-mode", "lossy");
  check(!control("png-quality-preset").disabled, "Lossy PNG enables its quality selector.");
  change("preset", "balanced");
  check(control("png-mode").value === "lossy", "Switching away from Smaller File keeps lossy PNG on.");
  change("preset", "small");
  select([new File([fixture(320, 200, "gentle")], "smaller.png", { type: "image/png" })]);
  await compress();
  check(tool.items[0].result?.lossy && tool.items[0].blob.type === "image/png", "Smaller File compresses PNG with color reduction.");
  change("preset", "balanced");
  change("png-mode", "lossless");

  // Worker decoding failures: a large decode freezing the main thread; any decode or
  // getImageData left on the main thread; EXIF orientation, P3 color conversion or
  // semi-transparent pixels differing from the <img> path; the fallback not producing
  // the same bytes or not saying it ran; a corrupt image stalling the batch or worker.
  const large = document.createElement("canvas");
  large.width = 4000;
  large.height = 3000;
  const largeContext = large.getContext("2d");
  const largeGradient = largeContext.createLinearGradient(0, 0, 4000, 3000);
  largeGradient.addColorStop(0, "#0a6847");
  largeGradient.addColorStop(1, "#f4ce14");
  largeContext.fillStyle = largeGradient;
  largeContext.fillRect(0, 0, 4000, 3000);
  const largeJpeg = new File([await new Promise((resolve) => large.toBlob(resolve, "image/jpeg", 0.95))], "large.jpg", {
    type: "image/jpeg",
  });
  large.width = large.height = 1;
  tool.clear();
  change("resize", false);
  select([largeJpeg]);
  // Chromium reports blocking directly as long tasks. A hidden or unpainted pane stops
  // animation frames without blocking anything, so frame gaps are only the fallback (WebKit).
  const blocking = async (run) => {
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      let longest = 0;
      const observer = new PerformanceObserver((list) =>
        list.getEntries().forEach((entry) => (longest = Math.max(longest, entry.duration))),
      );
      observer.observe({ type: "longtask" });
      await run();
      await new Promise((resolve) => setTimeout(resolve, 100));
      observer.disconnect();
      return { ms: Math.round(longest), measure: "longest task", limit: 50 };
    }
    let longest = 0;
    let watching = true;
    let last = performance.now();
    const watch = (now) => {
      longest = Math.max(longest, now - last);
      last = now;
      if (watching) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    await run();
    watching = false;
    return { ms: Math.round(longest), measure: "longest frame", limit: 100 };
  };
  const largeRun = await blocking(compress);
  check(tool.items[0].status === "Ready", "A 12 MP JPEG compresses.");
  // A long task is anything over 50 ms; the old main-thread path produced a 73 ms one here.
  check(
    largeRun.ms < largeRun.limit,
    `Compressing a 12 MP JPEG never blocks the main thread for ${largeRun.limit} ms (${largeRun.measure} ${largeRun.ms} ms).`,
  );

  const p3 = document.createElement("canvas");
  p3.width = p3.height = 64;
  const p3Context = p3.getContext("2d", { colorSpace: "display-p3" });
  p3Context.fillStyle = "color(display-p3 0.5 0.4 0.3)";
  p3Context.fillRect(0, 0, 64, 64);
  const p3Bytes = new Uint8Array(await (await new Promise((resolve) => p3.toBlob(resolve, "image/png"))).arrayBuffer());
  check(
    String.fromCharCode(...p3Bytes.subarray(37, 41)) === "iCCP",
    "The P3 fixture carries an ICC profile, so color conversion is exercised.",
  );
  const p3Image = new Image();
  p3Image.src = URL.createObjectURL(new Blob([p3Bytes], { type: "image/png" }));
  await p3Image.decode();
  const expectedP3 = pixels(p3Image).slice(0, 4);
  const rotatedJpeg = new File([join([jpegBytes.slice(0, 2), exif, jpegBytes.slice(2)])], "rotated.jpg", { type: "image/jpeg" });
  const decoderFiles = () => [
    rotatedJpeg,
    new File([webp], "translucent.webp", { type: "image/webp" }),
    quickWebp,
    new File([p3Bytes], "p3.png", { type: "image/png" }),
    new File([fixture(320, 200, "gentle")], "decoder-lossy.png", { type: "image/png" }),
  ];
  const nativeImageDecode = HTMLImageElement.prototype.decode;
  const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  let mainDecodes = 0;
  let mainPixelReads = 0;
  const runDecoderBatch = async (decoder) => {
    tool.clear();
    tool.decoder = decoder;
    change("png-mode", "lossy");
    change("resize", true);
    change("width", "48");
    change("height", "48");
    select(decoderFiles());
    mainDecodes = mainPixelReads = 0;
    HTMLImageElement.prototype.decode = function () {
      mainDecodes++;
      return nativeImageDecode.call(this);
    };
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      mainPixelReads++;
      return nativeGetImageData.apply(this, args);
    };
    try {
      await compress();
    } finally {
      HTMLImageElement.prototype.decode = nativeImageDecode;
      CanvasRenderingContext2D.prototype.getImageData = nativeGetImageData;
    }
    const items = [...tool.items];
    return {
      items,
      bytes: await Promise.all(items.map(async (item) => new Uint8Array(await item.blob.arrayBuffer()))),
      decodes: mainDecodes,
      pixelReads: mainPixelReads,
    };
  };
  const inWorker = await runDecoderBatch("auto");
  check(
    inWorker.items.every((item) => item.status === "Ready"),
    "JPEG, WebP and PNG all compress with decoding in the worker.",
  );
  check(
    inWorker.decodes === 0 && inWorker.pixelReads === 0,
    `Compression makes no image decode or getImageData call on the main thread (${inWorker.decodes} decodes, ${inWorker.pixelReads} reads).`,
  );
  check(
    inWorker.items.every((item) => item.logs.some((entry) => entry.stage === "Decoding" && entry.details.decoder === "worker")),
    "Each image reports that the worker decoded it.",
  );
  const workerRotated = inWorker.items[0].result;
  check(workerRotated.originalWidth === 400 && workerRotated.originalHeight === 640, "The worker applies EXIF orientation.");
  const p3Result = new Image();
  p3Result.src = inWorker.items[3].after;
  await p3Result.decode();
  const actualP3 = pixels(p3Result).slice(0, 4);
  check(
    actualP3.every((value, i) => Math.abs(value - expectedP3[i]) <= 1),
    `The worker converts P3 to sRGB like the <img> path (${[...actualP3]} vs ${[...expectedP3]}).`,
  );
  const onMain = await runDecoderBatch("main");
  check(
    onMain.items.every((item) => item.logs.some((entry) => entry.stage === "Decoding" && entry.details.decoder === "main-thread fallback")),
    "The forced fallback decodes on the main thread and says so.",
  );
  const sameBytes = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
  const decodedPixels = async (bytes, type = "image/jpeg") => {
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([bytes], { type }));
    await image.decode();
    return pixels(image);
  };
  // Engines resample differently (WebKit's worker and <img> paths are not byte-identical), so judge
  // both against an ideal area-average downscale of the original pixels instead of each other.
  const areaDownscale = (data, sw, sh, tw, th) => {
    const out = new Float64Array(tw * th * 4);
    for (let ty = 0; ty < th; ty++)
      for (let tx = 0; tx < tw; tx++) {
        const [x0, x1, y0, y1] = [(tx * sw) / tw, ((tx + 1) * sw) / tw, (ty * sh) / th, ((ty + 1) * sh) / th];
        const sum = [0, 0, 0, 0];
        let weight = 0;
        for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
          for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
            const w = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
            const i = (sy * sw + sx) * 4;
            const alpha = data[i + 3] / 255;
            for (let c = 0; c < 3; c++) sum[c] += data[i + c] * alpha * w;
            sum[3] += alpha * w;
            weight += w;
          }
        const o = (ty * tw + tx) * 4;
        for (let c = 0; c < 3; c++) out[o + c] = sum[3] ? sum[c] / sum[3] : 0;
        out[o + 3] = (sum[3] / weight) * 255;
      }
    return out;
  };
  const meanError = (reference, actual) => {
    let total = 0;
    for (let i = 0; i < reference.length; i += 4) {
      const a = actual[i + 3] / 255;
      for (let c = 0; c < 3; c++) total += Math.abs(reference[i + c] * (reference[i + 3] / 255) - actual[i + c] * a);
      total += Math.abs(reference[i + 3] - actual[i + 3]);
    }
    return total / reference.length;
  };
  const resizeQuality = await Promise.all(
    onMain.items.slice(1).map(async (item, i) => {
      const source = new Image();
      source.src = URL.createObjectURL(item.file);
      await source.decode();
      const { width, height } = item.result;
      const reference = areaDownscale(pixels(source), source.naturalWidth, source.naturalHeight, width, height);
      const [main, worker] = await Promise.all([
        decodedPixels(onMain.bytes[i + 1], item.blob.type),
        decodedPixels(inWorker.bytes[i + 1], item.blob.type),
      ]);
      return { name: item.file.name, main: meanError(reference, main), worker: meanError(reference, worker) };
    }),
  );
  check(
    resizeQuality.every(({ main, worker }) => worker <= main + 1),
    `Worker resizing is as close to an ideal downscale as the main-thread path (${resizeQuality
      .map(({ name, main, worker }) => `${name} worker ${worker.toFixed(2)} vs main ${main.toFixed(2)}`)
      .join(", ")}).`,
  );
  // Chrome's <img> path lets the JPEG decoder scale down while decoding; the worker decodes at
  // full size and then resamples. Measured at ±2 per channel before re-encoding.
  const [mainJpeg, workerJpeg] = await Promise.all([decodedPixels(onMain.bytes[0]), decodedPixels(inWorker.bytes[0])]);
  const jpegDrift = mainJpeg.reduce((max, value, i) => Math.max(max, Math.abs(value - workerJpeg[i])), 0);
  check(jpegDrift <= 8, `A shrunk JPEG stays within 8 per channel of the main-thread result after re-encoding (${jpegDrift}).`);
  const fullSizeJpeg = async (decoder) => {
    tool.clear();
    tool.decoder = decoder;
    change("png-mode", "lossless");
    change("resize", false);
    select([rotatedJpeg]);
    await compress();
    return new Uint8Array(await tool.items[0].blob.arrayBuffer());
  };
  check(
    sameBytes(await fullSizeJpeg("auto"), await fullSizeJpeg("main")),
    "An EXIF-rotated JPEG at full size gives byte-identical results on both decoders.",
  );
  tool.decoder = "auto";
  // Headers and frame intact (so the header preflight passes), scan data removed.
  let scanStart = 2;
  while (!(jpegBytes[scanStart] === 255 && jpegBytes[scanStart + 1] === 218)) scanStart++;
  const brokenJpeg = new File([join([jpegBytes.slice(0, scanStart), new Uint8Array([255, 217])])], "broken.jpg", { type: "image/jpeg" });
  tool.clear();
  change("png-mode", "lossless");
  change("resize", false);
  select([brokenJpeg, new File([jpeg], "after-broken.jpg", { type: "image/jpeg" })]);
  await compress();
  check(
    tool.items[0].status === "Error" && tool.items[1].status === "Ready",
    "An image the worker cannot decode fails on its own; the next one still compresses.",
  );
  // Skip failures: the lossless pass still running when lossy clearly wins, skipping where
  // lossless wins (smooth gradient), the quality-floor fallback losing its lossless result,
  // a skipped result not beating the original by the usual minimum, resized PNG not skipping,
  // and the validation count when both passes run.
  const lossyRun = async (file, { resize = false, minimum = "80" } = {}) => {
    tool.clear();
    change("preset", "balanced");
    change("png-mode", "lossy");
    change("png-quality-preset", minimum === "100" ? "high" : "balanced");
    change("resize", resize);
    if (resize) {
      change("width", "160");
      change("height", "160");
    }
    select([file]);
    const readSettings = tool.readSettings.bind(tool);
    if (minimum === "100") tool.readSettings = () => ({ ...readSettings(), pngQuality: { min: 100, target: 100 } });
    await compress();
    tool.readSettings = readSettings;
    const item = tool.items[0];
    const stages = item.logs.map((entry) => entry.stage);
    return { item, skipped: stages.includes("png.lossless-skipped"), compared: stages.includes("png.candidates") };
  };
  const clearWin = await lossyRun(new File([fixture(320, 200, "gentle")], "clear-win.png", { type: "image/png" }));
  check(
    clearWin.skipped && !clearWin.compared && clearWin.item.result.outcome === "Lossy PNG accepted",
    "A clearly smaller lossy PNG is accepted without the lossless pass.",
  );
  check(
    clearWin.item.file.size - clearWin.item.blob.size >= Math.max(Math.ceil(clearWin.item.file.size * 0.01), 1024),
    "A skipped lossless pass still requires the usual saving over the original.",
  );
  const smoothGradient = await lossyRun(new File([fixture(320, 200)], "gradient.png", { type: "image/png" }));
  const gradientRoles = smoothGradient.item.logs.filter((entry) => entry.stage === "png.validated").map((entry) => entry.details.role);
  check(
    !smoothGradient.skipped && smoothGradient.compared && smoothGradient.item.result.outcome === "Lossless result used",
    "A smooth gradient keeps the lossless pass, and lossless wins.",
  );
  check(gradientRoles.join(", ") === "source, output, output", "When both passes run, each output is validated once.");
  const resizedWin = await lossyRun(new File([fixture(320, 320, "gentle")], "resized-win.png", { type: "image/png" }), { resize: true });
  check(resizedWin.skipped && resizedWin.item.result.resized, "Resized lossy PNG skips the lossless pass too.");
  const floorMissed = await lossyRun(new File([fixture(320, 200, "gentle")], "floor.png", { type: "image/png" }), {
    minimum: "100",
  });
  check(
    !floorMissed.skipped && !floorMissed.item.result.lossy && floorMissed.item.status === "Ready",
    "When the quality floor fails, the lossless pass runs and its result is used.",
  );
  change("png-quality-preset", "balanced");
  change("png-mode", "lossless");
  // Pool failures: more jobs at once than workers, or no overlap on a multi-core machine; cold
  // workers every batch; the memory budget ignored or a lone over-budget job stuck; one corrupt
  // or timed-out image taking others down; results depending on pool size; Clear all leaving
  // workers running or object URLs unrevoked; summary, progress text or ZIP wrong when jobs
  // finish out of order.
  const intervals = (items) =>
    items.map((item) => {
      const at = (stage) => item.logs.find((entry) => entry.stage === stage)?.details.at ?? NaN;
      // The worker is free again when its result arrives, before the main thread verifies it.
      return [at("worker.started"), at("worker.finished")];
    });
  const peakOverlap = (spans) => Math.max(...spans.map(([start]) => spans.filter(([from, to]) => from <= start && start < to).length));
  const poolFiles = (count, prefix) =>
    Array.from({ length: count }, (_, i) => new File([fixture(480 + i * 8, 300, "gentle")], `${prefix}-${i}.png`, { type: "image/png" }));
  const poolBatch = async (files) => {
    tool.clear();
    change("preset", "balanced");
    change("png-mode", "lossless");
    change("resize", false);
    select(files);
    const progress = new Set();
    const watcher = setInterval(() => progress.add(root.querySelector(".ci-summary").textContent), 5);
    await compress();
    clearInterval(watcher);
    return { items: [...tool.items], progress: [...progress] };
  };
  const createdBefore = tool.pool.stats.created;
  const six = await poolBatch(poolFiles(6, "pool"));
  const sixSpans = intervals(six.items);
  check(
    six.items.every((item) => item.status === "Ready") && sixSpans.every(([start, end]) => start < end),
    "A batch of 6 completes, and each image records when its worker started.",
  );
  check(
    peakOverlap(sixSpans) <= tool.pool.size,
    `No more jobs run at once than the pool has workers (${peakOverlap(sixSpans)} of ${tool.pool.size}).`,
  );
  check(tool.pool.size === 1 || peakOverlap(sixSpans) > 1, "Jobs run in parallel when the pool has more than one worker.");
  check(tool.pool.stats.created - createdBefore <= tool.pool.size, "A batch starts no more workers than the pool size.");
  check(
    six.progress.some((text) => /Compressing/.test(text) && /\d+ of 6/.test(text)),
    "The summary shows how many images are done while compressing.",
  );
  check(
    root.querySelector('[data-ci="ready-count"]').textContent === "6 of 6 ready",
    "The ready count is right after out-of-order finishes.",
  );
  const expectedSaved = six.items.reduce((sum, item) => sum + item.file.size - item.blob.size, 0);
  check(
    expectedSaved > 0 && root.querySelector(".ci-summary").textContent.includes("saved"),
    "The batch total is reported after out-of-order finishes.",
  );
  await tool.downloadZip();
  const poolZip = await JSZip.loadAsync(await downloaded.blob.arrayBuffer());
  check(Object.keys(poolZip.files).length === 6, "The ZIP holds every image after out-of-order finishes.");
  await tool.offers;
  const createdWarm = tool.pool.stats.created;
  select(poolFiles(2, "warm"));
  await compress();
  check(tool.pool.stats.created === createdWarm, "A second batch reuses the warm workers.");

  const budget = tool.pool.memoryBudget;
  tool.pool.memoryBudget = 1;
  const serial = await poolBatch(poolFiles(3, "budget"));
  tool.pool.memoryBudget = budget;
  check(
    serial.items.every((item) => item.status === "Ready") && peakOverlap(intervals(serial.items)) === 1,
    "With a tiny memory budget, jobs run one at a time and each over-budget job still finishes.",
  );

  const isolationFiles = () => [
    ...poolFiles(3, "isolated"),
    new File(["invalid"], "corrupt.png", { type: "image/png" }),
    new File([fixture(320, 200, "gentle")], "slow.png", { type: "image/png" }),
  ];
  const timeoutFor = tool.pool.timeoutFor;
  tool.pool.timeoutFor = (job) => (job.name === "slow.png" ? 1 : timeoutFor(job));
  const parallel = await poolBatch(isolationFiles());
  const size = tool.pool.size;
  tool.pool.size = 1;
  const sequential = await poolBatch(isolationFiles());
  tool.pool.size = size;
  tool.pool.timeoutFor = timeoutFor;
  const statusOf = (run) => run.items.map((item) => item.status).join(",");
  check(
    statusOf(parallel) === "Ready,Ready,Ready,Error,Error" && /timed out/i.test(parallel.items[4].error),
    "A corrupt file and a timed-out file fail on their own; the rest finish.",
  );
  const parallelBytes = await Promise.all(parallel.items.slice(0, 3).map(async (item) => new Uint8Array(await item.blob.arrayBuffer())));
  const sequentialBytes = await Promise.all(
    sequential.items.slice(0, 3).map(async (item) => new Uint8Array(await item.blob.arrayBuffer())),
  );
  check(
    statusOf(sequential) === statusOf(parallel) && parallelBytes.every((bytes, i) => sameBytes(bytes, sequentialBytes[i])),
    "Results are byte-identical with one worker and with the full pool.",
  );

  const nativeCreate = URL.createObjectURL;
  const nativeRevoke = URL.revokeObjectURL;
  const liveUrls = new Set();
  URL.createObjectURL = (blob) => {
    const url = nativeCreate(blob);
    liveUrls.add(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    liveUrls.delete(url);
    nativeRevoke(url);
  };
  try {
    tool.clear();
    select(poolFiles(6, "cancel"));
    control("compress").click();
    const deadline = Date.now() + 10000;
    while (!tool.items.some((item) => item.logs.some((entry) => entry.stage === "worker.started")) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    tool.clear();
    await new Promise((resolve) => setTimeout(resolve, 300));
    check(tool.pool.stats.alive === 0 && !tool.running, "Clear all during a batch stops every worker.");
    check(liveUrls.size === 0, `Clear all during a batch leaves no object URL behind (${liveUrls.size} left).`);
  } finally {
    URL.createObjectURL = nativeCreate;
    URL.revokeObjectURL = nativeRevoke;
  }
  const afterCancel = await poolBatch(poolFiles(2, "after-cancel"));
  check(
    afterCancel.items.every((item) => item.status === "Ready"),
    "A new batch works after cancelling.",
  );
  // Flow failures: the size card shown for images that already fit or missing for ones that do
  // not; a size choice not reaching the resize settings; the offer shown without a real saving,
  // applied wrongly, or not undone; the background offer pass touching item logs or status;
  // Clear leaving it running; the primary action not following the state; and a field error
  // hidden in closed settings.
  tool.clear();
  change("preset", "balanced");
  change("png-mode", "lossless");
  change("resize", false);
  select([new File([fixture(320, 200, "gentle")], "small.png", { type: "image/png" })]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  check(!visible(control("advice-size")), "Images that fit a phone get no size card.");
  check(tool.items[0].row.textContent.includes("320 × 200"), "Rows show each image's dimensions before compressing.");
  check(
    control("compress").classList.contains("btn-primary") && !visible(control("zip")),
    "Before compressing, Compress is the primary action and there is nothing to download.",
  );
  check(visible(control("settings-panel")), "Settings remain visible after upload.");
  check(control("resize").getAttribute("role") === "switch", "Resize uses an accessible toggle.");
  check(
    visible(control("png-settings")) && visible(control("photo-settings")) && control("photo-settings").disabled,
    "Irrelevant photo settings stay visible and disabled.",
  );
  check(tool.selected === tool.items[0] && visible(root.querySelector(".ci-original-preview")), "Queued files open an original preview.");
  check(
    tool.items[0].row.querySelector(".ci-download").disabled && tool.items[0].row.querySelector(".ci-after").textContent.includes("—"),
    "Queued rows retain the result column and disable download until a result exists.",
  );
  tool.clear();
  select([
    new File([fixture(4000, 300, "gentle")], "wide.png", { type: "image/png" }),
    new File([fixture(320, 200, "gentle")], "fits.png", { type: "image/png" }),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const sizeCard = control("advice-size");
  check(
    visible(sizeCard) && /1 oversized image/.test(sizeCard.textContent) && /1440/.test(sizeCard.textContent),
    "One oversized image gets one size card.",
  );
  const choice = (name) => sizeCard.querySelector(`[data-size="${name}"]`);
  check(choice("original").getAttribute("aria-pressed") === "true", "The size card starts on Keep original.");
  choice("full").click();
  check(
    control("resize").checked &&
      control("width").value === "1440" &&
      control("height").value === "3200" &&
      choice("full").getAttribute("aria-pressed") === "true",
    "Choosing phone full width sets the resize bounds to 1440 × 3200.",
  );
  check(
    tool.items.every((item) => item.status === "Queued" && !item.result),
    "Choosing a size does not start compressing.",
  );
  await compress();
  const wide = tool.items.find((item) => item.file.name === "wide.png");
  const fits = tool.items.find((item) => item.file.name === "fits.png");
  check(wide.result.width === 1440 && fits.result.width === 320, "The chosen size shrinks only images larger than it.");
  check(
    !/Optimized|Lossless result used|Lossy PNG accepted|px/.test(fits.row.querySelector(".ci-file-state").textContent) &&
      wide.row.querySelector(".ci-file-state").textContent === "Resized" &&
      wide.row.querySelector(".ci-dimensions").textContent.includes("1440 × 108"),
    "Row notes give dimensions in one format and only news, never engine terms.",
  );
  tool.selectItem(wide);
  const panes = [...root.querySelectorAll(".ci-pair .ci-viewport")].map((pane) => pane.getBoundingClientRect());
  check(
    innerWidth >= 680 || (panes[1].top >= panes[0].bottom && Math.abs(panes[0].width / panes[0].height - 1440 / 108) < 0.5),
    "On narrow screens the comparison stacks Original above Result at the image's shape.",
  );
  check(
    control("zip").classList.contains("btn-primary") && !control("compress").classList.contains("btn-primary"),
    "After compressing, Download ZIP becomes the primary action.",
  );
  choice("original").click();
  check(
    control("compress").classList.contains("btn-primary") && !control("resize").checked,
    "Changing a choice after compressing makes Compress primary again.",
  );

  tool.clear();
  change("resize", false);
  select([new File([fixture(320, 320, "gentle")], "offer.png", { type: "image/png" })]);
  await compress();
  const offered = tool.items[0];
  const logsBeforeOffer = offered.logs.length;
  const losslessBlob = offered.blob;
  await tool.offers;
  const offerCard = control("advice-lossy");
  check(
    !!offered.alternative && offered.alternative.blob.size < losslessBlob.size,
    "Idle workers precompute a smaller reduced-color version.",
  );
  check(
    visible(offerCard) && offerCard.textContent.includes(`${formatSize(losslessBlob.size)} → ${formatSize(offered.alternative.blob.size)}`),
    "The offer shows the real sizes before and after.",
  );
  check(offered.logs.length === logsBeforeOffer && offered.status === "Ready", "The offer pass leaves the item's log and status alone.");
  offerCard.querySelector('[data-ci="use-smaller"]').click();
  check(
    offered.blob.size < losslessBlob.size &&
      offered.result.lossy &&
      control("png-mode").value === "lossy" &&
      offered.row.textContent.includes("Colors reduced"),
    "Use smaller swaps in the reduced-color result and turns on lossy PNG.",
  );
  check(control("zip").classList.contains("btn-primary"), "Using the offer keeps results current.");
  offerCard.querySelector('[data-ci="undo-smaller"]').click();
  check(
    offered.blob === losslessBlob && !offered.result.lossy && control("png-mode").value === "lossless",
    "Undo restores the lossless result.",
  );

  change("png-mode", "lossy");
  await compress();
  await tool.offers;
  check(!visible(control("advice-lossy")), "No offer when lossy PNG is already on.");
  change("png-mode", "lossless");

  tool.clear();
  select([new File([fixture(320, 200)], "gradient-offer.png", { type: "image/png" })]);
  await compress();
  await tool.offers;
  check(!visible(control("advice-lossy")) && !tool.items[0].alternative, "No offer when color reduction would not save enough.");

  select([new File([fixture(640, 400, "gentle")], "cancel-offer.png", { type: "image/png" })]);
  await compress();
  const pendingOffer = tool.offers;
  tool.clear();
  await pendingOffer;
  check(tool.pool.stats.alive === 0 && !visible(control("advice-lossy")), "Clear cancels the background offer pass.");

  tool.clear();
  select([new File([fixture(320, 200, "gentle")], "settings.png", { type: "image/png" })]);
  change("resize", true);
  change("height", "0");
  await compress();
  check(
    visible(control("settings-panel")) && document.activeElement === control("height"),
    "A settings error opens the settings and focuses the field.",
  );
  change("height", "1920");
  change("resize", false);
  tool.error("");
  document.querySelector("#verification").textContent = `PASS: ${checks.length} browser checks. Open details for the repeatable evidence.`;
  document.querySelector("#evidence").textContent = checks.join("\n");
} catch (error) {
  document.querySelector("#verification").textContent = `FAIL: ${error.message}`;
  document.querySelector("#evidence").textContent = checks.join("\n") + "\n" + error.stack;
  console.error(error);
}
// The result line is at the top; bring it into view so a window capture always shows it.
window.scrollTo(0, 0);
