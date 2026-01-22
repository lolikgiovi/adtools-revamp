import { commonDateFormats } from "../constants.js";
import moment from "moment";
import { UsageTracker } from "../../../core/UsageTracker.js";

export class ValueProcessorService {
  constructor() {}

  /**
   * Safely convert value to string for string operations.
   * Handles numbers, booleans, and other non-string types from spreadsheet cells.
   */
  _toString(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  processValue(value, dataType, nullable, fieldName, tableName, queryType = null) {
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
      const strValue = this._toString(value).trim();
      return strValue ? `'${strValue.replace(/'/g, "''").toUpperCase()}'` : "'SYSTEM'";
    }

    // Handle NULL values
    const isEmptyValue = value === null || value === undefined || value === "";
    const strValue = this._toString(value);
    const isExplicitNull = strValue.toLowerCase() === "null";

    if (isEmptyValue) {
      // For UPDATE operations, skip empty values (don't update these fields)
      if (queryType === "update") {
        return null;
      }
      // For other operations, validate nullable constraint
      if (nullable?.toLowerCase() !== "yes") {
        UsageTracker.trackEvent("quick-query", "value_error", { type: "null_not_allowed", fieldName, queryType, table_name: tableName });
        throw new Error(`NULL value not allowed for non-nullable field "${fieldName}"`);
      }
      return "NULL";
    }

    // Handle explicit NULL string values
    if (isExplicitNull) {
      // Always validate nullable constraint for explicit NULL values
      if (nullable?.toLowerCase() !== "yes") {
        UsageTracker.trackEvent("quick-query", "value_error", { type: "null_not_allowed", fieldName, queryType, table_name: tableName });
        throw new Error(`NULL value not allowed for non-nullable field "${fieldName}"`);
      }
      return "NULL";
    }

    // Handle special ID fields
    const upperDataType = dataType.toUpperCase();
    const lowerStrValue = strValue.toLowerCase();

    // Increment value (max + 1)
    if (
      (fieldName === "config_id" && upperDataType === "NUMBER") || // specific for config_id
      (upperDataType.startsWith("NUMBER") && lowerStrValue.includes("max")) // any number fields containing "max" phrase
    ) {
      return `(SELECT NVL(MAX(${fieldName})+1, 1) FROM ${tableName})`;
    }

    // Varchar containing UUID
    if (upperDataType.startsWith("VARCHAR") && lowerStrValue === "uuid") {
      if (!this.isValidUUID(strValue)) {
        return `'${crypto.randomUUID()}'`;
      }
      return `'${strValue}'`;
    }

    // System config ID
    if (fieldName === "system_config_id" && lowerStrValue === "max") {
      return `(SELECT MAX(CAST(${fieldName} AS INT))+1 FROM ${tableName})`;
    }

    // Process regular values based on data type
    const fieldDataType = this.parseDataType(dataType);

    switch (fieldDataType.type) {
      case "NUMBER":
        let normalizedValue = strValue.trim();

        // 1. Handle multiple commas (e.g. 10,000,000) -> Remove all commas
        if ((normalizedValue.match(/,/g) || []).length > 1) {
          normalizedValue = normalizedValue.replace(/,/g, "");
        }
        // 2. Handle mixed separators (e.g. 10,000.50 or 10.000,50)
        else if (normalizedValue.includes(",") && normalizedValue.includes(".")) {
          const lastCommaIndex = normalizedValue.lastIndexOf(",");
          const lastDotIndex = normalizedValue.lastIndexOf(".");

          if (lastCommaIndex < lastDotIndex) {
            // Format: 10,000.50 (Comma is thousands)
            normalizedValue = normalizedValue.replace(/,/g, "");
          } else {
            // Format: 10.000,50 (Dot is thousands)
            normalizedValue = normalizedValue.replace(/\./g, "").replace(",", ".");
          }
        }
        // 3. Handle single comma
        else if (normalizedValue.includes(",")) {
          // Check if it looks like a valid integer with thousands separator
          // Pattern: Optional minus, 1-3 digits, followed by comma, followed by 3 digits
          if (/^-?[1-9]\d{0,2},\d{3}$/.test(normalizedValue)) {
            normalizedValue = normalizedValue.replace(",", "");
          } else {
            // Otherwise assume decimal separator
            normalizedValue = normalizedValue.replace(",", ".");
          }
        }

        const num = parseFloat(normalizedValue);

        if (isNaN(num)) {
          UsageTracker.trackEvent("quick-query", "value_error", { type: "invalid_number", fieldName, value, table_name: tableName });
          throw new Error(`Invalid numeric value "${value}" for field "${fieldName}"`);
        }

        // Validate precision and scale if specified
        if (fieldDataType.precision) {
          this.validateNumberPrecision(num, fieldDataType.precision, fieldDataType.scale, fieldName, tableName);
        }

        return normalizedValue;

      case "VARCHAR":
      case "VARCHAR2":
      case "CHAR":
        const UUID_V4_MAXLENGTH = 36;

        if (lowerStrValue === "uuid") {
          if (fieldDataType.maxLength && fieldDataType.maxLength < UUID_V4_MAXLENGTH) {
            UsageTracker.trackEvent("quick-query", "value_error", {
              type: "uuid_length_too_small",
              fieldName,
              maxLength: fieldDataType.maxLength,
              table_name: tableName,
            });
            throw new Error(
              `Field "${fieldName}" length (${fieldDataType.maxLength}) is too small to store UUID. Minimum required length is ${UUID_V4_MAXLENGTH}.`
            );
          }
          return `'${crypto.randomUUID()}'`;
        }

        if (fieldDataType.maxLength) {
          const length = fieldDataType.unit === "BYTE" ? new TextEncoder().encode(strValue).length : strValue.length;

          if (length > fieldDataType.maxLength) {
            UsageTracker.trackEvent("quick-query", "value_error", {
              type: "max_length_exceeded",
              fieldName,
              maxLength: fieldDataType.maxLength,
              length,
              unit: fieldDataType.unit,
              table_name: tableName,
            });
            throw new Error(`Value exceeds maximum length of ${fieldDataType.maxLength} ${fieldDataType.unit} for field "${fieldName}"`);
          }
        }
        return `'${strValue.replace(/'/g, "''")}'`;

      case "DATE":
      case "TIMESTAMP":
        return this.formatTimestamp(strValue, fieldName);

      case "CLOB":
        return this.formatCLOB(strValue);

      case "BLOB":
        return this.formatBLOB(strValue);

      default:
        return `'${strValue.replace(/'/g, "''")}'`;
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

  validateNumberPrecision(num, precision, scale, fieldName, tableName) {
    const numStr = Math.abs(num).toString();
    const parts = numStr.split(".");

    const integerDigits = parts[0].length;
    const decimalDigits = parts[1]?.length || 0;

    if (integerDigits + decimalDigits > precision) {
      UsageTracker.trackEvent("quick-query", "value_error", {
        type: "precision_exceeded",
        fieldName,
        precision,
        value: num,
        table_name: tableName,
      });
      throw new Error(`Value ${num} exceeds maximum precision of ${precision} for field "${fieldName}"`);
    }

    if (scale !== undefined && decimalDigits > scale) {
      UsageTracker.trackEvent("quick-query", "value_error", {
        type: "scale_exceeded",
        fieldName,
        scale,
        precision,
        value: num,
        table_name: tableName,
      });
      throw new Error(`Value ${num} exceeds maximum scale of ${scale} (${precision},${scale}) for field "${fieldName}"`);
    }

    if (scale !== undefined && integerDigits > precision - scale) {
      UsageTracker.trackEvent("quick-query", "value_error", {
        type: "integer_digits_exceeded",
        fieldName,
        precision,
        scale,
        value: num,
        table_name: tableName,
      });
      throw new Error(`Integer part of ${num} exceeds maximum allowed digits for field "${fieldName}"`);
    }
  }

  findPrimaryKeys(data, tableName) {
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

  formatTimestamp(value, fieldName = null) {
    // Handle special cases
    if (!value) return "NULL";
    const upperValue = value.toUpperCase();
    if (upperValue === "SYSDATE" || upperValue === "CURRENT_TIMESTAMP") {
      return upperValue;
    }

    try {
      // 1. Handle ISO 8601 format with timezone
      // Regex to check if it looks like ISO 8601
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)) {
        const parsed = moment(value);
        if (parsed.isValid()) {
          const fractionalMatch = value.match(/\.(\d+)/);
          const precision = fractionalMatch ? Math.min(fractionalMatch[1].length, 9) : 0;

          if (precision > 0) {
            // Reconstruct the timestamp with timezone
            return `TO_TIMESTAMP_TZ('${parsed.format("YYYY-MM-DD HH:mm:ss")}.${fractionalMatch[1].substring(0, precision)}${parsed.format(
              "Z"
            )}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}TZH:TZM')`;
          }
          return `TO_TIMESTAMP_TZ('${parsed.format("YYYY-MM-DD HH:mm:ssZ")}', 'YYYY-MM-DD HH24:MI:SSTZH:TZM')`;
        }
      }

      // 2. Handle timestamps with fractional seconds (comma separator)
      if (value.includes(",")) {
        // First replace dots in time with colons, but keep the date dots
        // This regex targets the time part specifically if it uses dots
        const normalizedValue = value.replace(/(\d{2})\.(\d{2})\.(\d{2}),/, "$1:$2:$3,");
        const [datePart, fractionalPart] = normalizedValue.split(",");
        const precision = Math.min(fractionalPart?.length || 0, 9);

        // Try parsing the date part strictly first
        const parsed = moment(datePart, ["DD-MM-YYYY HH:mm:ss", "YYYY-MM-DD HH:mm:ss", "DD.MM.YYYY HH:mm:ss"], true);
        if (parsed.isValid()) {
          return `TO_TIMESTAMP('${parsed.format("YYYY-MM-DD HH:mm:ss")}.${fractionalPart.substring(
            0,
            precision
          )}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}')`;
        }
      }

      // 3. Handle common formats with strict parsing
      // These cover Excel, SQLDeveloper, DBeaver, Toad exports
      const commonFormats = [
        "YYYY-MM-DD HH:mm:ss",
        "DD-MM-YYYY HH:mm:ss",
        "MM/DD/YYYY HH:mm:ss",
        "DD/MM/YYYY HH:mm:ss",
        "YYYY/MM/DD HH:mm:ss",
        "DD.MM.YYYY HH:mm:ss",
        // Date only
        "YYYY-MM-DD",
        "DD-MM-YYYY",
        "MM/DD/YYYY",
        "DD/MM/YYYY",
        "YYYY/MM/DD",
        "DD.MM.YYYY",
        // Textual months
        "DD-MMM-YYYY",
        "DD-MMM-YY",
        "DD-MMM-RR",
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
          "MM/DD/YYYY h:mm:ss A", // Single digit hour
        ];

        for (const format of amPmFormats) {
          const parsed = moment(value, format, true);
          if (parsed.isValid()) {
            return `TO_TIMESTAMP('${parsed.format("YYYY-MM-DD HH:mm:ss")}', 'YYYY-MM-DD HH24:MI:SS')`;
          }
        }

        // Handle AM/PM with fractional seconds
        // e.g. 10/15/2026 12:00:00.000000 AM
        const fractionalAmPmMatch = value.match(/^(.+?)\.(\d+)\s+([AP]M)$/i);
        if (fractionalAmPmMatch) {
          const [_, datePart, fractional, ampm] = fractionalAmPmMatch;
          const formats = [
            "MM/DD/YYYY hh:mm:ss A",
            "M/DD/YYYY hh:mm:ss A",
            "M/D/YYYY hh:mm:ss A",
            "MM/D/YYYY hh:mm:ss A",
            "YYYY-MM-DD hh:mm:ss A",
          ];
          const parsed = moment(`${datePart} ${ampm}`, formats, true);
          if (parsed.isValid()) {
            const precision = Math.min(fractional.length, 9);
            return `TO_TIMESTAMP('${parsed.format("YYYY-MM-DD HH:mm:ss")}.${fractional.substring(
              0,
              precision
            )}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}')`;
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
      throw new Error(`Invalid timestamp format: "${value}". Please use a valid date/time format.`);
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
    // Ensure base64 string and wrap in utl_raw.cast_to_raw
    const base64 = value.replace(/^data:.*;base64,/, "");
    return `utl_raw.cast_to_raw('${base64}')`;
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
