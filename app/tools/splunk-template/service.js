/**
 * Splunk VTL Editor Service
 * Provides formatting and minification for Velocity templates used in Splunk.
 */

// Utility: safe split by top-level pipe (|) delimiters, skipping inside quotes and VTL placeholders
export function splitByPipesSafely(input = "") {
  const segments = [];
  let cur = "";
  let inSQ = false;
  let inDQ = false;
  let inBrace = false; // for ${...}
  let braceDepth = 0;
  let inBlockComment = false; // VTL #* ... *#
  let inLineComment = false; // VTL ## ... \n
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const prev = i > 0 ? input[i - 1] : "";
    const next2 = input.slice(i, i + 2);

    // Handle comment toggles
    if (!inSQ && !inDQ && !inBrace) {
      if (!inBlockComment && next2 === "#*") {
        inBlockComment = true;
        cur += ch; // keep original text
        continue;
      }
      if (inBlockComment && next2 === "*#") {
        inBlockComment = false;
        cur += ch; // will also add next iteration '*'
        continue;
      }
      if (!inLineComment && next2 === "##") {
        inLineComment = true;
        cur += ch;
        continue;
      }
      if (inLineComment && ch === "\n") {
        inLineComment = false;
      }
    }

    // Track quotes
    if (!inBlockComment) {
      if (!inDQ && ch === "'" && prev !== "\\") inSQ = !inSQ;
      if (!inSQ && ch === '"' && prev !== "\\") inDQ = !inDQ;
    }

    // Track ${...}
    if (!inSQ && !inDQ && !inBlockComment) {
      if (!inBrace && ch === "$" && input[i + 1] === "{") {
        inBrace = true;
        braceDepth = 1;
        cur += ch; // keep
        continue;
      } else if (inBrace) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
        if (braceDepth === 0) inBrace = false;
      }
    }

    // Split logic on top-level '|': do not block inside line comments
    if (!inSQ && !inDQ && !inBrace && !inBlockComment && ch === "|" && prev !== "\\") {
      segments.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }
  segments.push(cur);

  const trailingPipe = input.trimEnd().endsWith("|");
  return { segments, trailingPipe };
}

/**
 * Basic formatting: add newlines after '|' and format Velocity directives with indentation.
 * - Inserts line breaks around #if/#elseif/#else/#foreach/#macro/#define/#set/#end
 * - Indents nested blocks by two spaces per level
 */
export function formatVtlTemplate(input = "") {
  let s = String(input);

  // Newline after pipe segments as specified
  s = s.replace(/\|\s*/g, "|\n");

  // Insert line boundaries around directives
  const patterns = [
    /#if\s*\([^)]*\)/gi,
    /#elseif\s*\([^)]*\)/gi,
    /#foreach\s*\([^)]*\)/gi,
    /#macro\s*\([^)]*\)/gi,
    /#define\s*\([^)]*\)/gi,
    /#set\s*\([^)]*\)/gi,
    /\b#else\b/gi,
    /\b#end\b/gi,
  ];
  patterns.forEach((re) => {
    s = s.replace(re, (m) => `\n${m}\n`);
  });

  // Normalize whitespace and collapse consecutive blank lines
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{2,}/g, "\n");

  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let indentLevel = 0;
  const out = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const isEnd = /^#end\b/.test(lower);
    const isElse = /^#else\b/.test(lower);
    const isElseIf = /^#elseif\b/.test(lower);
    const isOpen = /^(#if|#foreach|#macro|#define)\b/.test(lower);

    // Reduce indentation before writing for closing/transition directives
    if (isEnd || isElse || isElseIf) {
      indentLevel = Math.max(indentLevel - 1, 0);
    }

    out.push("  ".repeat(indentLevel) + line);

    // Increase indentation after writing for opening directives and else/elseif bodies
    if (isOpen) {
      indentLevel += 1;
    } else if (isElse || isElseIf) {
      indentLevel += 1;
    }
  }

  return out.join("\n");
}

