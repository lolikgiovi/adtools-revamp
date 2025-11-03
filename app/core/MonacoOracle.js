import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

export const ORACLE_LANGUAGE_ID = "oracle-dml";
export const ORACLE_THEME = "oracle-dml-dark";

export function ensureMonacoWorkers() {
  try {
    self.MonacoEnvironment = {
      getWorker() {
        return new editorWorker();
      },
    };
  } catch (e) {
    console.warn("Failed to configure Monaco workers", e);
  }
}

export function setupMonacoOracle() {
  try {
    // Register language only once
    if (!monaco.languages.getLanguages().some((l) => l.id === ORACLE_LANGUAGE_ID)) {
      monaco.languages.register({ id: ORACLE_LANGUAGE_ID, aliases: ["Oracle DML", "Oracle SQL"] });
    }

    // Keywords and tokens derived from Quick Query implementation
    const dmlKeywords = [
      "select",
      "insert",
      "update",
      "merge",
      "into",
      "values",
      "set",
      "where",
      "from",
      "join",
      "inner",
      "left",
      "right",
      "full",
      "outer",
      "on",
      "group",
      "by",
      "order",
      "having",
      "fetch",
      "first",
      "rows",
      "only",
      "connect",
      "start",
      "with",
      "prior",
      "using",
      "when",
      "matched",
      "not",
      "then",
      "and",
      "or",
    ];
    const functions = [
      "nvl",
      "nvl2",
      "coalesce",
      "decode",
      "substr",
      "instr",
      "length",
      "replace",
      "regexp_like",
      "regexp_substr",
      "regexp_replace",
      "to_char",
      "to_date",
      "to_timestamp",
      "trunc",
      "round",
      "upper",
      "lower",
      "initcap",
      "lpad",
      "rpad",
      "trim",
    ];
    const specialKeywords = ["sysdate", "systimestamp"];
    const constants = ["null"];
    const dmlBlueKeywords = ["merge", "into", "as", "then", "update", "set", "select", "from"];
    const aliasesBlue = ["tgt", "src"];
    const specialFunctionsBlue = ["nvl"];

    monaco.languages.setMonarchTokensProvider(ORACLE_LANGUAGE_ID, {
      defaultToken: "",
      tokenPostfix: ".oracle",
      ignoreCase: true,
      brackets: [{ open: "(", close: ")", token: "delimiter.parenthesis" }],
      keywords: dmlKeywords,
      functions,
      specialKeywords,
      constants,
      dmlBlueKeywords,
      aliasesBlue,
      specialFunctionsBlue,
      operators: [
        "=",
        ">",
        "<",
        "!",
        "~",
        "?",
        ":",
        "==",
        "<=",
        ">=",
        "!=",
        "<>",
        "&&",
        "||",
        "++",
        "--",
        "+",
        "-",
        "*",
        "/",
        "%",
        "|",
        "^",
        "@",
      ],
      symbols: /[=><!~?:&|+\-*/^%]+/,
      tokenizer: {
        root: [
          [/--.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [/\bON\s*\(/, { token: "keyword", next: "@onClause" }],
          [/\'(?:''|[^'])*\'/, "string"],
          [/"schema_name"(?=\.)/, "entity.schema"],
          [/\./, "delimiter"],
          [/"table_name"/, "entity.table"],
          [/\bschema_name(?=\.)/, "entity.schema"],
          [/\./, "delimiter"],
          [/\btable_name\b/, "entity.table"],
          [/"(?:""|[^"])*"/, "identifier"],
          [/:[a-zA-Z_][\w$]*/, "variable"],
          [/0x[0-9a-fA-F]+/, "number.hex"],
          [/[-+]?\d*(?:\.|\d)\d*(?:[eE][-+]?\d+)?/, "number"],
          [
            /[a-zA-Z_][\w$]*/,
            {
              cases: {
                "@dmlBlueKeywords": "keyword.dml",
                "@keywords": "keyword",
                "@specialKeywords": "predefined.sys",
                "@specialFunctionsBlue": "predefined.func.special",
                "@functions": "predefined.func",
                "@aliasesBlue": "alias.dml",
                "@constants": "constant.null",
                "@default": "identifier",
              },
            },
          ],
          [/[,.;]/, "delimiter"],
          [/@symbols/, "operator"],
          [/[()]/, "delimiter.parenthesis"],
        ],

        onClause: [
          [/\)/, { token: "delimiter.parenthesis", next: "@pop" }],
          [/\.[a-zA-Z_][\w$]*/, "predicate.onfield"],
          [/--.*$/, "comment"],
          [/\'(?:''|[^'])*\'/, "string"],
          [/0x[0-9a-fA-F]+/, "number.hex"],
          [/[-+]?\d*(?:\.|\d)\d*(?:[eE][-+]?\d+)?/, "number"],
          [/[,.;]/, "delimiter"],
          [/@symbols/, "operator"],
          [/[()]/, "delimiter.parenthesis"],
          [
            /[a-zA-Z_][\w$]*/,
            {
              cases: {
                "@dmlBlueKeywords": "keyword.dml",
                "@keywords": "keyword",
                "@specialKeywords": "predefined.sys",
                "@specialFunctionsBlue": "predefined.func.special",
                "@functions": "predefined.func",
                "@aliasesBlue": "alias.dml",
                "@constants": "constant.null",
                "@default": "identifier",
              },
            },
          ],
        ],

        comment: [
          [/[^*/]+/, "comment"],
          [/\/\*/, "comment", "@push"],
          [/\*\//, "comment", "@pop"],
          [/[*/]/, "comment"],
        ],
      },
    });

    // Completion provider
    monaco.languages.registerCompletionItemProvider(ORACLE_LANGUAGE_ID, {
      triggerCharacters: [" ", "("],
      provideCompletionItems: () => ({
        suggestions: [
          ...dmlKeywords.map((k) => ({
            label: k.toUpperCase(),
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: k.toUpperCase(),
          })),
          ...functions.map((f) => ({
            label: f.toUpperCase(),
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `${f.toUpperCase()}(`,
          })),
          ...specialKeywords.map((s) => ({
            label: s.toUpperCase(),
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: s.toUpperCase(),
          })),
          {
            label: "FETCH FIRST ROWS ONLY",
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: "FETCH FIRST ${1:10} ROWS ONLY",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "Oracle row-limiting clause (12c+).",
          },
        ],
      }),
    });

    // Theme definition (kept consistent with Quick Query)
    if (!monaco.editor.getThemes || !monaco.editor.getThemes?.()[ORACLE_THEME]) {
      monaco.editor.defineTheme(ORACLE_THEME, {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "keyword", foreground: "#93c5ff" },
          { token: "keyword.dml", foreground: "#93c5ff" },
          { token: "alias.dml", foreground: "#93c5ff" },
          { token: "predefined.func.special", foreground: "#93c5ff" },
          { token: "predefined.sys", foreground: "A6E22E" },
          { token: "predicate.match", foreground: "ff93f9" },
          { token: "predicate.onfield", foreground: "ff93f9" },
          { token: "entity.schema", foreground: "#ff93f9" },
          { token: "entity.table", foreground: "#ff93f9" },
          { token: "string", foreground: "A6E22E" },
          { token: "number", foreground: "F78C6C" },
          { token: "constant.null", foreground: "ff93f9" },
        ],
        colors: {
          "editor.background": "#1e1e1e",
          "editor.foreground": "#d4d4d4",
          "editorWidget.background": "#252526",
          "editorSuggestWidget.background": "#252526",
          "editorSuggestWidget.foreground": "#d4d4d4",
          "editorSuggestWidget.selectedBackground": "#094771",
          "editorSuggestWidget.highlightForeground": "#93c5ff",
          "editorSuggestWidget.border": "#3c3c3c",
        },
      });
    }
  } catch (e) {
    console.warn("Failed to register Oracle SQL language; falling back to sql", e);
  }
}

export function createOracleEditor(container, options = {}) {
  ensureMonacoWorkers();
  setupMonacoOracle();
  const defaults = {
    value: "",
    language: ORACLE_LANGUAGE_ID,
    theme: ORACLE_THEME,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "on",
    fontSize: 12,
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
  };
  const editor = monaco.editor.create(container, { ...defaults, ...options });
  const model = editor.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, ORACLE_LANGUAGE_ID);
  }
  return editor;
}
