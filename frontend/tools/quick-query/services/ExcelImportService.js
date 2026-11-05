import * as XLSX from "xlsx";

// cellNF keeps each cell's number format so dates and zero-padded codes can be read as displayed.
const READ_OPTIONS = { type: "array", cellNF: true };

const pad = (value, length = 2) => String(value).padStart(length, "0");

// Excel stores dates as day serials; convert from the serial itself so the machine time zone cannot shift the day.
function excelDateText(serial, date1904) {
  const parts = XLSX.SSF.parse_date_code(serial, { date1904 });
  if (!parts) return null;
  const date = `${pad(parts.y, 4)}-${pad(parts.m)}-${pad(parts.d)}`;
  return parts.H || parts.M || parts.S ? `${date} ${pad(parts.H)}:${pad(parts.M)}:${pad(parts.S)}` : date;
}

// Read numeric cells the way Excel shows them: dates as text, zero-padded codes with their zeros,
// and decimals at Excel's 15 significant digits instead of binary float noise.
function normalizeNumericCells(sheet, date1904) {
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!") || cell?.t !== "n" || typeof cell.v !== "number") continue;
    const format = typeof cell.z === "string" ? cell.z : "";
    if (format && XLSX.SSF.is_date(format)) {
      const text = excelDateText(cell.v, date1904);
      // Drop the format too: sheet_to_json re-parses any cell that still has a date format.
      if (text) Object.assign(cell, { t: "s", v: text, z: undefined, w: text });
    } else if (/^0+$/.test(format)) {
      const padded = XLSX.SSF.format(format, cell.v);
      Object.assign(cell, { t: "s", v: padded, z: undefined, w: padded });
    } else if (Number.isFinite(cell.v)) {
      cell.v = Number(cell.v.toPrecision(15));
    }
  }
}

/**
 * Service for importing Excel files for quick-query data processing.
 * Reads Sheet1, extracts header from first row and data from subsequent rows.
 * Designed for handling large datasets without rendering to Handsontable.
 */
export class ExcelImportService {
  constructor() {
    this.importedData = null;
    this.header = null;
    this.rowCount = 0;
  }

  /**
   * Process an Excel file from a File object (web file input)
   * @param {File} file - The Excel file to process
   * @returns {Promise<{header: string[], data: any[][], rowCount: number}>}
   */
  async processFromFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    return this.processFromArrayBuffer(arrayBuffer);
  }

  /**
   * Process an Excel file from a Uint8Array (Tauri fs read)
   * @param {Uint8Array} uint8Array - The file contents as Uint8Array
   * @returns {{header: string[], data: any[][], rowCount: number}}
   */
  processFromUint8Array(uint8Array) {
    const workbook = XLSX.read(uint8Array, READ_OPTIONS);
    return this._processWorkbook(workbook);
  }

  /**
   * Process an Excel file from an ArrayBuffer
   * @param {ArrayBuffer} arrayBuffer - The file contents as ArrayBuffer
   * @returns {{header: string[], data: any[][], rowCount: number}}
   */
  processFromArrayBuffer(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, READ_OPTIONS);
    return this._processWorkbook(workbook);
  }

  /**
   * Internal method to process a workbook and extract data
   * @param {XLSX.WorkBook} workbook - The parsed workbook
   * @returns {{header: string[], data: any[][], rowCount: number}}
   */
  _processWorkbook(workbook) {
    // Get first sheet (Sheet1)
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error("Excel file has no sheets");
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new Error("Could not read sheet data");
    }

    normalizeNumericCells(sheet, Boolean(workbook.Workbook?.WBProps?.date1904));

    // Convert sheet to 2D array
    const rawData = XLSX.utils.sheet_to_json(sheet, {
      header: 1, // Use array of arrays format
      defval: null, // Default value for empty cells
      blankrows: false, // Skip blank rows
    });

    if (!rawData || rawData.length === 0) {
      throw new Error("Excel file is empty");
    }

    // First row is header. Formatted but empty columns inside the used range are not part of the data.
    const fullHeader = rawData[0].map((cell) => (cell != null ? String(cell).trim() : ""));
    const hasValue = (cell) => cell != null && cell !== "";
    const columns = fullHeader.flatMap((name, index) => (name || rawData.some((row) => hasValue(row[index])) ? [index] : []));
    const header = columns.map((index) => fullHeader[index]);

    // Remaining rows are data
    const data = rawData.slice(1).map((row) => {
      // Ensure each row has same length as header
      const normalizedRow = [];
      for (const i of columns) {
        const cell = row[i];
        // Convert cell value to string or null
        if (cell == null || cell === "") {
          normalizedRow.push(null);
        } else if (typeof cell === "number") {
          // Preserve number formatting
          normalizedRow.push(String(cell));
        } else if (cell instanceof Date) {
          // Format date as ISO string
          normalizedRow.push(cell.toISOString().split("T")[0]);
        } else {
          normalizedRow.push(String(cell).trim());
        }
      }
      return normalizedRow;
    });

    // Store for later use
    this.header = header;
    this.importedData = data;
    this.rowCount = data.length;

    return {
      header,
      data,
      rowCount: data.length,
    };
  }

  /**
   * Get the data formatted for query generation (with header as first row)
   * This mimics the Handsontable data format
   * @returns {any[][]}
   */
  getDataForQuery() {
    if (!this.header || !this.importedData) {
      return null;
    }
    return [this.header, ...this.importedData];
  }

  /**
   * Get just the imported data rows (without header)
   * @returns {any[][]}
   */
  getData() {
    return this.importedData;
  }

  /**
   * Get the header row
   * @returns {string[]}
   */
  getHeader() {
    return this.header;
  }

  /**
   * Get the row count (excluding header)
   * @returns {number}
   */
  getRowCount() {
    return this.rowCount;
  }

  /**
   * Check if there is imported data
   * @returns {boolean}
   */
  hasData() {
    return this.importedData !== null && this.importedData.length > 0;
  }

  /**
   * Clear imported data
   */
  clear() {
    this.importedData = null;
    this.header = null;
    this.rowCount = 0;
  }
}
