// Advisory scanner only. Never executes or rewrites stored SQL.
export function analyzeSql(sql) {
  const text = String(sql || "");
  let cleaned = "";
  let i = 0;
  let quotedIdentifier = false;
  while (i < text.length) {
    if (text.startsWith("--", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      cleaned += " ";
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      cleaned += " ";
    } else if (/[qQ]/.test(text[i]) && text[i + 1] === "'") {
      const delimiter = text[i + 2];
      const closing = { "[": "]", "{": "}", "(": ")", "<": ">" }[delimiter] || delimiter;
      const end = text.indexOf(`${closing}'`, i + 3);
      i = end < 0 ? text.length : end + 2;
      cleaned += " ";
    } else if (text[i] === "'" || text[i] === '"') {
      const quote = text[i++];
      if (quote === '"') quotedIdentifier = true;
      while (i < text.length) {
        if (text[i++] === quote) {
          if (text[i] === quote) i++;
          else break;
        }
      }
      cleaned += " ";
    } else cleaned += text[i++];
  }
  const binds = [...new Set([...cleaned.matchAll(/:([A-Za-z][A-Za-z0-9_$#]*)/g)].map((match) => match[1]))];
  const select = /^\s*select\s+([\s\S]+?)\s+from\b/i.exec(cleaned);
  const aliases = [];
  let projectionVerified = Boolean(select) && !quotedIdentifier && !/\bselect\b/i.test(select?.[1] || "");
  if (projectionVerified) {
    const projection = select[1];
    let part = "";
    let depth = 0;
    const parts = [];
    for (const char of projection + ",") {
      if (char === "(") depth++;
      if (char === ")") depth--;
      if (char === "," && depth === 0) {
        parts.push(part.trim());
        part = "";
      } else part += char;
    }
    for (const expression of parts) {
      const alias =
        /(?:\s+AS\s+|\s+)([A-Za-z][\w$#]*)$/i.exec(expression)?.[1] || /^(?:[A-Za-z][\w$#]*\.)?([A-Za-z][\w$#]*)$/.exec(expression)?.[1];
      if (!alias || expression === "*") projectionVerified = false;
      else aliases.push(alias);
    }
  }
  return { binds, aliases, projectionVerified, advisory: true };
}
