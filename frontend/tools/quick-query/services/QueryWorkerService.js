/**
 * QueryWorkerService
 * Manages worker lifecycle for SQL generation on large datasets
 */
import QueryWorker from "./query.worker.js?worker";

const WORKER_ROW_THRESHOLD = 1000; // Use worker for datasets larger than this

export class QueryWorkerService {
  constructor() {
    this.worker = null;
    this.pendingRequests = new Map();
    this.requestCounter = 0;
  }

  /**
   * Check if worker should be used based on row count
   */
  shouldUseWorker(inputData) {
    const rowCount = (inputData?.length || 0) - 1; // Exclude header row
    return rowCount >= WORKER_ROW_THRESHOLD;
  }

  /**
   * Get the threshold value (for UI to display)
   */
  getThreshold() {
    return WORKER_ROW_THRESHOLD;
  }

  /**
   * Initialize worker if not already running
   */
  _ensureWorker() {
    if (!this.worker) {
      this.worker = new QueryWorker();
      this.worker.onmessage = (e) => this._handleMessage(e);
      this.worker.onerror = (err) => this._handleError(err);
    }
    return this.worker;
  }

  /**
   * Handle messages from worker
   */
  _handleMessage(e) {
    const { type, requestId, ...data } = e.data || {};
    const pending = this.pendingRequests.get(requestId);

    if (!pending) return;

    if (type === "complete") {
      pending.resolve({
        sql: data.sql,
        duplicateResult: data.duplicateResult,
        rowCount: data.rowCount,
      });
      this.pendingRequests.delete(requestId);
    } else if (type === "error") {
      pending.reject(new Error(data.error));
      this.pendingRequests.delete(requestId);
    } else if (type === "progress" && pending.onProgress) {
      pending.onProgress(data.percent, data.message);
    }
  }

  /**
   * Handle worker errors
   */
  _handleError(err) {
    console.error("Query worker error:", err);
    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("Worker error: " + (err?.message || "Unknown error")));
    }
    this.pendingRequests.clear();
    this.terminate();
  }

  /**
   * Generate SQL query using web worker
   * @param {string} tableName
   * @param {string} queryType
   * @param {Array} schemaData
   * @param {Array} inputData
   * @param {Array} attachments
   * @param {Function} onProgress - Callback for progress updates (percent, message)
   * @returns {Promise<{sql: string, duplicateResult: object, rowCount: number}>}
   */
  generateQuery(tableName, queryType, schemaData, inputData, attachments = [], onProgress = null) {
    return new Promise((resolve, reject) => {
      const worker = this._ensureWorker();
      const requestId = ++this.requestCounter;

      this.pendingRequests.set(requestId, { resolve, reject, onProgress });

      worker.postMessage({
        type: "generate",
        requestId,
        payload: {
          tableName,
          queryType,
          schemaData,
          inputData,
          attachments,
        },
      });
    });
  }

  /**
   * Cancel any pending generation and terminate worker
   */
  cancel() {
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("Generation cancelled"));
    }
    this.pendingRequests.clear();
    this.terminate();
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
  }
}
