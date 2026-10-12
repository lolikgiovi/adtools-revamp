/**
 * Oracle Import Error Service
 *
 * Turns errors thrown during the "Import From Oracle" flows into an enriched,
 * human-readable description while preserving the original Oracle error detail.
 *
 * Errors can arrive in several shapes:
 *  - a JSON string from the Tauri layer, e.g.
 *    `{"code":12514,"message":"ORA-12514: ...","hint":"..."}`
 *  - an `OracleSidecarError` (friendly message + `rawMessage` + `hint`)
 *  - a structured `{ code, message, hint }` object
 *  - a plain `Error` or string for validation / sidecar lifecycle failures
 */

// Common Oracle / driver errors -> readable title and remediation hint.
const ORACLE_ERRORS = {
  "ORA-00001": { title: "Unique constraint violated", hint: "A row with the same primary or unique key already exists." },
  "ORA-00054": { title: "Resource busy", hint: "Another session holds a lock on the object. Try again once it is released." },
  "ORA-00060": { title: "Deadlock detected", hint: "Two sessions are blocking each other. Retry the operation." },
  "ORA-00904": { title: "Invalid column name", hint: "Check the column exists and is spelled correctly." },
  "ORA-00911": { title: "Invalid character in SQL", hint: "Remove unsupported characters, such as a trailing semicolon." },
  "ORA-00918": { title: "Column ambiguously defined", hint: "Qualify the duplicated column with its table or alias." },
  "ORA-00923": { title: "Missing FROM keyword", hint: "Check the SELECT statement is complete." },
  "ORA-00933": { title: "SQL command not properly ended", hint: "Check the SQL syntax against the target Oracle version." },
  "ORA-00936": { title: "Missing expression", hint: "A required expression or operand is missing from the query." },
  "ORA-00942": { title: "Table or view does not exist", hint: "Check the schema and table name, and that the account can access it." },
  "ORA-01017": { title: "Invalid username or password", hint: "Update the credentials in Settings → Oracle Connections." },
  "ORA-01031": { title: "Insufficient privileges", hint: "Request SELECT access to the object from your DBA." },
  "ORA-01400": { title: "Cannot insert NULL", hint: "A NOT NULL column received no value." },
  "ORA-01403": { title: "No data found", hint: "The query returned no rows." },
  "ORA-01427": { title: "Single-row subquery returns multiple rows", hint: "Add a filter so the subquery returns at most one row." },
  "ORA-01476": { title: "Divisor is equal to zero", hint: "Guard against zero in the division expression." },
  "ORA-01555": { title: "Snapshot too old", hint: "The query ran too long. Narrow the result set and retry." },
  "ORA-01722": { title: "Invalid number", hint: "A value could not be converted to a number." },
  "ORA-02291": { title: "Foreign key constraint violated", hint: "The referenced parent row does not exist." },
  "ORA-03113": { title: "End-of-file on communication channel", hint: "The connection dropped unexpectedly. Retry." },
  "ORA-03114": { title: "Not connected to Oracle", hint: "The connection was lost. Reconnect and retry." },
  "ORA-03135": { title: "Connection lost contact", hint: "The database closed the connection. Retry." },
  "ORA-03136": { title: "Query exceeded the timeout limit", hint: "Try a simpler query or add a WHERE clause to limit rows." },
  "ORA-04043": { title: "Object does not exist", hint: "Check the object name and schema." },
  "ORA-12154": { title: "TNS name could not be resolved", hint: "Verify the connection string format: host:port/service_name." },
  "ORA-12170": { title: "Connection timed out", hint: "The database may be unreachable or slow. Check network and firewall." },
  "ORA-12505": { title: "Listener does not know the service", hint: "Verify the service/SID exists on the target host." },
  "ORA-12514": { title: "Service name not found", hint: "Verify the service name exists on the target database." },
  "ORA-12537": { title: "Connection closed", hint: "The database closed the connection. Retry." },
  "ORA-12541": { title: "No listener at the specified host/port", hint: "Check the database is running and the port is correct." },
  "ORA-12543": { title: "Connection refused", hint: "The database may be down or blocked by a firewall." },
  "ORA-12545": { title: "Target host or object does not exist", hint: "Check the host name in the connection string." },
  "ORA-12547": { title: "Lost contact with the database", hint: "The connection dropped. Retry." },
  "ORA-12560": { title: "TNS protocol adapter error", hint: "Check the Oracle client/protocol configuration." },
  "ORA-28000": { title: "Account is locked", hint: "Contact your DBA to unlock the account." },
  "ORA-28001": { title: "Password has expired", hint: "Change the password and update it in Settings." },
  "ORA-28002": { title: "Password will expire soon", hint: "Change the password before it expires." },
  "DPY-6005": { title: "Cannot connect to database", hint: "Check network connectivity and the connection string format." },
  "DPY-4011": { title: "Connection closed", hint: "The database connection was lost. Retry." },
};

