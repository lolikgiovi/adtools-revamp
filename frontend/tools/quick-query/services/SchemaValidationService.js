import { UsageTracker } from "../../../core/UsageTracker.js";

export function schemaFieldKey(field) {
  const name = String(field ?? "").trim();
  return name.startsWith('"') ? name : name.toUpperCase();
}

export function validateFieldNames(fieldNames, source = "data input") {
  const indexes = new Map();
  fieldNames.forEach((field, index) => {
    const key = schemaFieldKey(field);
    const column = columnIndexToLetter(index);
    if (!key) {
      throw new Error(`Field Name Error:<br>Empty field name found in ${source} at column ${column}`);
    }
    if (indexes.has(key)) {
      const firstColumn = columnIndexToLetter(indexes.get(key));
      throw new Error(`Field Name Error:<br>Duplicate field name '${field}' in ${source} at columns ${firstColumn} and ${column}`);
    }
    indexes.set(key, index);
  });
  return indexes;
}

function columnIndexToLetter(index) {
  let letter = "";
  while (index >= 0) {
    letter = String.fromCharCode(65 + (index % 26)) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

export class SchemaValidationService {
  constructor() {}

  validateSchema(schemaData, tableName) {
    // Check for empty schema
    if (schemaData.length === 0) {
      throw new Error("Schema Validation Error:<br>Please fill in the schema (see the left panel).");
    }

    validateFieldNames(
      schemaData.map((row) => row[0]),
      "schema",
    );

    // Track invalid entries
    const invalidDataTypes = [];
    const invalidNullableValues = [];
    const invalidPkValues = [];

    // Validate each row in the schema once
    schemaData.forEach((row, index) => {
      const [fieldName, dataType, nullable, _default, _order, pk] = row;

      // Check if any required field is empty
      if (!fieldName || !dataType || !nullable) {
        throw new Error(
          `Schema Validation Error:<br>Row ${index + 1} of schema is not defined. Field Name, Data Type, and Null are required.`,
        );
      }

      // Validate data type
      if (!this.isValidOracleDataType(dataType)) {
        invalidDataTypes.push(`${dataType} (in field ${fieldName})`);
      }

      // Validate Null column values ('Yes' or 'No')
      if (!this.isValidNullableDataType(nullable)) {
        invalidNullableValues.push(`${nullable} (in field ${fieldName})`);
      }

      // Validate PK column values if present ('Yes' or 'No')
      if (pk !== undefined && pk !== null && pk !== "") {
        if (!this.isValidPkValue(pk)) {
          invalidPkValues.push(`${pk} (in field ${fieldName})`);
        }
      }
    });

    // Build error message if any validations failed
    if (invalidDataTypes.length > 0 || invalidNullableValues.length > 0 || invalidPkValues.length > 0) {
      const errors = [];

      if (invalidDataTypes.length > 0) {
        errors.push(`Invalid Oracle SQL Data Types: ${invalidDataTypes.join(", ")}`);
      }

      if (invalidNullableValues.length > 0) {
        errors.push(`Invalid Null values: ${invalidNullableValues.join(", ")}. Must be 'Yes' or 'No'`);
      }
      if (invalidPkValues.length > 0) {
        errors.push(`Invalid PK values: ${invalidPkValues.join(", ")}. Must be 'Yes' or 'No'`);
      }

      UsageTracker.trackEvent("quick-query", "validation_error", {
        type: "invalid_values",
        invalidDataTypesCount: invalidDataTypes.length,
        invalidNullableValuesCount: invalidNullableValues.length,
        invalidPkValuesCount: invalidPkValues.length,
        table_name: tableName,
      });
      throw new Error(`Schema Validation Error:<br>${errors.join("<br>")}`);
    }

    return true;
  }

  isValidOracleDataType(dataType) {
    const validTypes = ["NUMBER", "VARCHAR", "VARCHAR2", "DATE", "TIMESTAMP", "CHAR", "CLOB", "BLOB"];
    return validTypes.some((type) => dataType.toUpperCase().startsWith(type));
  }

  isValidNullableDataType(nullable) {
    const validValues = ["Yes", "No", "yes", "no", "Y", "N", "y", "n"];
    return validValues.includes(nullable);
  }

  isValidPkValue(pk) {
    const validValues = ["Yes", "No", "yes", "no", "Y", "N", "y", "n"];
    return validValues.includes(pk);
  }

  matchSchemaWithData(schemaData, inputData, { allowPartialData = false } = {}) {
    const hasSchemaData = schemaData.some((row) => row.some((cell) => cell !== null && cell !== ""));
    const hasFieldNames = inputData[0]?.some((cell) => cell !== null && cell !== "");
    const hasFirstDataRow = inputData[1]?.some((cell) => cell !== null && cell !== "");

    if (!hasSchemaData || !hasFieldNames || !hasFirstDataRow) {
      throw new Error("Incomplete data. Please fill in both schema and data sheets.");
    }

    const schemaFieldNames = schemaData.map((row) => row[0]);
    const inputFieldNames = inputData[0].map((field) => field?.trim());

    validateFieldNames(schemaFieldNames, "schema");
    validateFieldNames(inputFieldNames);

    // Find mismatches in both directions
    const missingInSchema = inputFieldNames.filter((field) => !schemaFieldNames.includes(field));
    const missingInData = schemaFieldNames.filter((field) => !inputFieldNames.includes(field));

    if (missingInSchema.length > 0 || (missingInData.length > 0 && !allowPartialData)) {
      const errors = [];
      if (missingInSchema.length > 0) {
        errors.push(`Fields in data but not in schema: ${missingInSchema.join(", ")}`);
      }
      if (missingInData.length > 0) {
        errors.push(`Fields in schema but not in data: ${missingInData.join(", ")}`);
      }
      throw new Error(`Field Mismatch Error:<br>${errors.join("<br>")}<br>Note: Oracle treat reserved keywords as case sensitive`);
    }

    return true;
  }

  columnIndexToLetter(index) {
    return columnIndexToLetter(index);
  }
}

export function isDbeaverSchema(schemaData) {
  return (
    Array.isArray(schemaData) &&
    String(schemaData[0]?.[0] || "")
      .trim()
      .toLowerCase() === "column name"
  );
}
