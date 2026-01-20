import { ValueProcessorService } from "./ValueProcessorService.js";
import { oracleReservedWords } from "../constants.js";
import { AttachmentValidationService } from "./AttachmentValidationService.js";
import { UsageTracker } from "../../../core/UsageTracker.js";

export class QueryGenerationService {
  constructor() {
    this.ValueProcessorService = new ValueProcessorService();
    this.attachmentValidationService = new AttachmentValidationService();
  }

  /**
   * Validate an Oracle identifier (table name, column name, schema name).
   * Oracle identifiers must:
   * - Start with a letter
   * - Contain only letters, digits, underscore (_), dollar ($), or hash (#)
   * - Be at most 128 characters
   * - Not contain semicolons, quotes, or whitespace (SQL injection prevention)
   *
   * @param {string} name - The identifier to validate
   * @param {string} type - Type of identifier for error messages ('table name', 'column name', etc.)
   * @returns {boolean} True if valid
   * @throws {Error} If invalid with descriptive message
   */
  validateOracleIdentifier(name, type = "identifier") {
    if (!name || typeof name !== "string") {
      throw new Error(`Invalid ${type}: must be a non-empty string`);
    }

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error(`Invalid ${type}: cannot be empty`);
    }

    if (trimmed.length > 128) {
      throw new Error(`Invalid ${type}: "${trimmed}" exceeds maximum length of 128 characters`);
    }

    // Check for dangerous characters (SQL injection prevention)
    if (/[;'"\\`\r\n\t]/.test(trimmed)) {
      UsageTracker.trackEvent("quick-query", "validation_error", {
        type: "dangerous_chars_in_identifier",
        identifier_type: type,
        table_name: trimmed,
      });
      throw new Error(`Invalid ${type}: "${trimmed}" contains forbidden characters (semicolons, quotes, or escape characters)`);
    }

    // For qualified names (schema.table), validate each part separately
    if (trimmed.includes(".")) {
      const parts = trimmed.split(".");
      if (parts.length !== 2) {
        throw new Error(`Invalid ${type}: "${trimmed}" must be in format SCHEMA.TABLE (only one dot allowed)`);
      }
      // Validate each part individually
      this._validateIdentifierPart(parts[0], `schema name in ${type}`);
      this._validateIdentifierPart(parts[1], `table name in ${type}`);
      return true;
    }

    // Validate single identifier
    this._validateIdentifierPart(trimmed, type);
    return true;
  }

  /**
   * Validate a single identifier part (no dots).
   * @private
   */
  _validateIdentifierPart(part, type) {
    if (!part || part.length === 0) {
      throw new Error(`Invalid ${type}: cannot be empty`);
    }

    // Oracle identifier pattern: starts with letter, followed by letters, digits, _, $, #
    const identifierPattern = /^[A-Za-z][A-Za-z0-9_$#]*$/;
    if (!identifierPattern.test(part)) {
      throw new Error(
        `Invalid ${type}: "${part}" must start with a letter and contain only letters, digits, underscore (_), dollar ($), or hash (#)`
      );
    }

    return true;
  }

  /**
   * Convert column index to Excel-style column letter (A, B, ..., Z, AA, AB, ...)
   * @param {number} index - Zero-based column index
   * @returns {string} Excel-style column letter
   */
  columnIndexToLetter(index) {
    let letter = "";
    while (index >= 0) {
      letter = String.fromCharCode(65 + (index % 26)) + letter;
      index = Math.floor(index / 26) - 1;
    }
    return letter;
  }

  detectDuplicatePrimaryKeys(schemaData, inputData, tableName) {
    // 1. Get primary keys
    const primaryKeys = this.ValueProcessorService.findPrimaryKeys(schemaData, tableName);
    if (primaryKeys.length === 0) {
      return { hasDuplicates: false, duplicates: [], warningMessage: null };
    }

    // 2. Get field names from first row of input data
    const fieldNames = inputData[0].map((name) => name);

    // 3. Get data rows (excluding header row)
    const dataRows = inputData.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== ""));

