// Revisions contain no catalog data. Each window checks the shared revision before using its cache.
const revisions = new Map();
const prefix = "adtools.search-catalog.";

export function catalogRevision(catalog) {
  try {
    return `${localStorage.getItem(prefix + catalog) || ""}:${revisions.get(catalog) || ""}`;
  } catch {
    return revisions.get(catalog) || "";
  }
}

export function invalidateCatalog(catalog) {
  const revision = crypto.randomUUID();
  revisions.set(catalog, revision);
  try {
    localStorage.setItem(prefix + catalog, revision);
  } catch {
    // Same-window invalidation remains available when localStorage is full/disabled.
  }
}
