// Run on disposable localhost:1235. Reproduces QQ -> Compress -> QQ -> Compress, then previews every cached and appended row.
import { CompressImage } from "../main.js";
import { QuickQuery } from "../../quick-query/main.js";
import { EventBus } from "../../../core/EventBus.js";
import { loadWorkspace } from "../workspace-store.js";
if (location.port !== "1235" && location.protocol !== "tauri:") throw new Error("Use the disposable test origin on port 1235.");
const report = document.querySelector("#evidence");
const checks = [];
const assert = (ok, text) => {
  if (!ok) throw new Error(text);
  checks.push(text);
  report.textContent = JSON.stringify({ status: "Running", checks });
};
const wait = async (predicate) => {
  for (let i = 0; i < 1200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the round trip");
};
const bus = new EventBus();
const ci = new CompressImage(bus),
  qq = new QuickQuery(bus);
const roots = { "compress-image": document.createElement("div"), "quick-query": document.createElement("div") };
let current, task;
window.app = {
  router: {
    navigate(id, data) {
      current?.deactivate();
      if (current === ci) current.unmount();
      current = id === "compress-image" ? ci : qq;
      document.querySelector("#tool").replaceChildren(roots[id]);
      if (!current.container) current.mount(roots[id]);
      current.activate();
      task = current.onRouteData?.(data || {});
    },
  },
};
const choose = async (value) => {
  await wait(() => document.querySelector("dialog[open]"));
  document.querySelector(`dialog [value="${value}"]`).click();
};
const previewAll = async (stage) => {
  for (const [index, item] of ci.items.entries()) {
    ci.selectItem(item);
    await Promise.all([...ci.container.querySelectorAll(".ci-inspector img")].map((image) => image.decode()));
    assert(
      [...ci.container.querySelectorAll(".ci-inspector img")].every((image) => image.naturalWidth > 0),
      `${stage}: row ${index + 1} original and result decode`,
    );
    if (item.variants) {
      for (const variant of Object.keys(item.variants)) {
        ci.selectVariant(item, variant);
        await Promise.all([...ci.container.querySelectorAll(".ci-inspector img")].map((image) => image.decode()));
        assert(true, `${stage}: row ${index + 1} ${variant} decodes`);
      }
    }
  }
};
try {
  const large = new URLSearchParams(location.search).has("large");
  const canvas = document.createElement("canvas");
  canvas.width = large ? 2440 : 320;
  canvas.height = large ? 1530 : 240;
  document.documentElement.classList.add("dark-grey");
  const context = canvas.getContext("2d");
  const files = [];
  for (let index = 0; index < 3; index++) {
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = index + 1;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const pixel = offset / 4;
      const x = pixel % canvas.width,
        y = Math.floor(pixel / canvas.width);
      pixels.data.set(
        [
          Math.floor((x / canvas.width) * 200) + ((seed >>> 16) % 16),
          Math.floor((y / canvas.height) * 200) + ((seed >>> 24) % 16),
          100 + index,
          255,
        ],
        offset,
      );
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    files.push(new File([blob], `roundtrip-${index + 1}.png`, { type: "image/png" }));
  }
  window.app.router.navigate("compress-image");
  await ci.ready;
  ci.clear();
  await ci.flushWorkspace();
  window.app.router.navigate("quick-query");
  await qq.ui.ready;
  const ui = qq.ui;
  await ui.createNewTab();
  await ui.handleAttachmentsInput({ target: { files } });
  await ui.handleCompressImages();
  await task;
  assert(ci.items.length === 3, "Quick Query imports three distinct PNGs");
  ci.$("png-quality-preset").value = "small";
  await ci.processQueue();
  await ci.offers;
  assert(
    ci.items.every((item) => item.result),
    "All three images compressed",
  );
  assert(
    ci.items.every((item) => item.variants.lossy && item.variants.lossless),
    "Each PNG has real Lossless and Lossy variants",
  );
  // Match the report: only row one is opened before leaving Compress Image.
  ci.selectItem(ci.items[0]);
  await Promise.all([...ci.container.querySelectorAll(".ci-inspector img")].map((image) => image.decode()));
  await ci.flushWorkspace();
  const stored = await new Promise((resolve, reject) => {
    const opening = indexedDB.open("adtools-compress-image", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const read = db.transaction("workspace").objectStore("workspace").get("current");
      read.onsuccess = () => {
        resolve(read.result);
        db.close();
      };
      read.onerror = () => {
        reject(read.error);
        db.close();
      };
    };
  });
  assert(
    stored.items.every((item) => item.file.bytes instanceof ArrayBuffer && item.blob.bytes instanceof ArrayBuffer),
    "Persisted originals and results contain image bytes, independent of browser Blob backing",
  );
  const hydrated = await loadWorkspace();
  assert(
    hydrated.items.every((item) => item.file instanceof File && item.blob instanceof Blob),
    "Stored bytes restore into usable files and result blobs",
  );
  ci.addToQuickQuery();
  await choose("attach");
  await task;
  for (let index = 0; index < 3; index++) ui.container.querySelector("#file-items .delete-file").click();
  await ui.saveActiveTabDraft();
  // Let scheduled cache writes settle before restoring the tool.
  const sending = ui.handleCompressImages();
  await choose("append");
  await sending;
  await task;
  assert(ci.items.length === 6, "Cached three images survive alongside three compressed attachments imported again");
  // Exercise an overwrite while original restored Blob objects remain alive.
  await ci.flushWorkspace();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await previewAll("After append round trip");
  window.app.router.navigate("quick-query");
  ui.handleDeleteAllAttachments();
  await ui.saveActiveTabDraft();
  window.app.router.navigate("compress-image");
  await ci.ready;
  await ci.flushWorkspace();
  await previewAll("After attachment deletion and second restore");
  for (const item of ci.items) {
    assert((await item.file.arrayBuffer()).byteLength === item.file.size, `Original bytes remain readable: ${item.file.name}`);
  }
  report.textContent = JSON.stringify({ status: "PASS", sizes: files.map((file) => file.size), checks }, null, 2);
} catch (error) {
  report.textContent = JSON.stringify({ status: "FAIL", name: error.name, error: error.stack || error.message, checks }, null, 2);
  console.error(error);
}
