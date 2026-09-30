const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const CHARSET_ATTRIBUTE = /\bcharset\s*=\s*["']?([a-z0-9._-]+)/i;

function headMetaTags(html) {
  const head = String(html).match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  const source = head ? head[1] : String(html).slice(0, 4096).split(/<(?:body|script|style)\b/i)[0];
  return [...source.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
}

function declaredCharset(html) {
  for (const tag of headMetaTags(html)) {
    const charset = tag.match(CHARSET_ATTRIBUTE)?.[1];
    if (charset) return charset.toLowerCase();
  }
  return null;
}

export function decodeHtmlBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let encoding = "utf-8";
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf-16le"; offset = 2; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf-16be"; offset = 2; }
  else {
    // HTML charset declarations are ASCII-compatible, so inspect the initial bytes before decoding.
    const header = Array.from(bytes.slice(0, 4096), (byte) => String.fromCharCode(byte)).join("");
    const charset = declaredCharset(header);
    if (charset) encoding = charset;
  }
  try {
    return { html: new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)), encoding };
  } catch (error) {
    throw new Error(`Could not decode HTML as ${encoding.toUpperCase()}. Check the file's encoding before importing.`, { cause: error });
  }
}

export function analyzeHtmlEncoding(html) {
  const issues = [];
  const charset = declaredCharset(html);
  if (charset && !["utf-8", "utf8"].includes(charset)) {
    issues.push({ code: "charset", message: `HTML declares ${charset}; UTF-8 export will declare UTF-8.` });
  }
  if (String(html).includes("\ufffd")) {
    issues.push({ code: "replacement", message: "Replacement character (�) found. The original byte cannot be recovered from this text." });
  }
  // High-signal UTF-8-as-Windows-1252 sequences. These are clues, not automatic repair instructions.
  const suspects = String(html).match(/(?:â[€\u0080-\u009f][\u0080-\u009f\u00a0-\u00ff]|â[€\u0080-\u009f][’“”˜œž¦]|Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|Â(?=\s|<))/g);
  if (suspects?.length) {
    issues.push({ code: "mojibake", message: `Possible misdecoded UTF-8 found (${[...new Set(suspects)].slice(0, 3).join(", ")}). Check the source before export.` });
  }
  const nonAscii = [...String(html)].filter((character) => character.codePointAt(0) > 127);
  if (nonAscii.length) {
    const counts = new Map();
    nonAscii.forEach((character) => counts.set(character, (counts.get(character) || 0) + 1));
    const examples = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([character, count]) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} (${count})`);
    issues.push({
      code: "non_ascii",
      message: `${nonAscii.length} non-ASCII characters may be damaged by a Windows text import: ${examples.join(", ")}. Review and replace them before Save As.`,
    });
  }
  return { charset, issues };
}

function withUtf8Meta(input) {
  let html = String(input).replace(/^\ufeff/, "");
  const head = html.match(/<head\b[^>]*>/i);
  if (head) {
    const start = head.index + head[0].length;
    const end = html.search(/<\/head\s*>/i);
    if (end > start) {
      const before = html.slice(0, start);
      let body = html.slice(start, end);
      body = body.replace(/<meta\b[^>]*\bcharset\s*=\s*["']?[a-z0-9._-]+["']?[^>]*>/gi, "");
      body = `<meta charset="utf-8">${body}`;
      html = before + body + html.slice(end);
    }
  }
  return html;
}

export function prepareUtf8HtmlBytes(input) {
  const html = withUtf8Meta(input);
  const encoded = new TextEncoder().encode(html);
  const result = new Uint8Array(UTF8_BOM.length + encoded.length);
  result.set(UTF8_BOM);
  result.set(encoded, UTF8_BOM.length);
  return result;
}

function encodeCharacterReferences(text) {
  return Array.from(text, (character) => character.codePointAt(0) > 127 ? `&#${character.codePointAt(0)};` : character).join("");
}

function hasNonAscii(text) {
  return [...text].some((character) => character.codePointAt(0) > 127);
}

const CHARACTER_NAMES = new Map([
  [" ", "Nonbreaking space"], ["‘", "Left single quote"], ["’", "Right single quote"],
  ["“", "Left double quote"], ["”", "Right double quote"], ["–", "En dash"], ["—", "Em dash"],
]);

export function listEncodingCharacters(html) {
  const findings = new Map();
  let offset = 0;
  let line = 1;
  for (const character of String(html)) {
    if (character.codePointAt(0) > 127) {
      if (!findings.has(character)) {
        const codePoint = character.codePointAt(0);
        findings.set(character, {
          character,
          name: CHARACTER_NAMES.get(character) || "Unicode character",
          codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
          count: 0,
          firstLine: line,
          offsets: [],
          simulated: new TextDecoder("windows-1252").decode(new TextEncoder().encode(character)),
          replacement: `&#${codePoint};`,
        });
      }
      const finding = findings.get(character);
      finding.count += 1;
      finding.offsets.push(offset);
    }
    if (character === "\n") line += 1;
    offset += character.length;
  }
  return [...findings.values()].sort((a, b) => b.count - a.count || a.offsets[0] - b.offsets[0]);
}

