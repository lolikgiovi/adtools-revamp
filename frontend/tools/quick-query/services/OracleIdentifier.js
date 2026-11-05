import { oracleReservedWords } from "../constants.js";

// Lowercase names are written as-is (case-insensitive) unless reserved: a reserved column can only
// exist as a quoted identifier, so it keeps the case Oracle stores it in ("level" or "LEVEL").
export function formatOracleFieldName(fieldName) {
  const name = String(fieldName);
  const lower = name.toLowerCase();
  if (!oracleReservedWords.has(lower)) return lower;
  return name === lower ? `"${lower}"` : `"${name.toUpperCase()}"`;
}
