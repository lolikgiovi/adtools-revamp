/**
 * Timestamp utilities for GMT+7 timezone handling
 * All timestamps are stored and compared using GMT+7 formatted strings
 */

/**
 * Returns current timestamp in ISO format with GMT+7 offset
 * @param {number} offsetMs - Optional offset in milliseconds
 * @returns {string} - ISO timestamp like "2026-01-05T12:00:00.000+07:00"
 */
export function tsGmt7(offsetMs = 0) {
  const base = Date.now() + 7 * 60 * 60 * 1000 + (offsetMs || 0);
  const d = new Date(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${y}-${m}-${day}T${hh}:${mi}:${ss}.${ms}+07:00`;
}

/**
 * Returns current timestamp in plain format with GMT+7 offset
 * @param {number} offsetMs - Optional offset in milliseconds
 * @returns {string} - Plain timestamp like "2026-01-05 12:00:00+07:00"
 */
export function tsGmt7Plain(offsetMs = 0) {
  const base = Date.now() + 7 * 60 * 60 * 1000 + (offsetMs || 0);
  const d = new Date(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mi}:${ss}+07:00`;
}

/**
 * Returns current date in GMT+7 timezone
 * @param {number} offsetMs - Optional offset in milliseconds
 * @returns {string} - Date like "2026-01-05"
 */
export function dayGmt7(offsetMs = 0) {
  const base = Date.now() + 7 * 60 * 60 * 1000 + (offsetMs || 0);
  const d = new Date(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Flexibly parses a timestamp from various formats
 * @param {string|number} x - Timestamp to parse (epoch ms, ISO string, etc.)
 * @returns {number} - Epoch milliseconds, or 0 if invalid
 */
export function parseTsFlexible(x) {
  if (typeof x === "number") return x;
  const s = String(x || "");
  const num = Number(s);
  if (!Number.isNaN(num)) return num;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Converts an ISO timestamp string to GMT+7 plain format
 * @param {string} s - ISO timestamp string
 * @returns {string|null} - Plain GMT+7 format or null if invalid
 */
export function tsToGmt7Plain(s) {
  try {
    const t = Date.parse(String(s || ""));
    if (Number.isNaN(t)) return null;
    const d = new Date(t + 7 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mi}:${ss}+07:00`;
  } catch (_) {
    return null;
  }
}
