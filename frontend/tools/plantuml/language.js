// Shared by the Monarch tokenizer and semantic participant highlighting.
export const participantTypes = ["actor", "participant", "boundary", "control", "entity", "database", "node", "component", "class"];
export const participantLegend = { tokenTypes: [...participantTypes, "constant", "variable", "function"], tokenModifiers: [] };

export const plantUmlLanguage = {
  defaultToken: "",
  tokenPostfix: ".plantuml",
  ignoreCase: true,
  includeLF: true,
  tokenizer: {
    root: [
      [/\/'/, "comment", "@comment"],
      [/'[^\r\n]*/, "comment"],
      [/(@(?:start|end)\w+)/, "keyword.directive"],
      [/(!define\b)(\s+)([A-Za-z_]\w*)/, ["keyword.directive", "", "constant"]],
      [/!\w+/, "keyword.directive"],
      [/\bCOLOR_[A-Z_]+\b/, "constant"],
      [/#(?:[\da-fA-F]{8}|[\da-fA-F]{6}|[\da-fA-F]{3})\b|#[A-Za-z]\w*/, "number.hex"],
      [/<<[^>]*>>/, "annotation"],
      [/^(\s*)(note|hnote|rnote)\b(?=[^\r\n]*:)/, ["", { token: "keyword", next: "@inlineNoteHeader" }]],
      [/^(\s*)(note|hnote|rnote|legend)(\b(?!\s+")[^:\r\n]*(?=\n|$))/, ["", "keyword", { token: "", next: "@note" }]],
      [/^(\s*)(title|caption|header|footer)(\s*(?=\n|$))/, ["", "keyword", { token: "", next: "@note" }]],
      [
        /^(\s*)(title|caption|header|footer|group|alt|else|opt|loop|par|break|critical|return|ref)\b/,
        ["", { token: "keyword", next: "@text" }],
      ],
      ...participantTypes.map((type) => [new RegExp(`^(\\s*)(${type})\\b`), ["", type]]),
      [
        /^(\s*)(collections|queue|interface|enum|abstract|package|namespace|cloud|rectangle|usecase|state|object|artifact|folder|frame|agent|card|port|storage|as|title|caption|header|footer|skinparam|hide|show|autonumber|activate|deactivate|destroy|create|return|newpage|ref|over|note|hnote|rnote|legend|end|endbox|alt|else|opt|loop|par|break|critical|group|box|if|then|elseif|endif|while|endwhile|repeat|fork|again|split|partition|start|stop)\b/,
        ["", "keyword"],
      ],
      [/"/, "string.quote", "@quoted"],
      { include: "@values" },
      [/[ox]?(?:<[-.]{2,}|[-.]{2,}>)(?:[ox](?!\w))?/, "operator.response", "@responseHeader"],
      [/[ox]?[<>]?[.-]+(?:\[[^\]\r\n]+\])?[.-]*[<>]?(?:[ox](?!\w))?/, "operator"],
      [/^(\s*)([+#~-])([A-Za-z_]\w*)/, ["", "operator", "member"]],
      [/\b[A-Za-z_]\w*(?=\s*:)/, "member"],
      [/:/, "delimiter", "@message"],
      [/[{}[\]()]/, "delimiter.bracket"],
      [/[<>*+.#|=!-]+/, "operator"],
      [/[A-Za-z_]\w*/, "identifier"],
    ],
    values: [
      [/\$[A-Za-z_]\w*(?=\s*\()/, "function"],
      [/\$\{[^}\r\n]+\}|\$[A-Za-z_]\w*/, "variable"],
      [/%[A-Za-z_]\w*(?=\s*\()/, "function.predefined"],
      [/\b[A-Za-z_]\w*(?=\s*\()/, "function"],
      [/\b(?:true|false|null)\b/, "constant"],
      [/\b\d+(?:\.\d+)?\b/, "number"],
    ],
    proseValues: [
      [/\$[A-Za-z_]\w*(?=\s*\()/, "function"],
      [/\$\{[^}\r\n]+\}|\$[A-Za-z_]\w*/, "variable"],
      [/%[A-Za-z_]\w*(?=\s*\()/, "function.predefined"],
    ],
    text: [[/\n/, "", "@popall"], { include: "@proseValues" }, [/[^$%\w\r\n]+|\w|./, "text"]],
    responseHeader: [[/:/, "delimiter", "@response"], [/\n/, "", "@popall"], { include: "@root" }],
    message: [
      [/\n/, "", "@popall"],
      { include: "@proseValues" },
      [/\\[nrlt]|<\/?[a-z][^>]*>/, "annotation"],
      [/[^$%\\<\w\r\n]+|\w|./, "message.request"],
    ],
    response: [
      [/\n/, "", "@popall"],
      { include: "@proseValues" },
      [/\\[nrlt]|<\/?[a-z][^>]*>/, "annotation"],
      [/[^$%\\<\w\r\n]+|\w|./, "message.response"],
    ],
    inlineNoteHeader: [[/:/, "delimiter", "@inlineNote"], [/\n/, "", "@popall"], { include: "@root" }],
    inlineNote: [[/\n/, "", "@popall"], { include: "@proseValues" }, [/[^$%\w\r\n]+|\w|./, "note.content"]],
    note: [
      [/^\s*end\s*(?:note|hnote|rnote|legend|title|caption|header|footer)\b[^\r\n]*(?:\n|$)/, "keyword", "@pop"],
      { include: "@proseValues" },
      [/[^$%:\w]+|\w|./, "note.content"],
    ],
    quoted: [
      [/\\./, "string.escape"],
      [/"/, "string.quote", "@pop"],
      [/\$\{[^}\r\n]+\}|\$[A-Za-z_]\w*/, "variable"],
      [/[^"\\$\r\n]+/, "string"],
      [/\$/, "string"],
      [/\n/, "string", "@pop"],
    ],
    comment: [
      [/[^']+/, "comment"],
      [/'\//, "comment", "@pop"],
      [/'/, "comment"],
    ],
  },
};

// Use lexical tokens to avoid treating names inside comments, strings and message bodies as references.
// Alias lookup is scoped to this document and its local includes, never unrelated workspace files.
export function participantTokens(source, lexicalLines, includedSources = [], bindings = []) {
  const symbols = new Map();
  for (const binding of bindings) {
    const kind = binding.kind === "color" ? "constant" : binding.kind === "method" ? "function" : binding.kind;
    const type = participantLegend.tokenTypes.indexOf(kind);
    if (type >= 0) symbols.set(binding.name, type);
  }
  for (const text of [...includedSources, source]) {
    let comment = false,
      note = false;
    for (const line of text.split(/\r?\n/)) {
      if (comment) {
        if (line.includes("'/")) comment = false;
        continue;
      }
      if (/^\s*\/'/.test(line)) {
        comment = !line.includes("'/", line.indexOf("/'") + 2);
        continue;
      }
      if (note) {
        if (/^\s*end\s*(?:note|hnote|rnote|legend)\b/i.test(line)) note = false;
        continue;
      }
      if (/^\s*(?:note|hnote|rnote|legend)\b[^:]*$/i.test(line)) {
        note = true;
        continue;
      }
      const match =
        /^\s*(actor|participant|boundary|control|entity|database|node|component|class)\s+(?:"(?:\\.|[^"\\])*"|([\w.-]+))(?:\s+as\s+(?:"([^"\n]+)"|([\w.-]+)))?/i.exec(
          line,
        );
      if (match) {
        const name = match[3] || match[4] || match[2];
        if (name) symbols.set(name, participantTypes.indexOf(match[1].toLowerCase()));
      }
    }
  }
  const data = [];
  let previousLine = 0,
    previousColumn = 0;
  source.split(/\r?\n/).forEach((line, lineIndex) => {
    const tokens = lexicalLines[lineIndex] || [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== "identifier.plantuml" && token.type !== "member.plantuml") continue;
      const text = line.slice(token.offset, tokens[i + 1]?.offset ?? line.length);
      for (const match of text.matchAll(/[A-Za-z_][\w.-]*/g)) {
        if (!symbols.has(match[0])) continue;
        const column = token.offset + match.index;
        data.push(
          lineIndex - previousLine,
          lineIndex === previousLine ? column - previousColumn : column,
          match[0].length,
          symbols.get(match[0]),
          0,
        );
        previousLine = lineIndex;
        previousColumn = column;
      }
    }
  });
  return new Uint32Array(data);
}
