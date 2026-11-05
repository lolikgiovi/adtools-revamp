/**
 * Decides whether "Generate & Run" must regenerate SQL before handing it to Run Query.
 * Regenerate when there is no SQL, or when the inputs changed and the editor still holds the
 * untouched generated SQL. Hand-edited SQL is always kept.
 */

// FNV-1a: a cheap, stable digest so large sheets are not kept as strings between clicks.
function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

export function fingerprintQueryInputs({ tableName, queryType, schemaData, inputData, extra = "" }) {
  return hash(JSON.stringify([String(tableName || "").toUpperCase(), queryType, schemaData, inputData, extra]));
}

// What was generated, kept per tab and saved with its draft: a digest instead of the SQL itself.
export function generationRecord(sql, fingerprint) {
  return { sqlHash: hash(String(sql || "").trim()), fingerprint };
}

export function needsRegeneration({ sql, fingerprint, generated }) {
  const current = String(sql || "").trim();
  if (!current) return true;
  if (!generated) return false;
  const untouched = generated.sqlHash ? hash(current) === generated.sqlHash : current === String(generated.sql || "").trim();
  if (!untouched) return false;
  return generated.fingerprint !== fingerprint;
}
