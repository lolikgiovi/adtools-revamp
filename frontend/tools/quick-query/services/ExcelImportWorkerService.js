import ExcelImportWorker from "./excel.worker.js?worker";
import { ExcelImportService } from "./ExcelImportService.js";

export class ExcelImportWorkerService {
  constructor(options = {}) {
    this.fallbackService = options.fallbackService || new ExcelImportService();
    this.worker = null;
    this.pendingRequests = new Map();
    this.requestCounter = 0;
    this.importedData = null;
    this.header = null;
    this.rowCount = 0;
  }

  async processFromFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    return this.processFromArrayBuffer(arrayBuffer);
  }

  async processFromUint8Array(uint8Array) {
    return this.processFromArrayBuffer(this.toArrayBuffer(uint8Array));
  }

  async processFromArrayBuffer(arrayBuffer) {
    try {
      const result = await this.processInWorker(arrayBuffer);
      this.setImportedData(result);
      return result;
    } catch (error) {
      if (error?.isImportError) {
        throw error;
      }

      console.warn("Excel import worker unavailable, falling back to main thread:", error);
      const result = this.fallbackService.processFromArrayBuffer(arrayBuffer);
      this.setImportedData(result);
      return result;
    }
  }

  processInWorker(arrayBuffer) {
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker();
      const requestId = ++this.requestCounter;

      this.pendingRequests.set(requestId, { resolve, reject });

      try {
        const workerBuffer = arrayBuffer.slice(0);
        worker.postMessage(
          {
            type: "import",
            requestId,
            payload: { arrayBuffer: workerBuffer },
          },
          [workerBuffer],
        );
      } catch (error) {
        this.pendingRequests.delete(requestId);
        error.isWorkerRuntimeError = true;
        reject(error);
      }
    });
  }

  ensureWorker() {
    if (!this.worker) {
      this.worker = new ExcelImportWorker();
      this.worker.onmessage = (event) => this.handleMessage(event);
      this.worker.onerror = (error) => this.handleWorkerError(error);
    }

    return this.worker;
  }

  handleMessage(event) {
    const { type, requestId, result, error } = event.data || {};
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    this.pendingRequests.delete(requestId);

    if (type === "complete") {
      pending.resolve(result);
      return;
    }

    const importError = new Error(error || "Failed to import Excel file");
    importError.isImportError = true;
    pending.reject(importError);
  }

  handleWorkerError(error) {
    for (const pending of this.pendingRequests.values()) {
      const workerError = new Error(error?.message || "Excel import worker failed");
      workerError.isWorkerRuntimeError = true;
      pending.reject(workerError);
    }

    this.pendingRequests.clear();
    this.terminate();
  }

  toArrayBuffer(uint8Array) {
    if (uint8Array instanceof ArrayBuffer) {
      return uint8Array;
    }

    return uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength);
  }

  setImportedData(result) {
    this.header = result?.header || null;
    this.importedData = result?.data || null;
    this.rowCount = result?.rowCount || 0;
  }

  getDataForQuery() {
    if (!this.header || !this.importedData) {
      return null;
    }

    return [this.header, ...this.importedData];
  }

  getData() {
    return this.importedData;
  }

  getHeader() {
    return this.header;
  }

  getRowCount() {
    return this.rowCount;
  }

  hasData() {
    return this.importedData !== null && this.importedData.length > 0;
  }

  clear() {
    this.importedData = null;
    this.header = null;
    this.rowCount = 0;
    this.fallbackService.clear?.();
  }

  terminate() {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
  }

  dispose() {
    this.terminate();
  }
}
