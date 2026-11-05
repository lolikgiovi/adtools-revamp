import { RecentInteractionStore } from "../../core/RecentInteractionStore.js";
import { openWorkspaceDatabase } from "./catalog.js";

const PREFIX = "plantuml-file:";

export function recordRecentDiagram(fileId) {
  if (fileId) new RecentInteractionStore().touch(`${PREFIX}${fileId}`);
}

export async function recentDiagrams(recentStore, limit = 4) {
  const entries = (recentStore?.getEntries() || []).filter((entry) => entry.key.startsWith(PREFIX));
  if (!entries.length) return [];
  const db = await openWorkspaceDatabase();
  try {
    const files = await new Promise((resolve, reject) => {
      const request = db.transaction("fileCatalog").objectStore("fileCatalog").get("local");
      request.onsuccess = () => resolve(request.result?.files || []);
      request.onerror = () => reject(request.error);
    });
    const byId = new Map(files.map((file) => [file.id, file]));
    return entries
      .map((entry) => byId.get(entry.key.slice(PREFIX.length)))
      .filter(Boolean)
      .slice(0, limit);
  } finally {
    db.close();
  }
}
