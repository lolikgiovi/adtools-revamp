/**
 * Query Generation Web Worker
 * Offloads heavy SQL generation to background thread for 80K+ row datasets
 */
import { QueryGenerationService } from "./QueryGenerationService.js";
import { SchemaValidationService } from "./SchemaValidationService.js";

const queryService = new QueryGenerationService();
const schemaValidationService = new SchemaValidationService();

/**
 * Process data in chunks and post progress updates
 */
function generateQueryWithProgress(tableName, queryType, schemaData, inputData, attachments) {
  // Validate first
  schemaValidationService.validateSchema(schemaData);
  schemaValidationService.matchSchemaWithData(schemaData, inputData);

  // Generate query (QueryGenerationService already optimized with Array.join)
  const sql = queryService.generateQuery(tableName, queryType, schemaData, inputData, attachments);

  return sql;
}

/**
 * Detect duplicate primary keys (used for warnings)
 */
function detectDuplicates(schemaData, inputData, tableName) {
  return queryService.detectDuplicatePrimaryKeys(schemaData, inputData, tableName);
}

self.onmessage = async (e) => {
  const { type, payload, requestId } = e.data || {};

  try {
    if (type === "generate") {
      const { tableName, queryType, schemaData, inputData, attachments } = payload;

      // Post initial progress
      self.postMessage({
        type: "progress",
        requestId,
        percent: 0,
        message: `Starting ${queryType.toUpperCase()} query generation...`,
      });

      // Generate the SQL
      const sql = generateQueryWithProgress(tableName, queryType, schemaData, inputData, attachments || []);

      // Post progress before duplicate detection
      self.postMessage({
        type: "progress",
        requestId,
        percent: 90,
        message: "Checking for duplicate primary keys...",
      });

      // Detect duplicates for warning
      const duplicateResult = detectDuplicates(schemaData, inputData, tableName);

      // Post completion
      self.postMessage({
        type: "complete",
        requestId,
        sql,
        duplicateResult,
        rowCount: inputData.length - 1, // Exclude header row
      });
    } else if (type === "ping") {
      // Health check
      self.postMessage({ type: "pong", requestId });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      requestId,
      error: err?.message || String(err),
    });
  }
};
