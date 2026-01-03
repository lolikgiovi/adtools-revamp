/**
 * SplitService - Handles SQL splitting logic for Quick Query
 */

/**
 * Split SQL statements safely, respecting quotes and comments
 * @param {string} sql - Raw SQL string
 * @returns {string[]} Array of SQL statements
 */
export function splitSqlStatementsSafely(sql) {
  const src = String(sql || "").replace(/\r\n/g, "\n");
  const out = [];
  let cur = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < src.length) {
    const ch = src[i];
    const next = i + 1 < src.length ? src[i + 1] : "";

    if (inLineComment) {
      cur += ch;
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      cur += ch;
      if (ch === "*" && next === "/") {
        cur += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "-" && next === "-") {
        cur += ch + next;
        i += 2;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        cur += ch + next;
        i += 2;
        inBlockComment = true;
        continue;
      }
    }
    if (!inDouble && ch === "'" && src[i - 1] !== "\\") {
      inSingle = !inSingle;
    } else if (!inSingle && ch === '"' && src[i - 1] !== "\\") {
      inDouble = !inDouble;
    }
    if (!inSingle && !inDouble && ch === ";") {
      cur += ch;
      out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((s) => (s.endsWith(";") ? s : s + ";"));
}

/**
 * Calculate UTF-8 byte size of a string
 * @param {string} s - Input string
 * @returns {number} Byte size
 */
export function calcUtf8Bytes(s) {
  try {
    return new TextEncoder().encode(String(s || "")).length;
  } catch (_) {
    return String(s || "").length * 2; // Fallback approximation
  }
}

/**
 * Extract table name from SQL chunk and add verification SELECT COUNT
 * @param {string} chunk - SQL chunk
 * @returns {string} Chunk with verification query appended
 */
function addVerificationSelect(chunk) {
  try {
    let tableName = null;
    
    // Try to extract table name from different statement types:
    // 1. MERGE INTO table_name
    // 2. INSERT INTO table_name
    // 3. UPDATE table_name SET
    const mergeMatch = String(chunk || "").match(/\bMERGE\s+INTO\s+([a-z0-9_]+\.[a-z0-9_]+)/i);
    const insertMatch = String(chunk || "").match(/\bINSERT\s+INTO\s+([a-z0-9_]+\.[a-z0-9_]+)/i);
    const updateMatch = String(chunk || "").match(/\bUPDATE\s+([a-z0-9_]+\.[a-z0-9_]+)\s+SET/i);
    
    if (mergeMatch) {
      tableName = mergeMatch[1];
    } else if (insertMatch) {
      tableName = insertMatch[1];
    } else if (updateMatch) {
      tableName = updateMatch[1];
    }
    
    if (!tableName) return chunk; // No table found, return as-is
    
    // Add verification query matching QueryGenerationService pattern
    // Uses INTERVAL '5' MINUTE syntax (Oracle SQL standard)
    const verificationQuery = `\n\nSELECT COUNT(*) FROM ${tableName} WHERE updated_time >= SYSDATE - INTERVAL '5' MINUTE;`;
    
    return chunk + verificationQuery;
  } catch (_) {
    return chunk; // On any error, return chunk unchanged
  }
}

/**
 * Group statements by size (bytes)
 * @param {string[]} statements - Array of SQL statements
 * @param {number} maxBytes - Max bytes per chunk
 * @param {string} header - Header to prepend to each chunk
 * @returns {{ chunks: string[], metadata: Array<{size: number, isOversized: boolean}> }} Chunks with metadata
 */
export function groupBySize(statements, maxBytes, header) {
  const chunks = [];
  const metadata = [];
  let cur = "";

  for (const st of statements) {
    // Add blank line after each statement for readability
    const combined = cur ? cur + "\n\n" + st : st;
    const candidateWithHeader = header + combined;

    if (calcUtf8Bytes(candidateWithHeader) <= maxBytes) {
      cur = combined;
    } else {
      if (cur) {
        const chunkWithSelect = addVerificationSelect(header + cur);
        const chunkSize = calcUtf8Bytes(chunkWithSelect);
        chunks.push(chunkWithSelect);
        metadata.push({ size: chunkSize, isOversized: chunkSize > maxBytes });
      }
      cur = st;
    }
  }
  if (cur) {
    const chunkWithSelect = addVerificationSelect(header + cur);
    const chunkSize = calcUtf8Bytes(chunkWithSelect);
    chunks.push(chunkWithSelect);
    metadata.push({ size: chunkSize, isOversized: chunkSize > maxBytes });
  }
  return { chunks, metadata };
}

/**
 * Group statements by query count (MERGE/INSERT/UPDATE)
 * @param {string[]} statements - Array of SQL statements
 * @param {number} count - Number of queries per chunk
 * @param {string} header - Header to prepend to each chunk
 * @param {number} [maxBytes] - Optional max bytes for oversized detection
 * @returns {{ chunks: string[], metadata: Array<{size: number, isOversized: boolean}> }} Chunks with metadata
 */
export function groupByQueryCount(statements, count, header, maxBytes = Infinity) {
  const chunks = [];
  const metadata = [];
  let current = [];
  let queryCount = 0;

  for (const st of statements) {
    const trimmed = st.trim().toUpperCase();
    // Count MERGE, INSERT, UPDATE only
    const isMutating = /^(MERGE|INSERT|UPDATE)\b/.test(trimmed);

    current.push(st);
    if (isMutating) queryCount++;

    if (queryCount >= count) {
      // Add blank line after each statement for readability
      const chunk = header + current.join("\n\n");
      const chunkWithSelect = addVerificationSelect(chunk);
      const chunkSize = calcUtf8Bytes(chunkWithSelect);
      chunks.push(chunkWithSelect);
      metadata.push({ size: chunkSize, isOversized: chunkSize > maxBytes });
      current = [];
      queryCount = 0;
    }
  }
  if (current.length > 0) {
    // Add blank line after each statement for readability
    const chunk = header + current.join("\n\n");
    const chunkWithSelect = addVerificationSelect(chunk);
    const chunkSize = calcUtf8Bytes(chunkWithSelect);
    chunks.push(chunkWithSelect);
    metadata.push({ size: chunkSize, isOversized: chunkSize > maxBytes });
  }
  return { chunks, metadata };
}

/**
 * Derive base name from SQL chunk (extracts table name from INTO clause)
 * @param {string} chunk - SQL chunk
 * @param {number} index - Chunk index
 * @param {string} [fallbackTableName] - Fallback table name
 * @returns {string} Base name for file
 */
export function deriveBaseName(chunk, index, fallbackTableName) {
  try {
    const m = String(chunk || "").match(/\bINTO\s+([a-z0-9_]+\.[a-z0-9_]+)\b/i);
    if (m) return m[1].toUpperCase();
    if (fallbackTableName) return fallbackTableName.toUpperCase();
    return `CHUNK_${index + 1}`;
  } catch (_) {
    return `CHUNK_${index + 1}`;
  }
}
