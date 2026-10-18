const SHELL_SENSITIVE_CHARACTERS = new Set(["#", "$", "`", "\\", "!"]);

function encodeUtf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function splitUtf8(value, maxBytes = 2000) {
  const chunks = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const character of value) {
    const size = new TextEncoder().encode(character).length;
    if (chunk && chunkBytes + size > maxBytes) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += size;
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks;
}

function readSql(source, onLiteral) {
  let result = "";
  for (let index = 0; index < source.length; ) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index);
      const next = end === -1 ? source.length : end;
      result += source.slice(index, next);
      index = next;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      const next = end === -1 ? source.length : end + 2;
      result += source.slice(index, next);
      index = next;
      continue;
    }
    if (source[index] !== "'") {
      result += source[index++];
      continue;
    }
    let cursor = index + 1;
    let value = "";
    while (cursor < source.length) {
      if (source[cursor] === "'" && source[cursor + 1] === "'") {
        value += "'";
        cursor += 2;
      } else if (source[cursor] === "'") {
        cursor++;
        break;
      } else {
        value += source[cursor++];
      }
    }
    result += onLiteral(value, source.slice(index, cursor));
    index = cursor;
  }
  return result;
}

function sensitiveCharacters(value) {
  return [...new Set([...value].filter((character) => SHELL_SENSITIVE_CHARACTERS.has(character)))];
}

export function analyzeJenkinsSql(sql = "") {
  const characters = [];
  let literalCount = 0;
  readSql(String(sql), (value, original) => {
    const found = sensitiveCharacters(value);
    if (found.length) {
      literalCount++;
      found.forEach((character) => {
        if (!characters.includes(character)) characters.push(character);
      });
    }
    return original;
  });
  return { safe: literalCount === 0, literalCount, characters };
}

export function convertJenkinsUnsafeLiterals(sql = "") {
  return readSql(String(sql), (value, original) => {
    if (!sensitiveCharacters(value).length) return original;
    return splitUtf8(value)
      .map((chunk) => {
        const base64 = encodeUtf8Base64(chunk);
        return `UTL_RAW.CAST_TO_VARCHAR2(UTL_ENCODE.BASE64_DECODE(UTL_RAW.CAST_TO_RAW('${base64}')))`;
      })
      .join(" || ");
  });
}
