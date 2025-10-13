import { commonDateFormats } from "../constants.js";

export class ValueProcessorService {
  constructor() {}

  processValue(value, dataType, nullable, fieldName, tableName, queryType = null) {
    console.log("Processing value:", value);

    // Constants
    const AUDIT_FIELDS = {
      time: ["created_time", "updated_time"],
      by: ["created_by", "updated_by"],
    };

    // Handle audit fields
    if (AUDIT_FIELDS.time.includes(fieldName.toLowerCase())) {
      // const hasNoValue = !value;
      // const hasNoTimestampCharacters = !/[-/]/.test(value);
      // return hasNoValue || hasNoTimestampCharacters ? "SYSDATE" : this.formatTimestamp(value);
      return "SYSDATE"; // for data integrity, return sysdate to log the time of the query
    }

    if (AUDIT_FIELDS.by.includes(fieldName.toLowerCase())) {
      return value?.trim() ? `'${value.replace(/'/g, "''").toUpperCase()}'` : "'SYSTEM'";
    }

    // Handle NULL values
    const isEmptyValue = value === null || value === undefined || value === "";
    const isExplicitNull = value?.toLowerCase() === "null";

    if (isEmptyValue) {
      // For UPDATE operations, skip empty values (don't update these fields)
      if (queryType === "update") {
        return null;
      }
      // For other operations, validate nullable constraint
      if (nullable?.toLowerCase() !== "yes") {
        throw new Error(`NULL value not allowed for non-nullable field "${fieldName}"`);
      }
      return "NULL";
    }

    // Handle explicit NULL string values
    if (isExplicitNull) {
      // Always validate nullable constraint for explicit NULL values
      if (nullable?.toLowerCase() !== "yes") {
        throw new Error(`NULL value not allowed for non-nullable field "${fieldName}"`);
      }
      return "NULL";
    }

    // Handle special ID fields
    const upperDataType = dataType.toUpperCase();

    // Increment value (max + 1)
    if (
      (fieldName === "config_id" && upperDataType === "NUMBER") || // specific for config_id
      (upperDataType.startsWith("NUMBER") && value.toLowerCase() === "max") // any number fields with exactly max value
    ) {
      return `(SELECT MAX(${fieldName})+1 FROM ${tableName})`;
    }

    // Varchar containing UUID
    if (upperDataType.startsWith("VARCHAR") && value.toLowerCase() === "uuid") {
      if (!this.isValidUUID(value)) {
        return `'${crypto.randomUUID()}'`;
      }
      return `'${value}'`;
    }

    // System config ID
    if (fieldName === "system_config_id" && value.toLowerCase() === "max") {
      return `(SELECT MAX(CAST(${fieldName} AS INT))+1 FROM ${tableName})`;
    }

    // Process regular values based on data type
    const fieldDataType = this.parseDataType(dataType);

    switch (fieldDataType.type) {
      case "NUMBER":
        // NUMBER(1,0) / boolean number
        // if (fieldDataType.precision === 1 && fieldDataType.scale === 0) {
        //   if (value !== "0" && value !== "1" && value !== 0 && value !== 1) {
        //     throw new Error(`Invalid boolean value "${value}" for field "${fieldName}". Only 0 or 1 are allowed.`);
        //   }
        //   return value;
        // }

        // Convert comma to dot if present
        const normalizedValue = value.toString().replace(",", ".");
        const num = parseFloat(normalizedValue);

        if (isNaN(num)) {
          throw new Error(`Invalid numeric value "${value}" for field "${fieldName}"`);
        }

        // Validate precision and scale if specified
        if (fieldDataType.precision) {
          this.validateNumberPrecision(num, fieldDataType.precision, fieldDataType.scale, fieldName);
        }

        return normalizedValue;

      case "VARCHAR":
      case "VARCHAR2":
      case "CHAR":
        const UUID_V4_MAXLENGTH = 36;

        if (value.toLowerCase() === "uuid") {
          if (fieldDataType.maxLength && fieldDataType.maxLength < UUID_V4_MAXLENGTH) {
            throw new Error(
              `Field "${fieldName}" length (${fieldDataType.maxLength}) is too small to store UUID. Minimum required length is ${UUID_V4_MAXLENGTH}.`
            );
          }
          return `'${crypto.randomUUID()}'`;
        }

        if (fieldDataType.maxLength) {
          const length = fieldDataType.unit === "BYTE" ? new TextEncoder().encode(value).length : value.length;

          if (length > fieldDataType.maxLength) {
            throw new Error(`Value exceeds maximum length of ${fieldDataType.maxLength} ${fieldDataType.unit} for field "${fieldName}"`);
          }
        }
        return `'${value.replace(/'/g, "''")}'`;

      case "DATE":
      case "TIMESTAMP":
        // skip validation, run right through formatTimeStamp
        // if (!this.isValidDate(value)) {
        //   throw new Error(`Invalid date value "${value}" for field "${fieldName}"`);
        // }
        return this.formatTimestamp(value);

      case "CLOB":
        return this.formatCLOB(value);

      case "BLOB":
        return this.formatBLOB(value);

      default:
        return `'${value.replace(/'/g, "''")}'`;
    }
  }

