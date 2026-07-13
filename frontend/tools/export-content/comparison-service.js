import * as Diff from "diff";
import * as XLSX from "xlsx";

const MARKUP_FILE_EXTENSIONS = new Set(["html", "htm", "xml", "xhtml"]);
const EXCEL_FILE_EXTENSIONS = new Set(["xlsx", "xls"]);
const SKIPPED_TEXT_ELEMENTS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
const BLOCK_TEXT_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

export class ExportContentComparisonService {
  getFileExtension(filename) {
    return String(filename || "")
      .split(".")
      .pop()
      .toLowerCase();
  }

  isMarkupFile(filename) {
    return MARKUP_FILE_EXTENSIONS.has(this.getFileExtension(filename));
  }

  isExcelFile(filename) {
    return EXCEL_FILE_EXTENSIONS.has(this.getFileExtension(filename));
  }

  async readMarkupFile(file, maxBytes = 5 * 1024 * 1024) {
    if (!file || !this.isMarkupFile(file.name)) {
      throw new Error("Choose an HTML, HTM, XML, or XHTML file.");
    }
    if (file.size > maxBytes) {
      throw new Error("Candidate markup file must be 5 MB or smaller.");
    }
    return {
      content: await file.text(),
      label: file.name,
      mediaType: this.mediaTypeForFilename(file.name),
    };
  }

  mediaTypeForFilename(filename) {
    const extension = this.getFileExtension(filename);
    if (extension === "xml") return "application/xml";
    if (extension === "xhtml") return "application/xhtml+xml";
    return "text/html";
  }

  async parseExcelFile(file, maxBytes = 20 * 1024 * 1024) {
    if (!file || !this.isExcelFile(file.name)) {
      throw new Error("Choose an XLSX or XLS file.");
    }
    if (file.size > maxBytes) {
      throw new Error("Candidate Excel file must be 20 MB or smaller.");
    }
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheets = workbook.SheetNames.map((name) => this.parseWorksheet(name, workbook.Sheets[name])).filter(Boolean);
    if (sheets.length === 0) {
      throw new Error("Excel file has no readable sheets.");
    }
    return { filename: file.name, sheets };
  }

  parseWorksheet(name, worksheet) {
    if (!worksheet) return null;
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", blankrows: false, raw: false });
    if (rawRows.length === 0) return { name, headers: [], rows: [] };

    const headers = rawRows[0].map((value, index) => String(value || "").trim() || `Column ${index + 1}`);
    const rows = rawRows.slice(1).map((values, index) => ({
      excelRowNumber: index + 2,
      values: Object.fromEntries(headers.map((header, columnIndex) => [header, String(values[columnIndex] ?? "")])),
    }));
    return { name, headers, rows };
  }

  suggestExcelMapping({ sheet, oracleIdentifierColumn = "", oracleIdentifierValue = "", oracleContentColumn = "" }) {
    const headers = sheet?.headers || [];
    const rows = sheet?.rows || [];
    const findHeader = (wanted) => headers.find((header) => header.toLowerCase() === String(wanted || "").toLowerCase());
    const identifierColumn = findHeader(oracleIdentifierColumn) || "";
    const contentColumn = findHeader(oracleContentColumn) || this.detectMarkupColumns(headers, rows)[0] || headers[0] || "";
    let rowIndex = 0;

    if (identifierColumn && String(oracleIdentifierValue ?? "") !== "") {
      const match = rows.findIndex(
        (row) => String(row.values[identifierColumn] ?? "").trim() === String(oracleIdentifierValue ?? "").trim(),
      );
      if (match >= 0) rowIndex = match;
    }

    return { identifierColumn, contentColumn, rowIndex: rows.length ? rowIndex : -1 };
  }