/** Example of the common failure: UTF-8 file bytes opened as Windows-1252 text. */
export function simulateWindows1252Import(html) {
  return new TextDecoder("windows-1252").decode(new TextEncoder().encode(String(html)));
}

function tagEnd(html, from) {
  let quote = null;
  for (let index = from + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index + 1;
  }
  throw new Error("Unclosed HTML tag; automatic replacement is unavailable.");
}

function visibleTextSegments(html) {
  const segments = [];
  let index = 0;
  while (index < html.length) {
    if (html[index] !== "<") {
      const next = html.indexOf("<", index);
      const end = next < 0 ? html.length : next;
      segments.push([index, end]);
      index = end;
      continue;
    }
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      if (end < 0) return null;
      index = end + 3;
      continue;
    }
    const end = tagEnd(html, index);
    const rawElement = html.slice(index, end).match(/^<(script|style)\b/i)?.[1];
    if (rawElement) {
      const close = new RegExp(`</${rawElement}\\s*>`, "gi");
      close.lastIndex = end;
      if (!close.exec(html)) return null;
      index = close.lastIndex;
      continue;
    }
    index = end;
  }
  return segments;
}

/** Source offsets that correspond to rendered text, excluding markup and code. */
export function visibleTextOffsets(input, needle) {
  const html = String(input);
  if (!needle) return [];
  const segments = visibleTextSegments(html);
  if (!segments) return [];
  return segments.flatMap(([start, end]) => {
    const offsets = [];
    let offset = html.indexOf(needle, start);
    while (offset >= 0 && offset < end && offset + needle.length <= end) {
      offsets.push(offset);
      offset = html.indexOf(needle, offset + needle.length);
    }
    return offsets;
  });
}

/** Add visual markers to preview text only; source HTML and code blocks stay untouched. */
export function markEncodingPreview(input, needle, activeIndex = -1) {
  const html = String(input);
  if (!needle) return html;
  const segments = visibleTextSegments(html);
  if (!segments) return html;
  const parts = [];
  let cursor = 0;
  let occurrence = 0;
  for (const [start, end] of segments) {
    parts.push(html.slice(cursor, start));
    let from = start;
    let offset = html.indexOf(needle, start);
    while (offset >= 0 && offset < end && offset + needle.length <= end) {
      parts.push(html.slice(from, offset));
      const target = occurrence === activeIndex ? ' id="adtools-encoding-target"' : "";
      parts.push(`<mark class="adtools-encoding-preview-mark"${target}>${needle}</mark>`);
      occurrence += 1;
      from = offset + needle.length;
      offset = html.indexOf(needle, from);
    }
    parts.push(html.slice(from, end));
    cursor = end;
  }
  parts.push(html.slice(cursor));
  return parts.join("");
}

/** Encode visible HTML text and attribute values without rewriting scripts, styles, or VTL expressions. */
export function convertHtmlForToad(input) {
  const html = String(input).replace(/^\ufeff/, "");
  const parts = [];
  let index = 0;
  while (index < html.length) {
    if (html[index] !== "<") {
      const next = html.indexOf("<", index);
      const end = next < 0 ? html.length : next;
      const text = html.slice(index, end);
      if (hasNonAscii(text) && /#(?:set|if|elseif|foreach|macro|define)\s*\(/i.test(text)) {
        throw new Error("Non-ASCII in a VTL directive needs manual review; automatic replacement is unavailable.");
      }
      parts.push(encodeCharacterReferences(text));
      index = end;
      continue;
    }
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      if (end < 0) throw new Error("Unclosed HTML comment; automatic replacement is unavailable.");
      const comment = html.slice(index, end + 3);
      if (hasNonAscii(comment)) throw new Error("Non-ASCII in an HTML comment needs manual review; automatic replacement is unavailable.");
      parts.push(comment);
      index = end + 3;
      continue;
    }
    const end = tagEnd(html, index);
    const tag = html.slice(index, end);
    const rawElement = tag.match(/^<(script|style)\b/i)?.[1];
    if (rawElement) {
      const close = new RegExp(`</${rawElement}\\s*>`, "gi");
      close.lastIndex = end;
      const match = close.exec(html);
      if (!match) throw new Error(`Unclosed ${rawElement} element; automatic replacement is unavailable.`);
      const block = html.slice(index, close.lastIndex);
      if (hasNonAscii(block)) throw new Error(`Non-ASCII in a ${rawElement} element needs manual review; automatic replacement is unavailable.`);
      parts.push(block);
      index = close.lastIndex;
      continue;
    }
    const converted = tag.replace(/(["'])([\s\S]*?)\1/g, (_, quote, value) => `${quote}${encodeCharacterReferences(value)}${quote}`);
    if (hasNonAscii(converted)) throw new Error("Non-ASCII in HTML markup needs manual review; automatic replacement is unavailable.");
    parts.push(converted);
    index = end;
  }
  return parts.join("");
}

export function prepareToadSafeHtmlBytes(input) {
  return new TextEncoder().encode(convertHtmlForToad(input));
}
