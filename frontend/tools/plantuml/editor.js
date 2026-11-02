// Adapted from lolikgiovi/plantuml at 74bc3e7.
import { configureMonacoWorkers } from "../../core/MonacoWorkers.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
import { collectSymbols, completionContext, matchingSymbols } from "./completions.js";
import { plantUmlLanguage, participantLegend, participantTokens, definePlantUmlThemes } from "./language.js";
import { nodePath, resolvePath } from "./workspace.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { confluencePalette, formatPlantUml, sequenceTemplate } from "./plantuml.js";
globalThis.__plantumlEditorRegistrations?.forEach((registration) => registration.dispose());
const registrations = [];
globalThis.__plantumlEditorRegistrations = registrations;
let completionWorkspace = [];
const semanticListeners = new Set();
function setCompletionWorkspace(nodes) {
  completionWorkspace = nodes;
  for (const listener of semanticListeners) listener();
}
if (import.meta.hot) import.meta.hot.dispose(() => registrations.forEach((registration) => registration.dispose()));
configureMonacoWorkers(globalThis, { editor: EditorWorker });
if (!monaco.languages.getLanguages().some((language) => language.id === "plantuml")) {
  monaco.languages.register({ id: "plantuml", extensions: [".puml", ".plantuml", ".iuml"] });
}
registrations.push(
  monaco.languages.setLanguageConfiguration("plantuml", {
    wordPattern: /!?[A-Za-z_][\w-]*/g,
    comments: { lineComment: "'", blockComment: ["/'", "'/"] },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
    folding: { markers: { start: /^\s*'\s*#region\b/, end: /^\s*'\s*#endregion\b/ } },
  }),
);
definePlantUmlThemes(monaco);
registrations.push(monaco.languages.setMonarchTokensProvider("plantuml", plantUmlLanguage));
registrations.push(
  monaco.languages.registerDocumentSemanticTokensProvider("plantuml", {
    getLegend: () => participantLegend,
    onDidChange(listener) {
      semanticListeners.add(listener);
      return { dispose: () => semanticListeners.delete(listener) };
    },
    provideDocumentSemanticTokens(model) {
      const source = model.getValue();
      const active = completionWorkspace.find((node) => model.uri.path === `/${node.id}.puml`);
      const files = new Map(
        completionWorkspace.filter((node) => node.kind === "file").map((node) => [nodePath(completionWorkspace, node.id), node.content]),
      );
      const included = [];
      const visited = new Set(active ? [nodePath(completionWorkspace, active.id)] : []);
      const visit = (text, path) => {
        const lexical = monaco.editor.tokenize(text, "plantuml");
        text.split(/\r?\n/).forEach((line, index) => {
          const match = /^\s*!include(?:_once|_many)?\s+(?:"([^"]+)"|(\S+))/i.exec(line);
          if (!match || !lexical[index].some((token) => token.type === "keyword.directive.plantuml")) return;
          try {
            const target = resolvePath((match[1] || match[2]).split("!")[0], path);
            if (visited.has(target) || !files.has(target)) return;
            visited.add(target);
            const content = files.get(target);
            included.push(content);
            visit(content, target);
          } catch {
            // Rendering reports invalid includes; highlighting skips them.
          }
        });
      };
      if (active) visit(source, nodePath(completionWorkspace, active.id));
      return {
        data: participantTokens(
          source,
          monaco.editor.tokenize(source, "plantuml"),
          included,
          collectSymbols(source, active ? nodePath(completionWorkspace, active.id) : model.uri.path, files),
        ),
      };
    },
    releaseDocumentSemanticTokens() {},
  }),
);
registrations.push(
  monaco.languages.registerDocumentFormattingEditProvider("plantuml", {
    provideDocumentFormattingEdits(model, options) {
      return [
        {
          range: model.getFullModelRange(),
          text: formatPlantUml(model.getValue(), options.insertSpaces ? " ".repeat(options.tabSize) : "	"),
        },
      ];
    },
  }),
);
const snippetDefinitions = [
  {
    label: "confluence-colors",
    detail: "Confluence \xB7 all 36 sequence colors",
    text: confluencePalette,
  },
  {
    label: "sequence",
    detail: "API sequence \xB7 config query, error, HTTP 200",
    text: sequenceTemplate,
  },
  {
    label: "alt",
    detail: "Alternative paths",
    text: "alt ${1:Condition}\n	${2:Alice -> Bob: Success}\nelse ${3:Otherwise}\n	${4:Alice -> Bob: Failure}\nend",
  },
  {
    label: "loop",
    detail: "Sequence loop",
    text: "loop ${1:Condition}\n	${2:Alice -> Bob: Request}\nend",
  },
  {
    label: "participant",
    detail: "Named participant",
    text: 'participant "${1:Service}" as ${2:service} ${3:COLOR_BLUE_SUBTLEST}',
  },
  {
    label: "note",
    detail: "Multiline note",
    text: "note ${1:right of} ${2:Alice}\n	${3:Note text}\nend note",
  },
  {
    label: "confluence-sequence-style",
    detail: "Confluence sequence styling",
    text: "skinparam shadowing false\nskinparam sequence {\n	ArrowColor COLOR_BLUE\n	ParticipantBorderColor COLOR_BLUE\n	ParticipantBackgroundColor COLOR_BLUE_SUBTLEST\n	ParticipantFontColor #172B4D\n	GroupBorderColor COLOR_TEAL\n	GroupBackgroundColor COLOR_TEAL_SUBTLEST\n}",
  },
];
registrations.push(
  monaco.languages.registerCompletionItemProvider("plantuml", {
    triggerCharacters: ["$", "%"],
    provideCompletionItems(model, position) {
      const beforeCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const context = completionContext(beforeCursor);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - context.prefix.length,
        endColumn: position.column,
      };
      const active = completionWorkspace.find((node) => model.uri.path === `/${node.id}.puml`);
      const path = active ? nodePath(completionWorkspace, active.id) : model.uri.path;
      const files = new Map(
        completionWorkspace.filter((node) => node.kind === "file").map((node) => [nodePath(completionWorkspace, node.id), node.content]),
      );
      const symbols = matchingSymbols(collectSymbols(model.getValue(), path, files), beforeCursor);
      const kinds = {
        function: monaco.languages.CompletionItemKind.Function,
        method: monaco.languages.CompletionItemKind.Method,
        variable: monaco.languages.CompletionItemKind.Variable,
        constant: monaco.languages.CompletionItemKind.Constant,
        color: monaco.languages.CompletionItemKind.Color,
      };
      return {
        suggestions: [
          ...symbols.map((symbol) => ({
            label: symbol.name,
            detail: symbol.detail,
            kind: kinds[symbol.kind],
            range,
            insertText:
              symbol.parameters === null
                ? symbol.name
                : `${symbol.name}(${symbol.parameters.map((parameter, i) => "${" + (i + 1) + ":" + parameter.replace(/[^\w]/g, "") + "}").join(", ")})`,
            insertTextRules:
              symbol.parameters === null
                ? monaco.languages.CompletionItemInsertTextRule.None
                : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: `0-${symbol.name}`,
          })),
          ...(context.snippets
            ? snippetDefinitions
                .filter((snippet) => snippet.label.startsWith(context.prefix.toLowerCase()))
                .map((snippet) => ({
                  label: snippet.label,
                  detail: snippet.detail,
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: snippet.text,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  sortText: `1-${snippet.label}`,
                  range,
                }))
            : []),
        ],
      };
    },
  }),
);
export { monaco, setCompletionWorkspace };
