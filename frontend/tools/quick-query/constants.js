export const oracleReservedWords = new Set([
  "access",
  "add",
  "all",
  "alter",
  "and",
  "any",
  "as",
  "asc",
  "audit",
  "between",
  "by",
  "char",
  "check",
  "cluster",
  "column",
  "comment",
  "compress",
  "connect",
  "create",
  "current",
  "date",
  "decimal",
  "default",
  "delete",
  "desc",
  "distinct",
  "drop",
  "else",
  "exclusive",
  "exists",
  "file",
  "float",
  "for",
  "from",
  "grant",
  "group",
  "having",
  "identified",
  "immediate",
  "in",
  "increment",
  "index",
  "initial",
  "insert",
  "integer",
  "intersect",
  "into",
  "is",
  "level",
  "like",
  "lock",
  "long",
  "maxextents",
  "minus",
  "mlslabel",
  "mode",
  "modify",
  "noaudit",
  "nocompress",
  "not",
  "nowait",
  "null",
  "number",
  "of",
  "offline",
  "on",
  "online",
  "option",
  "or",
  "order",
  "pctfree",
  "prior",
  "privileges",
  "public",
  "raw",
  "rename",
  "resource",
  "revoke",
  "row",
  "rowid",
  "rownum",
  "rows",
  "select",
  "session",
  "set",
  "share",
  "size",
  "smallint",
  "start",
  "successful",
  "synonym",
  "sysdate",
  "table",
  "then",
  "to",
  "trigger",
  "uid",
  "union",
  "unique",
  "update",
  "user",
  "validate",
  "values",
  "varchar",
  "varchar2",
  "view",
  "whenever",
  "where",
  "with",
  "sequence",
  "type",
  "package",
  "body",
]);

export const oracleDateFormats = {
  DATE_ONLY: {
    formats: ["DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "DD/M/YYYY", "M/D/YYYY", "DD-MON-YY", "DD-MON-YYYY"],
    regex: /^(\d{2}[-/]\d{2}[-/]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|\d{2}-[A-Z]{3}-\d{2}|\d{2}-[A-Z]{3}-\d{4})$/i,
    oracleFormat: "YYYY-MM-DD",
  },
  DATE_TIME: {
    formats: ["DD-MM-YYYY HH:mm:ss", "YYYY-MM-DD HH:mm:ss", "DD-MON-YYYY HH:mm:ss"],
    regex: /^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}|\d{2}-[A-Z]{3}-\d{4})\s\d{2}:\d{2}:\d{2}$/i,
    oracleFormat: "DD-MM-YYYY HH24:MI:SS",
  },
  ISO_TIMESTAMP: {
    formats: ["YYYY-MM-DD HH:mm:ss.SSS"],
    regex: /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3}$/,
    oracleFormat: "YYYY-MM-DD HH24:MI:SS.FF3",
  },
  TIMESTAMP: {
    formats: ["DD-MM-YYYY HH.mm.ss,SSSSSSSSS"],
    regex: /^\d{2}-\d{2}-\d{4}\s\d{2}\.\d{2}\.\d{2},\d{1,9}$/,
    oracleFormat: "DD-MM-YYYY HH24:MI:SS.FF9",
  },
  TIMESTAMP_AM_PM: {
    formats: ["M/D/YYYY h:mm:ss.SSSSSS A"],
    regex: /^\d{1,2}\/\d{1,2}\/\d{4}\s\d{1,2}:\d{2}:\d{2}(\.\d{1,6})?\s[AP]M$/,
    oracleFormat: "MM/DD/YYYY HH24:MI:SS.FF6",
  },
};

