// Adapted from lolikgiovi/plantuml at 74bc3e7.
import { resolvePath } from "./workspace.js";
export const plantUmlKeywords = [
  "alt",
  "else",
  "opt",
  "loop",
  "par",
  "break",
  "critical",
  "group",
  "end",
  "box",
  "endbox",
  "participant",
  "actor",
  "boundary",
  "control",
  "entity",
  "database",
  "collections",
  "queue",
  "note",
  "hnote",
  "rnote",
  "ref",
  "activate",
  "deactivate",
  "create",
  "destroy",
  "return",
  "autonumber",
  "title",
  "hide",
  "show",
  "skinparam",
  "newpage",
];

const builtinFunctions = [
  ["%strlen", "text"],
  ["%upper", "text"],
  ["%lower", "text"],
  ["%string", "value"],
  ["%intval", "value"],
  ["%boolval", "value"],
  ["%substr", "text, start, length"],
  ["%strpos", "text, search"],
  ["%size", "value"],
  ["%variable_exists", "name"],
  ["%get_variable_value", "name"],
  ["%newline", ""],
].map(([name, args]) => ({
  name,
  kind: "function",
  detail: `Built-in ${name}(${args})`,
  parameters: args ? args.split(", ") : [],
}));
function collectSymbols(source, path, files = /* @__PURE__ */ new Map()) {
  const symbols = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new Set();
  function visit(text, currentPath) {
    if (visited.has(currentPath)) return;
    visited.add(currentPath);
    let comment = false;
    let note = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (comment) {
        if (line.includes("'/")) comment = false;
        continue;
      }
      if (line.startsWith("/'")) {
        comment = !line.slice(2).includes("'/");
        continue;
      }
      if (line.startsWith("'")) continue;
      if (note) {
        if (/^end\s*(?:note|hnote|rnote|legend)\b/i.test(line)) note = false;
        continue;
      }
      if (/^(?:note|hnote|rnote|legend)\b/i.test(line) && !line.includes(":") && !/\bas\s+\w+/i.test(line)) {
        note = true;
        continue;
      }
      const include = /^!include(?:_once|_many)?\s+(?:"([^"]+)"|(\S+))/i.exec(line);
      if (include) {
        const requested = (include[1] ?? include[2]).split("!")[0];
        if (!requested.startsWith("<")) {
          try {
            const includedPath = resolvePath(requested, currentPath);
            const content = files.get(includedPath);
            if (content !== void 0) visit(content, includedPath);
          } catch {
            // Rendering reports missing/remote includes; completion discovery skips them.
          }
        }
        continue;
      }
      const fn =
        /^!(?:(?:unquoted|return)\s+)?(?:function|procedure)\s+([$\w]+)\s*\(([^)]*)\)/i.exec(line) ??
        /^!(?:define|definelong)\s+([$\w]+)\(([^)]*)\)/i.exec(line);
      if (fn) {
        symbols.set(fn[1], {
          name: fn[1],
          kind: "function",
          detail: `${fn[1]}(${fn[2]})`,
          parameters: fn[2]
            .split(",")
            .map((value) => value.trim().split("=")[0].replace(/^\$/, ""))
            .filter(Boolean),
        });
        continue;
      }
      const definition = /^!define\s+([$\w]+)(?:\s+(.*))?$/i.exec(line);
      const assignment = /^!(?:(?:global|local)\s+)?(\$?\w+)\s*\??=\s*(.*)$/i.exec(line);
      const match = definition ?? assignment;
      if (match) {
        const value = match[2] ?? "";
        const color = /^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(value);
        symbols.set(match[1], {
          name: match[1],
          kind: color ? "color" : definition ? "constant" : "variable",
          detail: value,
          parameters: null,
        });
        continue;
      }
      const colon = line.indexOf(":");
      if (colon >= 0 && /(?:[-=.]+(?:\[[^\]]*\])?[-=.]*[<>]+|[<>]+[-=.]+)/.test(line.slice(0, colon))) {
        const message = /^([$A-Za-z_]\w*)(?:\(([^)]*)\))?$/.exec(line.slice(colon + 1).trim());
        if (message && !symbols.has(message[1])) {
          const args = message[2];
          symbols.set(message[1], {
            name: message[1],
            kind: args === void 0 ? "variable" : "method",
            detail: args === void 0 ? `Message result \xB7 ${currentPath}` : `${message[1]}(${args})`,
            parameters:
              args === void 0
                ? null
                : args
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
          });
        }
      }
      const participant =
        /^(actor|participant|boundary|control|entity|database|collections|queue)\s+(?:"([^"]+)"|([\w.$]+))(?:\s+as\s+([\w.$]+))?/i.exec(
          line,
        );
      if (participant) {
        const name = participant[4] ?? participant[3];
        if (name)
          symbols.set(name, {
            name,
            kind: "variable",
            detail: `${participant[1]} ${participant[2] ?? participant[3]}`,
            parameters: null,
          });
      }
    }
  }
  visit(source, path);
  return [...symbols.values()];
}
function completionContext(beforeCursor) {
  const prefix = /[$%]?[A-Za-z_][\w-]*$/.exec(beforeCursor)?.[0] ?? "";
  return {
    prefix,
    keywords: beforeCursor.trim() === prefix && !/^[$%]/.test(prefix),
    color: /\b\w*color\s+[$\w]*$/i.test(beforeCursor),
  };
}
function matchingSymbols(symbols, beforeCursor) {
  const { prefix, color } = completionContext(beforeCursor);
  const query = prefix.toLowerCase();
  const unique = /* @__PURE__ */ new Map();
  for (const symbol of [...builtinFunctions, ...symbols]) {
    const name = symbol.name.toLowerCase();
    if (query && !name.startsWith(query) && !(!/^[$%]/.test(query) && name.replace(/^[$%]/, "").startsWith(query))) continue;
    if (symbol.kind === "color" && !color && !/^COLOR(?:_|$)/i.test(prefix) && !(query.length >= 2 && !/^COLOR_/i.test(symbol.name)))
      continue;
    if (color && symbol.kind !== "color") continue;
    unique.set(symbol.name, symbol);
  }
  return [...unique.values()];
}
export { builtinFunctions, collectSymbols, completionContext, matchingSymbols };
