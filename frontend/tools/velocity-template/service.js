import { Compile, parse } from "velocityjs";

export function renderVelocityTemplate(template = "", context = {}) {
  const values = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  return new Compile(parse(String(template))).render(values);
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
