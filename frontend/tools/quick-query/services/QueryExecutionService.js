import QueryWorker from "./query.worker.js?worker";
import { QueryGenerationService } from "./QueryGenerationService.js";
import { SchemaValidationService } from "./SchemaValidationService.js";

const WORKER_ROW_THRESHOLD = 1000;

export class QueryExecutionService {
  constructor({ queryService, validationService, workerFactory, workerRowThreshold = WORKER_ROW_THRESHOLD } = {}) {
    this.queryService = queryService || new QueryGenerationService();
    this.validationService = validationService || new SchemaValidationService();
    this.workerFactory = workerFactory || (() => new QueryWorker());
    this.workerRowThreshold = workerRowThreshold;
    this.worker = null;
    this.pendingRequests = new Map();
    this.requestCounter = 0;
  }

  async generateQuery({ tableName, queryType, schemaData, inputData, attachments = [], options = {}, onProgress } = {}) {
    this.validationService.validateSchema(schemaData, tableName);
    this.validationService.matchSchemaWithData(schemaData, inputData);

    if ((inputData?.length || 0) - 1 < this.workerRowThreshold) {
      return {
        sql: this.queryService.generateQuery(tableName, queryType, schemaData, inputData, attachments, options),
        duplicateResult: this.queryService.detectDuplicatePrimaryKeys(schemaData, inputData, tableName),
        rowCount: Math.max(0, (inputData?.length || 0) - 1),
        usedWorker: false,
      };
    }

    return this._generateWithWorker({ tableName, queryType, schemaData, inputData, attachments, options, onProgress });
  }

  _generateWithWorker({ tableName, queryType, schemaData, inputData, attachments, options, onProgress }) {
    return new Promise((resolve, reject) => {
      const worker = this._ensureWorker();
      const requestId = ++this.requestCounter;
      this.pendingRequests.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({
        type: "generate",
        requestId,
        payload: { tableName, queryType, schemaData, inputData, attachments, options },
      });
    });
  }

  _ensureWorker() {
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.worker.onmessage = (event) => this._handleMessage(event);
      this.worker.onerror = (error) => this._handleError(error);
    }
    return this.worker;
  }

  _handleMessage(event) {
    const { type, requestId, ...data } = event.data || {};
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    if (type === "progress") {
      pending.onProgress?.(data.percent, data.message);
      return;
    }
    this.pendingRequests.delete(requestId);
    if (type === "error") pending.reject(new Error(data.error));
    else if (type === "complete") pending.resolve({ ...data, usedWorker: true });
  }

  _handleError(error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error(`Worker error: ${error?.message || "Unknown error"}`));
    }
    this.pendingRequests.clear();
    this.terminate();
  }

  cancel() {
    for (const pending of this.pendingRequests.values()) pending.reject(new Error("Generation cancelled"));
    this.pendingRequests.clear();
    this.terminate();
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}
