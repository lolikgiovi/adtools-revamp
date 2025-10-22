/**
 * HTML Template Tool Service
 */

/** Extract Velocity Template Language (VTL) variables from HTML content.
 * Supports patterns: $var, $!var, ${var}, ${var.path}
 * Returns a unique, sorted array of variable references as they appear.
 */
export function extractVtlVariables(html = "") {
  const vars = new Set();

  // ${var} or ${var.path}
  const braceRe = /\$\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}/g;
  let m;
  while ((m = braceRe.exec(html)) !== null) {
    vars.add(m[1]);
  }

  // $var or $!var optionally with .path
  const simpleRe = /\$!?([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g;
  while ((m = simpleRe.exec(html)) !== null) {
    // Exclude matches already captured via ${...}
    // Also skip $${...} (escaped) by checking preceding char
    const idx = m.index;
    const prev = idx > 0 ? html[idx - 1] : '';
    if (prev === '$') continue; // skip $$var
    vars.add(m[1]);
  }

  const result = Array.from(vars).sort();
  // Exclude special-case variable managed by ENV dropdown
  return result.filter((v) => v !== "baseUrl");
}

/**
 * Debounce utility: returns a debounced function.
 */
export function debounce(fn, delay = 250) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

// VTL substitution rendering
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace VTL-style variables in the given HTML string using provided values.
 * Matches: ${var}, ${var.path}, $var, $!var, while skipping $$ escapes.
 */
export function renderVtlTemplate(html = "", values = {}) {
  if (!html || !values || typeof values !== "object") return html;
  const keys = Object.keys(values).filter((k) => values[k] !== undefined && values[k] !== null);
  if (keys.length === 0) return html;

  // Replace longer keys first to avoid partial overlaps (e.g., user vs user.name)
  keys.sort((a, b) => b.length - a.length);

  let rendered = html;
  for (const key of keys) {
    const val = String(values[key]);
    const ek = escapeRegExp(key);

    // ${key}
    const braceRe = new RegExp(`(?<!\\$)\\$\\{\\s*${ek}\\s*\\}`, "g");
    rendered = rendered.replace(braceRe, val);

    // $!key
    const bangRe = new RegExp(`(?<!\\$)\\$!${ek}`, "g");
    rendered = rendered.replace(bangRe, val);

    // $key
    const simpleRe = new RegExp(`(?<!\\$)\\$${ek}`, "g");
    rendered = rendered.replace(simpleRe, val);
  }
  return rendered;
}