  parseDataType(dataType) {
    const upperType = dataType.toUpperCase();

    // Parse NUMBER type
    const numberMatch = upperType.match(/NUMBER\((\d+)(?:,\s*(\d+))?\)/);
    if (numberMatch) {
      return {
        type: "NUMBER",
        precision: parseInt(numberMatch[1]),
        scale: numberMatch[2] ? parseInt(numberMatch[2]) : 0,
      };
    }

    // Parse VARCHAR/CHAR type
    const stringMatch = upperType.match(/(VARCHAR2?|CHAR)\((\d+)(?:\s+(BYTE|CHAR))?\)/);
    if (stringMatch) {
      return {
        type: stringMatch[1],
        maxLength: parseInt(stringMatch[2]),
        unit: stringMatch[3] || "BYTE",
      };
    }

    // Basic types
    if (upperType.startsWith("TIMESTAMP")) return { type: "TIMESTAMP" };
    if (upperType === "DATE") return { type: "DATE" };
    if (upperType === "CLOB") return { type: "CLOB" };
    if (upperType === "BLOB") return { type: "BLOB" };
    if (upperType === "NUMBER") return { type: "NUMBER" };

    return { type: upperType };
  }

  validateNumberPrecision(num, precision, scale, fieldName) {
    const numStr = Math.abs(num).toString();
    const parts = numStr.split(".");

    const integerDigits = parts[0].length;
    const decimalDigits = parts[1]?.length || 0;

    if (integerDigits + decimalDigits > precision) {
      throw new Error(`Value ${num} exceeds maximum precision of ${precision} for field "${fieldName}"`);
    }

    if (scale !== undefined && decimalDigits > scale) {
      throw new Error(`Value ${num} exceeds maximum scale of ${scale} (${precision},${scale}) for field "${fieldName}"`);
    }

    if (scale !== undefined && integerDigits > precision - scale) {
      throw new Error(`Integer part of ${num} exceeds maximum allowed digits for field "${fieldName}"`);
    }
  }

  findPrimaryKeys(data, tableName) {
    console.log("Finding primary keys for:", tableName);

    // For config table, use field parameter_key if exist as primary key
    if (tableName.toLowerCase().endsWith("config")) {
      const parameterKeyField = data.find((field) => field[0].toLowerCase() === "parameter_key");
      if (parameterKeyField) return [parameterKeyField[0].toLowerCase()];
    }

    // Detect PK from dedicated PK column (index 5)
    const pkFields = data
      .filter((field) => {
        const pkValue = (field[5] ?? "").toString().trim().toLowerCase();
        return pkValue === "yes" || pkValue === "y";
      })
      .map((field) => field[0]);

    if (pkFields.length > 0) return pkFields;

    // If no primary keys found, use the first field as default
    return [data[0][0]];
  }

  isValidUUID(str) {
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(str);
  }

  formatTimestamp(value) {
    // Handle special cases
    if (!value) return "NULL";
    const upperValue = value.toUpperCase();
    if (upperValue === "SYSDATE" || upperValue === "CURRENT_TIMESTAMP") {
      return upperValue;
    }

    try {
      // 1. Handle ISO 8601 format with timezone
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)) {
        const parsed = moment(value);
        if (parsed.isValid()) {
          const fractionalMatch = value.match(/\.(\d+)/);
          const precision = fractionalMatch ? Math.min(fractionalMatch[1].length, 9) : 0;

          if (precision > 0) {
            return `TO_TIMESTAMP_TZ('${parsed.format("YYYY-MM-DD HH:mm:ss")}${value.substring(
              value.indexOf("."),
              value.indexOf(".") + precision + 1
            )}${parsed.format("Z")}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}TZH:TZM')`;
          }
          return `TO_TIMESTAMP_TZ('${parsed.format("YYYY-MM-DD HH:mm:ssZ")}', 'YYYY-MM-DD HH24:MI:SSTZH:TZM')`;
        }
      }