    // 4. Find indices of primary key columns
    const pkIndices = primaryKeys.map((pk) => {
      const index = fieldNames.indexOf(pk);
      if (index === -1) {
        UsageTracker.trackEvent("quick-query", "generation_error", { type: "pk_field_missing", pk, table_name: tableName });
        throw new Error(`Primary key field '${pk}' not found in data columns`);
      }
      return { field: pk, index };
    });

    // 5. Track primary key combinations and their row numbers
    const pkCombinations = new Map();
    const duplicates = [];

    dataRows.forEach((row, rowIndex) => {
      // Extract primary key values for this row
      const pkValues = pkIndices.map(({ field, index }) => {
        const value = row[index];
        // Normalize null/empty values
        return value === null || value === undefined || value === "" ? "NULL" : String(value).trim();
      });

      // Skip rows where any primary key value is null/empty
      if (pkValues.some((val) => val === "NULL")) {
        return;
      }

      // Filter out rows containing "uuid" or "max" in any primary key value (case-insensitive)
      const hasFilteredStrings = pkValues.some((val) => {
        const lowerVal = val.toLowerCase();
        return lowerVal.includes("uuid") || lowerVal.includes("max");
      });

      if (hasFilteredStrings) {
        return; // Skip this row
      }

      // Create a unique key from primary key combination
      const pkKey = pkValues.join("|");
      const actualRowNumber = rowIndex + 2; // +2 because we skip header row and use 1-based indexing

      if (pkCombinations.has(pkKey)) {
        // Found duplicate - add to existing entry
        const existing = pkCombinations.get(pkKey);
        existing.rows.push(actualRowNumber);

        // Add to duplicates array if this is the first time we detect this duplicate
        if (existing.rows.length === 2) {
          duplicates.push({
            pkValues: pkValues,
            pkFields: primaryKeys,
            rows: [...existing.rows],
          });
        } else {
          // Update existing duplicate entry
          const duplicateEntry = duplicates.find((d) => d.pkValues.join("|") === pkKey);
          if (duplicateEntry) {
            duplicateEntry.rows = [...existing.rows];
          }
        }
      } else {
        // First occurrence of this primary key combination
        pkCombinations.set(pkKey, {
          pkValues: pkValues,
          rows: [actualRowNumber],
        });
      }
    });

    // Generate warning message if duplicates found
    let warningMessage = null;
    if (duplicates.length > 0) {
      const MAX_ROWS_TO_SHOW = 5;
      const warningMessages = duplicates
        .map((duplicate) => {
          const pkDescription =
            duplicate.pkFields.length === 1
              ? `Primary key '${duplicate.pkFields[0]}'`
              : `Primary key combination (${duplicate.pkFields.join(", ")})`;
          const valueDescription =
            duplicate.pkValues.length === 1 ? `value '${duplicate.pkValues[0]}'` : `values (${duplicate.pkValues.join(", ")})`;

          // Truncate row list if too many
          let rowsText;
          if (duplicate.rows.length <= MAX_ROWS_TO_SHOW) {
            rowsText = duplicate.rows.join(", ");
          } else {
            const visibleRows = duplicate.rows.slice(0, MAX_ROWS_TO_SHOW).join(", ");
            const remainingCount = duplicate.rows.length - MAX_ROWS_TO_SHOW;
            rowsText = `${visibleRows} and ${remainingCount} more rows`;
          }

          return `${pkDescription} with ${valueDescription} appears multiple times on rows: ${rowsText}`;
        })
        .join("<br>");

      const totalAffectedRows = duplicates.reduce((sum, d) => sum + d.rows.length, 0);
      warningMessage = {
        summary: `Warning: Duplicate primary keys detected (${totalAffectedRows} rows affected)`,
        details: warningMessages,
        note: "This may cause unexpected behavior.",
      };
    }

