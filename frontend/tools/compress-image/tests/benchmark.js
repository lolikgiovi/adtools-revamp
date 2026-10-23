import { UsageTracker } from "../../../core/UsageTracker.js";

// Benchmark runs must not change real usage counts.
UsageTracker.trackToolUse = () => {};
import { CompressImage } from "../main.js";

// Reproduce: put real images in tests/bench-images/, run `npm run dev`, open
// /tools/compress-image/tests/benchmark.html?commit=<short hash> and keep the tab visible.
// Optional: &scenarios=balanced:off,small:on limits the preset × lossy-PNG runs.
const sources = import.meta.glob("./bench-images/*.{png,PNG,jpg,JPG,jpeg,JPEG,webp,WEBP}", {
  query: "?url",
  import: "default",
  eager: true,
});
const params = new URLSearchParams(location.search);
const ALL_SCENARIOS = ["high", "balanced", "small"].flatMap((preset) => [`${preset}:off`, `${preset}:on`]);
const scenarios = (params.get("scenarios")?.split(",") || ALL_SCENARIOS).map((key) => {
  const [preset, lossy] = key.split(":");
  return { key, preset, lossyPng: lossy === "on" };
});
const status = (text) => (document.querySelector("#benchmark").textContent = text);

let hidden = document.visibilityState !== "visible";
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") hidden = true;
});

const tool = new CompressImage();
tool.mount(document.querySelector("#tool"));
const control = (name) => document.querySelector(`#tool [data-ci="${name}"]`);
function change(name, value) {
  const input = control(name);
  if (input.type === "checkbox") input.checked = value;
  else input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// Main-thread stalls: the largest gap between animation frames, attributed to
// the image that was compressing when the stalled frame began.
const frames = { running: false, gaps: [] };
function watchFrames() {
  let last = performance.now();
  let active = null;
  const tick = (now) => {
    if (!frames.running) return;
    frames.gaps.push({ gap: now - last, item: active });
    last = now;
    active = tool.items.find((item) => item.status === "Compressing…") || null;
    requestAnimationFrame(tick);
  };
  frames.running = true;
  frames.gaps = [];
  requestAnimationFrame(tick);
}
function gapStats(gaps) {
  const values = gaps.map((entry) => entry.gap);
  return {
    maxFrameGapMs: Math.round(Math.max(0, ...values)),
    framesOver50Ms: values.filter((gap) => gap > 50).length,
    framesOver100Ms: values.filter((gap) => gap > 100).length,
  };
}

function stageDurations(logs) {
  const totals = {};
  logs.forEach((entry, i) => {
    const next = logs[i + 1];
    if (next) totals[entry.stage] = (totals[entry.stage] || 0) + next.elapsedMs - entry.elapsedMs;
  });
  return totals;
}
const detail = (logs, stage) => logs.find((entry) => entry.stage === stage)?.details;

async function loadFiles() {
  const entries = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b));
  const files = [];
  for (const [path, url] of entries) {
    const blob = await (await fetch(url)).blob();
    const name = path.split("/").at(-1);
    // Label by content, not extension: renamed files are common in real asset folders.
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const type =
      head[0] === 137 && head[1] === 80
        ? "image/png"
        : head[0] === 255 && head[1] === 216
          ? "image/jpeg"
          : String.fromCharCode(...head.subarray(8, 12)) === "WEBP"
            ? "image/webp"
            : "application/octet-stream";
    files.push(new File([blob], name, { type }));
  }
  return files;
}

