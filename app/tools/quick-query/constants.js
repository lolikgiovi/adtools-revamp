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

export const sampleSchema1 = [
  ["TABLE_ID", "VARCHAR2(36)", "No", "", "1", "Yes"],
  ["DESC_ID", "VARCHAR2(500)", "No", "", "2", "Yes"],
  ["DESC_EN", "VARCHAR2(500)", "No", "", "3", "No"],
  ["AMOUNT", "NUMBER(15,2)", "Yes", "", "4", "No"],
  ["SEQUENCE", "NUMBER(3,0)", "No", "", "5", "No"],
  ["IS_ACTIVE", "NUMBER", "No", "", "6", "No"],
  ["CREATED_TIME", "TIMESTAMP(6)", "No", "", "7", "No"],
  ["CREATED_BY", "VARCHAR2(36)", "No", "", "8", "No"],
  ["UPDATED_TIME", "TIMESTAMP(6)", "No", "", "9", "No"],
  ["UPDATED_BY", "VARCHAR2(36)", "No", "", "10", "No"],
];

export const sampleData1 = [
  ["TABLE_ID", "DESC_ID", "DESC_EN", "AMOUNT", "SEQUENCE", "IS_ACTIVE", "CREATED_TIME", "CREATED_BY", "UPDATED_TIME", "UPDATED_BY"],
  ["TABLE_ID_1", "DESC_ID_1", "DESC_EN_1", "100000", "1", "1", "CREATED_TIME_1", "CREATED_BY_1", "UPDATED_TIME_1", "UPDATED_BY_1"],
  ["TABLE_ID_2", "DESC_ID_2", "DESC_EN_2", "", "2", "1", "CREATED_TIME_2", "CREATED_BY_2", "UPDATED_TIME_2", "UPDATED_BY_2"],
];

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
  themeName: 'ht-theme-main',
  minCols: 6,
  minRows: 1,
  autoRowSize: false,
  rowHeights: 20,
  contextMenu: true,
  mergeCells: true,
  manualColumnResize: true,
  // Limit maximum column width to 80% of the container, allow manual resizing below the cap
  beforeColumnResize: function (newSize, column, isDoubleClick) {
    const containerWidth = this.rootElement?.clientWidth || 0;
    const MAX_WIDTH = Math.floor(containerWidth * 0.8);
    if (typeof newSize === 'number' && newSize > MAX_WIDTH) {
      return MAX_WIDTH;
    }
  },
  afterInit: function () {
    const clampToMax = () => {
      const containerWidth = this.rootElement?.clientWidth || 0;
      const MAX_WIDTH = Math.floor(containerWidth * 0.8);
      const resizePlugin = this.getPlugin('manualColumnResize');
      const totalCols = this.countCols();
      for (let col = 0; col < totalCols; col++) {
        const width = this.getColWidth(col);
        if (width && width > MAX_WIDTH) {
          resizePlugin.setManualSize(col, MAX_WIDTH);
        }
      }
      this.render();
    };
    // Initial clamp
    clampToMax();
    // Observe container resize to re-clamp dynamically
    if (!this.__maxWidthObserver) {
      this.__maxWidthObserver = new ResizeObserver(() => clampToMax());
      this.__maxWidthObserver.observe(this.rootElement);
    }
  },
  // Enforce a dynamic hard maximum width based on container size
  modifyColWidth: function (width, col) {
    const containerWidth = this.rootElement?.clientWidth || 0;
    const MAX_WIDTH = Math.floor(containerWidth * 0.8);
    return typeof width === 'number' ? Math.min(width, MAX_WIDTH) : width;
  },
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
  themeName: 'ht-theme-main',
  minCols: 1,
  autoRowSize: false,
  rowHeights: 20,
  contextMenu: true,
  manualColumnResize: true,
  // Disable stretching; enforce a maximum width per column and allow manual resize below the cap
  stretchH: "none",
  beforeColumnResize: function (newSize, column, isDoubleClick) {
    const containerWidth = this.rootElement?.clientWidth || 0;
    const MAX_WIDTH = Math.floor(containerWidth * 0.8);
    if (typeof newSize === 'number' && newSize > MAX_WIDTH) {
      return MAX_WIDTH;
    }
  },
  afterInit: function () {
    const clampToMax = () => {
      const containerWidth = this.rootElement?.clientWidth || 0;
      const MAX_WIDTH = Math.floor(containerWidth * 0.8);
      const resizePlugin = this.getPlugin('manualColumnResize');
      const totalCols = this.countCols();
      for (let col = 0; col < totalCols; col++) {
        const width = this.getColWidth(col);
        if (width && width > MAX_WIDTH) {
          resizePlugin.setManualSize(col, MAX_WIDTH);
        }
      }
      this.render();
    };
    // Initial clamp
    clampToMax();
    // Observe container resize to re-clamp dynamically
    if (!this.__maxWidthObserver) {
      this.__maxWidthObserver = new ResizeObserver(() => clampToMax());
      this.__maxWidthObserver.observe(this.rootElement);
    }
  },
  // Enforce a dynamic hard maximum width based on container size
  modifyColWidth: function (width, col) {
    const containerWidth = this.rootElement?.clientWidth || 0;
    const MAX_WIDTH = Math.floor(containerWidth * 0.8);
    return typeof width === 'number' ? Math.min(width, MAX_WIDTH) : width;
  },
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

