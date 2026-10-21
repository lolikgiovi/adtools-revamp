import { Compile, parse } from "velocityjs";

export class VelocityTemplateError extends Error {
  constructor(message, { kind = "runtime", line = null, column = null, cause, reference } = {}) {
    super(message, { cause });
    this.name = "VelocityTemplateError";
    this.reference = reference;
    this.kind = kind;
    this.line = line;
    this.column = column;
  }
}

export class VelocityResultError extends Error {
  constructor(message, { line = 1, column = 1, cause, templateLine, templateColumn, reference } = {}) {
    super(message, { cause });
    this.name = "VelocityResultError";
    this.kind = "output";
    this.line = line;
    this.column = column;
    this.templateLine = templateLine;
    this.templateColumn = templateColumn;
    this.reference = reference;
  }
}

export function parseVelocityContext(context = "{}") {
  const source = String(context).trim() || "{}";
  let result = "";
  let inString = false;
  let escaped = false;
  let comment = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (comment === "line") {
      if (character === "\n" || character === "\r") {
        comment = null;
        result += character;
      } else result += " ";
      continue;
    }
    if (comment === "block") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        comment = null;
      } else result += character === "\n" || character === "\r" ? character : " ";
      continue;
    }
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === "/" && next === "/") {
      comment = "line";
      result += "  ";
      index += 1;
    } else if (character === "/" && next === "*") {
      comment = "block";
      result += "  ";
      index += 1;
    } else result += character;
  }
  if (comment === "block") throw new SyntaxError("Unterminated block comment in context data.");
  return JSON.parse(result);
}

function sourceLocation(source, position) {
  const before = source.slice(0, position);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function bareVelocityReference(source) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== "$") continue;
    const reference = source.slice(index).match(/^\$!?\{?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\}?/)?.[0];
    if (reference) return { index, reference };
  }
  return null;
}

function jsonErrorLocation(source, error) {
  const message = String(error?.message || "");
  const explicitLine = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (explicitLine) return { line: Number(explicitLine[1]), column: Number(explicitLine[2]) };
  const position = Number(message.match(/position\s+(\d+)/i)?.[1]);
  if (Number.isFinite(position)) return sourceLocation(source, position);
  const unresolved = bareVelocityReference(source);
  if (unresolved) return { ...sourceLocation(source, unresolved.index), reference: unresolved.reference };
  return { line: 1, column: 1 };
}

function emptyRenderedJsonField(source, template) {
  for (const match of source.matchAll(/"((?:[^"\\]|\\.)*)"\s*:\s*(?=[,}\]])/g)) {
    const field = match[1];
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const templateMatch = String(template).match(new RegExp(`"${escapedField}"\\s*:\\s*(\\$!\\{?[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*\\}?)`));
    if (!templateMatch) continue;
    const reference = templateMatch[1];
    const outputIndex = match.index + match[0].length;
    const templateIndex = templateMatch.index + templateMatch[0].indexOf(reference);
    const templateLocation = sourceLocation(String(template), templateIndex);
    return {
      ...sourceLocation(source, outputIndex),
      templateLine: templateLocation.line,
      templateColumn: templateLocation.column,
      field,
      reference,
    };
  }
  return null;
}