  detectMarkupColumns(headers = [], rows = []) {
    const scored = headers.map((header, index) => {
      const sampleValues = rows.slice(0, 25).map((row) => String(row.values?.[header] || ""));
      const markupValues = sampleValues.filter((value) => /<\/?[A-Za-z][^>]*>/.test(value)).length;
      const nameScore = /(?:html|xml|xhtml|content|body|template|message)(?:_|$)/i.test(header) ? 2 : 0;
      return { header, index, score: nameScore + markupValues * 3 };
    });
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.header);
  }

  getExcelCandidate({ workbook, sheetName, rowIndex, contentColumn }) {
    const sheet = workbook?.sheets?.find((item) => item.name === sheetName);
    const row = sheet?.rows?.[rowIndex];
    if (!sheet || !row || !contentColumn) {
      throw new Error("Select an Excel sheet, row, and HTML content column.");
    }
    const content = String(row.values[contentColumn] ?? "");
    if (!content.trim()) {
      throw new Error(`Excel row ${row.excelRowNumber} has empty content in ${contentColumn}.`);
    }
    return {
      content,
      label: `${workbook.filename} · ${sheet.name} · row ${row.excelRowNumber} · ${contentColumn}`,
      mediaType: this.inferMediaType(content),
    };
  }

  inferMediaType(content) {
    const normalized = String(content || "").trim().toLowerCase();
    if (normalized.startsWith("<?xml") || normalized.startsWith("<svg")) return "application/xml";
    if (normalized.includes("xmlns=\"http://www.w3.org/1999/xhtml\"")) return "application/xhtml+xml";
    return "text/html";
  }

  extractVisibleText(content, { normalizeWhitespace = true, mediaType = "text/html" } = {}) {
    const parser = new DOMParser();
    const document = parser.parseFromString(String(content || ""), mediaType);
    if (mediaType !== "text/html" && document.querySelector("parsererror")) {
      throw new Error("Candidate XML/XHTML is not well formed.");
    }

    const chunks = [];
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        chunks.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
      const tagName = node.nodeType === Node.ELEMENT_NODE ? node.tagName.toUpperCase() : "";
      if (SKIPPED_TEXT_ELEMENTS.has(tagName)) return;
      if (tagName === "BR") chunks.push("\n");
      const isBlock = BLOCK_TEXT_ELEMENTS.has(tagName);
      if (isBlock) chunks.push("\n");
      node.childNodes.forEach(visit);
      if (isBlock) chunks.push("\n");
    };
    visit(document.body || document.documentElement || document);

    const text = chunks.join("").replace(/\r\n?/g, "\n");
    if (!normalizeWhitespace) return text.trim();
    return text
      .split("\n")
      .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  compare(original, candidate, { normalizeWhitespace = true, originalMediaType, candidateMediaType } = {}) {
    const originalSource = String(original || "").replace(/\r\n?/g, "\n");
    const candidateSource = String(candidate || "").replace(/\r\n?/g, "\n");
    const originalText = this.extractVisibleText(originalSource, {
      normalizeWhitespace,
      mediaType: originalMediaType || this.inferMediaType(originalSource),
    });
    const candidateText = this.extractVisibleText(candidateSource, {
      normalizeWhitespace,
      mediaType: candidateMediaType || this.inferMediaType(candidateSource),
    });

    return {
      changed: originalSource !== candidateSource,
      textChanged: originalText !== candidateText,
      textSegments: this.toSegments(Diff.diffWordsWithSpace(originalText, candidateText)),
      sourceSegments: this.toSegments(Diff.diffLines(originalSource, candidateSource)),
      stats: this.buildStats(originalText, candidateText),
    };
  }

  toSegments(parts) {
    return parts.map((part) => ({
      type: part.added ? "insert" : part.removed ? "delete" : "equal",
      value: part.value,
    }));
  }

  buildStats(originalText, candidateText) {
    const parts = Diff.diffWordsWithSpace(originalText, candidateText);
    return {
      added: parts.filter((part) => part.added).reduce((total, part) => total + this.countWords(part.value), 0),
      removed: parts.filter((part) => part.removed).reduce((total, part) => total + this.countWords(part.value), 0),
    };
  }

  countWords(value) {
    return String(value || "").trim().split(/\s+/).filter(Boolean).length;
  }
}
