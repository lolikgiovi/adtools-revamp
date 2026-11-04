export function workspaceFiles(workspace) {
  const nodes = new Map(workspace.nodes.map((node) => [node.id, node]));
  return workspace.nodes
    .filter((node) => node.kind === "file")
    .map((node) => {
      const parts = [node.name];
      const seen = new Set([node.id]);
      let parent = nodes.get(node.parentId);
      while (parent && !seen.has(parent.id)) {
        seen.add(parent.id);
        parts.unshift(parent.name);
        parent = nodes.get(parent.parentId);
      }
      return { id: node.id, name: node.name, path: parts.join("/") };
    });
}

export function openWorkspaceDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("adtools-plantuml", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("workspaces")) db.createObjectStore("workspaces", { keyPath: "id" });
      const catalog = db.createObjectStore("fileCatalog", { keyPath: "id" });
      // One-time migration: existing workspaces become searchable without opening the editor.
      const saved = request.transaction.objectStore("workspaces").get("local");
      saved.onsuccess = () => {
        catalog.put({ id: "local", files: saved.result ? workspaceFiles(saved.result.workspace) : [] });
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}
