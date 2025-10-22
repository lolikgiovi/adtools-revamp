/**
 * Splunk VTL Editor Service
 * Provides formatting, minification, linting, and helpers specialized for Velocity templates used in Splunk.
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

/** Format VTL Splunk template: put each key=value segment on a new line, preserve placeholders */
export function formatVtlTemplate(input = "") {
  const { segments, trailingPipe } = splitByPipesSafely(input);
  const formatted = segments
    .map((seg) => {
      const s = seg.trim();
      if (!s) return "";
      // If this segment looks like a directive line, keep as-is
      if (/^\s*#(if|elseif|else|end|set|foreach|macro|parse|include|define|stop)\b/.test(s)) {
        return s;
      }
      // Normalize key=value spacing without touching value content beyond trim
      const m = s.match(/^\s*([^=|]+?)\s*=\s*(.+?)\s*$/);
      if (m) {
        const key = m[1].trim();
        const value = m[2].trim();
        return `${key}=${value}`;
      }
      // Otherwise return trimmed segment
      return s;
    })
    .filter(Boolean)
    .join(trailingPipe ? "|\n" : "\n");
  // Append trailing pipe only if original had it and there were segments
  return formatted + (formatted && trailingPipe ? "|" : "");
}

// Helper: mask VTL tokens to preserve exact sequences during minify
function maskVtlTokens(input = "") {
  const tokens = [];
  let masked = input;

  // ${...} and $!{...}
  masked = masked.replace(/\$!?\{[\s\S]*?\}/g, (m) => {
    const id = tokens.push(m) - 1;
    return `__VTL_SLOT_${id}__`;
  });
  // $var or $!var with optional .path
  masked = masked.replace(/\$!?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g, (m) => {
    const id = tokens.push(m) - 1;
    return `__VTL_SLOT_${id}__`;
  });
  // VTL directives: #if(...), #set(...), #foreach(...)
  masked = masked.replace(/#(?:if|elseif|set|foreach|macro|parse|include|define)\b[\s\S]*?(?=\n|$)/g, (m) => {
    const id = tokens.push(m) - 1;
    return `__VTL_SLOT_${id}__`;
  });
  return { masked, tokens };
}

function unmaskVtlTokens(masked, tokens) {
  return masked.replace(/__VTL_SLOT_(\d+)__/g, (_, idx) => tokens[Number(idx)] ?? "");
}

/** Minify VTL Splunk template: collapse whitespace around | and =, remove newlines, preserve VTL tokens */
export function minifyVtlTemplate(input = "") {
  const { masked, tokens } = maskVtlTokens(input);
  let s = masked;
  s = s.replace(/[\r\n\t]+/g, "");
  s = s.replace(/\s*\|\s*/g, "|");
  s = s.replace(/\s*=\s*/g, "=");
  s = s.replace(/\s{2,}/g, " ");
  return unmaskVtlTokens(s.trim(), tokens);
}

/** Lint VTL syntax and Splunk key=value segments; returns issues and summary */
export function lintVtlSyntax(input = "") {
  const issues = [];
  const { segments } = splitByPipesSafely(input);
  const keyCounts = new Map();
  const directiveStack = [];

  // Track ${...} balance roughly at the line level
  function checkPlaceholders(line, lineNo) {
    const opens = (line.match(/\$!?\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (closes < opens) {
      issues.push({ line: lineNo, column: Math.max(1, line.indexOf("${") + 1), severity: "error", message: "Unclosed ${...} placeholder" });
    }
    // basic variable validation
    const invalidVars = line.match(/\$!?\{?[^\s}]+\}?/g) || [];
    invalidVars.forEach((v) => {
      // Allow only [A-Za-z_][\w.]* inside braces or simple
      const name = v.replace(/^\$!?\{?/, "").replace(/\}?$/, "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)) {
        issues.push({ line: lineNo, column: 1, severity: "warning", message: `Suspicious variable name: ${name}` });
      }
    });
  }

  segments.forEach((seg, idx) => {
    const lineNo = idx + 1;
    const line = seg.trim();
    if (!line) return;

    // Directive handling
    const dirMatch = line.match(/^#(if|elseif|else|end|set|foreach|macro|parse|include|define|stop)\b/i);
    if (dirMatch) {
      const dir = dirMatch[1].toLowerCase();
      if (dir === "end") {
        if (!directiveStack.length) {
          issues.push({ line: lineNo, column: 1, severity: "error", message: "#end without matching block" });
        } else {
          directiveStack.pop();
        }
      } else if (["if", "foreach", "macro", "define"].includes(dir)) {
        directiveStack.push(dir);
      }
      checkPlaceholders(line, lineNo);
      return;
    }

    // KV validation: expect key=value
    const m = line.match(/^([^=|]+?)\s*=\s*(.+)$/);
    if (!m) {
      issues.push({ line: lineNo, column: 1, severity: "warning", message: "Expected key=value segment" });
    } else {
      const key = m[1].trim();
      const value = m[2];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        issues.push({ line: lineNo, column: 1, severity: "warning", message: `Suspicious key name: ${key}` });
      }
      const count = keyCounts.get(key) || 0;
      keyCounts.set(key, count + 1);
      if (count > 0) {
        issues.push({ line: lineNo, column: 1, severity: "warning", message: `Duplicate key: ${key}` });
      }
      checkPlaceholders(value, lineNo);
    }
  });

  if (directiveStack.length) {
    issues.push({ line: segments.length, column: 1, severity: "error", message: `Unclosed block(s): ${directiveStack.join(", ")}` });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const summary = { errors: errorCount, warnings: warnCount, ok: errorCount === 0 };
  return { issues, summary };
}

/** Convert lint issues to Monaco markers */
export function toMonacoMarkers(issues = []) {
  return issues.map((i) => ({
    severity: i.severity === "error" ? 8 /* Error */ : 4 /* Warning */,
    message: i.message,
    startLineNumber: i.line,
    startColumn: i.column || 1,
    endLineNumber: i.line,
    endColumn: (i.column || 1) + 1,
  }));
}