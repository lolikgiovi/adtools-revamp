export class SchemaValidationService {
  constructor() {}

  validateSchema(schemaData) {
    console.log(schemaData.length);
    // Check for empty schema
    if (schemaData.length === 0) {
      throw new Error("Schema Validation Error:<br>Please fill in the schema (see the left panel).");
    }

    // Track invalid entries
    const invalidDataTypes = [];
    const invalidNullableValues = [];

    // Validate each row in the schema once
    schemaData.forEach((row, index) => {
      const [fieldName, dataType, nullable] = row;

      // Check if any required field is empty
      if (!fieldName || !dataType || !nullable) {
        throw new Error(
          `Schema Validation Error:<br>Row ${index + 1} of schema is not defined. Field Name, Data Type, and Nullable are required.`
        );
      }

      // Validate data type
      if (!this.isValidOracleDataType(dataType)) {
        invalidDataTypes.push(`${dataType} (in field ${fieldName})`);
      }

      // Validate nullable values
      if (!this.isValidNullableDataType(nullable)) {
        invalidNullableValues.push(`${nullable} (in field ${fieldName})`);
      }
    });

    // Build error message if any validations failed
    if (invalidDataTypes.length > 0 || invalidNullableValues.length > 0) {
      const errors = [];

      if (invalidDataTypes.length > 0) {
        errors.push(`Invalid Oracle SQL Data Types: ${invalidDataTypes.join(", ")}`);
      }

      if (invalidNullableValues.length > 0) {
        errors.push(`Invalid nullable values: ${invalidNullableValues.join(", ")}. Must be 'Yes', 'No', or 'PK'`);
      }

      throw new Error(`Schema Validation Error:<br>${errors.join("<br>")}`);
    }

    return true;
  }

  isValidOracleDataType(dataType) {
    const validTypes = ["NUMBER", "VARCHAR", "VARCHAR2", "DATE", "TIMESTAMP", "CHAR", "CLOB", "BLOB"];
    return validTypes.some((type) => dataType.toUpperCase().startsWith(type));
  }

  isValidNullableDataType(nullable) {
    const validValues = ["Yes", "No", "PK", "yes", "no", "pk", "Y", "N", "y", "n"];
    return validValues.includes(nullable);
  }

  matchSchemaWithData(schemaData, inputData) {
    const hasSchemaData = schemaData.some((row) => row.some((cell) => cell !== null && cell !== ""));
    const hasFieldNames = inputData[0]?.some((cell) => cell !== null && cell !== "");
    const hasFirstDataRow = inputData[1]?.some((cell) => cell !== null && cell !== "");

    if (!hasSchemaData || !hasFieldNames || !hasFirstDataRow) {
      throw new Error("Incomplete data. Please fill in both schema and data sheets.");
    }

    const schemaFieldNames = schemaData.map((row) => row[0].toLowerCase());
    const inputFieldNames = inputData[0].map((field) => field?.toLowerCase());

    // Check for empty field names in data input
    const emptyColumnIndex = inputFieldNames.findIndex((field) => !field);
    if (emptyColumnIndex !== -1) {
      throw new Error(`Field Name Error:<br>Empty field name found in data input at column ${emptyColumnIndex + 1}`);
    }

    // Find mismatches in both directions
    const missingInSchema = inputFieldNames.filter((field) => !schemaFieldNames.includes(field));
    const missingInData = schemaFieldNames.filter((field) => !inputFieldNames.includes(field));

    if (missingInSchema.length > 0 || missingInData.length > 0) {
      const errors = [];
      if (missingInSchema.length > 0) {
        errors.push(`Fields in data but not in schema: ${missingInSchema.join(", ")}`);
      }
      if (missingInData.length > 0) {
        errors.push(`Fields in schema but not in data: ${missingInData.join(", ")}`);
      }
      throw new Error(`Field Mismatch Error:<br>${errors.join("<br>")}`);
    }

    return true;
  }
}

export function isDbeaverSchema(schemaData) {
  if (schemaData[0][0] === "Column Name") {
    return true;
  }
  return false;
}
