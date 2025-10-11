import { LocalStorageService } from "./services/LocalStorageService.js";
import { QueryGenerationService } from "./services/QueryGenerationService.js";
import { SchemaValidationService, isDbeaverSchema } from "./services/SchemaValidationService.js";
import { sampleSchema1, sampleData1, initialSchemaTableSpecification, initialDataTableSpecification } from "./constants.js";
import { AttachmentProcessorService } from "./services/AttachmentProcessorService.js";
import { MAIN_TEMPLATE, GUIDE_TEMPLATE, FILE_BUTTON_TEMPLATE } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import Handsontable from 'handsontable';
// Handsontable v15+ theming: import base and a theme CSS
import 'handsontable/styles/handsontable.css';
import 'handsontable/styles/ht-theme-main.css';


// Architecture-compliant tool wrapper preserving existing QuickQueryUI
export class QuickQuery extends BaseTool {
  constructor(eventBus) {
    super({
      id: "quick-query",
      name: "Quick Query",
      description: "Generate Oracle SQL from schema/data with attachments and previews",
      icon: "database",
      category: "application",
      eventBus,
    });
    this.ui = null;
  }

  render() {
    return MAIN_TEMPLATE;
  }

  onMount() {
    // Instantiate legacy UI controller against the mounted container
    this.ui = new QuickQueryUI(this.container, () => {});
  }
}

export class QuickQueryUI {
  constructor(container, updateHeaderTitle) {
    this.container = container;
    this.updateHeaderTitle = updateHeaderTitle;
    this.editor = null;
    this.schemaTable = null;
    this.dataTable = null;
    this.elements = {};
    this.localStorageService = new LocalStorageService();
    this.schemaValidationService = new SchemaValidationService();
    this.queryGenerationService = new QueryGenerationService();
    this.attachmentProcessorService = new AttachmentProcessorService();
    this.isGuideActive = false;
    this.isAttachmentActive = false;
    this.processedFiles = [];

    // Initialize search state
    this.searchState = {
      selectedIndex: -1,
      visibleItems: [],
    };

    this.init();
  }

  async init() {
    try {
      // Configure Monaco workers for Vite ESM builds
      self.MonacoEnvironment = {
        getWorker() {
          return new editorWorker();
        },
      };

      // Set HTML content only if not already rendered by the tool wrapper
      if (!this.container.querySelector(".quick-query-content")) {
        this.container.innerHTML = MAIN_TEMPLATE;
      }
      if (this.isGuideActive) {
        const guideContainer = document.getElementById("guideContainer");
        if (guideContainer) {
          guideContainer.innerHTML = GUIDE_TEMPLATE;
        }
      }

      // Initialize UI components
      this.bindElements();
      this.clearError();
      this.registerOracleSqlLanguage();
      await this.initializeComponents();
      this.setupEventListeners();
      this.setupTableNameSearch();
      this.loadMostRecentSchema();
    } catch (error) {
      console.error("Failed to initialize Quick Query:", error);
      this.container.innerHTML = `<div class="error-message">Failed to load: ${error.message}</div>`;
      throw error;
    }
  }