export const sampleSchema2 = [
  // Test case: Mixed case field names and special characters
  ["Field_NAME_1", "VARCHAR2(50)", "No", "", "1", "Yes"],

  // Test case: Number field with maximum precision and scale
  ["amount_2", "NUMBER(38,10)", "No", "0", "2", "No"],

  // Test case: Nullable field with default
  ["description", "VARCHAR2(4000)", "Yes", "'N/A'", "3", "No"],

  // Test case: Boolean/Flag field
  ["is_active_FLAG", "NUMBER(1,0)", "No", "1", "4", "No"],

  // Test case: Reserved word as field name
  ['"TABLE"', "VARCHAR2(100)", "No", "", "5", "No"],

  // Test case: Timestamp with timezone
  ["event_time", "TIMESTAMP(9) WITH TIME ZONE", "No", "SYSDATE", "6", "No"],

  // Test case: CLOB type
  ["large_text", "CLOB", "Yes", "", "7", "No"],
];

export const sampleData2 = [
  // Header row - mixed case and special characters
  ["Field_NAME_1", "amount_2", "description", "is_active_FLAG", '"TABLE"', "event_time", "large_text"],

  // Row 1: Testing maximum values and special cases
  [
    "ABC123!@#$", // PK with special chars
    "12345678901234567890.1234567890", // Large number
    "This is a very long text string that tests the VARCHAR2 limit...", // Long text
    "1", // Boolean true
    "DROP TABLE", // SQL keyword
    "2024-12-31 23:59:59.999999999 +00:00", // Max timestamp
    "Very long CLOB text...", // CLOB content
  ],

  // Row 2: Testing minimum/edge values
  [
    "", // Empty PK (should trigger error)
    "-0.00000000001", // Small negative number
    "", // Empty nullable field
    "0", // Boolean false
    "", // Empty reserved word field
    "", // Empty timestamp (should use SYSDATE)
    "", // Empty CLOB
  ],

  // Row 3: Testing special characters and formats
  [
    "PK''QUOTE", // Single quote in PK
    "1,234.56", // Number with comma
    "Line1\nLine2", // Text with newline
    "2", // Invalid boolean (should trigger error)
    "TABLE;DROP", // Semicolon in text
    "01-JAN-24", // Different date format
    '<?xml version="1.0"?><root>TEST</root>', // XML in CLOB
  ],
];

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
