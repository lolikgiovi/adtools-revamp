// Repeatable browser verification: open quick-query-flow.html on the local Vite server.
// Covers image-only transfers, append/replace/cancel, cold IndexedDB restore, both exports,
// attachment-first tab ordering, filename collisions and preservation of unrelated attachments.
import { CompressImage } from "../main.js";
import { QuickQuery } from "../../quick-query/main.js";
import { EventBus } from "../../../core/EventBus.js";
import JSZip from "jszip";

if (location.port !== "1235") throw new Error("Run this disposable test workspace on localhost:1235.");
const evidence = document.querySelector("#evidence");
const checks = [];
const assert = (value, message) => {
  if (!value) throw new Error(message);
  checks.push(message);
};
const wait = async (test) => {
  for (let i = 0; i < 600; i++) {
    if (test()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out waiting for browser state");
};
const choose = async (value) => {
  await wait(() => document.querySelector("dialog[open]"));
  const rect = document.querySelector("dialog[open]").getBoundingClientRect();
  if (Math.abs(rect.left + rect.width / 2 - innerWidth / 2) > 2 || rect.left < 0 || rect.right > innerWidth) {
    throw new Error("Workflow dialog is not centered within the viewport");
  }
  document.querySelector(`dialog [value="${value}"]`).click();
};
const bus = new EventBus();
const notices = [];
bus.on("notification:success", ({ message }) => notices.push(message));
let ci = new CompressImage(bus);
const qq = new QuickQuery(bus);
const root = document.querySelector("#tool");
const roots = { "compress-image": document.createElement("div"), "quick-query": document.createElement("div") };
const tools = { "compress-image": ci, "quick-query": qq };
let current;
let routeTask;
window.app = {
  router: {
    navigate(id, data) {
      current?.deactivate();
      if (current?.id === "compress-image") current.unmount();
      current = tools[id];
      root.replaceChildren(roots[id]);
      if (!current.container) current.mount(roots[id]);
      current.activate();
      routeTask = current.onRouteData?.(data || {});
    },
  },
};
try {
  // Reset only fixture tabs on the dedicated test origin; never use the normal app port.
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("QuickQueryDatabase");
    request.onsuccess = () => {
      const db = request.result;
      const stores = ["queryTabs", "queryTabSession"].filter((name) => db.objectStoreNames.contains(name));
      if (!stores.length) {
        db.close();
        resolve();
        return;
      }
      const transaction = db.transaction(stores, "readwrite");
      stores.forEach((name) => transaction.objectStore(name).clear());
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
  window.app.router.navigate("compress-image");
  await ci.ready;
  ci.clear();
  await ci.flushWorkspace();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  canvas.getContext("2d").fillRect(0, 0, 16, 16);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const png = new File([blob], "fixture.png", { type: "image/png" });
  const jpegBlob = await new Promise((r) => canvas.toBlob(r, "image/jpeg"));
  const webpBlob = await new Promise((r) => canvas.toBlob(r, "image/webp"));
  assert(webpBlob.type === "image/webp", "Browser creates a real WebP fixture");
  const jpeg = new File([jpegBlob], "photo.jpeg", { type: "image/jpeg" });
  const webp = new File([webpBlob], "photo.webp", { type: "image/webp" });
  ci.addFiles([png]);
  ci.$("quality").value = "82";
  ci.updateSettings();
  await ci.processQueue();
  await ci.offers;
  assert(ci.items[0].result, "Real worker compressed PNG");
  await ci.flushWorkspace();
  ci.unmount();
  ci = new CompressImage(bus);
  tools["compress-image"] = ci;
  current = ci;
  ci.mount(roots["compress-image"]);
  ci.activate();
  await ci.ready;
  assert(
    ci.items.length === 1 && ci.items[0].result && ci.$("quality").value === "82",
    "Cold IndexedDB restore keeps files, result and settings",
  );
  assert((await ci.items[0].file.arrayBuffer()).byteLength === png.size, "Restored original bytes intact");
  const cancelled = ci.onRouteData({ imageFiles: [png] });
  await choose("cancel");
  await cancelled;
  assert(ci.items.length === 1, "Cancel preserves cached images");
  const appended = ci.onRouteData({ imageFiles: [png] });
  await choose("append");
  await appended;
  assert(ci.items.length === 2, "Append keeps cached images");
  const replaced = ci.onRouteData({ imageFiles: [png] });
  await choose("replace");
  await replaced;
  assert(ci.items.length === 1 && !ci.items[0].result, "Replace clears previous results");
  const overLimit = ci.onRouteData({ imageFiles: Array(21).fill(png) });
  await choose("replace");
  await overLimit;
  assert(ci.items.length === 1, "Oversized transfer keeps existing images atomically");
  await ci.processQueue();
  await ci.offers;
  const downloads = [];
  ci.saveDownload = async (value, name) => {
    downloads.push({ value, name });
    ci.showSuccess(`Download started: ${name}`);
  };
  const single = ci.download(ci.items[0].blob, "fixture.png");
  await wait(() => document.querySelector("dialog[open]"));
  document.querySelector("dialog select").value = "base64";
  await choose("download");
  await single;
  assert(
    downloads[0].name === "fixture.txt" && (await downloads[0].value.text()).startsWith("data:image/png;base64,"),
    "Single Base64 export includes MIME data URL",
  );
  const zipped = ci.downloadZip();
  await choose("download");
  await zipped;
  const zip = await JSZip.loadAsync(await downloads[1].value.arrayBuffer());
  assert(Object.keys(zip.files).includes("fixture.png"), "ZIP contains image file");
  const zipped64 = ci.downloadZip();
  await wait(() => document.querySelector("dialog[open]"));
  document.querySelector("dialog select").value = "base64";
  await choose("download");
  await zipped64;
  const zip64 = await JSZip.loadAsync(await downloads[2].value.arrayBuffer());
  assert(
    (await zip64.file("fixture.txt").async("string")).startsWith("data:image/png;base64,"),
    "ZIP Base64 export includes MIME data URL",
  );
  assert(notices.length >= 3, "Downloads emit visible notifications");
  window.app.router.navigate("quick-query");
  await qq.ui.ready;
  const ui = qq.ui;
  await ui.createNewTab();
  const imageTab = ui.activeTabId;
  ui.elements.tableNameInput.value = "CONTENT.IMAGE";
  await ui.saveActiveTabDraft();
  await ui.handleAttachmentsInput({
    target: { files: [new File([blob], "fixture.png"), jpeg, webp, new File(["keep"], "keep.txt", { type: "text/plain" })] },
  });
  assert(!ui.elements.compressImagesButton.hidden, "Image attachments reveal Compress Image action");
  await ui.createNewTab();
  const emptyTab = ui.activeTabId;
  ui.elements.tableNameInput.value = "LOCALIZATION.LANGUAGE_PACK_VERSION";
  await ui.saveActiveTabDraft();
  assert(ui.elements.compressImagesButton.hidden, "No images hides Compress Image action");
  await ui.handleCompressImages();
  await routeTask;
  // Current tab has no images: no navigation.
  assert(current === qq, "Empty tab cannot transfer images");
  await ui.switchTab(imageTab);
  const sending = ui.handleCompressImages();
  await choose("replace");
  await sending;
  await routeTask;
  assert(current === ci && ci.items.length === 3, "Quick Query transfers PNG, JPEG and WebP only");
  await ci.processQueue();
  await ci.offers;
  assert(
    ci.items.every((item) => item.result),
    "Real workers compress PNG, JPEG and WebP",
  );
  window.app.router.navigate("quick-query");
  await ui.switchTab(emptyTab);
  window.app.router.navigate("compress-image");
  await ci.ready;
  ci.addToQuickQuery();
  await wait(() => document.querySelector("dialog[open]"));
  const options = [...document.querySelectorAll('dialog input[name="tab"]')];
  assert(
    options.length === ui.tabs.length + 1 && !document.querySelector("dialog select"),
    "Every destination is visible as a selectable list row",
  );
  assert(options[0].value === imageTab, "Tabs with attachments appear first");
  assert(options.find((option) => option.value === emptyTab).checked, "Active query tab is preselected");
  assert(
    options
      .find((option) => option.value === imageTab)
      .closest("label")
      .textContent.includes("CONTENT.IMAGE"),
    "Destination uses the same table-name fallback as the tab strip",
  );
  assert(
    options
      .find((option) => option.value === emptyTab)
      .closest("label")
      .textContent.includes("LOCALIZATION.LANGUAGE_PACK_VERSION"),
    "Tabs without attachments also show their table names",
  );
  options.find((option) => option.value === imageTab).click();
  await choose("attach");
  await routeTask;
  assert(ui.activeTabId === imageTab && ui.processedFiles.some((f) => f.name === "keep.txt"), "Return preserves unrelated attachments");
  assert(
    ui.processedFiles.some((f) => f.name === "fixture (2).png"),
    "Return avoids duplicate attachment names",
  );
  assert(
    ui.processedFiles.some((f) => f.name === "fixture (2).png" && f.processedFormats.base64?.startsWith("data:image/png;base64,")),
    "Returned images remain query-compatible",
  );
  window.app.router.navigate("compress-image");
  await ci.ready;
  ci.addToQuickQuery();
  await wait(() => document.querySelector("dialog[open]"));
  const cancelledTarget = routeTask;
  await choose("cancel");
  await cancelledTarget;
  assert(ui.activeTabId === imageTab, "Cancelling destination leaves query attachments intact");
  window.app.router.navigate("compress-image");
  await ci.ready;
  ci.addToQuickQuery();
  await wait(() => document.querySelector("dialog[open]"));
  document.querySelector('dialog input[name="tab"][value="new"]').click();
  await choose("attach");
  await routeTask;
  assert(ui.activeTabId !== imageTab && ui.processedFiles.length === 3, "Create query adds all compressed images to a new tab");
  ui.handleDeleteAllAttachments();
  await ui.saveActiveTabDraft();
  await ui.switchTab(imageTab);
  ui.handleDeleteAllAttachments();
  await ui.saveActiveTabDraft();
  window.app.router.navigate("compress-image");
  await ci.ready;
  assert(
    ci.items.length === 3 && ci.items.every((item) => item.result),
    "Deleting Quick Query attachments preserves cached compression results",
  );
  for (const item of ci.items) {
    assert((await item.file.arrayBuffer()).byteLength === item.file.size, `Cached original remains readable: ${item.file.name}`);
    assert((await item.blob.arrayBuffer()).byteLength === item.blob.size, `Cached result remains readable: ${item.file.name}`);
  }
  await ci.processQueue();
  await ci.offers;
  assert(
    ci.items.every((item) => item.status === "Ready" && !item.error),
    "Cached images recompress after Quick Query attachments are deleted",
  );
  if (!new URLSearchParams(location.search).has("review")) {
    window.app.router.navigate("compress-image");
    await ci.ready;
    ci.clear();
    await ci.flushWorkspace();
  }
  evidence.textContent = JSON.stringify({ status: "PASS", checks }, null, 2);
} catch (error) {
  evidence.textContent = JSON.stringify({ status: "FAIL", checks, error: error.stack }, null, 2);
  console.error(error);
}
