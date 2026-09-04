/**
 * FileParser - Parse Excel (.xlsx, .xls) and CSV files
 * Uses a short-lived module worker for parsing, with a lazy main-thread
 * fallback for constrained runtimes.
 */

/**
 * Supported file extensions
 */
export const SUPPORTED_EXTENSIONS = ["xlsx", "xls", "csv"];

/**
 * Parse any supported file format
 * @param {File} file - File object from input or drag-drop
 * @returns {Promise<ParseResult>} Parsed data with headers, rows, and metadata
 */
export async function parseFile(file, options = {}) {
  const ext = getFileExtension(file.name);

  switch (ext) {
    case "xlsx":
    case "xls":
      return parseExcel(file, options);
    case "csv":
      return parseCSV(file, options);
    default:
      throw new Error(`Unsupported file format: .${ext}. Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}`);
  }
}

/**
 * Parse Excel file (.xlsx, .xls)
 * @param {File} file - Excel file
 * @returns {Promise<ParseResult>}
 */
export async function parseExcel(file, options = {}) {
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(options.signal);
  const workerResult = await parseWithWorker(
    { operation: "excel", fileName: file.name, arrayBuffer },
    [arrayBuffer],
    options.signal,
  );
  if (workerResult !== WORKER_UNAVAILABLE) return workerResult;

  const { parseExcelBuffer } = await import("./file-parser-core.js");
  throwIfAborted(options.signal);
  return parseExcelBuffer(arrayBuffer, file.name);
}

/**
 * Parse CSV file
 * @param {File} file - CSV file
 * @returns {Promise<ParseResult>}
 */
export async function parseCSV(file, options = {}) {
  const text = await file.text();
  throwIfAborted(options.signal);
  const workerResult = await parseWithWorker({ operation: "csv", fileName: file.name, text }, [], options.signal);
  if (workerResult !== WORKER_UNAVAILABLE) return workerResult;

  const { parseCSVTextResult } = await import("./file-parser-core.js");
  throwIfAborted(options.signal);
  return parseCSVTextResult(text, file.name);
}

const WORKER_UNAVAILABLE = Symbol("worker-unavailable");

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("File parsing was cancelled");
  error.name = "AbortError";
  throw error;
}

function parseWithWorker(message, transferList, signal) {
  if (typeof Worker === "undefined") return Promise.resolve(WORKER_UNAVAILABLE);

  let worker;
  try {
    worker = new Worker(new URL("./file-parser.worker.js", import.meta.url), { type: "module" });
  } catch (_) {
    return Promise.resolve(WORKER_UNAVAILABLE);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let onAbort;
    const cleanup = () => {
      signal?.removeEventListener?.("abort", onAbort);
      try {
        worker.terminate();
      } catch (_) {}
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    onAbort = () => {
      const error = new Error("File parsing was cancelled");
      error.name = "AbortError";
      finish(reject, error);
    };

    worker.onmessage = (event) => {
      const data = event.data || {};
      if (!data.ok) {
        finish(reject, new Error(data.error || "File parsing failed"));
        return;
      }
      finish(resolve, data.result);
    };
    worker.onerror = (event) => {
      finish(reject, event instanceof Error ? event : new Error(event?.message || "File parser worker failed"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });

    try {
      worker.postMessage(message, transferList);
    } catch (_) {
      // A construction/post failure before a usable worker handoff can use
      // the lazy core fallback. The input buffer is still usable in this path.
      finish(resolve, WORKER_UNAVAILABLE);
    }
  });
}

/**
 * Parse CSV text into array of arrays
 * Handles quoted fields and embedded commas/newlines
 * @param {string} text - Raw CSV text
 * @returns {string[][]}
 */
export function parseCSVText(text) {
  const lines = [];
  let currentLine = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentLine.push(currentField.trim());
        currentField = "";
      } else if (char === "\n" || (char === "\r" && nextChar === "\n")) {
        currentLine.push(currentField.trim());
        if (currentLine.some((f) => f !== "")) {
          lines.push(currentLine);
        }
        currentLine = [];
        currentField = "";
        if (char === "\r") i++; // Skip \n in \r\n
      } else if (char !== "\r") {
        currentField += char;
      }
    }
  }

  // Handle last field/line
  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.some((f) => f !== "")) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Get file extension (lowercase)
 * @param {string} filename
 * @returns {string}
 */
export function getFileExtension(filename) {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

/**
 * Check if a file is supported
 * @param {File|string} fileOrName - File object or filename string
 * @returns {boolean}
 */
export function isSupported(fileOrName) {
  const name = typeof fileOrName === "string" ? fileOrName : fileOrName.name;
  const ext = getFileExtension(name);
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Filter files to only supported formats
 * @param {FileList|File[]} files
 * @returns {File[]}
 */
export function filterSupportedFiles(files) {
  return Array.from(files).filter(isSupported);
}

/**
 * @typedef {Object} ParseResult
 * @property {string[]} headers - Column headers
 * @property {Object[]} rows - Array of row objects {header: value}
 * @property {ParseMetadata} metadata - File metadata
 */

/**
 * @typedef {Object} ParseMetadata
 * @property {string} fileName - Original filename
 * @property {string|null} sheetName - Sheet name (Excel only)
 * @property {number} totalSheets - Total sheets in workbook (Excel only)
 * @property {string[]} allSheetNames - All sheet names (Excel only)
 * @property {number} rowCount - Number of data rows
 * @property {number} columnCount - Number of columns
 */
