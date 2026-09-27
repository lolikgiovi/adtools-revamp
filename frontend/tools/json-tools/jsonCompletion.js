const jsonToolsModels = new Set();
let completionProvider = null;
let originalModeConfiguration = null;

const completionKinds = (monaco) => [
  null,
  monaco.languages.CompletionItemKind.Text,
  monaco.languages.CompletionItemKind.Method,
  monaco.languages.CompletionItemKind.Function,
  monaco.languages.CompletionItemKind.Constructor,
  monaco.languages.CompletionItemKind.Field,
  monaco.languages.CompletionItemKind.Variable,
  monaco.languages.CompletionItemKind.Class,
  monaco.languages.CompletionItemKind.Interface,
  monaco.languages.CompletionItemKind.Module,
  monaco.languages.CompletionItemKind.Property,
  monaco.languages.CompletionItemKind.Unit,
  monaco.languages.CompletionItemKind.Value,
  monaco.languages.CompletionItemKind.Enum,
  monaco.languages.CompletionItemKind.Keyword,
  monaco.languages.CompletionItemKind.Snippet,
  monaco.languages.CompletionItemKind.Color,
  monaco.languages.CompletionItemKind.File,
  monaco.languages.CompletionItemKind.Reference,
  monaco.languages.CompletionItemKind.Folder,
  monaco.languages.CompletionItemKind.EnumMember,
  monaco.languages.CompletionItemKind.Constant,
  monaco.languages.CompletionItemKind.Struct,
  monaco.languages.CompletionItemKind.Event,
  monaco.languages.CompletionItemKind.Operator,
  monaco.languages.CompletionItemKind.TypeParameter,
];

const toMonacoRange = (monaco, range) =>
  new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);

function toMonacoCompletion(monaco, model, position, entry, kinds) {
  const word = model.getWordUntilPosition(position);
  const item = {
    label: entry.label,
    kind: kinds[entry.kind] ?? monaco.languages.CompletionItemKind.Property,
    insertText: entry.insertText || entry.label,
    range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
    sortText: entry.sortText,
    filterText: entry.filterText,
    detail: entry.detail,
    documentation: entry.documentation,
  };

  if (entry.textEdit) {
    item.range = entry.textEdit.insert
      ? { insert: toMonacoRange(monaco, entry.textEdit.insert), replace: toMonacoRange(monaco, entry.textEdit.replace) }
      : toMonacoRange(monaco, entry.textEdit.range);
    item.insertText = entry.textEdit.newText;
  }
  if (entry.additionalTextEdits) {
    item.additionalTextEdits = entry.additionalTextEdits.map((edit) => ({
      range: toMonacoRange(monaco, edit.range),
      text: edit.newText,
    }));
  }
  if (entry.insertTextFormat === 2) {
    item.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  }
  if (entry.command?.command === "editor.action.triggerSuggest") {
    item.command = { id: entry.command.command, title: entry.command.title, arguments: entry.command.arguments };
  }
  return item;
}

export function registerJsonToolsCompletions(monaco, models) {
  models.forEach((model) => jsonToolsModels.add(model));

  if (!completionProvider) {
    const defaults = monaco.languages.json.jsonDefaults;
    const kinds = completionKinds(monaco);
    originalModeConfiguration = defaults.modeConfiguration;
    defaults.setModeConfiguration({ ...originalModeConfiguration, completionItems: false });

    // Use Monaco's JSON worker for every JSON editor; omit only its root $schema hint in JSON Tools.
    completionProvider = monaco.languages.registerCompletionItemProvider("json", {
      triggerCharacters: [" ", ":", '"'],
      async provideCompletionItems(model, position, _context, token) {
        const getWorker = await monaco.languages.json.getWorker();
        const worker = await getWorker(model.uri);
        if (token.isCancellationRequested) return;
        const result = await worker.doComplete(model.uri.toString(), {
          line: position.lineNumber - 1,
          character: position.column - 1,
        });
        if (token.isCancellationRequested || !result) return;

        const items = jsonToolsModels.has(model) ? result.items.filter((item) => item.label !== "$schema") : result.items;
        return {
          isIncomplete: result.isIncomplete,
          suggestions: items.map((item) => toMonacoCompletion(monaco, model, position, item, kinds)),
        };
      },
    });
  }

  return () => {
    models.forEach((model) => jsonToolsModels.delete(model));
    if (jsonToolsModels.size === 0 && completionProvider) {
      completionProvider.dispose();
      completionProvider = null;
      monaco.languages.json.jsonDefaults.setModeConfiguration(originalModeConfiguration);
      originalModeConfiguration = null;
    }
  };
}
