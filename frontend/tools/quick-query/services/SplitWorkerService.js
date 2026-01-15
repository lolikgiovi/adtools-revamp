/**
 * SplitWorkerService
 * Manages worker lifecycle for SQL splitting on large files
 */
import SplitWorker from "./split.worker.js?worker";

const WORKER_SIZE_THRESHOLD = 100 * 1024; // Use worker for SQL > 100KB

export class SplitWorkerService {
  constructor() {
    this.worker = null;
    this.pendingRequests = new Map();
    this.requestCounter = 0;
  }

  /**
   * Check if worker should be used based on SQL size
   */
  shouldUseWorker(sql) {
    try {
      const bytes = new TextEncoder().encode(String(sql || "")).length;
      return bytes >= WORKER_SIZE_THRESHOLD;
    } catch (_) {
      return String(sql || "").length >= WORKER_SIZE_THRESHOLD;
    }
  }

  /**
   * Get the threshold value in KB (for UI to display)
   */
  getThresholdKB() {
    return WORKER_SIZE_THRESHOLD / 1024;
  }

  /**
   * Initialize worker if not already running
   */
  _ensureWorker() {
    if (!this.worker) {
      this.worker = new SplitWorker();
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
        chunks: data.chunks,
        metadata: data.metadata,
        statementCount: data.statementCount,
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
    console.error("Split worker error:", err);
    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("Worker error: " + (err?.message || "Unknown error")));
    }
    this.pendingRequests.clear();
    this.terminate();
  }

  /**
   * Split SQL using web worker
   * @param {string} sql - SQL to split
   * @param {string} mode - "size" or "count"
   * @param {number} value - Max KB (for size mode) or query count
   * @param {Function} onProgress - Callback for progress updates (percent, message)
   * @returns {Promise<{chunks: string[], metadata: object[], statementCount: number}>}
   */
  split(sql, mode, value, onProgress = null) {
    return new Promise((resolve, reject) => {
      const worker = this._ensureWorker();
      const requestId = ++this.requestCounter;

      this.pendingRequests.set(requestId, { resolve, reject, onProgress });

      worker.postMessage({
        type: "split",
        requestId,
        payload: {
          sql,
          mode,
          value,
        },
      });
    });
  }

  /**
   * Cancel any pending operations and terminate worker
   */
  cancel() {
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("Split cancelled"));
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
