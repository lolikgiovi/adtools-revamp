export function hasMalformedQuotedField(clipboardText) {
  if (typeof clipboardText !== "string" || !/(?:^|[\t\r\n])"/.test(clipboardText)) return false;

  let inQuotes = false;
  let atFieldStart = true;

  for (let index = 0; index < clipboardText.length; index += 1) {
    const character = clipboardText[index];
    const nextCharacter = clipboardText[index + 1];

    if (atFieldStart && character === '"') {
      inQuotes = true;
      atFieldStart = false;
      continue;
    }

    if (inQuotes && character === '"') {
      if (nextCharacter === '"') {
        index += 1;
      } else if (nextCharacter === undefined || nextCharacter === "\t" || nextCharacter === "\r" || nextCharacter === "\n") {
        inQuotes = false;
      } else {
        return true;
      }
      continue;
    }

    if (!inQuotes && character === "\t") {
      atFieldStart = true;
    } else if (!inQuotes && (character === "\r" || character === "\n")) {
      atFieldStart = true;
      if (character === "\r" && nextCharacter === "\n") index += 1;
    } else {
      atFieldStart = false;
    }
  }

  return false;
}

function parseTolerantTsv(text, pastedData) {
  const rows = [];
  const malformedCells = [];
  let row = [];
  let malformedRow = [];
  let field = "";
  let fieldIsMalformed = false;
  let inQuotes = false;
  let atFieldStart = true;
  let jsonState = null;

  const appendFieldCharacter = (character) => {
    field += character;

    if (!jsonState) {
      const fieldWithoutLeadingWhitespace = field.trimStart();
      if (fieldWithoutLeadingWhitespace.length === 1 && (character === "[" || character === "{")) {
        jsonState = { depth: 1, inString: false, escaped: false, rawQuotes: null };
      }
      return;
    }

    if (jsonState.inString) {
      if (jsonState.escaped) {
        jsonState.escaped = false;
      } else if (character === "\\") {
        jsonState.escaped = true;
      } else if (character === '"') {
        jsonState.inString = false;
      }
    } else if (character === '"') {
      jsonState.inString = true;
    } else if (character === "[" || character === "{") {
      jsonState.depth += 1;
    } else if (character === "]" || character === "}") {
      jsonState.depth -= 1;
    }
  };

  const finishField = () => {
    row.push(field);
    malformedRow.push(fieldIsMalformed);
    field = "";
    fieldIsMalformed = false;
    atFieldStart = true;
    jsonState = null;
  };

  const finishRow = () => {
    rows.push(row);
    malformedCells.push(malformedRow);
    row = [];
    malformedRow = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (atFieldStart && character === '"') {
      inQuotes = true;
      atFieldStart = false;
      continue;
    }

    if (inQuotes && character === '"') {
      if (jsonState?.depth > 0 && jsonState.rawQuotes !== false) {
        if (jsonState.rawQuotes === null) jsonState.rawQuotes = nextCharacter !== '"';
        if (jsonState.rawQuotes) {
          appendFieldCharacter('"');
          fieldIsMalformed = true;
          continue;
        }
      }

      if (nextCharacter === '"') {
        appendFieldCharacter('"');
        index += 1;
      } else if (nextCharacter === undefined || nextCharacter === "\t" || nextCharacter === "\r" || nextCharacter === "\n") {
        const expectedColumnCount = pastedData[rows.length]?.length;
        const hasTrailingColumns = Number.isInteger(expectedColumnCount) && row.length < expectedColumnCount - 1;
        const atLineBreak = nextCharacter === "\r" || nextCharacter === "\n";
        if (fieldIsMalformed && hasTrailingColumns && atLineBreak) {
          appendFieldCharacter('"');
        } else {
          inQuotes = false;
        }
      } else {
        appendFieldCharacter('"');
        fieldIsMalformed = true;
      }
      continue;
    }

    if (!inQuotes && character === "\t") {
      finishField();
      continue;
    }

    if (!inQuotes && (character === "\r" || character === "\n")) {
      finishField();
      finishRow();
      if (character === "\r" && nextCharacter === "\n") index += 1;
      continue;
    }

    appendFieldCharacter(character);
    atFieldStart = false;
  }

  const endsWithLineBreak = text.endsWith("\n") || text.endsWith("\r");
  if (!endsWithLineBreak || row.length > 0 || field !== "") {
    finishField();
    finishRow();
  }

  return { rows, malformedCells };
}

export function recoverMalformedDatabaseClipboard(clipboardText, pastedData) {
  if (!hasMalformedQuotedField(clipboardText) || !Array.isArray(pastedData)) return false;

  let changed = false;
  const { rows: recoveredData, malformedCells } = parseTolerantTsv(clipboardText, pastedData);

  recoveredData.forEach((recoveredRow, rowIndex) => {
    const pastedRow = pastedData[rowIndex];
    if (!Array.isArray(pastedRow) || recoveredRow.length !== pastedRow.length) return;

    recoveredRow.forEach((recoveredValue, columnIndex) => {
      if (malformedCells[rowIndex][columnIndex] && recoveredValue !== pastedRow[columnIndex]) {
        pastedRow[columnIndex] = recoveredValue;
        changed = true;
      }
    });
  });

  return changed;
}