    return {
      hasDuplicates: duplicates.length > 0,
      duplicates: duplicates,
      warningMessage: warningMessage,
    };
  }

  generateQuery(tableName, queryType, schemaData, inputData, attachments) {
    // 0. Validate table name to prevent SQL injection
    this.validateOracleIdentifier(tableName, "table name");

    // 1. Get field names from first row of input data
    const fieldNames = inputData[0].map((name) => String(name || "").trim());

    // Validate all field names
    fieldNames.forEach((fieldName, index) => {
      if (fieldName) {
        try {
          this.validateOracleIdentifier(fieldName, "column name");
        } catch (error) {
          const columnLetter = this.columnIndexToLetter(index);
          throw new Error(`Column ${columnLetter}: ${error.message}`);
        }
      }
    });

    // 2. Get data rows (excluding header row)
    const dataRows = inputData.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== ""));

    // 3. Map schema with field name as key
    const schemaMap = new Map(schemaData.map((row) => [row[0], row]));

    // 4. Process each row of data
    const processedRows = dataRows.map((rowData, rowIndex) => {
      try {
        // For each field in the row
        return fieldNames.map((fieldName, colIndex) => {
          try {
            // Get the schema definition for this field
            const schemaRow = schemaMap.get(fieldName);

            // Validate schema row exists for this field
            if (!schemaRow) {
              const columnLetter = this.columnIndexToLetter(colIndex);
              throw new Error(
                `Column "${fieldName}" (column ${columnLetter}) exists in data but not in schema definition. ` +
                  `Please add this field to the schema or remove it from the data.`
              );
            }

            // Extract dataType and nullable from schema
            const [, dataType, nullable] = schemaRow;
            // Get the actual value from the data
            let value = rowData[colIndex];

            // Check if value matches any attachment
            const attachmentValue = this.attachmentValidationService.validateAttachment(
              value,
              dataType.replace(/\([^)]*\)/g, ""), // Remove any length specifiers (e.g., VARCHAR(100) -> VARCHAR)
              this.getMaxLength(dataType),
              attachments,
              tableName
            );

            // Use attachment value if found, otherwise use original value
            value = attachmentValue !== null ? attachmentValue : value;

            // Return formatted object
            return {
              fieldName,
              formattedValue: this.ValueProcessorService.processValue(value, dataType, nullable, fieldName, tableName, queryType),
            };
          } catch (fieldError) {
            // Convert column index to Excel-style letter (A, B, ..., Z, AA, AB, ...)
            const columnLetter = this.columnIndexToLetter(colIndex);
            throw new Error(`Error in Cell ${columnLetter}${rowIndex + 2}, Field "${fieldName}":<br>${fieldError.message}`);
          }
        });
      } catch (error) {
        // If the error already has our format, just re-throw it
        throw error;
      }
    });

    // 6. Find primary keys for MERGE statements
    const primaryKeys = this.ValueProcessorService.findPrimaryKeys(schemaData, tableName);

    // 7. Generate SQL based on query type using Array.join() for O(n) performance
    const queryParts = [`SET DEFINE OFF;`];

    if (queryType === "insert") {
      for (const processedFields of processedRows) {
        queryParts.push(this.generateInsertStatement(tableName, processedFields));
      }
    } else if (queryType === "update") {
      queryParts.push(this.generateUpdateStatement(tableName, processedRows, primaryKeys, fieldNames, schemaData));
    } else {
      for (const processedFields of processedRows) {
        queryParts.push(this.generateMergeStatement(tableName, processedFields, primaryKeys));
      }
    }

    // 8. Add select query to verify results
    const selectQuery = this.generateSelectStatement(tableName, primaryKeys, processedRows, schemaData);

    if (selectQuery) {
      queryParts.push(selectQuery);
    }

    return queryParts.join("\n\n");
  }

  generateInsertStatement(tableName, processedFields) {
    const fields = processedFields.map((f) => this.formatFieldName(f.fieldName));
    const values = processedFields.map((f) => f.formattedValue);

    return `INSERT INTO ${tableName} (${fields.join(", ")}) \nVALUES (${values.join(", ")});`;
  }

  generateMergeStatement(tableName, processedFields, primaryKeys) {
    // Format fields for SELECT part
    const selectFields = processedFields.map((f) => `\n  ${f.formattedValue} AS ${this.formatFieldName(f.fieldName)}`).join(",");

    // Format ON conditions for primary keys
    const pkConditions = primaryKeys.map((pk) => `tgt.${this.formatFieldName(pk)} = src.${this.formatFieldName(pk)}`).join(" AND ");

    // Format UPDATE SET clause (excluding PKs and creation fields)
    const updateFieldsList = processedFields
      // lowercase comparison is mandatory, we want to exclude created field ignoring case
      .filter((f) => !primaryKeys.includes(f.fieldName) && !["created_time", "created_by"].includes(String(f.fieldName).toLowerCase()));

    // Format INSERT fields and values (excluding primary keys as per Oracle SQL conventions)
    const insertFields = processedFields.map((f) => this.formatFieldName(f.fieldName)).join(", ");
    const insertValues = processedFields.map((f) => `src.${this.formatFieldName(f.fieldName)}`).join(", ");

    let mergeStatement = `MERGE INTO ${tableName} tgt`;
    mergeStatement += `\nUSING (SELECT${selectFields}\n  FROM DUAL) src`;
    mergeStatement += `\nON (${pkConditions})`;

    // Only include WHEN MATCHED clause if there are fields to update
    if (updateFieldsList.length > 0) {
      const updateFields = updateFieldsList
        .map((f) => `  tgt.${this.formatFieldName(f.fieldName)} = src.${this.formatFieldName(f.fieldName)}`)
        .join(",\n");
      mergeStatement += `\nWHEN MATCHED THEN UPDATE SET\n${updateFields}`;
    }

    mergeStatement += `\nWHEN NOT MATCHED THEN INSERT (${insertFields})\nVALUES (${insertValues});`;

    return mergeStatement;
  }

  generateUpdateStatement(tableName, processedRows, primaryKeys, fieldNames = [], schemaData = []) {
    // Collect all unique fields being updated across all rows (table scope)
    const allUpdatedFields = new Set();
    // Collect PK tuples for composite key WHERE clause (instead of separate IN clauses)
    const pkTuples = [];

    // Check if updated_time/updated_by exist in schema
    const schemaFieldNames = new Set(schemaData.map((row) => String(row[0]).toLowerCase()));
    const hasUpdatedTime = schemaFieldNames.has("updated_time");
    const hasUpdatedBy = schemaFieldNames.has("updated_by");

    // Process each row to collect updated fields and primary key tuples
    processedRows.forEach((row) => {
      // Collect PK tuple for this row
      const rowPkValues = primaryKeys.map((pk) => {
        const field = row.find((f) => f.fieldName === pk);
        return field?.formattedValue || null;
      });
      // Only add tuple if all PKs have valid values
      const allPksValid = rowPkValues.every((v) => v && v !== "NULL" && v !== null);
      if (allPksValid) {
        pkTuples.push(rowPkValues);
      }

      row.forEach((field) => {
        // Collect non-primary key fields that are being updated (excluding audit fields)
        if (
          !primaryKeys.includes(field.fieldName) &&
          !["created_time", "created_by", "updated_time", "updated_by"].includes(String(field.fieldName).toLowerCase()) &&
          field.formattedValue !== null &&
          field.formattedValue !== undefined
        ) {
          allUpdatedFields.add(String(field.fieldName).toLowerCase());
        }
      });
    });

    // Validate that we have primary key values
    if (pkTuples.length === 0) {
      UsageTracker.trackEvent("quick-query", "generation_error", { type: "missing_pk_for_update", table_name: tableName });
      throw new Error("Primary key values are required for UPDATE operation.");
    }

    // Validate that we have fields to update
    if (allUpdatedFields.size === 0) {
      UsageTracker.trackEvent("quick-query", "generation_error", { type: "no_fields_to_update", table_name: tableName });
      throw new Error("No fields to update. Please provide at least one non-primary-key field with a value.");
    }

    // Add audit fields only if they exist in schema
    if (hasUpdatedTime) allUpdatedFields.add("updated_time");
    if (hasUpdatedBy) allUpdatedFields.add("updated_by");

    // Build UPDATE SET clause for each row
    const updateStatements = [];
    processedRows.forEach((row, rowIndex) => {
      const updateFields = row
        .filter((f) => {
          if (primaryKeys.includes(f.fieldName)) return false;
          if (["created_time", "created_by"].includes(String(f.fieldName).toLowerCase())) return false;
          if (f.formattedValue === null) return false;
          return f.formattedValue !== undefined;
        })
        .map((f) => `  ${this.formatFieldName(f.fieldName)} = ${f.formattedValue}`);

      if (updateFields.length > 0) {
        const pkConditions = primaryKeys
          .map((pk) => {
            const pkField = row.find((f) => f.fieldName === pk);
            if (!pkField || pkField.formattedValue === null || pkField.formattedValue === "NULL" || !pkField.formattedValue) {
              // Find column index for this primary key field
              const colIndex = fieldNames.indexOf(pk);
              const columnLetter = colIndex >= 0 ? this.columnIndexToLetter(colIndex) : "?";

              UsageTracker.trackEvent("quick-query", "generation_error", {
                type: "pk_missing_in_row",
                row: rowIndex + 2,
                column: columnLetter,
                pk,
                table_name: tableName,
              });
              throw new Error(
                `Error in Cell ${columnLetter}${rowIndex + 2}, Field "${pk}": Primary key must have a value for UPDATE operation.`
              );
            }
            return `${this.formatFieldName(pk)} = ${pkField.formattedValue}`;
          })
          .join(" AND ");

        updateStatements.push(`UPDATE ${tableName}\nSET\n${updateFields.join(",\n")}\nWHERE ${pkConditions};`);
      }
    });

    // Create field list for SELECT statements (table scope)
    const selectFieldNames = Array.from(allUpdatedFields).map((f) => this.formatFieldName(f));

    // Build WHERE clause for SELECT statements using tuple-based composite key matching
    const allPkConditions = this._buildCompositePkWhereClause(primaryKeys, pkTuples);

    // Generate the 3-part UPDATE statement
    let updateStatement = "-- Selected fields before update\n";
    updateStatement += `SELECT ${selectFieldNames.join(", ")}\nFROM ${tableName} WHERE ${allPkConditions};\n\n`;

    updateStatement += updateStatements.join("\n\n") + "\n\n";

    updateStatement += "-- Selected fields after update\n";
    updateStatement += `SELECT ${selectFieldNames.join(", ")}\nFROM ${tableName} WHERE ${allPkConditions};`;

    return updateStatement;
  }

  /**
   * Build a WHERE clause for composite primary keys using tuple-IN syntax.
   * For single PK: pk IN (v1, v2, v3)
   * For composite PK: (pk1, pk2) IN ((v1a, v1b), (v2a, v2b))
   * @param {string[]} primaryKeys - Array of primary key field names
   * @param {Array<Array<string>>} pkTuples - Array of PK value tuples, each tuple matching primaryKeys order
   * @returns {string} WHERE clause condition
   */
  _buildCompositePkWhereClause(primaryKeys, pkTuples) {
    if (pkTuples.length === 0) return "1=0"; // No valid tuples

    const formattedPkNames = primaryKeys.map((pk) => this.formatFieldName(pk));

    if (primaryKeys.length === 1) {
      // Single PK: use simple IN clause
      const values = pkTuples.map((tuple) => tuple[0]);
      return `${formattedPkNames[0]} IN (${values.join(", ")})`;
    }

    // Composite PK: use tuple-IN syntax (Oracle row value constructor)
    // WHERE (pk1, pk2) IN ((v1, v2), (v3, v4))
    const tupleStrings = pkTuples.map((tuple) => `(${tuple.join(", ")})`);
    return `(${formattedPkNames.join(", ")}) IN (${tupleStrings.join(", ")})`;
  }

  generateSelectStatement(tableName, primaryKeys, processedRows, schemaData = []) {
    if (primaryKeys.length === 0) return null;
    if (processedRows.length === 0) return null;

    // Check if updated_time exists in schema
    const schemaFieldNames = new Set(schemaData.map((row) => String(row[0]).toLowerCase()));
    const hasUpdatedTime = schemaFieldNames.has("updated_time");

    // Collect PK tuples for composite key WHERE clause
    const pkTuples = [];
    let hasRunningNumberPK = false;

    // Go through each processed row to collect PK value tuples
    processedRows.forEach((row) => {
      const rowPkValues = primaryKeys.map((pk) => {
        const field = row.find((f) => f.fieldName === pk);
        return field?.formattedValue || null;
      });

      // Check for running number PKs (subquery like SELECT MAX...)
      const hasRunningNumber = rowPkValues.some((v) => v && v.startsWith("(SELECT"));
      if (hasRunningNumber) {
        hasRunningNumberPK = true;
        return;
      }

      // Only add tuple if all PKs have valid non-NULL values
      const allPksValid = rowPkValues.every((v) => v && v !== "NULL" && v !== null);
      if (allPksValid) {
        pkTuples.push(rowPkValues);
      }
    });

    const rowCount = processedRows.length;

    // If any PK is a running number, use FETCH FIRST approach instead of WHERE IN
    if (hasRunningNumberPK) {
      // Use updated_time for ordering only if it exists in schema
      const orderByField = hasUpdatedTime ? "updated_time" : primaryKeys[0].toLowerCase();
      let selectStatement = `\nSELECT * FROM ${tableName} ORDER BY ${orderByField} DESC FETCH FIRST ${rowCount} ROWS ONLY;`;
      if (hasUpdatedTime) {
        selectStatement += `\nSELECT ${primaryKeys
          .map((pk) => pk.toLowerCase())
          .join(", ")}, updated_time FROM ${tableName} WHERE updated_time >= SYSDATE - INTERVAL '5' MINUTE;`;
      }
      return selectStatement;
    }

    // If no valid PK tuples found, return null
    if (pkTuples.length === 0) return null;

    // Build WHERE clause using tuple-based composite key matching
    const whereClause = this._buildCompositePkWhereClause(primaryKeys, pkTuples);

    // Use updated_time for ordering only if it exists in schema
    const orderByClause = processedRows.length > 1 && hasUpdatedTime ? " ORDER BY updated_time ASC" : "";
    let selectStatement = `\nSELECT * FROM ${tableName} WHERE ${whereClause}${orderByClause};`;
    if (hasUpdatedTime) {
      selectStatement += `\nSELECT ${primaryKeys
        .map((pk) => pk.toLowerCase())
        .join(", ")}, updated_time FROM ${tableName} WHERE updated_time >= SYSDATE - INTERVAL '5' MINUTE;`;
    }
    return selectStatement;
  }

  formatFieldName(fieldName) {
    if (fieldName === fieldName.toLowerCase()) {
      return oracleReservedWords.has(fieldName.toLowerCase()) ? `"${fieldName.toLowerCase()}"` : fieldName;
    }
    return fieldName.toLowerCase();
  }

  getMaxLength(dataType) {
    const match = dataType.match(/\((\d+)(?:\s*\w+)?\)/);
    return match ? parseInt(match[1]) : null;
  }
}