export function formatRenderedResult(rendered = "", mode = "text", template = "") {
  const source = String(rendered);
  if (mode !== "json") return source;
  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch (error) {
    const emptyField = emptyRenderedJsonField(source, template);
    const location = emptyField || jsonErrorLocation(source, error);
    const templateIndex = location.reference ? String(template).indexOf(location.reference) : -1;
    const templateLocation = location.templateLine || templateIndex < 0 ? {} : sourceLocation(String(template), templateIndex);
    const detail = emptyField
      ? `Quiet reference ${emptyField.reference} rendered an empty value for "${emptyField.field}". Add the value to Context Data or provide a JSON-safe default.`
      : error?.message || "Check the generated JSON syntax.";
    throw new VelocityResultError(`Rendered output is not valid JSON. ${detail}`, {
      ...location,
      templateLine: location.templateLine || templateLocation.line,
      templateColumn: location.templateColumn || templateLocation.column,
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
    return createDiagnosticCompiler(parse(source), source).render(values);
  } catch (error) {
    throw normalizeVelocityError(error);
  }
}

function referenceLabel(ast) {
  return `${ast.leader || "$"}${ast.isWraped ? "{" : ""}${ast.id}${(ast.path || [])
    .map((part) => {
      if (part.type === "method") return `.${part.id}(${part.args?.length ? "…" : ""})`;
      if (part.type === "property") return `.${part.id}`;
      return `[${part.id?.value ?? "…"}]`;
    })
    .join("")}${ast.isWraped ? "}" : ""}`;
}

function valueType(value) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function createDiagnosticCompiler(asts, source) {
  const locations = new WeakMap();
  const offset = (pos) =>
    source
      .split("\n")
      .slice(0, pos.first_line - 1)
      .join("\n").length +
    (pos.first_line > 1 ? 1 : 0) +
    pos.first_column;
  function locate(node, start = 0) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child) => locate(child, start));
      return;
    }
    const position = node.pos ? offset(node.pos) : start;
    if (node.type === "references") {
      const firstMethod = node.path?.findIndex((part) => part.type !== "property") ?? -1;
      const path = firstMethod < 0 ? node.path || [] : node.path.slice(0, firstMethod + 1);
      const prefix = `${node.leader || "$"}${node.isWraped ? "{" : ""}${node.id}${path
        .filter((part) => part.type === "property" || part.type === "method")
        .map((part) => `.${part.id}`)
        .join("")}`;
      const index = source.indexOf(prefix, position);
      locations.set(node, index);
    } else if (node.type === "string" && node.isEval) {
      const index = source.indexOf(node.value, position);
      locations.set(node, index);
    }
    Object.values(node).forEach((child) => locate(child, position));
  }
  locate(asts);
  const compiler = new Compile(asts);
  const getString = compiler.getString;
  const getAttributes = compiler.getAttributes;
  let stringOffset = null;
  compiler.getString = function (literal) {
    const previous = stringOffset;
    stringOffset = locations.get(literal) ?? previous;
    try {
      return getString.call(this, literal);
    } finally {
      stringOffset = previous;
    }
  };
  compiler.getAttributes = function (property, receiver, ast) {
    try {
      return getAttributes.call(this, property, receiver, ast);
    } catch (error) {
      if (error instanceof VelocityTemplateError) throw error;
      const reference = referenceLabel(ast);
      let index = locations.get(ast);
      if (index === undefined && stringOffset !== null) {
        index = source.indexOf(`${ast.leader || "$"}${ast.isWraped ? "{" : ""}${ast.id}`, stringOffset);
      }
      const location = index >= 0 ? sourceLocation(source, index) : { line: null, column: null };
      const type = valueType(receiver);
      const hint =
        property.type === "method"
          ? `Method .${property.id}() failed on a ${type} value. ${
              ["object", "array"].includes(type)
                ? "Check the method arguments and renderer compatibility."
                : "Check Context Data: use an array for a list or an object for a map."
            }`
          : `Cannot read this property from a ${type} value. Check the value in Context Data.`;
      throw new VelocityTemplateError(`Velocity rendering failed at ${reference}: ${hint}`, {
        ...location,
        reference,
        cause: error,
      });
    }
  };
  return compiler;
}

