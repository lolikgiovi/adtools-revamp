// Adapted from lolikgiovi/plantuml at 74bc3e7.
import { z } from "zod";
import { confluencePalette, starterSequence, classTemplate } from "./plantuml.js";
const baseNode = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1),
  parentId: z.string().nullable(),
});
const nodeSchema = z.discriminatedUnion("kind", [
  baseNode.extend({ kind: z.literal("file"), content: z.string() }),
  baseNode.extend({ kind: z.literal("folder") }),
]);
const workspaceSchema = z.object({
  version: z.literal(1),
  nodes: z.array(nodeSchema).max(5e3),
  tabs: z.array(z.string()),
  activeId: z.string().nullable(),
  expanded: z.array(z.string()),
});
function initialWorkspace() {
  return {
    version: 1,
    nodes: [
      { id: "diagrams", kind: "folder", name: "diagrams", parentId: null },
      { id: "shared", kind: "folder", name: "shared", parentId: null },
      {
        id: "welcome",
        kind: "file",
        name: "api-sequence.puml",
        parentId: "diagrams",
        content: starterSequence,
      },
      {
        id: "classes",
        kind: "file",
        name: "workspace.puml",
        parentId: "diagrams",
        content: classTemplate,
      },
      {
        id: "colors",
        kind: "file",
        name: "confluence-colors.puml",
        parentId: "shared",
        content: confluencePalette,
      },
    ],
    tabs: ["welcome"],
    activeId: "welcome",
    expanded: ["diagrams", "shared"],
  };
}
function upgradeStarter(workspace) {
  const legacyStarter = workspace.nodes.find((node) => node.id === "welcome" && node.kind === "file" && node.name === "sign-in.puml");
  if (!legacyStarter || workspace.nodes.some((node) => node.id === "api-sequence-starter")) return workspace;
  const parentId = legacyStarter.parentId;
  let name = "api-sequence.puml";
  let suffix = 2;
  while (workspace.nodes.some((node) => node.parentId === parentId && node.name.toLowerCase() === name.toLowerCase()))
    name = `api-sequence-${suffix++}.puml`;
  const id = "api-sequence-starter";
  return {
    ...workspace,
    nodes: [...workspace.nodes, { id, kind: "file", name, parentId, content: starterSequence }],
    tabs: [...workspace.tabs, id],
    activeId: id,
    expanded: [.../* @__PURE__ */ new Set([...workspace.expanded, ...(parentId ? [parentId] : [])])],
  };
}
function validateWorkspace(input) {
  const workspace = workspaceSchema.parse(input);
  const ids = /* @__PURE__ */ new Set();
  const siblings = /* @__PURE__ */ new Set();
  for (const node of workspace.nodes) {
    if (ids.has(node.id)) throw new Error("Duplicate file ID in workspace");
    ids.add(node.id);
    validateName(node.name);
    const key = `${node.parentId ?? ""}/${node.name.toLowerCase()}`;
    if (siblings.has(key)) throw new Error(`Duplicate name: ${node.name}`);
    siblings.add(key);
  }
  for (const node of workspace.nodes) {
    const seen = /* @__PURE__ */ new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) throw new Error("Folder cycle in workspace");
      seen.add(parentId);
      const parent = workspace.nodes.find((n) => n.id === parentId);
      if (!parent || parent.kind !== "folder") throw new Error(`Missing parent of ${node.name}`);
      parentId = parent.parentId;
    }
  }
  const fileIds = new Set(workspace.nodes.filter((n) => n.kind === "file").map((n) => n.id));
  workspace.tabs = [...new Set(workspace.tabs)].filter((id) => fileIds.has(id));
  if (!workspace.activeId || !workspace.tabs.includes(workspace.activeId)) workspace.activeId = workspace.tabs[0] ?? null;
  workspace.expanded = workspace.expanded.filter((id) => workspace.nodes.some((n) => n.id === id && n.kind === "folder"));
  return workspace;
}
function validateName(name) {
  if (
    !name.trim() ||
    name !== name.trim() ||
    /[/\\]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32) ||
    name === "." ||
    name === ".." ||
    name.length > 180
  ) {
    throw new Error("Use a name without slashes, control characters, or surrounding spaces.");
  }
}
function nodePath(nodes, id) {
  const node = nodes.find((n) => n.id === id);
  if (!node) return "";
  return node.parentId ? `${nodePath(nodes, node.parentId)}/${node.name}` : node.name;
}
function resolvePath(path, from) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//"))
    throw new Error("Remote resources are disabled. Import the file into your workspace.");
  const parts = path.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("Include is outside the workspace");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
function addNode(workspace, name, parentId, kind, content = "") {
  validateName(name);
  if (parentId && !workspace.nodes.some((n) => n.id === parentId && n.kind === "folder")) throw new Error("Folder does not exist");
  if (workspace.nodes.some((n) => n.parentId === parentId && n.name.toLowerCase() === name.toLowerCase()))
    throw new Error("That name already exists in this folder.");
  const id = crypto.randomUUID();
  const node = kind === "file" ? { id, kind, name, parentId, content } : { id, kind, name, parentId };
  return {
    ...workspace,
    nodes: [...workspace.nodes, node],
    expanded: [.../* @__PURE__ */ new Set([...workspace.expanded, ...(parentId ? [parentId] : [])])],
    ...(kind === "file" ? { tabs: [...workspace.tabs, id], activeId: id } : {}),
  };
}
function renameNode(workspace, id, name) {
  const node = workspace.nodes.find((n) => n.id === id);
  if (!node) return workspace;
  validateName(name);
  if (workspace.nodes.some((n) => n.id !== id && n.parentId === node.parentId && n.name.toLowerCase() === name.toLowerCase()))
    throw new Error("That name already exists in this folder.");
  return { ...workspace, nodes: workspace.nodes.map((n) => (n.id === id ? { ...n, name } : n)) };
}
function moveNode(workspace, id, parentId) {
  const node = workspace.nodes.find((n) => n.id === id);
  if (!node) return workspace;
  if (parentId === node.parentId) return workspace;
  const next = {
    ...workspace,
    nodes: workspace.nodes.map((n) => (n.id === id ? { ...n, parentId } : n)),
    expanded: [.../* @__PURE__ */ new Set([...workspace.expanded, ...(parentId ? [parentId] : [])])],
  };
  return validateWorkspace(next);
}
function deleteNode(workspace, id) {
  const removed = /* @__PURE__ */ new Set([id]);
  let size = 0;
  while (size !== removed.size) {
    size = removed.size;
    for (const node of workspace.nodes) if (node.parentId && removed.has(node.parentId)) removed.add(node.id);
  }
  const tabs = workspace.tabs.filter((tab) => !removed.has(tab));
  return {
    ...workspace,
    nodes: workspace.nodes.filter((n) => !removed.has(n.id)),
    tabs,
    activeId: workspace.activeId && removed.has(workspace.activeId) ? (tabs.at(-1) ?? null) : workspace.activeId,
    expanded: workspace.expanded.filter((id2) => !removed.has(id2)),
  };
}
export {
  addNode,
  deleteNode,
  initialWorkspace,
  moveNode,
  nodePath,
  nodeSchema,
  renameNode,
  resolvePath,
  upgradeStarter,
  validateName,
  validateWorkspace,
  workspaceSchema,
};