      // 2. Handle timestamps with fractional seconds
      if (value.includes(",")) {
        // First replace dots in time with colons, but keep the date dots
        const normalizedValue = value.replace(/(\d{2})\.(\d{2})\.(\d{2}),/, "$1:$2:$3,");
        const [datePart, fractionalPart] = normalizedValue.split(",");
        const precision = Math.min(fractionalPart?.length || 0, 9);

        const parsed = moment(datePart, "DD-MM-YYYY HH:mm:ss", true);
        if (parsed.isValid()) {
          return `TO_TIMESTAMP('${parsed.format("YYYY-MM-DD HH:mm:ss")}.${fractionalPart.substring(
            0,
            precision
          )}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}')`;
        }
      }

      // 3. Handle common formats with strict parsing
      const commonFormats = [
        "YYYY-MM-DD HH:mm:ss",
        "DD-MM-YYYY HH:mm:ss",
        "MM/DD/YYYY HH:mm:ss",
        "DD/MM/YYYY HH:mm:ss",
        "YYYY-MM-DD",
        "DD-MM-YYYY",
        "MM/DD/YYYY",
        "DD/MM/YYYY",
        "DD-MMM-YYYY",
        "DD-MMM-YY",
        "DD.MM.YYYY HH:mm:ss",
        "DD.MM.YYYY",
        "YYYY/MM/DD HH:mm:ss",
        "YYYY/MM/DD",
      ];

      for (const format of commonFormats) {
        const parsed = moment(value, format, true);
        if (parsed.isValid()) {
          return `TO_TIMESTAMP('${parsed.format("YYYY-MM-DD HH:mm:ss")}', 'YYYY-MM-DD HH24:MI:SS')`;
        }
      }

      // 4. Handle AM/PM format
      if (/[AaPpMm]/.test(value)) {
        const amPmFormats = [
          "MM/DD/YYYY hh:mm:ss A",
          "DD-MM-YYYY hh:mm:ss A",
          "YYYY-MM-DD hh:mm:ss A",
          "DD/MM/YYYY hh:mm:ss A",
          "MM-DD-YYYY hh:mm:ss A",
        ];

        for (const format of amPmFormats) {
          const parsed = moment(value, format, true);
          if (parsed.isValid()) {
            return `TO_TIMESTAMP('${parsed.format("YYYY-MM-DD HH:mm:ss")}', 'YYYY-MM-DD HH24:MI:SS')`;
          }
        }
      }

      // 5. Last resort: try flexible parsing
      const parsed = moment(value);
      if (parsed.isValid()) {
        console.warn(`Using flexible date parsing for format: ${value}`);
        return `TO_TIMESTAMP('${parsed.format("YYYY-MM-DD HH:mm:ss")}', 'YYYY-MM-DD HH24:MI:SS')`;
      }

      throw new Error(`Unable to parse date format: ${value}`);
    } catch (error) {
      console.error(`Error parsing timestamp: ${value}`, error);
      throw new Error(`Invalid timestamp format: ${value}. Please use a valid date/time format.`);
    }
  }

  formatCLOB(value) {
    const chunkSize = 1000;
    let result = "";
    let currentChunkSize = 0;
    let isFirstChunk = true;

    for (let i = 0; i < value.length; i++) {
      let char = value[i];

      if (char === "'" || char === "\u2018" || char === "\u2019") {
        char = "''";
      } else if (char === "\u201C" || char === "\u201D") {
        char = '"';
      }

      if (currentChunkSize + char.length > chunkSize || isFirstChunk) {
        if (!isFirstChunk) {
          result += "') || \n";
        }
        result += "to_clob('";
        currentChunkSize = 0;
        isFirstChunk = false;
      }

      result += char;
      currentChunkSize += char.length;
    }

    result += "')";
    return result;
  }

  formatBLOB(value) {
    return `UTL_RAW.CAST_TO_RAW('${value}')`;
  }

  isValidDate(value) {
    // Handle special cases
    if (!value) return false;
    if (value.toUpperCase() === "SYSDATE" || value.toUpperCase() === "CURRENT_TIMESTAMP") {
      return true;
    }

    // Try strict parsing with common formats
    if (commonDateFormats.some((format) => moment(value, format, true).isValid())) {
      return true;
    }

    // If strict parsing fails, try flexible parsing as last resort
    const parsed = moment(value);
    if (parsed.isValid()) {
      console.warn(`Date validated using flexible parsing: ${value}`);
      return true;
    }

    return false;
  }
}
