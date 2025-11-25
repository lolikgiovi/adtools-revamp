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
      (upperDataType.startsWith("NUMBER") && value.toLowerCase().includes("max")) // any number fields containing "max" phrase
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
        let normalizedValue = value.toString().trim();
        
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
        return this.formatTimestamp(value, fieldName);

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

  formatTimestamp(value, fieldName = null) {
    // Handle special cases
    if (!value) return "NULL";
    const upperValue = value.toUpperCase();
    if (upperValue === "SYSDATE" || upperValue === "CURRENT_TIMESTAMP") {
      return upperValue;
    }

    try {
      // 1. Handle ISO 8601 format with timezone
      const iso8601Regex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/;
      const iso8601Match = value.match(iso8601Regex);
      
      if (iso8601Match) {
        const [, year, month, day, hour, minute, second, fractional, timezone] = iso8601Match;
        
        // Parse the date to validate it
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          throw new Error(`Invalid date: ${value}`);
        }
        
        // Format timezone
        let tzOffset = "+00:00";
        if (timezone && timezone !== "Z") {
          tzOffset = timezone.includes(":") ? timezone : timezone.slice(0, 3) + ":" + timezone.slice(3);
        } else if (!timezone || timezone === "Z") {
          // Convert to local timezone
          const offset = -date.getTimezoneOffset();
          const sign = offset >= 0 ? "+" : "-";
          const absOffset = Math.abs(offset);
          const hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
          const minutes = String(absOffset % 60).padStart(2, "0");
          tzOffset = `${sign}${hours}:${minutes}`;
          
          // Adjust the time to local
          const localDate = new Date(date.getTime());
          const formattedDate = `${year}-${month}-${day} ${String(localDate.getHours()).padStart(2, "0")}:${minute}:${second}`;
          
          if (fractional) {
            const precision = Math.min(fractional.length, 9);
            return `TO_TIMESTAMP_TZ('${formattedDate}.${fractional.substring(0, precision)}${tzOffset}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}TZH:TZM')`;
          }
          return `TO_TIMESTAMP_TZ('${formattedDate}${tzOffset}', 'YYYY-MM-DD HH24:MI:SSTZH:TZM')`;
        }
        
        const formattedDate = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
        
        if (fractional) {
          const precision = Math.min(fractional.length, 9);
          return `TO_TIMESTAMP_TZ('${formattedDate}.${fractional.substring(0, precision)}${tzOffset}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}TZH:TZM')`;
        }
        return `TO_TIMESTAMP_TZ('${formattedDate}${tzOffset}', 'YYYY-MM-DD HH24:MI:SSTZH:TZM')`;
      }

      // 2. Handle timestamps with fractional seconds (comma separator)
      if (value.includes(",")) {
        // First replace dots in time with colons, but keep the date dots/dashes
        const normalizedValue = value.replace(/(\d{2})\.(\d{2})\.(\d{2}),/, "$1:$2:$3,");
        const [datePart, fractionalPart] = normalizedValue.split(",");
        const precision = Math.min(fractionalPart?.length || 0, 9);

        // Try DD-MM-YYYY HH:mm:ss format
        const ddmmyyyyRegex = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
        const match = datePart.match(ddmmyyyyRegex);
        
        if (match) {
          const [, day, month, year, hour, minute, second] = match;
          const date = new Date(year, month - 1, day, hour, minute, second);
          
          if (isNaN(date.getTime())) {
            throw new Error(`Invalid date: ${value}`);
          }
          
          return `TO_TIMESTAMP('${year}-${month}-${day} ${hour}:${minute}:${second}.${fractionalPart.substring(0, precision)}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}')`;
        }
      }

      // 3. Handle common formats with regex
      const formats = [
        // YYYY-MM-DD HH:mm:ss
        { regex: /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/, order: [0, 1, 2, 3, 4, 5] },
        // DD-MM-YYYY HH:mm:ss
        { regex: /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/, order: [2, 1, 0, 3, 4, 5] },
        // MM/DD/YYYY HH:mm:ss
        { regex: /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/, order: [2, 0, 1, 3, 4, 5] },
        // DD/MM/YYYY HH:mm:ss
        { regex: /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/, order: [2, 1, 0, 3, 4, 5] },
        // DD.MM.YYYY HH:mm:ss
        { regex: /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/, order: [2, 1, 0, 3, 4, 5] },
        // YYYY/MM/DD HH:mm:ss
        { regex: /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/, order: [0, 1, 2, 3, 4, 5] },
        // Date only formats
        // YYYY-MM-DD
        { regex: /^(\d{4})-(\d{2})-(\d{2})$/, order: [0, 1, 2], dateOnly: true },
        // DD-MM-YYYY
        { regex: /^(\d{2})-(\d{2})-(\d{4})$/, order: [2, 1, 0], dateOnly: true },
        // MM/DD/YYYY
        { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: [2, 0, 1], dateOnly: true },
        // DD/MM/YYYY
        { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: [2, 1, 0], dateOnly: true },
        // DD.MM.YYYY
        { regex: /^(\d{2})\.(\d{2})\.(\d{4})$/, order: [2, 1, 0], dateOnly: true },
        // YYYY/MM/DD
        { regex: /^(\d{4})\/(\d{2})\/(\d{2})$/, order: [0, 1, 2], dateOnly: true },
        // DD-MMM-YYYY (e.g., 27-Oct-2023)
        { regex: /^(\d{2})-([A-Za-z]{3})-(\d{4})$/, order: [2, 1, 0], dateOnly: true, monthName: true },
        // DD-MMM-YY (e.g., 27-Oct-23)
        { regex: /^(\d{2})-([A-Za-z]{3})-(\d{2})$/, order: [2, 1, 0], dateOnly: true, monthName: true, shortYear: true },
      ];

      for (const format of formats) {
        const match = value.match(format.regex);
        if (match) {
          let year, month, day, hour = "00", minute = "00", second = "00";
          
          if (format.monthName) {
            const monthNames = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
            day = match[format.order[0] + 1];
            month = monthNames[match[format.order[1] + 1].toLowerCase()];
            year = match[format.order[2] + 1];
            
            if (format.shortYear) {
              year = parseInt(year) < 50 ? `20${year}` : `19${year}`;
            }
          } else {
            const parts = [match[1], match[2], match[3]];
            year = parts[format.order[0]];
            month = parts[format.order[1]];
            day = parts[format.order[2]];
            
            if (!format.dateOnly) {
              hour = match[4];
              minute = match[5];
              second = match[6];
            }
          }
          
          // Validate the date
          const date = new Date(year, month - 1, day, hour, minute, second);
          if (isNaN(date.getTime()) || date.getFullYear() != year || date.getMonth() != month - 1 || date.getDate() != day) {
            continue; // Try next format
          }
          
          return `TO_TIMESTAMP('${year}-${month}-${day} ${hour}:${minute}:${second}', 'YYYY-MM-DD HH24:MI:SS')`;
        }
      }

      // 4. Handle AM/PM format
      if (/[AaPpMm]/.test(value)) {
        // Support both with and without fractional seconds
        const amPmRegex = /^(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*([AaPp][Mm])$/;
        const match = value.match(amPmRegex);
        
        if (match) {
          const [, p1, p2, year, hour12, minute, second, fractional, ampm] = match;
          
          // Determine if it's MM/DD or DD/MM based on which makes more sense
          let month, day;
          if (parseInt(p1) > 12) {
            // Must be DD/MM
            day = p1;
            month = p2;
          } else if (parseInt(p2) > 12) {
            // Must be MM/DD
            month = p1;
            day = p2;
          } else {
            // Ambiguous, assume MM/DD (US format)
            month = p1;
            day = p2;
          }
          
          // Convert to 24-hour format
          let hour24 = parseInt(hour12);
          if (ampm.toUpperCase() === "PM" && hour24 !== 12) {
            hour24 += 12;
          } else if (ampm.toUpperCase() === "AM" && hour24 === 12) {
            hour24 = 0;
          }
          
          const date = new Date(year, month - 1, day, hour24, minute, second);
          if (isNaN(date.getTime())) {
            throw new Error(`Invalid date: ${value}`);
          }
          
          const hour24Str = String(hour24).padStart(2, "0");
          const monthStr = month.padStart(2, "0");
          const dayStr = day.padStart(2, "0");
          
          // Handle fractional seconds if present
          if (fractional) {
            const precision = Math.min(fractional.length, 9);
            return `TO_TIMESTAMP('${year}-${monthStr}-${dayStr} ${hour24Str}:${minute}:${second}.${fractional.substring(0, precision)}', 'YYYY-MM-DD HH24:MI:SS.FF${precision}')`;
          }
          
          return `TO_TIMESTAMP('${year}-${monthStr}-${dayStr} ${hour24Str}:${minute}:${second}', 'YYYY-MM-DD HH24:MI:SS')`;
        }
      }

      throw new Error(`Unable to parse date format: ${value}`);
    } catch (error) {
      console.error(`Error parsing timestamp: ${value}`, error);
      throw new Error(`Invalid timestamp format: "${value}". Please use a valid date/time format (e.g., YYYY-MM-DD HH:mm:ss or MM/DD/YYYY HH:mm:ss AM/PM or ISO 8601).`);
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
