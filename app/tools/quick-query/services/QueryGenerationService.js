import { ValueProcessorService } from "./ValueProcessorService.js";
import { oracleReservedWords } from "../constants.js";
import { AttachmentValidationService } from "./AttachmentValidationService.js";

export class QueryGenerationService {
  constructor() {
    this.ValueProcessorService = new ValueProcessorService();
    this.attachmentValidationService = new AttachmentValidationService();
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
      const warningMessages = duplicates
        .map((duplicate) => {
          const pkDescription =
            duplicate.pkFields.length === 1
              ? `Primary key '${duplicate.pkFields[0]}'`
              : `Primary key combination (${duplicate.pkFields.join(", ")})`;
          const valueDescription =
            duplicate.pkValues.length === 1 ? `value '${duplicate.pkValues[0]}'` : `values (${duplicate.pkValues.join(", ")})`;
          return `${pkDescription} with ${valueDescription} appears multiple times on rows: ${duplicate.rows.join(", ")}<br>`;
        })
        .join("\n");

      warningMessage = `Warning: Duplicate primary keys detected:<br>${warningMessages}This may cause unexpected behavior.`;
    }

    return {
      hasDuplicates: duplicates.length > 0,
      duplicates: duplicates,
      warningMessage: warningMessage,
    };
  }

  generateQuery(tableName, queryType, schemaData, inputData, attachments) {
    // 1. Get field names from first row of input data
    const fieldNames = inputData[0].map((name) => name);
    console.log("Field names extracted", fieldNames);

    // 2. Get data rows (excluding header row)
    const dataRows = inputData.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== ""));
    console.log("Data rows extracted");

    // 3. Map schema with field name as key
    const schemaMap = new Map(schemaData.map((row) => [row[0], row]));
    console.log("Schema Map:", schemaMap);

    // 4. Process each row of data
    const processedRows = dataRows.map((rowData, rowIndex) => {
      try {
        // For each field in the row
        return fieldNames.map((fieldName, colIndex) => {
          // Get the schema definition for this field
          const schemaRow = schemaMap.get(fieldName);

          // Extract dataType and nullable from schema
          const [, dataType, nullable] = schemaRow;
          // Get the actual value from the data
          let value = rowData[colIndex];

          // Check if value matches any attachment
          const attachmentValue = this.attachmentValidationService.validateAttachment(
            value,
            dataType,
            this.getMaxLength(dataType),
            attachments
          );

          // Use attachment value if found, otherwise use original value
          value = attachmentValue !== null ? attachmentValue : value;

          // Return formatted object
          return {
            fieldName,
            formattedValue: this.ValueProcessorService.processValue(value, dataType, nullable, fieldName, tableName, queryType),
          };
        });
      } catch (error) {
        throw new Error(`Row ${rowIndex + 2}: ${error.message}`);
      }
    });

    console.log("Data processed", processedRows);

    // 6. Find primary keys for MERGE statements
    const primaryKeys = this.ValueProcessorService.findPrimaryKeys(schemaData, tableName);
    console.log("Primary keys found:", primaryKeys);

    // 7. Generate SQL based on query type
    let query = `SET DEFINE OFF;\n\n`;

    if (queryType === "insert") {
      processedRows.forEach((processedFields) => {
        query += this.generateInsertStatement(tableName, processedFields);
        query += "\n\n";
      });
    } else if (queryType === "update") {
      query += this.generateUpdateStatement(tableName, processedRows, primaryKeys);
      query += "\n\n";
    } else {
      processedRows.forEach((processedFields) => {
        query += this.generateMergeStatement(tableName, processedFields, primaryKeys);
        query += "\n\n";
      });
    }

    // 8. Add select query to verify results
    const selectQuery = this.generateSelectStatement(tableName, primaryKeys, processedRows);

    if (selectQuery) {
      query += selectQuery;
    }

    return query;
  }

  generateInsertStatement(tableName, processedFields) {
    const fields = processedFields.map((f) => this.formatFieldName(f.fieldName));
    const values = processedFields.map((f) => f.formattedValue);

    return `INSERT INTO ${tableName} (${fields.join(", ")}) \nVALUES (${values.join(", ")});`;
  }

  generateMergeStatement(tableName, processedFields, primaryKeys) {
    // Format fields for SELECT part
    console.log("primaryKeys", primaryKeys);
    const primaryKeysLowerCase = primaryKeys.map((pk) => pk.toLowerCase());
    const selectFields = processedFields.map((f) => `\n  ${f.formattedValue} AS ${this.formatFieldName(f.fieldName)}`).join(",");

    // Format ON conditions for primary keys
    const pkConditions = primaryKeys
      .map((pk) => `tgt.${this.formatFieldName(pk).toLowerCase()} = src.${this.formatFieldName(pk).toLowerCase()}`)
      .join(" AND ");

    // Format UPDATE SET clause (excluding PKs and creation fields)
    const updateFields = processedFields
      .filter(
        (f) => !primaryKeys.includes(f.fieldName.toLowerCase()) && !["created_time", "created_by"].includes(f.fieldName.toLowerCase())
      )
      .map((f) => `  tgt.${this.formatFieldName(f.fieldName)} = src.${this.formatFieldName(f.fieldName)}`)
      .join(",\n");

    // Format INSERT fields and values (excluding primary keys as per Oracle SQL conventions)
    const insertFields = processedFields.map((f) => this.formatFieldName(f.fieldName)).join(", ");
    const insertValues = processedFields.map((f) => `src.${this.formatFieldName(f.fieldName)}`).join(", ");

    let mergeStatement = `MERGE INTO ${tableName} tgt`;
    mergeStatement += `\nUSING (SELECT${selectFields}\n  FROM DUAL) src`;
    mergeStatement += `\nON (${pkConditions})`;
    mergeStatement += `\nWHEN MATCHED THEN UPDATE SET\n${updateFields}`;
    mergeStatement += `\nWHEN NOT MATCHED THEN INSERT (${insertFields})\nVALUES (${insertValues});`;

    return mergeStatement;
  }

  generateUpdateStatement(tableName, processedRows, primaryKeys) {
    // const primaryKeysLowerCase = primaryKeys.map((pk) => pk.toLowerCase());

    // Collect all unique fields being updated across all rows (table scope)
    const allUpdatedFields = new Set();
    const pkValueMap = new Map(primaryKeys.map((pk) => [pk, new Set()]));

    // Process each row to collect updated fields and primary key values
    processedRows.forEach((row) => {
      row.forEach((field) => {
        // Collect primary key values for WHERE clause
        if (primaryKeys.includes(field.fieldName)) {
          if (field.formattedValue && field.formattedValue !== "NULL" && field.formattedValue !== null) {
            pkValueMap.get(field.fieldName).add(field.formattedValue);
          }
        }
        // Collect non-primary key fields that are being updated (excluding audit fields)
        else if (
          !primaryKeys.includes(field.fieldName) &&
          !["created_time", "created_by", "updated_time", "updated_by"].includes(field.fieldName) &&
          field.formattedValue !== null &&
          field.formattedValue !== undefined
        ) {
          allUpdatedFields.add(field.fieldName);
        }
      });
    });

    // Validate that we have primary key values
    const hasValidPkValues = Array.from(pkValueMap.values()).some((valueSet) => valueSet.size > 0);
    if (!hasValidPkValues) {
      throw new Error("Primary key values are required for UPDATE operation.");
    }

    // Validate that we have fields to update
    if (allUpdatedFields.size === 0) {
      throw new Error("No fields to update. Please provide at least one non-primary-key field with a value.");
    }

    // Add audit fields separately after processing all rows
    allUpdatedFields.add("updated_time");
    allUpdatedFields.add("updated_by");

    // Build UPDATE SET clause for each row
    const updateStatements = [];
    processedRows.forEach((row) => {
      const updateFields = row
        .filter((f) => {
          if (primaryKeys.includes(f.fieldName)) return false;
          if (["created_time", "created_by"].includes(f.fieldName)) return false;
          if (f.formattedValue === null) return false;
          return f.formattedValue !== undefined;
        })
        .map((f) => `  ${this.formatFieldName(f.fieldName)} = ${f.formattedValue}`);

      if (updateFields.length > 0) {
        const pkConditions = primaryKeys
          .map((pk) => {
            const pkField = row.find((f) => f.fieldName === pk);
            if (!pkField || pkField.formattedValue === null || pkField.formattedValue === "NULL" || !pkField.formattedValue) {
              throw new Error(`Primary key '${pk}' in row ${processedRows.indexOf(row) + 2} must have a value for UPDATE operation.`);
            }
            return `${this.formatFieldName(pk)} = ${pkField.formattedValue}`;
          })
          .join(" AND ");

        updateStatements.push(`UPDATE ${tableName}\nSET\n${updateFields.join(",\n")}\nWHERE ${pkConditions};`);
      }
    });

    // Create field list for SELECT statements (table scope)
    const selectFieldNames = Array.from(allUpdatedFields).map((f) => this.formatFieldName(f));

    // Build WHERE clause for SELECT statements using IN clauses like generateSelectStatement
    const whereConditions = [];
    pkValueMap.forEach((values, pkName) => {
      if (values.size > 0) {
        whereConditions.push(`${this.formatFieldName(pkName)} IN (${Array.from(values).join(", ")})`);
      }
    });
    const allPkConditions = whereConditions.join(" AND ");

    // Generate the 3-part UPDATE statement
    let updateStatement = "-- Selected fields before update\n";
    updateStatement += `SELECT ${selectFieldNames.join(", ")}\nFROM ${tableName} WHERE ${allPkConditions};\n\n`;

    updateStatement += updateStatements.join("\n\n") + "\n\n";

    updateStatement += "-- Selected fields after update\n";
    updateStatement += `SELECT ${selectFieldNames.join(", ")}\nFROM ${tableName} WHERE ${allPkConditions};`;

    return updateStatement;
  }

  generateSelectStatement(tableName, primaryKeys, processedRows) {
    if (primaryKeys.length === 0) return null;
    if (processedRows.length === 0) return null;

    // Collect formatted values for each primary key
    const pkValueMap = new Map(primaryKeys.map((pk) => [pk, new Set()]));

    // Go through each processed row to collect PK values
    processedRows.forEach((row) => {
      row.forEach((field) => {
        if (pkValueMap.has(field.fieldName)) {
          // Only add non-null values
          if (field.formattedValue !== "NULL") {
            pkValueMap.get(field.fieldName).add(field.formattedValue);
          }
        }
      });
    });

    // Build WHERE conditions
    const whereConditions = [];

    pkValueMap.forEach((values, pkName) => {
      if (values.size > 0) {
        whereConditions.push(`${this.formatFieldName(pkName)} IN (${Array.from(values).join(", ")})`);
      }
    });

    // If no valid PK values found, return null
    if (whereConditions.length === 0) return null;

    const orderByClause = processedRows.length > 1 ? " ORDER BY updated_time ASC" : "";
    let selectStatement = `\nSELECT * FROM ${tableName} WHERE ${whereConditions.join(" AND ")}${orderByClause};`;
    selectStatement += `\nSELECT ${primaryKeys
      .map((pk) => pk.toLowerCase())
      .join(", ")}, updated_time FROM ${tableName} WHERE updated_time >= SYSDATE - INTERVAL '5' MINUTE;`;
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