  registerOracleSqlLanguage() {
    try {
      // Focused highlighter for Oracle DML: SELECT, MERGE, UPDATE, INSERT
      const id = 'oracle-dml';
      if (!monaco.languages.getLanguages().some(l => l.id === id)) {
        monaco.languages.register({ id, aliases: ['Oracle DML', 'Oracle SQL'] });
      }

      const dmlKeywords = [
        'select','insert','update','merge','into','values','set','where','from','join','inner','left','right','full','outer','on','group','by','order','having','connect','start','with','prior','using','when','matched','not','then','and','or'
      ];
      const functions = [
        'nvl','nvl2','coalesce','decode','substr','instr','length','replace','regexp_like','regexp_substr','regexp_replace','to_char','to_date','to_timestamp','trunc','round','upper','lower','initcap','lpad','rpad','trim'
      ];
      const specialKeywords = ['sysdate','systimestamp'];
      const constants = ['null'];
      // Custom coloring targets per user request
      const dmlBlueKeywords = ['merge','into','as','then','update','set','select','from'];
      const aliasesBlue = ['tgt','src'];
      const specialFunctionsBlue = ['nvl'];

      monaco.languages.setMonarchTokensProvider(id, {
        defaultToken: '',
        tokenPostfix: '.oracle',
        ignoreCase: true,
        brackets: [
          { open: '(', close: ')', token: 'delimiter.parenthesis' },
        ],
        keywords: dmlKeywords,
        functions,
        specialKeywords,
        constants,
        dmlBlueKeywords,
        aliasesBlue,
        specialFunctionsBlue,
        operators: [
          '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '<>', '&&', '||', '++', '--', '+', '-', '*', '/', '%', '|', '^', '@'
        ],
        symbols: /[=><!~?:&|+\-*/^%]+/,
        tokenizer: {
          root: [
            [/--.*$/, 'comment'],
            [/\/\*/, 'comment', '@comment'],

            // Enter ON clause to highlight field names inside parentheses
            [/\bON\s*\(/, { token: 'keyword', next: '@onClause' }],

            // strings
            [/\'(?:''|[^'])*\'/, 'string'],

            // Explicit schema_name.table_name (quoted) — green as requested
            [/"schema_name"(?=\.)/, 'entity.schema'],
            [/\./, 'delimiter'],
            [/"table_name"/, 'entity.table'],

            // Explicit schema_name.table_name (unquoted) — green as requested
            [/\bschema_name(?=\.)/, 'entity.schema'],
            [/\./, 'delimiter'],
            [/\btable_name\b/, 'entity.table'],

            // quoted identifiers (standalone)
            [/"(?:""|[^"])*"/, 'identifier'],

            // bind variables :var
            [/:[a-zA-Z_][\w$]*/, 'variable'],

            // numbers
            [/0x[0-9a-fA-F]+/, 'number.hex'],
            [/[-+]?\d*(?:\.|\d)\d*(?:[eE][-+]?\d+)?/, 'number'],

            // identifiers, keywords, functions, aliases
            [/[a-zA-Z_][\w$]*/, {
              cases: {
                '@dmlBlueKeywords': 'keyword.dml',
                '@keywords': 'keyword',
                '@specialKeywords': 'predefined.sys',
                '@specialFunctionsBlue': 'predefined.func.special',
                '@functions': 'predefined.func',
                '@aliasesBlue': 'alias.dml',
                '@constants': 'constant.null',
                '@default': 'identifier'
              }
            }],

            // delimiters and operators
            [/[,.;]/, 'delimiter'],
            [/@symbols/, 'operator'],
            [/[()]/, 'delimiter.parenthesis'],
          ],

          // Inside MERGE ON (...) — emphasize field names
          onClause: [
            [/\)/, { token: 'delimiter.parenthesis', next: '@pop' }],
            [/\.[a-zA-Z_][\w$]*/, 'predicate.onfield'],
            [/--.*$/, 'comment'],
            [/\'(?:''|[^'])*\'/, 'string'],
            [/0x[0-9a-fA-F]+/, 'number.hex'],
            [/[-+]?\d*(?:\.|\d)\d*(?:[eE][-+]?\d+)?/, 'number'],
            [/[,.;]/, 'delimiter'],
            [/@symbols/, 'operator'],
            [/[(]/, 'delimiter.parenthesis'],
            [/[a-zA-Z_][\w$]*/, {
              cases: {
                '@dmlBlueKeywords': 'keyword.dml',
                '@keywords': 'keyword',
                '@specialKeywords': 'predefined.sys',
                '@specialFunctionsBlue': 'predefined.func.special',
                '@functions': 'predefined.func',
                '@aliasesBlue': 'alias.dml',
                '@constants': 'constant.null',
                '@default': 'identifier'
              }
            }],
          ],

          comment: [
            [/[^*/]+/, 'comment'],
            [/\/\*/, 'comment', '@push' ],
            [/\*\//, 'comment', '@pop' ],
            [/[*/]/, 'comment']
          ],
        },
      });

      // Basic completion provider for DML keywords and common functions
      monaco.languages.registerCompletionItemProvider(id, {
        triggerCharacters: [' ', '('],
        provideCompletionItems: () => ({
          suggestions: [
            ...dmlKeywords.map(k => ({ label: k.toUpperCase(), kind: monaco.languages.CompletionItemKind.Keyword, insertText: k.toUpperCase() })),
            ...functions.map(f => ({ label: f.toUpperCase(), kind: monaco.languages.CompletionItemKind.Function, insertText: `${f.toUpperCase()}(` })),
            ...specialKeywords.map(s => ({ label: s.toUpperCase(), kind: monaco.languages.CompletionItemKind.Keyword, insertText: s.toUpperCase() }))
          ]
        })
      });

      // Theme tweaks: requested colors for keywords, aliases, schema.table, built-ins, strings, numbers, NULL
      monaco.editor.defineTheme('oracle-dml-dark', {
        base: 'vs-dark', inherit: true,
        rules: [
          { token: 'keyword', foreground: '#93c5ff' },           // general keywords blue
          { token: 'keyword.dml', foreground: '#93c5ff' },      // MERGE, INTO, AS, THEN, UPDATE, SET, SELECT, FROM
          { token: 'alias.dml', foreground: '#93c5ff' },        // tgt/src in blue
          { token: 'predefined.func.special', foreground: '#93c5ff' }, // NVL in blue
          { token: 'predefined.sys', foreground: 'A6E22E' },   // SYSDATE/SYSTIMESTAMP in blue
          { token: 'predicate.match', foreground: 'ff93f9' },  // equality pairs in ON clause red
          { token: 'predicate.onfield', foreground: 'ff93f9' }, // field names inside ON (...) red
          { token: 'entity.schema', foreground: '#ff93f9' },    // schema name green
          { token: 'entity.table', foreground: '#ff93f9' },     // table name green
          { token: 'string', foreground: 'A6E22E' },           // strings green
          { token: 'number', foreground: 'F78C6C' },           // numbers orange
          { token: 'constant.null', foreground: 'ff93f9' },    // NULL red
        ],
        colors: {}
      });
    } catch (e) {
      console.warn('Failed to register Oracle SQL language; falling back to sql', e);
    }
  }

  async initializeComponents() {
    try {
      // Ensure container elements exist before initializing
      if (!this.elements.schemaContainer || !this.elements.dataContainer) {
        throw new Error("Required containers not found in DOM");
      }

      this.initializeSpreadsheets();
      this.initializeEditor();

      if (this.elements.filesContainer && this.elements.attachmentsContainer) {
        this.elements.filesContainer.classList.add("hidden");
        this.elements.attachmentsContainer.classList.remove("hidden");
      }
    } catch (error) {
      console.error("Failed to initialize components:", error);
      throw error;
    }
  }

  bindElements() {
    this.elements = {
      // Input elements
      tableNameInput: document.getElementById("tableNameInput"),
      queryTypeSelect: document.getElementById("queryTypeSelect"),
      schemaFileInput: document.getElementById("schemaFileInput"),

      // Schema editor elements
      schemaContainer: document.getElementById("spreadsheet-schema"),
      dataContainer: document.getElementById("spreadsheet-data"),

      // Attachments components
      attachmentsContainer: document.getElementById("attachments-container"),
      attachmentsInput: document.getElementById("attachmentsInput"),
      filesContainer: document.getElementById("files-container"),

      // Message and display elements
      errorMessages: document.getElementById("errorMessages"),
      warningMessages: document.getElementById("warningMessages"),
      guide: document.getElementById("guide"),

      // Schema overlay elements
      schemaOverlay: document.getElementById("schemaOverlay"),
      savedSchemasList: document.getElementById("savedSchemasList"),

      // Buttons
      toggleGuideButton: document.getElementById("toggleGuide"),
      guideContent: document.getElementById("guide"),
      toggleWordWrapButton: document.getElementById("toggleWordWrap"),
      showSavedSchemasButton: document.getElementById("showSavedSchemas"),
      closeSchemaOverlayButton: document.getElementById("closeSchemaOverlay"),
      exportSchemasButton: document.getElementById("exportSchemas"),
      clearAllSchemasButton: document.getElementById("clearAllSchemas"),
      importSchemasButton: document.getElementById("importSchemas"),

      // Container elements
      tableSearchContainer: null,
      dropdownContainer: null,

      // Attachment Preview Overlay Elements
      filePreviewOverlay: document.getElementById("fileViewerOverlay"),
      closeFilePreviewOverlayButton: document.getElementById("closeFileViewer"),
    };
  }

  setupEventListeners() {
    const eventMap = {
      // Input elements
      tableNameInput: {
        input: (e) => this.handleSearchInput(e),
        keydown: (e) => this.handleSearchKeyDown(e),
      },
      queryTypeSelect: {
        change: () => this.handleGenerateQuery(),
      },
      schemaFileInput: {
        change: (e) => this.handleSchemaFileInput(e),
      },
      // Query related buttons
      generateQuery: {
        click: () => this.handleGenerateQuery(),
      },
      copySQL: {
        click: (e) => this.copyToClipboard(this.editor.getValue(), e.target),
      },
      clearAll: {
        click: () => this.handleClearAll(),
      },
      downloadSQL: {
        click: () => this.handleDownloadSql(),
      },
      toggleWordWrapButton: {
        click: () => this.handleToggleWordWrap(),
      },

      // Attachments related
      attachmentsContainer: {
        click: () => this.elements.attachmentsInput.click(),
        dragOver: (e) => this.handleDragOver(e),
        dragLeave: (e) => this.handleDragLeave(e),
        drop: (e) => this.handleDrop(e),
      },
      attachmentsInput: {
        change: (e) => this.handleAttachmentsInput(e),
      },

      // Guide related buttons
      toggleGuideButton: {
        click: () => this.handleToggleGuide(),
      },
      simulationFillSchemaButton: {
        click: () => this.handleSimulationFillSchema(),
      },
      simulationFillDataButton: {
        click: () => this.handleSimulationFillData(),
      },
      simulationGenerateQueryButton: {
        click: () => this.handleSimulationGenerateQuery(),
      },

      // Overlay handlers
      schemaOverlay: {
        click: (e) => {
          if (e.target === this.elements.schemaOverlay) {
            this.elements.schemaOverlay.classList.add("hidden");
          }
        },
      },
      filePreviewOverlay: {
        click: (e) => {
          if (e.target === this.elements.filePreviewOverlay) {
            this.elements.filePreviewOverlay.classList.add("hidden");
          }
        },
      },

      // Data related buttons
      addFieldNames: {
        click: () => this.handleAddFieldNames(),
      },
      addDataRow: {
        click: () => this.handleAddDataRow(),
      },
      removeDataRow: {
        click: () => this.handleRemoveDataRow(),
      },
      clearData: {
        click: () => this.handleClearData(),
      },

      // Schema related buttons
      addNewSchemaRow: {
        click: () => this.handleAddNewSchemaRow(),
      },
      removeLastSchemaRow: {
        click: () => this.handleRemoveLastSchemaRow(),
      },
      showSavedSchemasButton: {
        click: () => {
          this.elements.schemaOverlay.classList.remove("hidden");
          this.updateSavedSchemasList();
        },
      },
      closeSchemaOverlayButton: {
        click: () => this.elements.schemaOverlay.classList.add("hidden"),
      },
      exportSchemasButton: {
        click: () => this.handleExportSchemas(),
      },
      clearAllSchemasButton: {
        click: () => this.handleClearAllSchemas(),
      },
      importSchemasButton: {
        click: () => this.elements.schemaFileInput.click(),
      },
    };

    // Bind all event handlers
    Object.entries(eventMap).forEach(([elementId, events]) => {
      const element = this.elements[elementId] || document.getElementById(elementId);
      if (element) {
        Object.entries(events).forEach(([event, handler]) => {
          element.addEventListener(event, handler);
        });
      } else {
        console.warn(`Element '${elementId}' not found`);
      }
    });
  }

  initializeEditor() {
    this.editor = monaco.editor.create(document.getElementById("queryEditor"), {
      value: "",
      language: "oracle-dml",
      theme: "oracle-dml-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "off",
    });
    // Ensure language is applied even if model was created before registration
    const model = this.editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, 'oracle-dml');
    }
  }

  initializeSpreadsheets() {
    const schemaTableConfig = {
      ...initialSchemaTableSpecification,
      afterChange: (changes) => {
        if (changes) {
          this.updateDataSpreadsheet();
          this.handleAddFieldNames();
        }
      },
      afterCreateRow: (index, amount) => {
        console.log(amount, "Row created, for index:", index);
        this.updateDataSpreadsheet();
        this.handleAddFieldNames();
      },
      afterRemoveRow: () => {
        this.updateDataSpreadsheet();
        this.handleAddFieldNames();
      },
      afterGetColHeader: function (col, TH) {
        const header = TH.querySelector(".colHeader");
        if (header) {
          header.style.fontWeight = "bold";
        }
      },
    };
    this.schemaTable = new Handsontable(this.elements.schemaContainer, schemaTableConfig);

    const dataTableConfig = {
      ...initialDataTableSpecification,
      afterChange: (changes, source) => {
        if (!changes || source === "loadData") return; // Skip if no changes or if change is from loading data

        const tableName = this.elements.tableNameInput.value.trim();
        if (!tableName) return; // Skip if no table name

        // Only save if there are actual changes
        if (changes.length > 0) {
          const currentData = this.dataTable.getData();
          this.localStorageService.updateTableData(tableName, currentData);
        }
      },
    };

    this.dataTable = new Handsontable(this.elements.dataContainer, dataTableConfig);
  }

  updateDataSpreadsheet() {
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    const columnCount = schemaData.length;
    const currentData = this.dataTable.getData();

    const columnHeaders = Array.from({ length: columnCount }, (_, i) => String.fromCharCode(65 + i));

    console.log("Column headers:", columnHeaders);

    this.dataTable.updateSettings({
      colHeaders: columnHeaders,
      columns: Array(columnCount).fill({ type: "text" }),
      minCols: columnCount,
    });

    if (currentData.length < 2) {
      const newData = [Array(columnCount).fill(null), Array(columnCount).fill(null)];
      this.dataTable.loadData(newData);
    } else {
      const newData = currentData.map((row) => {
        return row.slice(0, columnCount).concat(Array(Math.max(0, columnCount - row.length)).fill(null));
      });
      this.dataTable.loadData(newData);
    }
  }

  // Error handling methods
  showError(message) {
    if (this.elements.errorMessages) {
      this.elements.errorMessages.innerHTML = message;
      this.elements.errorMessages.style.display = "block";
    }
  }

  showSuccess(message) {
    if (this.elements.warningMessages) {
      this.elements.errorMessages.innerHTML = message;
      this.elements.errorMessages.style.display = "block";
      this.elements.errorMessages.style.color = "green";
    }
  }

  showWarning(message) {
    if (this.elements.warningMessages) {
      this.elements.warningMessages.innerHTML = message;
      this.elements.warningMessages.style.display = "block";
      this.elements.warningMessages.style.color = "orange";
    }
  }

  clearError() {
    if (this.elements.errorMessages && this.elements.warningMessages) {
      this.elements.errorMessages.textContent = "";
      this.elements.warningMessages.textContent = "";
      this.elements.errorMessages.style.display = "none";
      this.elements.warningMessages.style.display = "none";
    }
  }

  // Event Handlers
  handleGenerateQuery() {
    try {
      const tableName = this.elements.tableNameInput.value.trim();
      const queryType = this.elements.queryTypeSelect.value;

      const schemaData = this.schemaTable.getData().filter((row) => row[0]);
      const inputData = this.dataTable.getData();

      if (!tableName) {
        throw new Error("Please fill in schema_name.table_name.");
      }

      if (!tableName.includes(".")) {
        throw new Error("Table name format should be 'schema_name.table_name'.");
      }

      if (schemaData.length === 0) {
        throw new Error("Please fill the schema data first");
      }

      if (isDbeaverSchema(schemaData)) {
        this.adjustDbeaverSchema(schemaData);

        throw new Error("Schema data adjusted from DBeaver to SQL Developer format. Please refill the data sheet.");
      }

      this.schemaValidationService.validateSchema(schemaData);
      this.schemaValidationService.matchSchemaWithData(schemaData, inputData);

      this.localStorageService.saveSchema(tableName, schemaData, inputData);

      const query = this.queryGenerationService.generateQuery(tableName, queryType, schemaData, inputData, this.processedFiles);

      this.editor.setValue(query);
      this.clearError();

      // Check for duplicate primary keys for MERGE and UPDATE operations
      const duplicateResult = this.queryGenerationService.detectDuplicatePrimaryKeys(schemaData, inputData, tableName);
      if (duplicateResult.hasDuplicates && duplicateResult.warningMessage) {
        this.showWarning(duplicateResult.warningMessage);
        console.log("Detected duplicate result");
      }
    } catch (error) {
      this.showError(error.message);
      this.editor.setValue("");
    }
  }

  handleClearAll() {
    this.elements.tableNameInput.value = "";

    if (this.schemaTable) {
      this.schemaTable.updateSettings({
        data: [["", "", "", ""]],
        colHeaders: ["Field Name", "Data Type", "Nullable/PK", "Default", "Field Order", "Comments"],
      });
    }

    if (this.dataTable) {
      this.dataTable.updateSettings({
        data: [[], []],
        colHeaders: true,
        minCols: 1,
      });
    }

    if (this.editor) {
      this.editor.setValue("");
    }

    this.clearError();
    this.elements.queryTypeSelect.value = "merge";
  }

  handleDownloadSql() {
    const sql = this.editor.getValue();
    if (!sql) {
      this.showError("No SQL to download. Please generate a query first.");
      return;
    }

    let tableName = this.elements.tableNameInput.value.trim();
    const sanitizedTableName = tableName.replace(/[^a-z0-9_.]/gi, "_").toUpperCase();
    const filename = `${sanitizedTableName}.sql`;

    const blob = new Blob([sql], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  handleToggleWordWrap() {
    const wordWrapButton = document.getElementById("toggleWordWrap");
    const currentState = this.editor.getOption("lineWrapping");
    const newState = !currentState;

    this.editor.setOption("lineWrapping", newState);
    wordWrapButton.textContent = `Word Wrap: ${newState ? "On" : "Off"}`;
    this.editor.refresh();
  }

  handleToggleGuide() {
    if (this.elements.guideContent.classList.contains("hidden")) {
      this.elements.guideContent.classList.remove("hidden");
      this.elements.toggleGuideButton.textContent = "Hide";
    } else {
      this.elements.guideContent.classList.add("hidden");
      this.elements.toggleGuideButton.textContent = "Tutorial & Simulation";
    }
  }

  handleSimulationFillSchema() {
    this.elements.tableNameInput.value = "schema_name.table_name";
    this.schemaTable.loadData(sampleSchema1);
  }

  handleSimulationFillData() {
    this.dataTable.loadData(sampleData1);
    this.updateDataSpreadsheet();
  }

  handleSimulationGenerateQuery() {
    this.handleGenerateQuery();
    this.handleToggleGuide();
  }

  handleAddFieldNames() {
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    const fieldNames = schemaData.map((row) => row[0]);
    const currentData = this.dataTable.getData();

    if (currentData.length > 0) {
      currentData[0] = fieldNames;
    } else {
      currentData.push(fieldNames);
    }

    if (currentData.length < 2) {
      currentData.push(Array(fieldNames.length).fill(null));
    }

    this.dataTable.loadData(currentData);
  }

  handleAddDataRow() {
    const currentData = this.dataTable.getData();
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    const columnCount = schemaData.length;
    const newRow = Array(columnCount).fill(null);
    const newData = [...currentData, newRow];
    this.dataTable.loadData(newData);
  }

  handleRemoveDataRow() {
    const currentData = this.dataTable.getData();
    const newData = currentData.slice(0, -1);
    this.dataTable.loadData(newData);
  }

  handleClearData() {
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    const fieldNames = schemaData.map((row) => row[0]);
    const newData = [fieldNames, Array(fieldNames.length).fill(null)];

    this.dataTable.loadData(newData);
  }

  // handleAddNewSchemaRow() {
  //   const currentData = this.schemaTable.getData();
  //   const newRow = Array(6).fill(null);
  //   const newData = [...currentData, newRow];
  //   this.schemaTable.loadData(newData);
  // }

  // handleRemoveLastSchemaRow() {
  //   const currentData = this.schemaTable.getData();
  //   const newData = currentData.slice(0, -1);
  //   this.schemaTable.loadData(newData);
  // }

  handleAddNewSchemaRow() {
    const currentRowCount = this.schemaTable.countRows();
    // Insert a new row with empty cells for all columns
    this.schemaTable.alter("insert_row_below", currentRowCount - 1, 1);
    this.schemaTable.render();
  }

  handleRemoveLastSchemaRow() {
    const lastRowIndex = this.schemaTable.countRows() - 1;
    if (lastRowIndex >= 0) {
      this.schemaTable.alter("remove_row", lastRowIndex);
    }
  }

  handleClearAllSchemas() {
    const allTables = this.localStorageService.getAllTables();
    if (allTables.length === 0) {
      this.showError("No schemas to clear");
      return;
    }

    if (!confirm("Are you sure you want to clear all saved schemas? This cannot be undone.")) {
      return;
    }

    const schemaCleared = this.localStorageService.clearAllSchemas();
    if (schemaCleared) {
      this.showSuccess("All saved schemas have been cleared");
      this.elements.schemaOverlay.classList.add("hidden");
    } else {
      this.showError("Failed to clear all saved schemas");
    }
  }

  // Schema management methods
  updateSavedSchemasList() {
    const allTables = this.localStorageService.getAllTables();

    if (allTables.length === 0) {
      this.elements.savedSchemasList.innerHTML = '<div class="no-schemas">No saved schemas</div>';
      return;
    }

    const groupedTables = allTables.reduce((groups, table) => {
      if (!groups[table.schemaName]) {
        groups[table.schemaName] = [];
      }
      groups[table.schemaName].push(table);
      return groups;
    }, {});

    this.elements.savedSchemasList.innerHTML = "";

    Object.entries(groupedTables).forEach(([schemaName, tables]) => {
      const groupDiv = document.createElement("div");
      groupDiv.className = "schema-group";

      const headerDiv = document.createElement("div");
      headerDiv.className = "schema-group-header";
      headerDiv.textContent = schemaName;
      groupDiv.appendChild(headerDiv);

      tables.forEach((table) => {
        const itemDiv = document.createElement("div");
        itemDiv.className = "schema-item";

        const infoDiv = document.createElement("div");
        infoDiv.className = "schema-info";

        const nameDiv = document.createElement("div");
        nameDiv.className = "schema-name";
        nameDiv.textContent = table.tableName;

        const timestampDiv = document.createElement("div");
        timestampDiv.className = "schema-timestamp";
        timestampDiv.textContent = new Date(table.timestamp).toLocaleString();

        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(timestampDiv);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "schema-actions";

        const loadBtn = document.createElement("button");
        loadBtn.textContent = "Load";
        loadBtn.addEventListener("click", () => this.handleLoadSchema(table.fullName));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => this.handleDeleteSchema(table.fullName));

        actionsDiv.appendChild(loadBtn);
        actionsDiv.appendChild(deleteBtn);

        itemDiv.appendChild(infoDiv);
        itemDiv.appendChild(actionsDiv);
        groupDiv.appendChild(itemDiv);
      });

      this.elements.savedSchemasList.appendChild(groupDiv);
    });
  }

  handleLoadSchema(fullName) {
    const result = this.localStorageService.loadSchema(fullName, true);
    if (result) {
      this.elements.tableNameInput.value = fullName;
      this.schemaTable.loadData(result.schema);
      this.updateDataSpreadsheet();

      // Load cached data if available
      if (result.data) {
        this.dataTable.loadData(result.data);
      } else {
        this.handleAddFieldNames();
        this.handleClearData();
      }

      this.elements.schemaOverlay.classList.add("hidden");
      this.clearError();
    } else {
      this.showError(`Failed to load schema for ${fullName}`);
    }
  }

  handleDeleteSchema(fullName) {
    if (confirm(`Delete schema for ${fullName}?`)) {
      const deleted = this.localStorageService.deleteSchema(fullName);
      if (deleted) {
        this.updateSavedSchemasList();

        const currentTable = this.elements.tableNameInput.value;
        if (currentTable === fullName) {
          this.handleClearAll();
        }
      } else {
        this.showError(`Failed to delete schema for ${fullName}`);
      }
    }
  }

  handleExportSchemas() {
    const allTables = this.localStorageService.getAllTables();
    if (allTables.length === 0) {
      this.showError("No schemas to export");
      return;
    }

    const exportData = {};
    allTables.forEach((table) => {
      const schema = this.localStorageService.loadSchema(table.fullName);
      if (schema) {
        if (!exportData[table.schemaName]) {
          exportData[table.schemaName] = {};
        }
        exportData[table.schemaName][table.tableName] = schema;
      }
    });

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quick_query_saved_schemas.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  setupTableNameSearch() {
    const tableNameInput = this.elements.tableNameInput;

    // Disable browser's default suggestions
    tableNameInput.setAttribute("autocomplete", "off");
    tableNameInput.setAttribute("autocorrect", "off");
    tableNameInput.setAttribute("autocapitalize", "off");
    tableNameInput.setAttribute("spellcheck", "false");

    // Create a container div and wrap it around the input
    const container = document.createElement("div");
    container.className = "table-search-container";
    tableNameInput.parentNode.insertBefore(container, tableNameInput);
    container.appendChild(tableNameInput);

    // Create dropdown container
    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "table-search-dropdown";
    dropdownContainer.style.display = "none";
    container.appendChild(dropdownContainer);

    // Store containers in elements
    this.elements.tableSearchContainer = container;
    this.elements.dropdownContainer = dropdownContainer;

    // this.setupSearchEventListeners(container, dropdownContainer, tableNameInput);
  }

  setupSearchEventListeners(container, dropdownContainer, tableNameInput) {
    // Close dropdown when clicking outside
    document.addEventListener("click", (event) => {
      if (!container.contains(event.target)) {
        dropdownContainer.style.display = "none";
        this.searchState.selectedIndex = -1;
      }
    });
  }

  handleSearchInput(event) {
    const input = event.target.value.trim();
    this.elements.tableNameInput.style.borderColor = "";

    if (!input) {
      const results = this.localStorageService.searchSavedSchemas("").slice(0, 7);
      this.showSearchDropdown(results);
      return;
    }

    const parts = input.split(".");
    if (
      !this.localStorageService.validateOracleName(parts[0], "schema") ||
      !this.localStorageService.validateOracleName(parts[1], "table")
    ) {
      return;
    }

    const results = this.localStorageService.searchSavedSchemas(input);
    this.showSearchDropdown(results);
  }

  handleSearchKeyDown(event) {
    if (this.elements.dropdownContainer.style.display === "none" && event.key === "ArrowDown") {
      const results = this.localStorageService.searchSavedSchemas("").slice(0, 7);
      this.showSearchDropdown(results);
      this.searchState.selectedIndex = -1;
      return;
    }

    if (this.elements.dropdownContainer.style.display === "block") {
      this.handleDropdownNavigation(event);
    }
  }

  showSearchDropdown(results) {
    const dropdownContainer = this.elements.dropdownContainer;
    dropdownContainer.innerHTML = "";
    this.searchState.visibleItems = [];
    this.searchState.selectedIndex = -1;

    if (results.length === 0) {
      dropdownContainer.style.display = "none";
      return;
    }

    const groupedResults = results.reduce((groups, table) => {
      if (!groups[table.schemaName]) {
        groups[table.schemaName] = [];
      }
      groups[table.schemaName].push(table);
      return groups;
    }, {});

    Object.entries(groupedResults).forEach(([schemaName, tables]) => {
      const schemaGroup = document.createElement("div");
      schemaGroup.className = "schema-group";

      const schemaHeader = document.createElement("div");
      schemaHeader.className = "schema-header";
      schemaHeader.textContent = schemaName;
      schemaGroup.appendChild(schemaHeader);

      tables.forEach((table) => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        item.textContent = table.tableName;

        // Store the full table name for easy access
        item.dataset.fullName = table.fullName;

        // Add to visible items array for keyboard navigation
        this.searchState.visibleItems.push(item);

        item.addEventListener("click", () => this.selectSearchResult(table.fullName));

        schemaGroup.appendChild(item);
      });

      dropdownContainer.appendChild(schemaGroup);
    });

    dropdownContainer.style.display = "block";
  }

  selectSearchResult(fullName) {
    this.elements.tableNameInput.value = fullName;
    this.elements.dropdownContainer.style.display = "none";
    this.handleLoadSchema(fullName);

    // Reset selection
    this.searchState.selectedIndex = -1;
    this.elements.tableNameInput.focus();
  }

  handleDropdownNavigation(event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.searchState.selectedIndex = Math.min(this.searchState.selectedIndex + 1, this.searchState.visibleItems.length - 1);
        this.updateSearchSelection();
        break;

      case "ArrowUp":
        event.preventDefault();
        this.searchState.selectedIndex = Math.max(this.searchState.selectedIndex - 1, -1);
        this.updateSearchSelection();
        break;

      case "Enter":
        event.preventDefault();
        if (this.searchState.selectedIndex >= 0 && this.searchState.selectedIndex < this.searchState.visibleItems.length) {
          this.selectSearchResult(this.searchState.visibleItems[this.searchState.selectedIndex].dataset.fullName);
        }
        break;

      case "Escape":
        this.elements.dropdownContainer.style.display = "none";
        this.searchState.selectedIndex = -1;
        break;
    }
  }

  updateSearchSelection() {
    this.searchState.visibleItems.forEach((item, index) => {
      if (index === this.searchState.selectedIndex) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }

  loadMostRecentSchema() {
    const allTables = this.localStorageService.getAllTables();
    if (allTables.length > 0) {
      const mostRecent = allTables[0];
      this.handleLoadSchema(mostRecent.fullName);
    }
  }

  async handleSchemaFileInput(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);

      if (!this.isValidSchemaFormat(jsonData)) {
        throw new Error("Invalid schema format");
      }

      let importCount = 0;
      Object.entries(jsonData).forEach(([schemaName, tables]) => {
        Object.entries(tables).forEach(([tableName, schema]) => {
          const fullTableName = `${schemaName}.${tableName}`;
          if (this.localStorageService.saveSchema(fullTableName, schema)) {
            importCount++;
          }
        });
      });

      this.updateSavedSchemasList();
      this.showSuccess(`Successfully imported ${importCount} table schemas`);
      setTimeout(() => this.clearError(), 3000);
    } catch (error) {
      this.showError(`Failed to import schemas: ${error.message}`);
    } finally {
      event.target.value = ""; // Reset file input
    }
  }

  isValidSchemaFormat(data) {
    if (!data || typeof data !== "object") return false;

    return Object.entries(data).every(([schemaName, tables]) => {
      if (typeof tables !== "object") return false;

      return Object.entries(tables).every(([tableName, schema]) => {
        return (
          Array.isArray(schema) &&
          schema.every(
            (row) =>
              Array.isArray(row) &&
              row.length >= 3 && // At least name, type, and nullable
              typeof row[0] === "string" &&
              typeof row[1] === "string" &&
              typeof row[2] === "string"
          )
        );
      });
    });
  }

  adjustDbeaverSchema(schemaData) {
    console.log("Adjusting schema data");

    // Remove the header row
    const removedHeader = schemaData.slice(1);

    // Transform the data
    const adjustedSchemaData = removedHeader.map((row) => {
      // Original DBeaver format:
      // [0]: Column Name
      // [1]: Column Type
      // [2]: Type Name
      // [3]: Column Size
      // [4]: Nullable
      // [5]: Default Value
      // [6]: Comments

      // Transform nullable from TRUE/FALSE to No/Yes
      const nullable = String(row[4]).toLowerCase() === "true" ? "No" : "Yes";

      // Transform [NULL] to empty string
      const defaultValue = row[5] === "[NULL]" ? "" : row[5];

      return [
        row[0], // [0] Field Name (same as Column Name)
        row[2], // [1] Data Type (use Type Name instead of Column Type)
        nullable, // [2] Nullable/PK
        defaultValue, // [3] Default Value
        row[1] || "", // [4] Field Order (use Column Type as order)
        row[6] || "", // [5] Comments
      ];
    });

    // Update the schemaTable with the new data
    if (this.schemaTable && typeof this.schemaTable.loadData === "function") {
      try {
        // Clear existing data and load new data
        this.handleClearData();
        this.schemaTable.loadData(adjustedSchemaData);
        this.updateDataSpreadsheet();
      } catch (error) {
        console.error("Error updating schema table:", error);
      }
    }
  }

  async handleAttachmentsInput(e) {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      try {
        this.processedFiles = await this.attachmentProcessorService.processAttachments(files);
        console.log("Processed files:", this.processedFiles);

        // Clear existing file buttons
        this.elements.filesContainer.innerHTML = "";
        // Reset file input
        this.elements.attachmentsInput.value = "";

        // Add minify button if there's a text file
        const hasTextFile = this.processedFiles.some((file) => ["txt", "html", "json"].includes(file.name.split(".").pop().toLowerCase()));

        if (hasTextFile) {
          const buttonContainer = document.createElement("div");
          buttonContainer.className = "attachment-actions";

          const minifyButton = document.createElement("button");
          minifyButton.className = "minify-button";
          minifyButton.textContent = "Minify Content";
          minifyButton.addEventListener("click", async () => {
            // Show processing state
            minifyButton.textContent = "Processing...";
            minifyButton.disabled = true;

            // Process files
            this.processedFiles = this.processedFiles.map((file) => {
              const ext = file.name.split(".").pop().toLowerCase();
              if (["txt", "html", "json"].includes(ext)) {
                return this.attachmentProcessorService.minifyContent(file);
              }
              return file;
            });

            // Refresh the file viewer if it's currently open and visible
            const fileViewer = document.getElementById("fileViewerOverlay");
            const isViewerVisible = !fileViewer.classList.contains("hidden");

            if (isViewerVisible) {
              const activeFileName = document.getElementById("fileViewerTitle")?.textContent;
              const activeFile = this.processedFiles.find((f) => f.name === activeFileName);
              if (activeFile) {
                this.showFileViewer(activeFile);
              }
            }

            // Show success message
            minifyButton.textContent = "Content Minified!";

            setTimeout(() => {
              minifyButton.textContent = "Minify Content";
              minifyButton.style.color = "";
              minifyButton.disabled = false;
            }, 1000);
          });
          this.elements.filesContainer.appendChild(minifyButton);

          const deleteAllButton = document.createElement("button");
          deleteAllButton.className = "delete-all-button";
          deleteAllButton.textContent = "Delete All Attachments";
          deleteAllButton.addEventListener("click", () => {
            if (confirm("Are you sure you want to delete all attachments?")) {
              this.processedFiles = [];
              this.elements.filesContainer.innerHTML = "";
              this.elements.filesContainer.classList.add("hidden");
              this.elements.attachmentsContainer.classList.remove("hidden");
            }
          });

          buttonContainer.appendChild(minifyButton);
          buttonContainer.appendChild(deleteAllButton);
          this.elements.filesContainer.appendChild(buttonContainer);
        }

        // Create file buttons for each processed file
        this.processedFiles.forEach((file, index) => {
          const fileButton = document.createElement("button");
          fileButton.className = "file-button";
          fileButton.innerHTML = FILE_BUTTON_TEMPLATE(file);

          const copyBtn = fileButton.querySelector(".copy-filename");
          copyBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent file button click
            navigator.clipboard.writeText(file.name);

            // Visual feedback
            copyBtn.classList.add("copied");
            setTimeout(() => copyBtn.classList.remove("copied"), 1000);
          });

          // Add click handler for the delete button
          const deleteBtn = fileButton.querySelector(".delete-file");
          deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent file button click
            const fileIndex = this.processedFiles.findIndex((f) => f.name === file.name);
            if (fileIndex !== -1) {
              this.processedFiles.splice(fileIndex, 1);
              fileButton.remove();
            }

            // If no files left, show the upload container again
            if (this.processedFiles.length === 0) {
              this.elements.filesContainer.classList.add("hidden");
              this.elements.attachmentsContainer.classList.remove("hidden");
            }
          });

          fileButton.addEventListener("click", () => this.showFileViewer(file));
          this.elements.filesContainer.appendChild(fileButton);
        });

        // Hide attachments container and show files container
        this.elements.attachmentsContainer.classList.add("hidden");
        this.elements.filesContainer.classList.remove("hidden");

        this.clearError();
      } catch (error) {
        this.showError(`Error processing attachments: ${error.message}`);
      }
    }
  }

  showFileViewer(file) {
    const overlay = document.getElementById("fileViewerOverlay");
    const title = document.getElementById("fileViewerTitle");
    const originalContent = document.getElementById("originalContent");
    const processedContent = document.getElementById("processedContent");
    const metadata = document.getElementById("fileMetadata");
    const processedTab = document.querySelector('.tab-button[data-tab="processed"]');

    console.log("File viewer showing for file:", file);
    title.textContent = file.name;

    // Clear previous content
    originalContent.innerHTML = "";
    processedContent.innerHTML = "";

    const metadataElements = {
      fileType: document.getElementById("fileType"),
      fileSize: document.getElementById("fileSize"),
      base64Size: document.getElementById("base64Size"),
      dimensions: document.getElementById("dimensions"),
      lineCount: document.getElementById("lineCount"),
      charCount: document.getElementById("charCount"),
    };

    // clear previous content
    Object.values(metadataElements).forEach((el) => (el.textContent = ""));
    Object.values(metadataElements).forEach((el) => el.classList.add("hidden"));
    // Set common metadata
    metadataElements.fileType.textContent = `File Type: ${file.type}`;
    metadataElements.fileType.classList.remove("hidden");

    // Handle different file types
    if (file.type.startsWith("image/") || file.type === "application/pdf") {
      // Original content (actual file)
      const viewer = document.createElement("div");
      viewer.className = file.type.startsWith("image/") ? "image-viewer" : "pdf-viewer";

      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = file.processedFormats.base64;
        viewer.appendChild(img);

        // Update metadata once image is loaded
        img.onload = () => {
          metadataElements.fileSize.textContent = `Media Size: ${(file.size / 1024).toFixed(2)} KB`;
          metadataElements.base64Size.textContent = `Base64 Size: ${(file.processedFormats.base64.length / 1024).toFixed(2)} KB`;
          metadataElements.dimensions.textContent = `Dimensions: ${img.naturalWidth} × ${img.naturalHeight}`;

          [metadataElements.fileSize, metadataElements.base64Size, metadataElements.dimensions].forEach((el) =>
            el.classList.remove("hidden")
          );
        };
      } else {
        // PDF viewer
        const obj = document.createElement("object");
        obj.data = file.processedFormats.base64;
        obj.type = "application/pdf";
        obj.width = "100%";
        obj.height = "600px";
        viewer.appendChild(obj);

        metadataElements.fileSize.textContent = `Size: ${(file.size / 1024).toFixed(2)} KB`;
        metadataElements.base64Size.textContent = `Base64 Size: ${(file.processedFormats.base64.length / 1024).toFixed(2)} KB`;
        [metadataElements.fileSize, metadataElements.base64Size].forEach((el) => el.classList.remove("hidden"));
      }

      originalContent.appendChild(viewer);

      // Processed content (base64 string)
      const pre = document.createElement("pre");
      pre.className = "base64-content";
      pre.textContent = file.processedFormats.base64;
      processedContent.appendChild(pre);

      // Show both tabs
      processedTab.style.display = "block";
    } else if (file.processedFormats.contentType?.includes("base64")) {
      // For base64 text files: Original = Base64, Processed = Rendered content

      // Original content (base64 text)
      const pre = document.createElement("pre");
      pre.className = "base64-content";
      pre.textContent = file.processedFormats.original;
      originalContent.appendChild(pre);

      // Processed content (rendered base64)
      const viewer = document.createElement("div");
      viewer.className = "rendered-content";

      if (file.processedFormats.base64.startsWith("data:image/")) {
        const img = document.createElement("img");
        img.src = file.processedFormats.base64;
        viewer.appendChild(img);
      } else if (file.processedFormats.base64.startsWith("data:application/pdf")) {
        const obj = document.createElement("object");
        obj.data = file.processedFormats.base64;
        obj.type = "application/pdf";
        viewer.appendChild(obj);
      }

      processedContent.appendChild(viewer);

      // Show both tabs
      processedTab.style.display = "block";

      metadataElements.fileSize.textContent = `Original Media Size: ${(file.processedFormats.sizes.original / 1024).toFixed(2)} KB`;
      if (file.processedFormats.base64) {
        metadataElements.base64Size.textContent = `Base64 Size: ${(file.processedFormats.base64.length / 1024).toFixed(2)} KB`;
        metadataElements.base64Size.classList.remove("hidden");
      }
      metadataElements.fileSize.classList.remove("hidden");
    } else {
      // For regular text files (txt, json, html): Only show original
      const pre = document.createElement("pre");
      pre.className = "text-content";
      pre.textContent = file.processedFormats.original;
      originalContent.appendChild(pre);

      const textLength = file.processedFormats.original.length;
      const lineCount = (file.processedFormats.original.match(/\n/g) || []).length + 1;

      metadataElements.fileSize.textContent = `Size: ${(textLength / 1024).toFixed(2)} KB`;
      metadataElements.lineCount.textContent = `Lines: ${lineCount}`;
      metadataElements.charCount.textContent = `Characters: ${textLength}`;

      [metadataElements.fileSize, metadataElements.lineCount, metadataElements.charCount].forEach((el) => el.classList.remove("hidden"));

      // Hide processed tab
      processedTab.style.display = "none";
    }

    // Show overlay and set initial state
    overlay.classList.remove("hidden");
    document.querySelector('.tab-button[data-tab="original"]').classList.add("active");
    document.getElementById("originalContent").classList.add("active");

    // Add tab switching functionality
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.onclick = () => {
        document.querySelectorAll(".tab-button").forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");

        document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
        document.getElementById(`${button.dataset.tab}Content`).classList.add("active");
      };
    });

    // Add close button handler
    document.getElementById("closeFileViewer").onclick = () => {
      overlay.classList.add("hidden");
    };
  }

  showFilePreview() {
    this.elements.filePreviewOverlay.classList.remove("hidden");
  }
  closeFilePreview() {
    this.elements.filePreviewOverlay.classList.add("hidden");
  }

  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    this.attachmentsContainer.classList.add("drag-over");
  }

  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    this.attachmentsContainer.classList.remove("drag-over");
  }

  handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.attachmentsContainer.classList.remove("drag-over");
  }
}

// Export the main initialization function
export async function initQuickQuery(container) {
  return new QuickQueryUI(container);
}