async function runScenario(scenario, files) {
  tool.clear();
  change("preset", scenario.preset);
  change("lossy-png", scenario.lossyPng);
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  const input = document.querySelector("#ci-files");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  watchFrames();
  const started = performance.now();
  control("compress").click();
  const deadline = Date.now() + files.length * 120000;
  while (tool.running) {
    if (Date.now() > deadline) throw new Error(`${scenario.key} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const wallMs = Math.round(performance.now() - started);
  frames.running = false;

  const images = tool.items.map((item) => {
    const candidates = detail(item.logs, "png.candidates");
    const quantized = detail(item.logs, "png.quantized");
    return {
      name: item.file.name,
      type: item.file.type,
      inputBytes: item.file.size,
      outputBytes: item.blob?.size ?? null,
      savedPct: item.blob ? Number(((1 - item.blob.size / item.file.size) * 100).toFixed(2)) : null,
      status: item.status,
      error: item.error || null,
      outcome: item.result?.outcome ?? null,
      codec: item.result?.codec ?? null,
      width: item.result?.originalWidth ?? null,
      height: item.result?.originalHeight ?? null,
      fallbackReason: item.result?.fallbackReason ?? null,
      losslessCandidateBytes: candidates?.losslessBytes ?? null,
      lossyCandidateBytes: candidates?.lossyBytes ?? null,
      quantizationQuality: quantized ? Number(quantized.quality.toFixed(1)) : null,
      totalMs: item.logs.at(-1)?.elapsedMs ?? null,
      stageMs: stageDurations(item.logs),
      ...gapStats(frames.gaps.filter((entry) => entry.item === item)),
    };
  });
  const done = images.filter((image) => image.outputBytes !== null);
  const inputBytes = done.reduce((sum, image) => sum + image.inputBytes, 0);
  const outputBytes = done.reduce((sum, image) => sum + image.outputBytes, 0);
  return {
    scenario: scenario.key,
    preset: scenario.preset,
    lossyPng: scenario.lossyPng,
    wallMs,
    inputBytes,
    outputBytes,
    savedPct: inputBytes ? Number(((1 - outputBytes / inputBytes) * 100).toFixed(2)) : null,
    errors: images.filter((image) => image.status === "Error").length,
    ...gapStats(frames.gaps),
    images,
  };
}

function summarize(report) {
  const kb = (bytes) => `${(bytes / 1000).toFixed(0)} KB`;
  const lines = [
    `${report.meta.date} · commit ${report.meta.commit} · ${report.meta.images} images · ${kb(report.meta.inputBytes)} input`,
    `${report.meta.hardwareConcurrency} logical cores · tab hidden: ${report.meta.tabHiddenDuringRun} · ` +
      `frames throttled: ${report.meta.framesLikelyThrottled}`,
    "",
    "scenario          wall s   in → out             saved   max stall   >100ms frames   errors",
  ];
  for (const run of report.runs) {
    lines.push(
      [
        run.scenario.padEnd(16),
        (run.wallMs / 1000).toFixed(1).padStart(7),
        `${kb(run.inputBytes)} → ${kb(run.outputBytes)}`.padStart(20),
        `${run.savedPct}%`.padStart(7),
        `${run.maxFrameGapMs} ms`.padStart(11),
        String(run.framesOver100Ms).padStart(15),
        String(run.errors).padStart(8),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

try {
  const files = await loadFiles();
  if (!files.length) {
    status("No images found. Add PNG, JPEG or WebP files to frontend/tools/compress-image/tests/bench-images/ and reload.");
  } else {
    if (files.length > 20) throw new Error("The tool accepts at most 20 images per batch. Remove some from bench-images/.");
    const runs = [];
    for (const [i, scenario] of scenarios.entries()) {
      status(`Running ${scenario.key} (${i + 1} of ${scenarios.length})…`);
      runs.push(await runScenario(scenario, files));
    }
    const report = {
      tool: "compress-image",
      meta: {
        date: new Date().toISOString(),
        commit: params.get("commit") || "unknown",
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        images: files.length,
        inputBytes: files.reduce((sum, file) => sum + file.size, 0),
        tabHiddenDuringRun: hidden,
        // An embedded or background view can stop frames while still reporting "visible".
        framesLikelyThrottled: runs.some((run) => run.maxFrameGapMs > 5000),
        notes: "Each scenario starts with a cleared tool, so the first image includes codec loading. stageMs sums time per log stage.",
      },
      runs,
    };
    window.__benchmark = report;
    document.querySelector("#summary").textContent = summarize(report);
    document.querySelector("#results").textContent = JSON.stringify(report, null, 2);
    const copy = document.querySelector("#copy");
    copy.disabled = false;
    copy.addEventListener("click", () => navigator.clipboard.writeText(JSON.stringify(report, null, 2)));
    const invalid = hidden || report.meta.framesLikelyThrottled;
    status(invalid ? "DONE, but the tab was hidden or throttled during the run: stall numbers are not valid." : "DONE");
  }
} catch (error) {
  status(`FAIL: ${error.message}`);
  console.error(error);
}
