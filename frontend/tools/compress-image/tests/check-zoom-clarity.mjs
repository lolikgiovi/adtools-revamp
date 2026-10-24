import fs from "node:fs";
import { PNG } from "pngjs";

const [screenshotPath, geometryPath] = process.argv.slice(2);
if (!screenshotPath || !geometryPath) throw new Error("Usage: node check-zoom-clarity.mjs screenshot.png geometry.json");
const screenshot = PNG.sync.read(fs.readFileSync(screenshotPath));
const report = JSON.parse(fs.readFileSync(geometryPath, "utf8"));
if (!report.sourcePixelsEqual) throw new Error("The lossless fixture changed source pixels");
const samples = report.panes.map((pane) => {
  const colors = new Set();
  let interpolated = 0;
  for (let y = Math.ceil(pane.y + 80); y < Math.ceil(pane.y + 144); y++) {
    for (let x = Math.ceil(pane.x + 80); x < Math.ceil(pane.x + 144); x++) {
      const value = screenshot.data[(y * screenshot.width + x) * 4];
      colors.add(value);
      if (value > 20 && value < 235) interpolated++;
    }
  }
  return { colors: [...colors].sort((a, b) => a - b), interpolatedPixels: interpolated, samplePixels: 4096 };
});
console.log(JSON.stringify({ sourcePixelsEqual: report.sourcePixelsEqual, samples }, null, 2));
if (samples.some((sample) => sample.interpolatedPixels > sample.samplePixels * 0.01)) {
  throw new Error("Zoom introduces interpolated gray pixels into a pure black/white source");
}
console.log("PASS: original and lossless result preserve black/white source-pixel contrast at 2x native size");
