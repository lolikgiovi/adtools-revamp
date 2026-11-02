// Adapted from lolikgiovi/plantuml at 74bc3e7.
import { configureMonacoWorkers } from "../../core/MonacoWorkers.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
import { collectSymbols, completionContext, matchingSymbols, plantUmlKeywords } from "./completions.js";
import { plantUmlLanguage, participantLegend, participantTokens } from "./language.js";
import { definePlantUmlThemes } from "./themes.js";
import { nodePath, resolvePath } from "./workspace.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { formatPlantUml } from "./plantuml.js";
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
registrations.push(
  monaco.languages.registerCompletionItemProvider("plantuml", {
    triggerCharacters: ["$", "%"],
    provideCompletionItems(model, position) {
      const beforeCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const context = completionContext(beforeCursor);
      const line = model.getLineContent(position.lineNumber);
      const suffix = /^\w*/.exec(line.slice(position.column - 1))[0];
      const lexical = monaco.editor.tokenize(model.getValue(), "plantuml")[position.lineNumber - 1];
      const prefixStart = position.column - 1 - context.prefix.length;
      const token = lexical.findLast((token) => token.offset <= prefixStart)?.type || "";
      const keywordContext = context.keywords && !/^(?:comment|string|note\.|message\.|text(?:\.|$))/.test(token);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - context.prefix.length,
        endColumn: position.column + suffix.length,
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
            sortText: `1-${symbol.name}`,
          })),
          ...(keywordContext
            ? plantUmlKeywords
                .filter((keyword) => keyword.startsWith(context.prefix.toLowerCase()))
                .map((keyword) => ({
                  label: keyword,
                  kind: monaco.languages.CompletionItemKind.Keyword,
                  insertText: keyword,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.None,
                  sortText: `0-${keyword}`,
                  range,
                }))
            : []),
        ],
      };
    },
  }),
);
export { monaco, setCompletionWorkspace };
