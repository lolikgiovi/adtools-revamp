/**
 * Splunk VTL Editor Service
 * Provides formatting and minification for Velocity templates used in Splunk.
 */

import { Compile, parse } from "velocityjs";

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

  // Insert line boundaries around directives using balanced parentheses detection
  const wrapDirectives = (text) => {
    const dirs = ["#if", "#elseif", "#foreach", "#macro", "#define", "#set"];
    let out = "";
    let i = 0;
    while (i < text.length) {
      if (text[i] === "#") {
        const lowerRest = text.slice(i).toLowerCase();
        let matched = null;
        for (const d of dirs) {
          if (lowerRest.startsWith(d)) {
            matched = d;
            break;
          }
        }
        if (matched) {
          let j = i + matched.length;
          while (j < text.length && /\s/.test(text[j])) j++;
          if (text[j] === "(") {
            let depth = 1;
            let k = j + 1;
            let inSQ = false,
              inDQ = false;
            let prev = "";
            while (k < text.length) {
              const ch = text[k];
              if (!inDQ && ch === "'" && prev !== "\\") {
                inSQ = !inSQ;
              } else if (!inSQ && ch === '"' && prev !== "\\") {
                inDQ = !inDQ;
              } else if (!inSQ && !inDQ) {
                if (ch === "(") depth++;
                else if (ch === ")") {
                  depth--;
                  if (depth === 0) break;
                }
              }
              prev = ch;
              k++;
            }
            const inner = text.slice(j + 1, k);
            const hasContent = inner.trim().length > 0;
            out += "\n" + text.slice(i, k + 1) + (hasContent ? "\n" : "");
            i = k + 1;
            continue;
          }
        }
      }
      out += text[i];
      i++;
    }
    return out;
  };

  // Add newline after [ ... ] blocks when content is non-empty
  const wrapBrackets = (text) => {
    let out = "";
    let i = 0;
    let inSQ = false,
      inDQ = false;
    let prev = "";
    while (i < text.length) {
      const ch = text[i];
      if (!inDQ && ch === "'" && prev !== "\\") {
        inSQ = !inSQ;
        out += ch;
        i++;
        prev = ch;
        continue;
      }
      if (!inSQ && ch === '"' && prev !== "\\") {
        inDQ = !inDQ;
        out += ch;
        i++;
        prev = ch;
        continue;
      }
      if (!inSQ && !inDQ && ch === "[") {
        let depth = 1;
        let k = i + 1;
        let localInSQ = false,
          localInDQ = false;
        let localPrev = "";
        while (k < text.length) {
          const c = text[k];
          if (!localInDQ && c === "'" && localPrev !== "\\") {
            localInSQ = !localInSQ;
          } else if (!localInSQ && c === '"' && localPrev !== "\\") {
            localInDQ = !localInDQ;
          } else if (!localInSQ && !localInDQ) {
            if (c === "[") depth++;
            else if (c === "]") {
              depth--;
              if (depth === 0) break;
            }
          }
          localPrev = c;
          k++;
        }
        const inner = text.slice(i + 1, k);
        out += text.slice(i, k + 1) + (inner.trim().length > 0 ? "\n" : "");
        i = k + 1;
        prev = "";
        continue;
      }
      out += ch;
      prev = ch;
      i++;
    }
    return out;
  };

  s = wrapDirectives(s);
  s = wrapBrackets(s);

  // Always wrap #else and #end with newlines
  s = s.replace(/\b#else\b/gi, (m) => `\n${m}\n`);
  s = s.replace(/\b#end\b/gi, (m) => `\n${m}\n`);

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

  // Ensure newline after non-empty [ ... ] blocks
  const ensureBracketNewline = (text) => {
    let out = "";
    let i = 0;
    let inSQ = false,
      inDQ = false;
    let prev = "";
    while (i < text.length) {
      const ch = text[i];
      if (!inDQ && ch === "'" && prev !== "\\") {
        inSQ = !inSQ;
        out += ch;
        i++;
        prev = ch;
        continue;
      }
      if (!inSQ && ch === '"' && prev !== "\\") {
        inDQ = !inDQ;
        out += ch;
        i++;
        prev = ch;
        continue;
      }
      if (!inSQ && !inDQ && ch === "[") {
        let depth = 1;
        let k = i + 1;
        let localInSQ = false,
          localInDQ = false;
        let localPrev = "";
        while (k < text.length) {
          const c = text[k];
          if (!localInDQ && c === "'" && localPrev !== "\\") {
            localInSQ = !localInSQ;
          } else if (!localInSQ && c === '"' && localPrev !== "\\") {
            localInDQ = !localInDQ;
          } else if (!localInSQ && !localInDQ) {
            if (c === "[") depth++;
            else if (c === "]") {
              depth--;
              if (depth === 0) break;
            }
          }
          localPrev = c;
          k++;
        }
        const inner = text.slice(i + 1, k);
        // Find next non-whitespace char after closing bracket
        let p = k + 1;
        while (p < text.length && /\s/.test(text[p])) p++;
        const nextNonSpace = text[p] || "";
        const hasContent = inner.trim().length > 0;
        let sep = "";
        if (hasContent) {
          // If next token is a pipe, no space; otherwise insert a single space
          sep = nextNonSpace === "|" ? "" : " ";
        }
        out += text.slice(i, k + 1) + sep;
        i = p;
        prev = "";
        continue;
      }
      out += ch;
      prev = ch;
      i++;
    }
    return out;
  };
  s = ensureBracketNewline(s);

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

  // Strip leading Velocity directives (#if/#elseif/#else/#end/#set/etc.) with balanced parentheses
  const stripLeadingDirectives = (s) => {
    let t = String(s).trimStart();
    while (t.startsWith("#")) {
      const lower = t.toLowerCase();
      const m = lower.match(/^(#(?:if|elseif|foreach|macro|define|set|parse|include|stop|else|end))/);
      if (!m) break;
      const name = m[1];
      t = t.slice(name.length);
      t = t.replace(/^\s+/, "");
      if (name !== "#else" && name !== "#end" && name !== "#stop") {
        if (t[0] === "(") {
          let depth = 1;
          let k = 1;
          let inSQ = false,
            inDQ = false;
          let prev = "";
          while (k < t.length) {
            const ch = t[k];
            if (!inDQ && ch === "'" && prev !== "\\") inSQ = !inSQ;
            else if (!inSQ && ch === '"' && prev !== "\\") inDQ = !inDQ;
            else if (!inSQ && !inDQ) {
              if (ch === "(") depth++;
              else if (ch === ")") {
                depth--;
                if (depth === 0) {
                  k++;
                  break;
                }
              }
            }
            prev = ch;
            k++;
          }
          t = t.slice(k);
        }
      }
      t = t.trimStart();
    }
    return t.trimStart();
  };

  // Strip a leading [ ... ] block (e.g., Splunk subsearch) with balanced brackets
  const stripLeadingBrackets = (s) => {
    let t = String(s).trimStart();
    let i = 0;
    while (i < t.length && t[i] === "[") {
      let k = i + 1;
      let depth = 1;
      let inSQ = false,
        inDQ = false;
      let prev = "";
      while (k < t.length) {
        const ch = t[k];
        if (!inDQ && ch === "'" && prev !== "\\") inSQ = !inSQ;
        else if (!inSQ && ch === '"' && prev !== "\\") inDQ = !inDQ;
        else if (!inSQ && !inDQ) {
          if (ch === "[") depth++;
          else if (ch === "]") {
            depth--;
            if (depth === 0) break;
          }
        }
        prev = ch;
        k++;
      }
      if (depth !== 0) break;
      i = k + 1;
      while (i < t.length && /\s/.test(t[i])) i++;
    }
    return t.slice(i).trimStart();
  };

  for (const raw of segments) {
    let seg = String(raw).trim();
    if (!seg || seg.startsWith("##")) continue;

    // Previously, segments starting with directives were skipped entirely.
    // Now strip leading directives and brackets, then detect key=value.
    seg = stripLeadingDirectives(seg);
    seg = stripLeadingBrackets(seg);
    if (!seg) continue;

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
      // collect method calls within
      const methodRe = /\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let mm;
      while ((mm = methodRe.exec(inner))) {
        functions.add(mm[1]);
      }
      // collect function calls like format(foo)
      const funcRe = /(^|[^#])\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let ff;
      while ((ff = funcRe.exec(inner))) {
        functions.add(ff[2]);
      }
    }

    // Unbraced variables e.g. $context.foo.toUpperCase()
    const unbraced = valueExpr.match(/\$!?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g) || [];
    for (const t of unbraced) {
      const path = t.replace(/^\$!?/, "");
      variables.add(path);
    }

    // Method calls outside braces
    const methodCalls = valueExpr.match(/\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g) || [];
    for (const mth of methodCalls) {
      const name = mth.replace(/^\./, "").replace(/\(.*/, "");
      functions.add(name);
    }
    // Stand-alone function calls not preceded by '#'
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

    rows.push({
      field,
      originalField: field,
      source,
      value: displayValue,
      variables: varsArr.join(", "),
      functions: funcsArr.join(", "),
      expression: valueExpr,
      originalSource: source,
      originalValue: displayValue,
    });
  }
  return rows;
}

function localDateFromMatch(match) {
  const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = "0"] = match;
  const date = new Date(+year, +month - 1, +day, +hour, +minute, +second, +fraction.slice(0, 3).padEnd(3, "0"));
  return Number.isNaN(date.getTime()) ? null : date;
}

// SimpleDateFormat.parse(String) accepts a valid prefix and ignores the remaining suffix.
// Following TemplateFormatter's declared order, the non-millisecond patterns therefore win first.
function parseTemplateFormatterDate(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;

  const dateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})(?: |T)(\d{2}):(\d{2}):(\d{2})/);
  if (dateTime) return localDateFromMatch(dateTime);
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return localDateFromMatch(dateOnly);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  return compact ? localDateFromMatch(compact) : null;
}

function parseDateFormatterDate(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;

  // Timestamp.valueOf: yyyy-[m]m-[d]d hh:mm:ss[.f...]
  const timestamp = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/);
  if (timestamp) return localDateFromMatch(timestamp);

  // The subsequent yyyy-MM-dd SimpleDateFormat parse accepts a valid date prefix.
  const dateOnly = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return dateOnly ? localDateFromMatch(dateOnly) : null;
}

