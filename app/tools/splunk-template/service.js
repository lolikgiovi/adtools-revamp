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
  let inLineComment = false;  // VTL ## ... \n
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

    // Split logic on top-level '|'
    if (!inSQ && !inDQ && !inBrace && !inBlockComment && !inLineComment && ch === "|" && prev !== "\\") {
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