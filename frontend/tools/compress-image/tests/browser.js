import pako from "pako";
import JSZip from "jszip";
import { CompressImage } from "../main.js";
import { makeChunk, parsePng } from "../service.js";

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
      data[y * (width * 4 + 1) + 1 + x] = noise ? seed >>> 24 : x % 4 === 3 ? 127 : (x % 3) * 80;
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
const tool = new CompressImage();
tool.mount(document.querySelector("#tool"));
try {
  const small = withText(fixture(2, 2), 35);
  select([
    new File([fixture(320, 320)], "transparent.png", { type: "image/png" }),
    new File([small], "small.png", { type: "image/png" }),
    new File([fixture(320, 320, true)], "noise.png", { type: "image/png" }),
    new File(["invalid"], "invalid.png", { type: "image/png" }),
    new File([small], "wrong.jpg", { type: "image/jpeg" }),
    new File([withText(fixture(800, 500, false, 9), 343421)], "text-heavy.png", { type: "image/png" }),
  ]);
  await settle(tool);
  check(tool.items.length === 6, "Multiple files entered through the real file input");
  check(
    tool.items.filter((item) => item.result?.eligible).length === 3,
    "Mixed batch: three ready, three blocked; processing continues after errors",
  );
  check(tool.items[0].blob.size < 300000, "Large PNG compressed strictly below 300 KB");
  check(tool.items[1].blob.size < small.length && tool.items[1].result.changed, "Small PNG is optimized even below 100 KB");
  check(!tool.items[2].result.eligible && tool.items[2].row.querySelector("button").disabled, "Incompressible output cannot be downloaded");
  check(
    tool.items[3].row.querySelector("button").disabled && tool.items[4].row.querySelector("button").disabled,
    "Invalid PNG and wrong MIME rejected",
  );
  const blocked = tool.items[2];
  check(
    blocked.logs.filter((entry) => entry.stage === "compression.attempt.complete").length === 3,
    "Worker streams all three compression attempt sizes into the per-image log",
  );
  check(
    blocked.row.querySelector(".ci-diagnostics").open &&
      blocked.row.querySelector(".ci-diagnostics pre").textContent.includes("bytesOverLimit"),
    "Blocked result opens its log and explains the exact excess bytes",
  );
  check(
    blocked.row.querySelector(".ci-status").textContent.includes("further lossless optimization may be possible"),
    "Size-limit message describes this optimizer's limitation without claiming all lossless methods failed",
  );
  check(
    tool.items[3].logs.at(-1).stage === "processing.failed" && tool.items[4].logs.at(-1).stage === "processing.failed",
    "Invalid-file failures are logged independently",
  );
  check(
    tool.items[1].logs.filter((entry) => entry.stage === "compression.attempt.complete").length === 3,
    "Small-image log confirms all three compression attempts ran",
  );
  let copiedLog;
  tool.copyToClipboard = async (text) => {
    copiedLog = JSON.parse(text);
    return true;
  };
  blocked.row.querySelector('[data-ci="copy-log"]').click();
  check(
    copiedLog.entries.at(-1).details.allowed === false && !JSON.stringify(copiedLog).includes("data:image"),
    "Copy log exports structured diagnostics without image payloads",
  );
  const textHeavy = tool.items[5];
  check(
    textHeavy.result.eligible && textHeavy.result.metadataRemovedBytes === 343421 && textHeavy.blob.size < 300000,
    "Text-heavy PNG becomes eligible after removing exactly 343421 bytes of tEXt metadata",
  );
  const textOutput = parsePng(new Uint8Array(await textHeavy.blob.arrayBuffer()));
  check(
    !textOutput.chunks.some((chunk) => chunk.type === "tEXt") && textOutput.chunks.some((chunk) => chunk.type === "sRGB"),
    "Text comments are removed while the sRGB rendering chunk survives",
  );
  const textImages = textHeavy.row.querySelectorAll(".ci-pair img");
  await Promise.all([...textImages].map((image) => image.decode()));
  const textBefore = pixels(textImages[0]);
  const textAfter = pixels(textImages[1]);
  check(
    textBefore.length === textAfter.length && textBefore.every((value, i) => value === textAfter[i]),
    "800 by 500 PNG retains identical browser-rendered pixels after metadata removal",
  );
  check(
    textHeavy.row.querySelector(".ci-status").textContent.includes("343.42 KB of text metadata"),
    "Ready result discloses how much text metadata was removed",
  );
  const preview = tool.items[0].row.querySelector(".ci-preview");
  const images = preview.querySelectorAll("img");
  await Promise.all([...images].map((image) => image.decode()));
  const before = pixels(images[0]);
  const after = pixels(images[1]);
  check(
    before.length === after.length && before.every((value, i) => value === after[i]),
    "Browser-rendered RGBA is identical, including transparency and sRGB rendering",
  );
  const toggle = preview.querySelector('input[type="checkbox"]');
  toggle.click();
  check(
    preview.querySelector(".ci-pair").hidden && !preview.querySelector(".ci-overlay").hidden,
    "Overlay toggle switches the visual comparison",
  );
  const slider = preview.querySelector('input[type="range"]');
  slider.value = "75";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  check(images[3].style.clipPath.includes("75%"), "Comparison slider updates immediately");
  toggle.click();
  const downloads = [];
  tool.download = (blob, name) => downloads.push({ blob, name });
  tool.items[0].row.querySelector("button").click();
  check(
    downloads[0].name === "transparent.png" && downloads[0].blob.type === "image/png",
    "Individual download keeps PNG MIME and original filename",
  );
  await tool.downloadZip();
  const zip = await JSZip.loadAsync(await downloads[1].blob.arrayBuffer());
  check(
    Object.keys(zip.files).length === 3 && zip.file("transparent.png") && zip.file("small.png") && zip.file("text-heavy.png"),
    "ZIP contains only the three eligible PNGs",
  );
  select([
    new File([fixture(2400, 1200, false, 9)], "landscape-mobile.png", { type: "image/png" }),
    new File([fixture(1200, 2400, false, 9)], "portrait-mobile.png", { type: "image/png" }),
  ]);
  await settle(tool);
  const landscape = tool.items[6];
  const portrait = tool.items[7];
  check(
    landscape.file.size < 100000 &&
      portrait.file.size < 100000 &&
      landscape.logs.some((entry) => entry.stage === "compression.start") &&
      portrait.logs.some((entry) => entry.stage === "compression.start"),
    "Large-dimension images under 100 KB still receive lossless optimization",
  );
  check(
    !landscape.selectedVariant.resized &&
      !portrait.selectedVariant.resized &&
      landscape.result.width === 2400 &&
      portrait.result.height === 2400,
    "Mobile resizing is optional and never runs automatically",
  );
  check(
    landscape.resizeTarget.width === 1920 &&
      landscape.resizeTarget.height === 960 &&
      portrait.resizeTarget.width === 960 &&
      portrait.resizeTarget.height === 1920,
    "1920 px long-edge suggestions fit landscape and portrait without stretching",
  );
  landscape.row.querySelector(".ci-mobile").open = true;
  landscape.row.querySelector(".ci-resize-apply").click();
  await settle(tool);
  check(
    landscape.selectedVariant.resized && landscape.result.width === 1920 && landscape.result.height === 960,
    "Explicit Resize + compress creates the landscape mobile output",
  );
  const mobileImage = landscape.row.querySelectorAll(".ci-pair img")[1];
  await mobileImage.decode();
  const rgba = pixels(mobileImage);
  check(
    mobileImage.naturalWidth === 1920 &&
      mobileImage.naturalHeight === 960 &&
      rgba.some((value, i) => i % 4 === 3 && value > 0 && value < 255),
    "Resized PNG decodes at the proposed dimensions and retains transparency",
  );
  check(
    landscape.row.querySelector(".ci-status").textContent.includes("pixels changed") &&
      landscape.row.querySelector(".ci-preview figcaption:last-of-type") !== null,
    "Resized output explicitly discloses changed pixels",
  );
  landscape.row.querySelector(".ci-result-header button").click();
  const mobileDownload = downloads.at(-1);
  const mobileParsed = parsePng(new Uint8Array(await mobileDownload.blob.arrayBuffer()));
  check(
    mobileDownload.name === "landscape-mobile.png" && mobileParsed.width === 1920 && mobileParsed.height === 960,
    "Individual download uses the selected resized PNG",
  );
  await tool.downloadZip();
  const mobileZip = await JSZip.loadAsync(await downloads.at(-1).blob.arrayBuffer());
  const zippedMobile = parsePng(await mobileZip.file("landscape-mobile.png").async("uint8array"));
  check(zippedMobile.width === 1920 && zippedMobile.height === 960, "ZIP also uses the selected resized variant");
  landscape.row.querySelector(".ci-restore").click();
  check(
    !landscape.selectedVariant.resized &&
      landscape.blob === landscape.fullSize.blob &&
      landscape.result.width === 2400 &&
      landscape.result.height === 1200,
    "Use full-size version restores the exact previous optimized result",
  );
  portrait.row.querySelector(".ci-mobile").open = true;
  portrait.row.querySelector(".ci-resize-apply").click();
  await settle(tool);
  check(
    portrait.selectedVariant.resized && portrait.result.width === 960 && portrait.result.height === 1920,
    "Portrait mobile resize preserves orientation and aspect ratio",
  );
  const widthInput = landscape.row.querySelector(".ci-max-width");
  const heightInput = landscape.row.querySelector(".ci-max-height");
  widthInput.value = "800";
  widthInput.dispatchEvent(new Event("input", { bubbles: true }));
  heightInput.value = "600";
  heightInput.dispatchEvent(new Event("input", { bubbles: true }));
  check(
    landscape.resizeTarget.width === 800 &&
      landscape.resizeTarget.height === 400 &&
      landscape.row.querySelector(".ci-resize-preset").value === "custom",
    "Custom bounds update the proposed size immediately",
  );
  widthInput.value = "0";
  widthInput.dispatchEvent(new Event("input", { bubbles: true }));
  check(
    landscape.row.querySelector(".ci-resize-apply").disabled && landscape.resizeTarget === null,
    "Invalid resize bounds disable the action",
  );
  widthInput.value = "800";
  widthInput.dispatchEvent(new Event("input", { bubbles: true }));
  const smallItem = tool.items[1];
  check(
    smallItem.row.querySelector(".ci-resize-apply").disabled &&
      smallItem.row.querySelector(".ci-resize-note").textContent.includes("never upscaled"),
    "Small images are never enlarged to the mobile preset",
  );
  const previous = landscape.selectedVariant;
  const originalEncoder = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback) {
    callback(null);
  };
  try {
    landscape.row.querySelector(".ci-resize-apply").click();
    await settle(tool);
  } finally {
    HTMLCanvasElement.prototype.toBlob = originalEncoder;
  }
  check(
    landscape.selectedVariant === previous &&
      landscape.logs.at(-1).stage === "resize.failed" &&
      !landscape.row.querySelector(".ci-result-header button").disabled,
    "Resize encoding failure preserves the previous downloadable result",
  );
  // Leave a successful mobile comparison visible for manual review.
  portrait.row.querySelector(".ci-mobile").open = true;
  const result = document.querySelector("#verification");
  result.textContent = `PASS: ${checks.length} browser checks. ${checks.join(". ")}.`;
  result.dataset.result = "pass";
} catch (error) {
  document.querySelector("#verification").textContent = `FAIL after ${checks.length} checks: ${error.message}`;
  document.querySelector("#verification").dataset.result = "fail";
  console.error(error);
}
