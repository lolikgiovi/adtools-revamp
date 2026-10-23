// Measures what Oxipng's alpha optimization would save on the benchmark images.
// Run from the repository root: node frontend/tools/compress-image/tests/alpha-optimization-probe.mjs
// Lossy path: the browser canvas reads fully transparent pixels as 0,0,0,0, then
// libimagequant builds a palette image, which is what Oxipng receives in the worker.
import { readFileSync, readdirSync } from "node:fs";
import { PNG } from "pngjs";
import { initSync, optimise } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import initQuantizer, { ImageQuantizer, encode_palette_to_png } from "libimagequant-wasm/wasm/libimagequant_wasm.js";

initSync(readFileSync("node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm"));
await initQuantizer({ module_or_path: readFileSync("node_modules/libimagequant-wasm/dist/wasm/libimagequant_wasm_bg.wasm") });

// Mirrors PRESETS.balanced in ../config.js (Node loads this repo's .js files as CommonJS).
const pngOptions = { level: 2 };
const quantize = { maxColors: 256, speed: 4, quality: { target: 95 } };
const dir = new URL("./bench-images/", import.meta.url);
const percent = (before, after) => `${((100 * (before - after)) / before).toFixed(2)}%`;
for (const name of readdirSync(dir).filter((file) => file.toLowerCase().endsWith(".png"))) {
  const source = new Uint8Array(readFileSync(new URL(name, dir)));
  const { width, height, data } = PNG.sync.read(Buffer.from(source));
  const canvas = new Uint8ClampedArray(data);
  for (let i = 0; i < canvas.length; i += 4) if (canvas[i + 3] === 0) canvas[i] = canvas[i + 1] = canvas[i + 2] = 0;

  const quantizer = new ImageQuantizer();
  quantizer.setMaxColors(quantize.maxColors);
  quantizer.setSpeed(quantize.speed);
  quantizer.setQuality(0, quantize.quality.target);
  const result = quantizer.quantizeImage(canvas, width, height);
  const palette = encode_palette_to_png(result.getPaletteIndices(canvas, width, height), result.getPalette(), width, height);
  result.free();
  quantizer.free();

  const lossyOff = optimise(palette, pngOptions.level, false, false).length;
  const lossyOn = optimise(palette, pngOptions.level, false, true).length;
  const losslessOff = optimise(source, pngOptions.level, false, false).length;
  const losslessOn = optimise(source, pngOptions.level, false, true).length;
  console.log(
    `${name.padEnd(31)} lossy ${lossyOff} -> ${lossyOn} (${percent(lossyOff, lossyOn)}) | ` +
      `lossless ${losslessOff} -> ${losslessOn} (${percent(losslessOff, losslessOn)})`,
  );
}
