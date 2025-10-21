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

  return Array.from(vars).sort();
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