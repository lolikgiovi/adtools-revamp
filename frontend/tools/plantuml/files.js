import JSZip from "jszip";
import { addNode, nodePath, validateWorkspace } from "./workspace.js";

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportWorkspace(workspace) {
  const zip = new JSZip();
  for (const node of workspace.nodes) {
    const path = nodePath(workspace.nodes, node.id);
    if (node.kind === "file") zip.file(path, node.content);
    else zip.folder(path);
  }
  zip.file(".plantuml-workspace.json", JSON.stringify(workspace));
  downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), "plantuml-workspace.zip");
}

export async function readWorkspaceZip(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a ZIP smaller than 20 MB.");
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (error) {
    throw new Error("Cannot read this ZIP. Choose a valid workspace ZIP.", { cause: error });
  }
  const entries = Object.values(zip.files);
  // Bound declared sizes before decompression; JSZip also checks decoded content lengths.
  let total = 0;
  if (entries.length > 5000) throw new Error("Workspace exceeds 5,000 entries.");
  for (const entry of entries) {
    total += entry._data?.uncompressedSize || 0;
    if (total > 50 * 1024 * 1024) throw new Error("Workspace exceeds 50 MB uncompressed.");
    const original = entry.unsafeOriginalName || entry.name;
    if (original.startsWith("/") || original.includes("\\") || original.split("/").includes("..")) throw new Error("Invalid path in ZIP.");
  }
  const metadata = zip.file(".plantuml-workspace.json");
  if (metadata) return validateWorkspace(JSON.parse(await metadata.async("string")));
  let workspace = { version: 1, nodes: [], tabs: [], activeId: null, expanded: [] };
  const folders = new Map();
  for (const entry of entries) {
    if (entry.name.startsWith("__MACOSX/") || /(^|\/)\./.test(entry.name)) continue;
    const parts = entry.name.replace(/\/$/, "").split("/");
    let parentId = null;
    for (let i = 0; i < parts.length - (entry.dir ? 0 : 1); i++) {
      const path = parts.slice(0, i + 1).join("/");
      if (!folders.has(path)) {
        workspace = addNode(workspace, parts[i], parentId, "folder");
        folders.set(path, workspace.nodes.at(-1).id);
      }
      parentId = folders.get(path);
    }
    if (!entry.dir) workspace = addNode(workspace, parts.at(-1), parentId, "file", await entry.async("string"));
  }
  workspace.tabs = workspace.tabs.slice(0, 1);
  workspace.activeId = workspace.tabs[0] || null;
  return validateWorkspace(workspace);
}

export async function exportPng(svg, name) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(2, 8192 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable.");
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("PNG export failed"))), "image/png"),
    );
    downloadBlob(blob, name.replace(/\.[^.]+$/, "") + ".png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
