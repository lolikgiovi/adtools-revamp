/**
 * Worker-safe file parsing implementation.
 * This module intentionally owns the SheetJS import so the main Compare Config
 * route does not load it until a parser fallback or the module worker runs.
 */
import * as XLSX from "xlsx";

export function parseExcelBuffer(arrayBuffer, fileName) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  if (!sheet) {
    throw new Error(`No sheets found in file: ${fileName}`);
  }

  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (rawData.length === 0) {
    return createEmptyResult(fileName, firstSheetName, workbook.SheetNames);
  }

  const headers = rawData[0].map((header, index) => normalizeHeader(header, index));
  const dataRows = rawData.slice(1);
  const rows = dataRows.map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index] ?? "";
    });
    return object;
  });

  return {
    headers,
    rows,
    metadata: {
      fileName,
      sheetName: firstSheetName,
      totalSheets: workbook.SheetNames.length,
      allSheetNames: workbook.SheetNames,
      rowCount: rows.length,
      columnCount: headers.length,
    },
  };
}

export function parseCSVTextResult(text, fileName) {
  const lines = parseCSVText(text);
  if (lines.length === 0) return createEmptyResult(fileName, null, []);

  const headers = lines[0].map((header, index) => normalizeHeader(header, index));
  const dataRows = lines.slice(1);
  const rows = dataRows.map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index] ?? "";
    });
    return object;
  });

  return {
    headers,
    rows,
    metadata: {
      fileName,
      sheetName: null,
      totalSheets: 0,
      allSheetNames: [],
      rowCount: rows.length,
      columnCount: headers.length,
    },
  };
}

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
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      currentLine.push(currentField.trim());
      currentField = "";
    } else if (char === "\n" || (char === "\r" && nextChar === "\n")) {
      currentLine.push(currentField.trim());
      if (currentLine.some((field) => field !== "")) lines.push(currentLine);
      currentLine = [];
      currentField = "";
      if (char === "\r") i++;
    } else if (char !== "\r") {
      currentField += char;
    }
  }

  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.some((field) => field !== "")) lines.push(currentLine);
  }

  return lines;
}

function normalizeHeader(header, index) {
  const value = String(header ?? "").trim();
  return value || `Column_${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ""}`;
}

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