function localeName(locale) {
  const requested = String(locale || "").replace("_", "-");
  try {
    new Intl.DateTimeFormat(requested || undefined).format();
    return requested || undefined;
  } catch (_) {
    return undefined;
  }
}

function javaDateFormatDate(date, pattern, locale) {
  const formatterLocale = localeName(locale);
  const getPart = (options) => new Intl.DateTimeFormat(formatterLocale, options).format(date);
  const hour24 = date.getHours();
  const replacements = {
    yyyy: String(date.getFullYear()).padStart(4, "0"),
    MMMM: getPart({ month: "long" }),
    MMM: getPart({ month: "short" }),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    M: String(date.getMonth() + 1),
    dd: String(date.getDate()).padStart(2, "0"),
    d: String(date.getDate()),
    HH: String(hour24).padStart(2, "0"),
    H: String(hour24),
    hh: String(hour24 % 12 || 12).padStart(2, "0"),
    h: String(hour24 % 12 || 12),
    mm: String(date.getMinutes()).padStart(2, "0"),
    m: String(date.getMinutes()),
    ss: String(date.getSeconds()).padStart(2, "0"),
    s: String(date.getSeconds()),
    SSS: String(date.getMilliseconds()).padStart(3, "0"),
    a: hour24 < 12 ? "AM" : "PM",
    Z: `${-date.getTimezoneOffset() >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(date.getTimezoneOffset()) / 60)).padStart(2, "0")}${String(
      Math.abs(date.getTimezoneOffset()) % 60,
    ).padStart(2, "0")}`,
  };
  return String(pattern).replace(/'([^']*)'|yyyy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|a|Z/g, (token, literal) =>
    literal !== undefined ? literal : replacements[token],
  );
}

