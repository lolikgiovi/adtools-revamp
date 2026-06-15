import { ExcelImportService } from "./ExcelImportService.js";

const importService = new ExcelImportService();

self.onmessage = (event) => {
  const { type, requestId, payload } = event.data || {};

  if (type !== "import") return;

  try {
    const result = importService.processFromArrayBuffer(payload?.arrayBuffer);
    self.postMessage({
      type: "complete",
      requestId,
      result,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || String(error),
    });
  }
};
