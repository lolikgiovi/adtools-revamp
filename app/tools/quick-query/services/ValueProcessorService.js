import { commonDateFormats } from "../constants.js";
import { UsageTracker } from "../../../core/UsageTracker.js";

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
        UsageTracker.trackEvent("quick-query", "value_error", { type: "null_not_allowed", fieldName, queryType });
        throw new Error(`NULL value not allowed for non-nullable field "${fieldName}"`);
      }
      return "NULL";
    }

    // Handle explicit NULL string values
    if (isExplicitNull) {
      // Always validate nullable constraint for explicit NULL values
      if (nullable?.toLowerCase() !== "yes") {
        UsageTracker.trackEvent("quick-query", "value_error", { type: "null_not_allowed", fieldName, queryType });
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
      return `(SELECT NVL(MAX(${fieldName})+1, 1) FROM ${tableName})`;
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
        // Convert comma to dot if present
        const normalizedValue = value.toString().replace(",", ".");
        const num = parseFloat(normalizedValue);

        if (isNaN(num)) {
          UsageTracker.trackEvent("quick-query", "value_error", { type: "invalid_number", fieldName, value });
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
            UsageTracker.trackEvent("quick-query", "value_error", { type: "uuid_length_too_small", fieldName, maxLength: fieldDataType.maxLength });
            throw new Error(
              `Field "${fieldName}" length (${fieldDataType.maxLength}) is too small to store UUID. Minimum required length is ${UUID_V4_MAXLENGTH}.`
            );
          }
          return `'${crypto.randomUUID()}'`;
        }

        if (fieldDataType.maxLength) {
          const length = fieldDataType.unit === "BYTE" ? new TextEncoder().encode(value).length : value.length;

          if (length > fieldDataType.maxLength) {
            UsageTracker.trackEvent("quick-query", "value_error", { type: "max_length_exceeded", fieldName, maxLength: fieldDataType.maxLength, length, unit: fieldDataType.unit });
            throw new Error(`Value exceeds maximum length of ${fieldDataType.maxLength} ${fieldDataType.unit} for field "${fieldName}"`);
          }
        }
        return `'${value.replace(/'/g, "''")}'`;

      case "DATE":
      case "TIMESTAMP":
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
      UsageTracker.trackEvent("quick-query", "value_error", { type: "precision_exceeded", fieldName, precision, value: num });
      throw new Error(`Value ${num} exceeds maximum precision of ${precision} for field "${fieldName}"`);
    }

    if (scale !== undefined && decimalDigits > scale) {
      UsageTracker.trackEvent("quick-query", "value_error", { type: "scale_exceeded", fieldName, scale, precision, value: num });
      throw new Error(`Value ${num} exceeds maximum scale of ${scale} (${precision},${scale}) for field "${fieldName}"`);
    }

    if (scale !== undefined && integerDigits > precision - scale) {
      UsageTracker.trackEvent("quick-query", "value_error", { type: "integer_digits_exceeded", fieldName, precision, scale, value: num });
      throw new Error(`Integer part of ${num} exceeds maximum allowed digits for field "${fieldName}"`);
    }
  }

  findPrimaryKeys(data, tableName) {
    console.log("Finding primary keys for:", tableName);

    // For config table, use field parameter_key if exist as primary key
    if (tableName.toLowerCase().endsWith("config")) {
      const parameterKeyField = data.find((field) => field[0].toLowerCase() === "parameter_key");
      if (parameterKeyField) return [parameterKeyField[0]];
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

      // 2. Handle common explicit formats without timezone
      for (const fmt of commonDateFormats) {
        const parsed = moment(value, fmt, true);
        if (parsed.isValid()) {
          return `TO_DATE('${parsed.format("YYYY-MM-DD HH:mm:ss")}', 'YYYY-MM-DD HH24:MI:SS')`;
        }
      }

      // 3. Fallback to parsing with timezone if provided (like +07:00)
      const tzMatch = value.match(/([+-]\d{2}:?\d{2})$/);
      if (tzMatch) {
        const parsed = moment(value);
        if (parsed.isValid()) {
          return `TO_TIMESTAMP_TZ('${parsed.format("YYYY-MM-DD HH:mm:ssZ")}', 'YYYY-MM-DD HH24:MI:SSTZH:TZM')`;
        }
      }

      // 4. If none matched, return literal string
      return `'${value.replace(/'/g, "''")}'`;
    } catch (error) {
      UsageTracker.trackEvent("quick-query", "value_error", { type: "timestamp_parse_failed", message: error.message, value });
      return `'${value.replace(/'/g, "''")}'`;
    }
  }

  formatCLOB(value) {
    // Escape single quotes and wrap in TO_CLOB()
    return `TO_CLOB('${value.replace(/'/g, "''")}')`;
  }

  formatBLOB(value) {
    // Ensure base64 string and wrap in utl_raw.cast_to_raw
    const base64 = value.replace(/^data:.*;base64,/, "");
    return `utl_raw.cast_to_raw('${base64}')`;
  }

  isValidDate(value) {
    const parsed = moment(value);
    return parsed.isValid();
  }
}
