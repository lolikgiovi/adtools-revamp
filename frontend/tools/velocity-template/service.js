import { Compile, parse } from "velocityjs";

export class VelocityTemplateError extends Error {
  constructor(message, { kind = "runtime", line = 1, column = 1, cause } = {}) {
    super(message, { cause });
    this.name = "VelocityTemplateError";
    this.kind = kind;
    this.line = line;
    this.column = column;
  }
}

function validateDirectiveStructure(template) {
  const stack = [];
  const blockDirectives = new Set(["if", "foreach", "macro", "define"]);
  const withoutBlockComments = template.replace(/#\*[\s\S]*?\*#/g, (comment) => comment.replace(/[^\n]/g, " "));
  const lines = withoutBlockComments.split("\n");

  lines.forEach((line, lineIndex) => {
    const content = line.replace(/##.*$/, "").replace(/(["'])(?:\\.|(?!\1).)*\1/g, (quoted) => " ".repeat(quoted.length));
    for (const match of content.matchAll(/(?<!\\)#(if|foreach|macro|define|elseif|else|end)\b/g)) {
      const directive = match[1];
      const location = { line: lineIndex + 1, column: match.index + 1 };
      if (blockDirectives.has(directive)) {
        stack.push({ directive, ...location });
        continue;
      }
      if (directive === "else" || directive === "elseif") {
        if (stack.at(-1)?.directive !== "if") {
          const hint = directive === "else" ? "Move #else before the matching #end." : "Use #elseif inside an open #if block.";
          throw new VelocityTemplateError(`Unexpected #${directive}: there is no open #if block. ${hint}`, {
            kind: "syntax",
            ...location,
          });
        }
        continue;
      }
      if (!stack.length) {
        throw new VelocityTemplateError("Unexpected #end: there is no open block to close.", { kind: "syntax", ...location });
      }
      stack.pop();
    }
  });

  const unclosed = stack.at(-1);
  if (unclosed) {
    throw new VelocityTemplateError(`Unclosed #${unclosed.directive} block: add a matching #end.`, {
      kind: "syntax",
      line: unclosed.line,
      column: unclosed.column,
    });
  }
}

function normalizeVelocityError(error) {
  if (error instanceof VelocityTemplateError) return error;
  const location = error?.hash?.loc;
  if (location) {
    const expectation = String(error.message || "")
      .split("\n")
      .find((line) => line.startsWith("Expecting "));
    return new VelocityTemplateError(expectation ? `Invalid Velocity syntax. ${expectation}` : "Invalid Velocity syntax.", {
      kind: "syntax",
      line: location.first_line || 1,
      column: (location.first_column ?? 0) + 1,
      cause: error,
    });
  }
  return new VelocityTemplateError(`Velocity rendering failed: ${error?.message || "Unknown error."}`, { cause: error });
}

export function renderVelocityTemplate(template = "", context = {}) {
  const values = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  const source = String(template);
  try {
    validateDirectiveStructure(source);
    return new Compile(parse(source)).render(values);
  } catch (error) {
    throw normalizeVelocityError(error);
  }
}

function referencePath(node) {
  if (!node || node.type !== "references" || !node.id) return "";
  const parts = [node.id];
  for (const segment of node.path || []) {
    if (segment.type !== "property" || !segment.id) break;
    parts.push(segment.id);
  }
  return parts.join(".");
}

function collectContextPaths(node, locals, paths) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    const header = node[0];
    if (header?.type === "foreach") {
      collectContextPaths(header.from, locals, paths);
      const scopedLocals = new Set(locals);
      scopedLocals.add(header.to);
      node.slice(1).forEach((child) => collectContextPaths(child, scopedLocals, paths));
      return;
    }
    if (header?.type === "macro") {
      const scopedLocals = new Set(locals);
      (header.args || []).forEach((argument) => scopedLocals.add(String(argument?.id || argument || "").replace(/^\$/, "")));
      node.slice(1).forEach((child) => collectContextPaths(child, scopedLocals, paths));
      return;
    }
    node.forEach((child) => {
      if (child?.type === "set") {
        collectContextPaths(child.equal?.[1], locals, paths);
        const assigned = referencePath(child.equal?.[0]).split(".")[0];
        if (assigned) locals.add(assigned);
      } else collectContextPaths(child, locals, paths);
    });
    return;
  }
  if (node.type === "references") {
    const path = referencePath(node);
    const root = path.split(".")[0];
    if (path && !locals.has(root) && root !== "foreach") paths.add(path);
  }
  Object.values(node).forEach((child) => collectContextPaths(child, locals, paths));
}

export function extractContextPaths(template = "") {
  const paths = new Set();
  try {
    collectContextPaths(parse(String(template)), new Set(), paths);
  } catch (_) {
    const references = String(template).match(/\$!?\{[^}]+\}|\$!?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/g) || [];
    references.forEach((reference) => {
      const path = reference.replace(/^\$!?\{?/, "").replace(/\}$/, "");
      if (!/^(?:foreach)(?:\.|$)/.test(path)) paths.add(path);
    });
  }
  return Array.from(paths).sort();
}

export function setNestedValue(target, path, value) {
  const parts = String(path).split(".");
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else {
      if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    }
  });
  return target;
}
