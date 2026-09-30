// Keep this script byte-for-byte stable: its SHA-256 hash is allowed by the desktop CSP.
export const previewBridgeScript = `(() => {
  const script = document.currentScript;
  const key = script.dataset.previewKey;
  const targetId = script.dataset.encodingTarget;
  let applyingSync = false;
  const extent = () => ({
    x: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    y: Math.max(0, document.documentElement.scrollHeight - innerHeight),
  });
  addEventListener("load", () => {
    if (!targetId) return;
    requestAnimationFrame(() => {
      applyingSync = true;
      document.getElementById(targetId)?.scrollIntoView({ block: "center", inline: "nearest" });
      requestAnimationFrame(() => { applyingSync = false; });
    });
  }, { once: true });
  if (!key) return;
  addEventListener("scroll", () => {
    if (applyingSync) return;
    const max = extent();
    parent.postMessage({
      type: "adtools:preview-scroll", key,
      x: max.x ? scrollX / max.x : 0,
      y: max.y ? scrollY / max.y : 0,
    }, "*");
  }, { passive: true });
  addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== parent || data?.type !== "adtools:preview-sync" || data.key !== key) return;
    const max = extent();
    const x = Math.max(0, Math.min(1, Number(data.x) || 0)) * max.x;
    const y = Math.max(0, Math.min(1, Number(data.y) || 0)) * max.y;
    if (Math.abs(scrollX - x) < 1 && Math.abs(scrollY - y) < 1) return;
    applyingSync = true;
    scrollTo(x, y);
    requestAnimationFrame(() => { applyingSync = false; });
  });
})();`;

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function withEncodingPreviewBridge(html, { key = "", target = false } = {}) {
  const attributes = `data-preview-key="${escapeAttribute(key)}"` +
    (target ? ' data-encoding-target="adtools-encoding-target"' : "");
  return `${html}<script ${attributes}>${previewBridgeScript}</script>`;
}
