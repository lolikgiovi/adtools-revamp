// HTML Minifier vendored browser build (CDN download)
import minifierSource from "./vendor/htmlminifier.min.js?raw";
import {
  MINIFIER_OPTIONS,
  MINIFIER_UNAVAILABLE_MESSAGE,
  loadHtmlMinifier,
  normalizeMinifiedHtml,
  parseCdnPackageInfo,
} from "./minifierEngine.js";

let minifyFn = null;

function ensureMinifierLoaded() {
  if (minifyFn) return true;
  try {
    const candidate = loadHtmlMinifier(minifierSource, self);
    if (candidate) {
      minifyFn = candidate;
      return true;
    }
  } catch (_err) {
    // Surface a single actionable message to the UI below.
  }
  return false;
}

self.onmessage = async (e) => {
  const type = e?.data?.type || "minify";
  const html = e?.data?.html ?? "";
  try {
    if (type === "probe") {
      const loaded = ensureMinifierLoaded();
      const details = loaded ? parseCdnPackageInfo(minifierSource) : null;
      self.postMessage({
        type: "probe",
        success: loaded,
        error: loaded ? null : MINIFIER_UNAVAILABLE_MESSAGE,
        engine: loaded ? "html-minifier" : null,
        enginePackageName: details?.name || null,
        enginePackageVersion: details?.version || null,
        enginePackageUrl: details?.npmUrl || null,
      });
      return;
    }

    if (type !== "minify") {
      self.postMessage({ type, success: false, error: `Unsupported minifier worker message: ${type}` });
      return;
    }

    const loaded = ensureMinifierLoaded();
    if (!loaded) {
      self.postMessage({ type: "minify", success: false, error: MINIFIER_UNAVAILABLE_MESSAGE });
      return;
    }

    const details = parseCdnPackageInfo(minifierSource);
    const result = normalizeMinifiedHtml(minifyFn(html, MINIFIER_OPTIONS));
    self.postMessage({
      type: "minify",
      success: true,
      result,
      engine: "html-minifier",
      enginePackageName: details?.name || null,
      enginePackageVersion: details?.version || null,
      enginePackageUrl: details?.npmUrl || null,
    });
  } catch (err) {
    self.postMessage({ type, success: false, error: err?.message || String(err) });
  }
};
