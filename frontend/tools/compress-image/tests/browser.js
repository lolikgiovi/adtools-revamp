import pako from "pako";
import JSZip from "jszip";
import { UsageTracker } from "../../../core/UsageTracker.js";

// Fixture processing must not change real usage counts.
UsageTracker.trackToolUse = () => {};
import { CompressImage } from "../main.js";
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
  if (input.type === "checkbox") input.checked = value;
  else input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function compress() {
  control("compress").click();
  await settle(tool);
}
try {
  check(
    control("preset").value === "balanced" && !control("lossy-png").checked && !control("resize").checked,
    "Lossless with original dimensions is the default.",
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
  const reusableWorker = tool.worker;
  change("lossy-png", true);
  await compress();
  check(first.blob.type === "image/png" && first.result.lossy, "Opt-in lossy PNG stays PNG and accepts a useful quantized result.");
  check(
    first.logs.some((entry) => entry.stage === "Quantizing"),
    "Quantization reports a named stage.",
  );
  check(
    first.logs.some((entry) => entry.stage === "png.candidates"),
    "Lossy PNG compares both candidates.",
  );
  check(tool.worker === reusableWorker, "A warm worker is reused across files and runs.");
  const previousLossy = first.blob;
  const originalRunWorker = tool.runWorker;
  tool.runWorker = async function () {
    const source = fixture(320, 320);
    const bytes = join([source.slice(0, 33), makeChunk("IDAT", new Uint8Array(1024 * 1024)), makeChunk("IEND", new Uint8Array())]);
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
  const webp = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 1));
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
  check(control("quality").value === "75" && control("png-min").value === "65", "Preset changes update all codec quality controls.");
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
  change("lossy-png", false);
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
  change("lossy-png", true);
  change("png-min", "100");
  change("png-target", "100");
  await compress();
  check(
    !text.result.lossy && text.blob.type === "image/png",
    "Unattainable quantization quality falls back to lossless PNG at the target dimensions.",
  );
  change("png-min", "99");
  change("png-target", "80");
  const previousQuality = first.blob;
  await compress();
  check(first.blob === previousQuality && !tool.running, "Invalid PNG quality bounds preserve previous results.");
  change("preset", "balanced");
  change("lossy-png", false);
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
  change("lossy-png", true);
  await compress();
  check(
    !tool.items[4].result.lossy && tool.items[4].logs.some((entry) => entry.stage === "png.lossless-fallback"),
    "16-bit PNG stays on the lossless path even when color reduction is enabled.",
  );
  change("lossy-png", false);
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
  await initWebp({ locateFile: (path) => (path.includes("simd") ? webpSimdWasm : webpWasm) });
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
  document.querySelector("#verification").textContent = `PASS: ${checks.length} browser checks. Open details for the repeatable evidence.`;
  document.querySelector("#evidence").textContent = checks.join("\n");
} catch (error) {
  document.querySelector("#verification").textContent = `FAIL: ${error.message}`;
  document.querySelector("#evidence").textContent = checks.join("\n") + "\n" + error.stack;
  console.error(error);
}