function formatParsedDate(input, pattern, locale) {
  const date = parseTemplateFormatterDate(input);
  return date ? javaDateFormatDate(date, pattern, locale) : String(input ?? "");
}

function decimalParts(input) {
  const match = String(input ?? "")
    .trim()
    .match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const exponent = Number(match[4] || 0);
  let digits = `${match[2]}${match[3] || ""}`.replace(/^0+(?=\d)/, "");
  let scale = (match[3] || "").length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  const integer = BigInt(`${match[1] || ""}${digits || "0"}`);
  return { integer, negative: match[1] === "-", scale };
}

function addDecimals(values) {
  const parts = values.map(decimalParts);
  if (parts.some((part) => !part)) return null;
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const total = parts.reduce((sum, part) => sum + part.integer * 10n ** BigInt(scale - part.scale), 0n);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const value = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return `${negative ? "-" : ""}${value}`;
}

function decimalFormat(input, grouping, decimalSeparator = ".", groupingSeparator = ",") {
  const source = String(input ?? "").trim();
  const parts = decimalParts(source);
  if (!parts) return String(input ?? "");

  const absolute = parts.integer < 0n ? -parts.integer : parts.integer;
  let cents;
  if (parts.scale <= 2) {
    cents = absolute * 10n ** BigInt(2 - parts.scale);
  } else {
    const divisor = 10n ** BigInt(parts.scale - 2);
    const quotient = absolute / divisor;
    const remainder = absolute % divisor;
    const half = divisor / 2n;
    const roundUp = remainder > half || (remainder === half && quotient % 2n !== 0n);
    cents = quotient + (roundUp ? 1n : 0n);
  }

  let whole = (cents / 100n).toString();
  if (grouping) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupingSeparator);
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${parts.negative ? "-" : ""}${whole}${decimalSeparator}${fraction}`;
}

function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const words = [];
  const bitLength = bytes.length * 8;
  bytes.forEach((byte, index) => (words[index >> 2] = (words[index >> 2] || 0) | (byte << (24 - (index % 4) * 8))));
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (24 - (bitLength % 32)));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;
  const constants = [];
  const initial = [];
  for (let candidate = 2; constants.length < 64; candidate++) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor++) if (candidate % divisor === 0) prime = false;
    if (!prime) continue;
    if (initial.length < 8) initial.push((Math.sqrt(candidate) * 0x100000000) | 0);
    constants.push((Math.cbrt(candidate) * 0x100000000) | 0);
  }
  const rotate = (number, amount) => (number >>> amount) | (number << (32 - amount));
  const hash = initial.slice();
  for (let offset = 0; offset < words.length; offset += 16) {
    const schedule = words.slice(offset, offset + 16);
    for (let index = 0; index < 16; index++) schedule[index] ||= 0;
    for (let index = 16; index < 64; index++) {
      const x = schedule[index - 15];
      const y = schedule[index - 2];
      schedule[index] =
        (schedule[index - 16] +
          (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
          schedule[index - 7] +
          (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))) |
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[index] + schedule[index]) | 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [a, b, c, d, e, f, g, h] = [(first + second) | 0, a, b, c, (d + first) | 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => (hash[index] = (hash[index] + value) | 0));
  }
  return hash.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

export const templateFormatter = {
  dateShort: (input, locale) => (locale != null ? formatParsedDate(input, "d/M/yyyy", locale) : String(input ?? "")),
  dateLong: (input, locale) => (locale != null ? formatParsedDate(input, "d MMM yyyy", locale).replace("Agt", "Agu") : String(input ?? "")),
  dateFull: (input, locale) => (locale != null ? formatParsedDate(input, "d MMMM yyyy", locale) : String(input ?? "")),
  time12: (input, locale) => (locale != null ? formatParsedDate(input, "h:mm:ss a", locale) : String(input ?? "")),
  time24: (input, locale) => (locale != null ? formatParsedDate(input, "HH:mm:ss", locale) : String(input ?? "")),
  formatDate: (input, pattern, locale) => (locale != null ? formatParsedDate(input, pattern, locale) : String(input ?? "")),
  amount: (input) => decimalFormat(input, true),
  smsCurrency: (input) => decimalFormat(input, false),
  trimLeft10: (input) => (input == null ? input : String(input).slice(0, 10)),
  trimLeft11: (input) => (input == null ? input : String(input).slice(0, 11)),
  trimLeft25: (input) => (input == null ? input : String(input).slice(0, 25).trim()),
  mask: (input) => {
    if (input == null) return input;
    const right = String(input).slice(-8);
    return `****${right.slice(Math.min(4, right.length))}`;
  },
  currency: (input) => {
    const source = String(input ?? "").replace(/,+/g, "");
    return decimalFormat(source, true, ",", ".");
  },
  add: (...numbers) => {
    if (numbers.some((number) => number === null)) return `[${numbers.map((number) => String(number)).join(", ")}]`;
    return (
      addDecimals(numbers.map((number) => (String(number ?? "").trim() ? number : "0"))) ??
      `[${numbers.map((number) => String(number)).join(", ")}]`
    );
  },
  encrypt: (input, salt) => sha256(`${input === null ? "null" : (input ?? "")}${salt === null ? "null" : (salt ?? "")}`),
  replaceByRegex: (input, regex, replacement) =>
    input == null ? null : String(input).replace(new RegExp(String(regex), "g"), String(replacement ?? "")),
};

export const dateFormatter = {
  get: (pattern) => javaDateFormatDate(new Date(), pattern),
  convertDate: (input, pattern) => {
    const date = parseDateFormatterDate(input);
    return date ? javaDateFormatDate(date, pattern) : String(input ?? "");
  },
};

function buildParameterContext(parameters) {
  const values = parameters && typeof parameters === "object" && !Array.isArray(parameters) ? parameters : {};
  const runtime = { ...values, date: dateFormatter };
  return { ...runtime, context: runtime, format: templateFormatter };
}

/** Render like SplunkV2EventTemplate, including its context, format and date helpers. */
export function renderSplunkTemplate(template = "", parameters = {}) {
  const ast = parse(String(template));
  const silenceReferences = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "references") node.leader = "$!";
    Object.values(node).forEach(silenceReferences);
  };
  silenceReferences(ast);
  return new Compile(ast).render(buildParameterContext(parameters));
}

function astReferencePath(node) {
  if (!node || node.type !== "references" || !node.id) return "";
  const parts = [node.id];
  for (const segment of node.path || []) {
    if (segment.type !== "property" || !segment.id) break;
    parts.push(segment.id);
  }
  return parts.join(".");
}

function collectParameterPaths(node, locals, paths) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    const header = node[0];
    if (header?.type === "foreach") {
      collectParameterPaths(header.from, locals, paths);
      const blockLocals = new Set(locals);
      blockLocals.add(header.to);
      node.slice(1).forEach((child) => collectParameterPaths(child, blockLocals, paths));
      return;
    }
    if (header?.type === "macro") {
      const blockLocals = new Set(locals);
      (header.args || []).forEach((argument) => blockLocals.add(String(argument?.id || argument || "").replace(/^\$/, "")));
      node.slice(1).forEach((child) => collectParameterPaths(child, blockLocals, paths));
      return;
    }
    node.forEach((child) => {
      if (child?.type === "set") {
        collectParameterPaths(child.equal?.[1], locals, paths);
        const assigned = astReferencePath(child.equal?.[0]).split(".")[0];
        if (assigned) locals.add(assigned);
      } else {
        collectParameterPaths(child, locals, paths);
      }
    });
    return;
  }
  if (node.type === "references") {
    let path = astReferencePath(node);
    const root = path.split(".")[0];
    if (root === "context") path = path.slice("context.".length);
    else if (locals.has(root) || root === "format" || root === "date" || root === "foreach") path = "";
    if (path) paths.add(path);
  }
  Object.values(node).forEach((child) => collectParameterPaths(child, locals, paths));
}

/** Collect external parameter paths and normalize $context.foo to the input JSON shape { foo: ... }. */
export function extractParameterPaths(template = "") {
  const paths = new Set();
  try {
    collectParameterPaths(parse(String(template)), new Set(), paths);
  } catch (_) {
    const references = String(template).match(/\$!?\{[^}]+\}|\$!?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/g) || [];
    references.forEach((reference) => {
      let path = reference.replace(/^\$!?\{?/, "").replace(/\}$/, "");
      if (path === "context") return;
      if (path.startsWith("context.")) path = path.slice("context.".length);
      if (!/^(?:format|date|foreach)(?:\.|$)/.test(path)) paths.add(path);
    });
  }
  return Array.from(paths).sort();
}

export function setNestedValue(target, path, value) {
  const parts = String(path).split(".");
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else {
      if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    }
  });
  return target;
}
