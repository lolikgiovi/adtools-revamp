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

export class VelocityResultError extends Error {
  constructor(message, { line = 1, column = 1, cause } = {}) {
    super(message, { cause });
    this.name = "VelocityResultError";
    this.kind = "output";
    this.line = line;
    this.column = column;
  }
}

function jsonErrorLocation(source, error) {
  const position = Number(String(error?.message || "").match(/position\s+(\d+)/i)?.[1]);
  if (!Number.isFinite(position)) return { line: 1, column: 1 };
  const before = source.slice(0, position);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

export function formatRenderedResult(rendered = "", mode = "text") {
  const source = String(rendered);
  if (mode !== "json") return source;
  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch (error) {
    const location = jsonErrorLocation(source, error);
    throw new VelocityResultError(`Rendered output is not valid JSON. ${error?.message || "Check the generated JSON syntax."}`, {
      ...location,
      cause: error,
    });
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

function collectVelocityVariables(node, variables) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectVelocityVariables(child, variables));
    return;
  }
  if (node.type === "set") {
    const path = referencePath(node.equal?.[0]);
    if (path) {
      variables.add(path.split(".")[0]);
      variables.add(path);
    }
  } else if (node.type === "foreach" && node.to) {
    variables.add(String(node.to).replace(/^\$/, ""));
  } else if (node.type === "macro") {
    (node.args || []).forEach((argument) => {
      const name = String(argument?.id || argument || "").replace(/^\$/, "");
      if (name) variables.add(name);
    });
  }
  Object.values(node).forEach((child) => collectVelocityVariables(child, variables));
}

export function extractVelocityVariables(template = "") {
  const variables = new Set();
  const source = String(template);
  try {
    collectVelocityVariables(parse(source), variables);
  } catch (_) {
    for (const match of source.matchAll(/#set\s*\(\s*\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*=/g)) {
      variables.add(match[1].split(".")[0]);
      variables.add(match[1]);
    }
    for (const match of source.matchAll(/#foreach\s*\(\s*\$([A-Za-z_]\w*)\s+in\b/g)) variables.add(match[1]);
    for (const match of source.matchAll(/#macro\s*\([^\r\n)]*/g)) {
      for (const argument of match[0].matchAll(/\$([A-Za-z_]\w*)/g)) variables.add(argument[1]);
    }
  }
  return Array.from(variables).sort();
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

export function parseTemplateImportQuery(sql = "") {
  const statement = String(sql).trim().replace(/;\s*$/, "").trim();
  const masked = statement
    .replace(/--[^\n]*/g, (comment) => " ".repeat(comment.length))
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/'(?:''|[^'])*'/g, (quoted) => " ".repeat(quoted.length))
    .replace(/"(?:""|[^"])*"/g, (quoted) => " ".repeat(quoted.length));
  if (!statement || !/^SELECT\b/i.test(masked) || /;/.test(masked)) {
    throw new Error("Enter one read-only SELECT statement.");
  }
  if (/\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|CALL|FOR\s+UPDATE)\b/i.test(masked)) {
    throw new Error("The import query must be read-only.");
  }
  return statement;
}

export function getTemplateImportIdentity(sql = "", columns = [], row = []) {
  const source = String(sql)
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  const from = source.match(/\bFROM\s+((?:"(?:[^"]|"")+"|[A-Za-z_$#][\w$#]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_$#][\w$#]*))?)/i)?.[1];
  if (!from) return null;
  const names = from.split(".").map((part) => part.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
  const table = names.at(-1) || "";
  const schema = names.length > 1 ? names.at(-2) : "";
  if (!table) return null;

  const columnMap = new Map(columns.map((column, index) => [String(column).toUpperCase(), index]));
  const identifierNames = ["SERVICE_CODE", "ENVIRONMENT", "TEMPLATE_ID", "ID"];
  const preferred = identifierNames.filter((name) => columnMap.has(name) && row[columnMap.get(name)] != null);
  const selected = preferred.some((name) => name === "SERVICE_CODE" || name === "ENVIRONMENT")
    ? preferred.filter((name) => name === "SERVICE_CODE" || name === "ENVIRONMENT")
    : preferred.slice(0, 1);
  const identifiers = Object.fromEntries(selected.map((name) => [name, String(row[columnMap.get(name)])]));
  const qualifiedTable = schema ? `${schema}.${table}` : table;
  const tabNamespace = schema || table;
  const tabIdentifier = identifiers.SERVICE_CODE || identifiers.ENVIRONMENT || Object.values(identifiers)[0];
  return { schema, table, identifiers, label: tabIdentifier ? `${tabNamespace} - ${tabIdentifier}` : qualifiedTable };
}

function sqlIdentifier(value, label) {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z_$#][\w$#]*$/.test(identifier)) throw new Error(`The imported ${label} is not a safe SQL identifier.`);
  return identifier;
}

export function buildVelocityQuickQueryDraft(sourceIdentity, template) {
  const schema = sourceIdentity?.schema ? sqlIdentifier(sourceIdentity.schema, "schema") : "";
  const table = sqlIdentifier(sourceIdentity?.table, "table");
  const templateColumn = sqlIdentifier(sourceIdentity?.templateColumn, "template column");
  const identifiers = Object.entries(sourceIdentity?.identifiers || {});
  if (!identifiers.length) throw new Error("At least one imported row identifier is required.");
  const identifierSchema = identifiers.map(([name]) => [sqlIdentifier(name, "identifier column"), "VARCHAR2", "No", "", "", "Yes"]);
  const headers = [...identifiers.map(([name]) => name), templateColumn];
  return {
    title: "Velocity template",
    tableName: schema ? `${schema}.${table}` : table,
    queryType: "update",
    schemaData: [...identifierSchema, [templateColumn, "CLOB", "Yes", "", "", "No"]],
    inputData: [headers, [...identifiers.map(([, value]) => value), String(template)]],
    source: "velocity-template",
  };
}

export function normalizeImportedTemplateValue(value) {
  if (value == null) return "";
  if (["string", "number", "boolean", "bigint"].includes(typeof value)) return String(value);
  if (typeof value === "object" && typeof value.data === "string" && /^oracle_(?:clob|nclob)$/i.test(value.__adtools_type || "")) {
    return value.data;
  }
  throw new Error("The selected field cannot be imported as template text.");
}
