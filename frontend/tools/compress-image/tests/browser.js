import pako from "pako";
import JSZip from "jszip";
import { UsageTracker } from "../../../core/UsageTracker.js";

// Fixture processing must not change real usage counts.
UsageTracker.trackToolUse = () => {};
import { CompressImage } from "../main.js";
import { makeChunk } from "../service.js";

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
      data[y * (width * 4 + 1) + 1 + x] = noise
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
function select(files) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  const input = document.querySelector("#ci-files");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function settle(tool) {
  const deadline = Date.now() + 20000;
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
  check(control("mode").value === "lossless" && !control("resize").checked, "Lossless with original dimensions is the default.");
  select([
    new File([fixture(320, 320)], "transparent.png", { type: "image/png" }),
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
  await tool.downloadZip();
  const zip = await JSZip.loadAsync(await downloaded.blob.arrayBuffer());
  check(
    Object.keys(zip.files).length === 3 && downloaded.name.endsWith(".zip"),
    "ZIP includes every successful image and excludes failures.",
  );
  change("mode", "lossy");
  change("quality", "70");
  await compress();
  check(first.blob.type === "image/webp" && first.result.lossy, "Explicit lossy mode encodes WebP.");
  check(first.result.width === 320 && !first.result.resized, "Lossy compression keeps original dimensions by default.");
  const previousLossy = first.blob;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback) {
    originalToBlob.call(this, callback, "image/png");
  };
  try {
    await compress();
  } finally {
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
  }
  check(
    first.blob === previousLossy && first.status === "Error",
    "Unsupported WebP encoding keeps the prior result and reports the failure.",
  );
  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 80;
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg"));
  const transfer = new DataTransfer();
  transfer.items.add(new File([jpeg], "photo.jpg", { type: "image/jpeg" }));
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: transfer });
  root.querySelector(".ci-drop").dispatchEvent(drop);
  await compress();
  check(tool.items.at(-1).result && tool.items.at(-1).result.width === 120, "JPEG input works in lossy mode through drag and drop.");
  change("mode", "lossless");
  change("resize", true);
  change("width", "160");
  change("height", "120");
  await compress();
  check(text.result.width === 160 && text.result.height === 100 && text.result.resized, "Opt-in resizing fits bounds without stretching.");
  check(text.row.textContent.includes("Resized"), "Resized output is never labeled pixel-identical lossless.");
  check(tool.items.at(-1).status === "Error", "JPEG in strict lossless mode explains unsupported input.");
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
  ]);
  await compress();
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
  document.querySelector("#verification").textContent = `PASS: ${checks.length} browser checks. Open details for the repeatable evidence.`;
  document.querySelector("#evidence").textContent = checks.join("\n");
} catch (error) {
  document.querySelector("#verification").textContent = `FAIL: ${error.message}`;
  document.querySelector("#evidence").textContent = checks.join("\n") + "\n" + error.stack;
  console.error(error);
}