// Oracle-family error labels found in a raw message, e.g. ORA-12154 or DPY-6005.
const CODE_PATTERN = /\b(ORA|DPY|NJS|PLS|IMP)-(\d{1,5})\b/i;

function formatLabel(family, digits) {
  const name = family.toUpperCase();
  // Oracle numeric codes are conventionally zero-padded to five digits (ORA-00942).
  return name === "ORA" ? `${name}-${digits.padStart(5, "0")}` : `${name}-${digits}`;
}

function labelFromNumericCode(code) {
  const numeric = Number(code);
  return Number.isFinite(numeric) && numeric > 0 ? formatLabel("ORA", String(numeric)) : null;
}

// Pull the raw message / hint / code out of the many shapes an error can take.
function normalizeError(error) {
  if (error == null) return { message: "", hint: null, code: null };

  if (typeof error === "object") {
    const rawMessage =
      typeof error.rawMessage === "string" && error.rawMessage ? error.rawMessage : typeof error.message === "string" ? error.message : "";
    const hint = typeof error.hint === "string" && error.hint ? error.hint : null;
    const stringLabel = typeof error.code === "string" && /^[A-Za-z]+-\d+$/.test(error.code) ? error.code.toUpperCase() : null;
    return { message: rawMessage, hint, code: stringLabel || error.code };
  }

  return { message: String(error).trim(), hint: null, code: null };
}

// If the message is a JSON error payload, unwrap it so the Oracle detail is visible.
function unwrapMessage({ message, hint, code }) {
  const trimmed = (message || "").trim();
  if (!trimmed.startsWith("{")) return { message: trimmed, hint, code };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
      return {
        message: parsed.message,
        hint: hint || (typeof parsed.hint === "string" ? parsed.hint : null),
        code: code ?? parsed.code,
      };
    }
  } catch {
    // Not JSON; treat the original text as the message.
  }
  return { message: trimmed, hint, code };
}

function withCodePrefix(label, message) {
  const text = (message || "").trim();
  if (!label) return text || null;
  if (!text) return label;
  return new RegExp(`^${label}[\\s:]`, "i").test(text) ? text : `${label}: ${text}`;
}

function stripCodePrefix(message) {
  return (message || "").replace(/^(ORA|DPY|NJS|PLS|IMP)-\d{1,5}[\s:]*/i, "").trim();
}

/**
 * Describe an error surfaced during an Oracle import.
 * @param {unknown} error - A thrown error, a Tauri JSON payload, or a plain message.
 * @returns {{ isOracle: boolean, code: string|null, title: string, hint: string|null, detail: string|null }}
 */
export function describeOracleImportError(error) {
  const { message, hint, code } = unwrapMessage(normalizeError(error));

  const detected = CODE_PATTERN.exec(message);
  const label = detected ? formatLabel(detected[1], detected[2]) : labelFromNumericCode(code);
  const known = label ? ORACLE_ERRORS[label] : null;

  if (!label) {
    const title = message || "An unknown error occurred.";
    return { isOracle: false, code: null, title, hint, detail: null };
  }

  const title = known?.title || stripCodePrefix(message) || `Oracle error ${label}`;
  return {
    isOracle: true,
    code: label,
    title,
    hint: hint || known?.hint || null,
    detail: withCodePrefix(label, message),
  };
}
