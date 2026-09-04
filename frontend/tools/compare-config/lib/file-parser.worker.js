import { parseCSVTextResult, parseExcelBuffer } from "./file-parser-core.js";

self.onmessage = (event) => {
  const { operation, fileName, arrayBuffer, text } = event.data || {};

  try {
    let result;
    if (operation === "excel") {
      result = parseExcelBuffer(arrayBuffer, fileName);
    } else if (operation === "csv") {
      result = parseCSVTextResult(text, fileName);
    } else {
      throw new Error(`Unsupported parse operation: ${operation}`);
    }
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.message || error).slice(0, 500) });
  }
};