/**
 * Basic minify: remove newline(s) and surrounding spaces immediately after '|'.
 * Leaves other whitespace/newlines untouched.
 */
export function minifyVtlTemplate(input = "") {
  let s = String(input);
  // Keep existing rule: remove newline(s) immediately after '|'
  s = s.replace(/\|\s*\r?\n\s*/g, "|");
  // Collapse newlines around Velocity directives
  s = s.replace(/\r?\n\s*(#(?:if|elseif|else|foreach|macro|define|set|end)\b)/gi, "$1");
  s = s.replace(/(#(?:if|elseif|else|foreach|macro|define|set|end)\b)\s*\r?\n/gi, "$1");
  // Remove indentation spaces at start of lines left by format
  s = s.replace(/\n[ \t]+/g, "\n");
  return s;
}

export function extractFieldsFromTemplate(input = "") {
  const { segments } = splitByPipesSafely(String(input));
  const rows = [];
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg || seg.startsWith("##")) continue;

    // Skip directives like #if, #foreach etc.
    if (/^#(if|elseif|else|end|set|foreach|macro|parse|include|define|stop)\b/i.test(seg)) {
      continue;
    }

    // Allow empty right-hand value
    const m = seg.match(/^([^=|]+?)\s*=\s*(.*)$/);
    if (!m) continue;
    const field = m[1].trim();
    const valueExpr = m[2].trim();

    const variables = new Set();
    const functions = new Set();

    // Braced variables e.g. $!{context.name.toUpperCase()}
    const braced = valueExpr.match(/\$!\{([^}]+)\}|\$\{([^}]+)\}/g) || [];
    for (const t of braced) {
      const inner = t.replace(/^\$!?\{/, "").replace(/\}$/, "");
      const pathMatch = inner.match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/);
      if (pathMatch) variables.add(pathMatch[0]);
      const methodRe = /\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let mm;
      while ((mm = methodRe.exec(inner))) {
        functions.add(mm[1]);
      }
      const funcRe = /(^|[^#])\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let ff;
      while ((ff = funcRe.exec(inner))) {
        functions.add(ff[2]);
      }
    }

    const unbraced = valueExpr.match(/\$!?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g) || [];
    for (const t of unbraced) {
      const path = t.replace(/^\$!?/, "");
      variables.add(path);
    }

    const methodCalls = valueExpr.match(/\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g) || [];
    for (const mth of methodCalls) {
      const name = mth.replace(/^\./, "").replace(/\(.*/, "");
      functions.add(name);
    }
    const funcCalls = [];
    {
      const re = /(^|[^#])\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let match;
      while ((match = re.exec(valueExpr))) {
        funcCalls.push(match[2]);
      }
    }
    for (const f of funcCalls) functions.add(f);

    const varsArr = Array.from(variables);
    const funcsArr = Array.from(functions);

    // choose a primary variable path (prefer context.*)
    let primaryVar = null;
    if (varsArr.length > 0) {
      primaryVar = varsArr.find((p) => /^context\b/i.test(p)) || varsArr[0];
      // remove trailing method segment if matches any collected function name
      for (const fn of funcsArr) {
        const dotFn = `.${fn}`;
        if (primaryVar.endsWith(dotFn)) {
          primaryVar = primaryVar.slice(0, -dotFn.length);
        }
      }
    }

    const usesContext = varsArr.some((p) => /^context\b/i.test(p));
    const source = primaryVar ? (usesContext ? "context" : "variable") : "hardcoded";

    // Compute display value: either hardcoded literal or variable name without context.
    let displayValue = valueExpr;
    if (primaryVar) {
      displayValue = primaryVar.replace(/^context\./i, "");
    }

    rows.push({ field, source, value: displayValue, variables: varsArr.join(", "), functions: funcsArr.join(", ") });
  }
  return rows;
}