export function suggestMissingContextFields(template = "", context = {}) {
  let asts;
  try {
    asts = parse(String(template));
  } catch (_) {
    return [];
  }
  const inputs = new Map();
  const locals = new Map();
  function declare(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "set") locals.set(node.equal?.[0]?.id, null);
    Object.values(node).forEach(declare);
  }
  declare(asts);
  const resolve = (node, scope) => {
    const path = referencePath(node);
    if (!path) return null;
    if (!scope.has(node.id)) return path;
    const alias = scope.get(node.id);
    return alias ? alias + path.slice(node.id.length) : null;
  };
  const record = (path, kind = "scalar", note = "") => {
    if (!path || path === "foreach" || path.startsWith("foreach.")) return;
    const priority = { scalar: 0, collection: 1, object: 1, array: 2, map: 3 };
    const old = inputs.get(path);
    if (!old || priority[kind] > priority[old.kind]) inputs.set(path, { kind, note });
    else if (note) old.note = note;
  };
  function visit(node, scope = locals) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      const header = node[0];
      if (header?.type === "foreach") {
        visit(header.from, scope);
        record(resolve(header.from, scope), "array");
        const nested = new Map(scope).set(header.to, null);
        node.slice(1).forEach((child) => visit(child, nested));
      } else if (header?.type === "macro") {
        const nested = new Map(scope);
        (header.args || []).forEach((arg) => nested.set(arg.id || String(arg).replace(/^\$/, ""), null));
        node.slice(1).forEach((child) => visit(child, nested));
      } else node.forEach((child) => visit(child, scope));
      return;
    }
    if (node.type === "set") {
      visit(node.equal?.[1], scope);
      if (!node.equal?.[0]?.path) {
        const right = node.equal[1];
        const alias = right?.type === "references" && (right.path || []).every((part) => part.type === "property");
        scope.set(node.equal[0].id, alias ? resolve(right, scope) : null);
      }
      return;
    }
    if (node.type === "string" && node.isEval && node.value.includes("$")) {
      try {
        visit(parse(node.value), scope);
      } catch (_) {
        /* Incomplete interpolation has no safe suggestion. */
      }
      return;
    }
    if (node.type === "references") {
      const path = resolve(node, scope);
      const method = node.path?.find((part) => part.type === "method");
      const indexed = node.path?.some((part) => part.type === "index");
      let kind = indexed ? "array" : "scalar";
      let note = "";
      if (method) {
        if (["entrySet", "keySet", "values", "containsKey", "put"].includes(method.id)) kind = "map";
        else if (["add", "subList"].includes(method.id)) kind = "array";
        else if (["isEmpty", "size", "get"].includes(method.id)) kind = "collection";
        else if (
          ![
            "trim",
            "toString",
            "toUpperCase",
            "toLowerCase",
            "substring",
            "replace",
            "contains",
            "startsWith",
            "endsWith",
            "indexOf",
            "equals",
            "equalsIgnoreCase",
          ].includes(method.id)
        ) {
          kind = "object";
          note = `.${method.id}() needs a runtime helper; JSON cannot define functions.`;
        }
      }
      record(path, kind, note);
    }
    Object.values(node).forEach((child) => visit(child, scope));
  }
  visit(asts);
  const shape = {};
  for (const [path, { kind }] of [...inputs].sort(([a], [b]) => a.length - b.length)) {
    if ([...inputs.keys()].some((other) => other.startsWith(`${path}.`))) continue;
    const leaf = path.split(".").at(-1).toLowerCase();
    let value = `sample-${leaf}`;
    if (kind === "array") value = [];
    else if (kind === "object" || kind === "map" || kind === "collection") value = {};
    else if (/^(?:is[A-Z_]|has[A-Z_])/.test(path.split(".").at(-1)) || /^(active|enabled|success)$/.test(leaf)) value = true;
    else if (/^(count|amount|total|price|age)$|(?:Count|Amount|WeightGram|Price)$/.test(path.split(".").at(-1))) value = 1;
    setNestedValue(shape, path, value);
  }
  const fields = [];
  function missing(expected, actual, path) {
    const type = valueType(expected);
    const note = inputs.get(path)?.note;
    if (inputs.get(path)?.kind === "collection" && ["object", "array"].includes(valueType(actual))) return;
    if (type === "object" && Object.keys(expected).length && (actual === undefined || valueType(actual) === "object")) {
      Object.entries(expected).forEach(([key, value]) => missing(value, actual?.[key], path ? `${path}.${key}` : key));
    } else if (actual === undefined || (["object", "array"].includes(type) && valueType(actual) !== type)) {
      fields.push({
        path,
        value: expected,
        ...(note || actual !== undefined
          ? { note: [actual !== undefined ? `Replace ${valueType(actual)} with ${type}.` : "", note].filter(Boolean).join(" ") }
          : {}),
      });
    }
  }
  missing(shape, context, "");
  return fields.sort((a, b) => a.path.localeCompare(b.path));
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

export function getTemplateImportTable(sql = "") {
  const source = String(sql)
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  const from = source.match(/\bFROM\s+((?:"(?:[^"]|"")+"|[A-Za-z_$#][\w$#]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_$#][\w$#]*))?)/i)?.[1];
  if (!from) return null;
  const names = from.split(".").map((part) => part.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
  const table = names.at(-1) || "";
  const schema = names.length > 1 ? names.at(-2) : "";
  if (!table) return null;
  return { schema, table, qualifiedTable: schema ? `${schema}.${table}` : table };
}

export function getTemplateImportIdentity(sql = "", columns = [], row = []) {
  const source = getTemplateImportTable(sql);
  if (!source) return null;
  const { schema, table } = source;

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
