import { ExcelImportService } from "../quick-query/services/ExcelImportService.js";
import { IndexedDBStorageService } from "../quick-query/services/IndexedDBStorageService.js";
import { QueryGenerationService } from "../quick-query/services/QueryGenerationService.js";
import { QueryWorkerService } from "../quick-query/services/QueryWorkerService.js";
import { SchemaValidationService } from "../quick-query/services/SchemaValidationService.js";

const EXCEL_EXTENSION_REGEX = /\.(xlsx|xls)$/i;

export class QuerifyService {
  constructor(options = {}) {
    this.storageService = options.storageService || new IndexedDBStorageService();
    this.excelImportServiceFactory = options.excelImportServiceFactory || (() => new ExcelImportService());
    this.schemaValidationService = options.schemaValidationService || new SchemaValidationService();
    this.queryGenerationService = options.queryGenerationService || new QueryGenerationService();
    this.queryWorkerService = options.queryWorkerService || new QueryWorkerService();
    this.defaultGenerationOptions = options.defaultGenerationOptions || { defaultSysdate: true };
    this._storageReady = false;
  }

  async init() {
    if (this._storageReady) return;
    if (typeof this.storageService.init === "function") {
      await this.storageService.init();
    }
    this._storageReady = true;
  }

  parseExcelFileName(fileName) {
    const name = String(fileName || "").trim();
    if (!EXCEL_EXTENSION_REGEX.test(name)) {
      throw new Error("Only .xlsx and .xls files are supported.");
    }

    const tableIdentifier = name.replace(EXCEL_EXTENSION_REGEX, "");
    const parts = tableIdentifier.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error('Excel filename must use "schema_name.table_name.xlsx".');
    }

    return {
      fileName: name,
      requestedFullName: tableIdentifier,
      lookupKey: this.normalizeFullName(tableIdentifier),
      schemaName: parts[0],
      tableName: parts[1],
    };
  }

  normalizeFullName(fullName) {
    return String(fullName || "").trim().toLowerCase();
  }

  async buildSchemaLookup() {
    await this.init();
    const tables = await this.storageService.getAllTables();
    const lookup = new Map();

    for (const table of tables || []) {
      const fullName = table?.fullName || (table?.schemaName && table?.tableName ? `${table.schemaName}.${table.tableName}` : "");
      if (!fullName) continue;

      const key = this.normalizeFullName(fullName);
      const existing = lookup.get(key) || [];
      existing.push({ ...table, fullName });
      lookup.set(key, existing);
    }

    return lookup;
  }

  resolveSchemaRecord(parsedFileName, schemaLookup) {
    const matches = schemaLookup.get(parsedFileName.lookupKey) || [];
    if (matches.length === 0) {
      throw new Error(`Schema not found in Quick Query: ${parsedFileName.requestedFullName}`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple saved schemas match ${parsedFileName.requestedFullName}. Please keep only one casing variant.`);
    }
    return matches[0];
  }

  async generateFile(file, queryType = "merge", options = {}) {
    const parsedFileName = this.parseExcelFileName(file?.name);
    const schemaLookup = options.schemaLookup || (await this.buildSchemaLookup());
    const schemaRecord = this.resolveSchemaRecord(parsedFileName, schemaLookup);
    const schemaData = await this.storageService.loadSchema(schemaRecord.fullName);

    if (!schemaData || !Array.isArray(schemaData) || schemaData.length === 0) {
      throw new Error(`Schema not found in Quick Query: ${parsedFileName.requestedFullName}`);
    }

    const excelImportService = this.excelImportServiceFactory();
    const imported = file?.uint8Array
      ? excelImportService.processFromUint8Array(file.uint8Array)
      : await excelImportService.processFromFile(file);
    const inputData = [imported.header, ...imported.data];
    const generationOptions = {
      ...this.defaultGenerationOptions,
      ...(options.generationOptions || {}),
    };

    this.schemaValidationService.validateSchema(schemaData, schemaRecord.fullName);
    this.schemaValidationService.matchSchemaWithData(schemaData, inputData);

    if (this.queryWorkerService.shouldUseWorker(inputData)) {
      const result = await this.queryWorkerService.generateQuery(
        schemaRecord.fullName,
        queryType,
        schemaData,
        inputData,
        [],
        generationOptions,
        options.onProgress || null,
      );

      return {
        fileName: file.name,
        tableName: schemaRecord.fullName,
        queryType,
        sql: result.sql,
        rowCount: result.rowCount,
        duplicateResult: result.duplicateResult || null,
        usedWorker: true,
      };
    }

    const sql = this.queryGenerationService.generateQuery(schemaRecord.fullName, queryType, schemaData, inputData, [], generationOptions);
    const duplicateResult = this.queryGenerationService.detectDuplicatePrimaryKeys(schemaData, inputData, schemaRecord.fullName);

    return {
      fileName: file.name,
      tableName: schemaRecord.fullName,
      queryType,
      sql,
      rowCount: inputData.length - 1,
      duplicateResult,
      usedWorker: false,
    };
  }

  buildCombinedSql(results) {
    return (results || [])
      .filter((result) => result?.status === "success" && result.sql)
      .map((result) => {
        const label = result.tableName || result.fileName || "unknown";
        return [`-- BEGIN ${label}`, result.sql.trim(), `-- END ${label}`].join("\n");
      })
      .join("\n\n");
  }

  dispose() {
    this.queryWorkerService?.terminate?.();
  }
}