export const initialSchemaTableSpecification = {
  data: [["", "", "", "", "", ""]], // empty data
  colHeaders: ["Field Name", "Data Type", "Null", "Default", "Order", "PK"],
  columns: [
    {
      renderer: function (instance, td, row, col, prop, value, cellProperties) {
        td.textContent = value == null ? "" : String(value);
        td.style.fontWeight = "bold";
      },
    },
    {},
    {
      type: "dropdown",
      source: ["Yes", "No"],
      validator: function (value, callback) {
        callback(["Yes", "No", "yes", "no", "Y", "N", "y", "n"].includes(value));
      },
      renderer: function (instance, td, row, col, prop, value, cellProperties) {
        td.textContent = value == null ? "" : String(value);
        td.style.textAlign = "center";
      },
    },
    {},
    {
      type: "numeric",
      validator: function (value, callback) {
        callback(value === null || value === "" || !isNaN(parseFloat(value)));
      },
      renderer: function (instance, td, row, col, prop, value, cellProperties) {
        td.textContent = value == null ? "" : String(value);
        td.style.textAlign = "center";
      },
    },
    {
      type: "dropdown",
      source: ["Yes", "No"],
      validator: function (value, callback) {
        callback(["Yes", "No", "yes", "no", "Y", "N", "y", "n"].includes(value));
      },
      renderer: function (instance, td, row, col, prop, value, cellProperties) {
        td.textContent = value == null ? "" : String(value);
        td.style.textAlign = "center";
      },
    },
  ],
  height: "auto",
  licenseKey: "non-commercial-and-evaluation",
  themeName: "ht-theme-main",
  minCols: 6,
  minRows: 1,
  autoRowSize: false,
  rowHeights: 20,
  contextMenu: true,
  mergeCells: true,
  manualColumnResize: true,

  afterChange: (changes) => {
    if (changes) {
      this.updateDataSpreadsheet();
    }
  },
  afterGetColHeader: function (col, TH) {
    const header = TH.querySelector(".colHeader");
    if (header) {
      header.style.fontWeight = "bold";
    }
  },
};

export const initialDataTableSpecification = {
  data: [[], []],
  colHeaders: true,
  rowHeaders: true,
  height: "auto",
  licenseKey: "non-commercial-and-evaluation",
  // Use modern Handsontable theme (auto dark/light)
  themeName: "ht-theme-main",
  minCols: 1,
  autoRowSize: true,
  contextMenu: true,
  manualColumnResize: true,
  className: "hide-scrollbar",
  cells: function (row, col) {
    const cellProperties = {};
    if (row === 0) {
      cellProperties.renderer = function (instance, td, row, col, prop, value, cellProperties) {
        td.textContent = value == null ? "" : String(value);
        td.style.fontWeight = "bold";
        td.style.textAlign = "center";
      };
    }
    return cellProperties;
  },
};

export const commonDateFormats = [
  // ISO formats
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DD[T]HH:mm:ss.SSSZ",
  "YYYY-MM-DD[T]HH:mm:ssZ",
  "YYYY-MM-DD[T]HH:mm:ss",

  // European formats (DD first)
  "DD-MM-YYYY HH:mm:ss",
  "DD/MM/YYYY HH:mm:ss",
  "DD.MM.YYYY HH:mm:ss",
  "DD-MM-YYYY HH.mm.ss",
  "DD/MM/YYYY HH.mm.ss",
  "DD.MM.YYYY HH.mm.ss",
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "DD.MM.YYYY",

  // US formats (MM first)
  "MM/DD/YYYY HH:mm:ss",
  "MM-DD-YYYY HH:mm:ss",
  "MM.DD.YYYY HH:mm:ss",
  "MM/DD/YYYY",
  "MM-DD-YYYY",
  "MM.DD.YYYY",

  // Year first formats
  "YYYY/MM/DD HH:mm:ss",
  "YYYY-MM-DD HH:mm:ss",
  "YYYY.MM.DD HH:mm:ss",
  "YYYY/MM/DD",
  "YYYY-MM-DD",
  "YYYY.MM.DD",

  // Month name formats
  "DD-MMM-YYYY HH:mm:ss",
  "DD MMM YYYY HH:mm:ss",
  "DD-MMM-YYYY",
  "DD MMM YYYY",
  "DD-MMM-YY",
  "DD MMM YY",

  // AM/PM formats
  "MM/DD/YYYY hh:mm:ss A",
  "DD-MM-YYYY hh:mm:ss A",
  "YYYY-MM-DD hh:mm:ss A",
  "DD/MM/YYYY hh:mm:ss A",
  "MM-DD-YYYY hh:mm:ss A",
  "DD.MM.YYYY hh:mm:ss A",

  // Time only variations
  "YYYY-MM-DD HH:mm",
  "DD-MM-YYYY HH:mm",
  "MM/DD/YYYY HH:mm",
  "YYYY/MM/DD HH:mm",

  // Fractional seconds
  "YYYY-MM-DD HH:mm:ss.SSS",
  "DD-MM-YYYY HH:mm:ss.SSS",
  "MM/DD/YYYY HH:mm:ss.SSS",
];
