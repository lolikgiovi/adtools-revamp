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
      ...participantTypes.map((type) => [new RegExp(`\\b${type}\\b`), type]),
      [
        /\b(?:collections|queue|interface|enum|abstract|package|namespace|cloud|rectangle|usecase|state|object|artifact|folder|frame|agent|card|port|storage|as|title|caption|header|footer|skinparam|hide|show|autonumber|activate|deactivate|destroy|create|return|newpage|ref|over|note|hnote|rnote|legend|end|endbox|alt|else|opt|loop|par|break|critical|group|box|if|then|elseif|endif|while|endwhile|repeat|fork|again|split|partition|start|stop)\b/,
        "keyword",
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
    responseHeader: [[/:/, "delimiter", "@response"], [/\n/, "", "@popall"], { include: "@root" }],
    message: [
      [/\n/, "", "@popall"],
      { include: "@values" },
      [/\\[nrlt]|<\/?[a-z][^>]*>/, "annotation"],
      [/[^$%\\<\w\r\n]+|\w|./, "message.request"],
    ],
    response: [
      [/\n/, "", "@popall"],
      { include: "@values" },
      [/\\[nrlt]|<\/?[a-z][^>]*>/, "annotation"],
      [/[^$%\\<\w\r\n]+|\w|./, "message.response"],
    ],
    inlineNoteHeader: [[/:/, "delimiter", "@inlineNote"], [/\n/, "", "@popall"], { include: "@root" }],
    inlineNote: [[/\n/, "", "@popall"], { include: "@values" }, [/[^$%\w\r\n]+|\w|./, "note.content"]],
    note: [
      [/^\s*end\s*(?:note|hnote|rnote|legend)\b[^\r\n]*(?:\n|$)/, "keyword", "@pop"],
      { include: "@values" },
      [/:[A-Za-z_]\w*/, "variable"],
      [/\b(?:SELECT|FROM|WHERE|AND|OR|IN|JOIN|ON|INSERT|UPDATE|DELETE|SET|VALUES|ORDER BY|GROUP BY|LIMIT)\b/, "keyword.sql"],
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

export function definePlantUmlThemes(monaco) {
  const palettes = {
    light: {
      base: "vs",
      foreground: "24292F",
      background: "FFFFFF",
      keyword: "8250DF",
      directive: "8250DF",
      variable: "953800",
      constant: "0550AE",
      function: "6639BA",
      string: "116329",
      number: "0550AE",
      comment: "62706D",
      operator: "57606A",
      request: "1F4E79",
      response: "116329",
      note: "6E5224",
      member: "0550AE",
      actor: "9A4A00",
      participant: "0550AE",
      boundary: "8C2F75",
      control: "6639BA",
      entity: "116329",
      database: "9A4A00",
      node: "A1263D",
      component: "006B75",
      class: "116329",
    },
    dark: {
      base: "vs-dark",
      foreground: "D4D4D4",
      background: "1E1E1E",
      keyword: "C586C0",
      directive: "C586C0",
      variable: "9CDCFE",
      constant: "4FC1FF",
      function: "DCDCAA",
      string: "CE9178",
      number: "B5CEA8",
      comment: "8DAD7B",
      operator: "C5C5C5",
      request: "BCD9F0",
      response: "8ED6AD",
      note: "CEB991",
      member: "9CDCFE",
      actor: "E5C07B",
      participant: "9CDCFE",
      boundary: "E5A0CF",
      control: "C5A5F5",
      entity: "8ED6AD",
      database: "E5B477",
      node: "F38BA8",
      component: "78DCE8",
      class: "8ED6AD",
    },
    contrast: {
      base: "hc-black",
      foreground: "FFFFFF",
      background: "000000",
      keyword: "FF9DFF",
      directive: "FF9DFF",
      variable: "9CDCFE",
      constant: "4FC1FF",
      function: "FFFF80",
      string: "FFB98F",
      number: "B5F5A8",
      comment: "B3C6AC",
      operator: "FFFFFF",
      request: "FFFFFF",
      response: "80FFB0",
      note: "FFDD99",
      member: "9CDCFE",
      actor: "FFFF80",
      participant: "9CDCFE",
      boundary: "FF9DFF",
      control: "D5B0FF",
      entity: "80FFB0",
      database: "FFCC80",
      node: "FF9EAD",
      component: "80FFFF",
      class: "80FFB0",
    },
  };
  for (const [name, p] of Object.entries(palettes)) {
    monaco.editor.defineTheme(`plantuml-${name}`, {
      base: p.base,
      inherit: true,
      rules: [
        { token: "", foreground: p.foreground },
        ...["keyword", "variable", "constant", "function", "string", "number", "comment", "operator", "member"].map((token) => ({
          token: `${token}.plantuml`,
          foreground: p[token],
        })),
        { token: "keyword.directive.plantuml", foreground: p.directive },
        { token: "message.request.plantuml", foreground: p.request },
        { token: "message.response.plantuml", foreground: p.response },
        { token: "note.content.plantuml", foreground: p.note },
        { token: "annotation.plantuml", foreground: p.keyword },
        ...[...participantTypes, "constant", "variable", "function"].flatMap((token) => [
          { token: `${token}.plantuml`, foreground: p[token] },
          { token, foreground: p[token] },
        ]),
      ],
      colors: { "editor.background": `#${p.background}`, "editor.foreground": `#${p.foreground}` },
    });
  }
}
