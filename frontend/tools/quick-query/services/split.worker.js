/**
 * Split Web Worker
 * Offloads SQL splitting/chunking to background thread for large SQL files
 */
import { splitSqlStatementsSafely, calcUtf8Bytes, groupBySize, groupByQueryCount } from "./SplitService.js";

const HEADER = "SET DEFINE OFF;\n";

/**
 * Perform the split operation
 */
function performSplit(sql, mode, value) {
  // Parse SQL into statements
  const statements = splitSqlStatementsSafely(sql);

  // Filter out SET DEFINE OFF statements
  const filtered = statements.filter((s) => !/^SET\s+DEFINE\s+OFF\s*;?$/i.test(s.trim()));

  let chunks = [];
  let metadata = [];

  if (mode === "size") {
    const maxBytes = value * 1024;
    const result = groupBySize(filtered, maxBytes, HEADER);
    chunks = result.chunks;
    metadata = result.metadata;
  } else {
    // For query count mode, pass maxBytes to detect oversized chunks
    const maxBytes = 90 * 1024; // Use 90KB as default limit for oversized detection
    const result = groupByQueryCount(filtered, value, HEADER, maxBytes);
    chunks = result.chunks;
    metadata = result.metadata;
  }

  return {
    chunks,
    metadata,
    statementCount: filtered.length,
  };
}

self.onmessage = async (e) => {
  const { type, payload, requestId } = e.data || {};

  try {
    if (type === "split") {
      const { sql, mode, value } = payload;

      // Post initial progress
      self.postMessage({
        type: "progress",
        requestId,
        percent: 10,
        message: "Parsing SQL statements...",
      });

      // Perform the split
      const result = performSplit(sql, mode, value);

      // Post completion
      self.postMessage({
        type: "complete",
        requestId,
        ...result,
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
