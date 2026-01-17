/**
 * FileParser - Parse Excel (.xlsx, .xls) and CSV files
 * Uses SheetJS (xlsx) for Excel parsing and native FileReader for CSV
 */

import * as XLSX from "xlsx";

/**
 * Supported file extensions
 */
export const SUPPORTED_EXTENSIONS = ["xlsx", "xls", "csv"];

/**
 * Parse any supported file format
 * @param {File} file - File object from input or drag-drop
 * @returns {Promise<ParseResult>} Parsed data with headers, rows, and metadata
 */
export async function parseFile(file) {
  const ext = getFileExtension(file.name);

  switch (ext) {
    case "xlsx":
    case "xls":
      return parseExcel(file);
    case "csv":
      return parseCSV(file);
    default:
      throw new Error(`Unsupported file format: .${ext}. Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}`);
  }
}

/**
 * Parse Excel file (.xlsx, .xls)
 * @param {File} file - Excel file
 * @returns {Promise<ParseResult>}
 */
export async function parseExcel(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  // Always use first sheet by index
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  if (!sheet) {
    throw new Error(`No sheets found in file: ${file.name}`);
  }

  // Parse sheet to array of arrays (header: 1 means first row is data, not headers)
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rawData.length === 0) {
    return createEmptyResult(file.name, firstSheetName, workbook.SheetNames);
  }

  // First row is headers
  const headers = rawData[0].map((h, i) => normalizeHeader(h, i));
  const dataRows = rawData.slice(1);

  // Convert to array of objects
  const rows = dataRows.map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });

  return {
    headers,
    rows,
    metadata: {
      fileName: file.name,
      sheetName: firstSheetName,
      totalSheets: workbook.SheetNames.length,
      allSheetNames: workbook.SheetNames,
      rowCount: rows.length,
      columnCount: headers.length,
    },
  };
}

/**
 * Parse CSV file
 * @param {File} file - CSV file
 * @returns {Promise<ParseResult>}
 */
export async function parseCSV(file) {
  const text = await file.text();
  const lines = parseCSVText(text);

  if (lines.length === 0) {
    return createEmptyResult(file.name, null, []);
  }

  // First row is headers
  const headers = lines[0].map((h, i) => normalizeHeader(h, i));
  const dataRows = lines.slice(1);

  // Convert to array of objects
  const rows = dataRows.map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });

  return {
    headers,
    rows,
    metadata: {
      fileName: file.name,
      sheetName: null,
      totalSheets: 0,
      allSheetNames: [],
      rowCount: rows.length,
      columnCount: headers.length,
    },
  };
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
 * Normalize header name
 * - Converts to string
 * - Trims whitespace
 * - Assigns placeholder for empty headers
 * @param {any} header - Raw header value
 * @param {number} index - Column index (for placeholder)
 * @returns {string}
 */
function normalizeHeader(header, index) {
  const str = String(header ?? "").trim();
  return str || `Column_${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ""}`;
}

/**
 * Create empty result structure
 * @param {string} fileName
 * @param {string|null} sheetName
 * @param {string[]} allSheetNames
 * @returns {ParseResult}
 */
function createEmptyResult(fileName, sheetName, allSheetNames) {
  return {
    headers: [],
    rows: [],
    metadata: {
      fileName,
      sheetName,
      totalSheets: allSheetNames.length,
      allSheetNames,
      rowCount: 0,
      columnCount: 0,
    },
  };
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
