import { catalogRevision } from "../../core/SearchCatalogRevision.js";
import { collapseSearchName, getSearchAbbreviations, scoreFuzzyTerm } from "../../core/FuzzySearch.js";
import { openWorkspaceDatabase } from "./catalog.js";

let cached;
let revision;
let loading;

async function loadCatalog() {
  const loadedRevision = catalogRevision("plantuml");
  const db = await openWorkspaceDatabase();
  try {
    const files = await new Promise((resolve, reject) => {
      const request = db.transaction("fileCatalog").objectStore("fileCatalog").get("local");
      request.onsuccess = () => resolve(request.result?.files || []);
      request.onerror = () => reject(request.error);
    });
    cached = files.map((file) => ({
      ...file,
      lowerName: file.name.toLowerCase(),
      collapsed: collapseSearchName(file.name),
      abbrs: getSearchAbbreviations(file.name),
    }));
    revision = loadedRevision;
  } finally {
    db.close();
  }
}

export async function searchPlantUmlFiles(term) {
  if (!cached || revision !== catalogRevision("plantuml")) {
    loading ||= loadCatalog().finally(() => {
      loading = null;
    });
    await loading;
  }
  const query = term.trim().toLowerCase();
  if (!query) return [];
  // Keep only the best eight candidates, rather than sorting/rendering the entire workspace.
  const best = [];
  for (const file of cached) {
    const score = scoreFuzzyTerm(query, { name: file.lowerName, collapsed: file.collapsed, abbrs: file.abbrs });
    if (!score) continue;
    const entry = { file, score };
    const at = best.findIndex((item) => item.score < score || (item.score === score && item.file.path.localeCompare(file.path) > 0));
    if (at < 0) best.push(entry);
    else best.splice(at, 0, entry);
    if (best.length > 8) best.pop();
  }
  return best.map(({ file, score }) => ({
    id: `plantuml-file-${file.id}`,
    name: file.name,
    description: `PlantUML · ${file.path}`,
    route: "plantuml",
    type: "action",
    icon: "plantuml",
    data: { fileId: file.id },
    searchScore: score,
  }));
}
