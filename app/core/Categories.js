// Centralized category utilities
export const CATEGORIES = {
  GENERAL: "general",
  CONFIG: "config",
};

// Normalize raw category strings to a known set
export function normalizeCategory(value) {
  const v = (value || "").toString().trim().toLowerCase();
  if (!v) return CATEGORIES.GENERAL;

  const configAliases = ["config", "configuration", "settings", "admin", "setup"];
  if (configAliases.includes(v)) return CATEGORIES.CONFIG;

  return CATEGORIES.GENERAL;
}

// Heuristic categorization for tools; enforces default for App Registration
export function categorizeTool(tool) {
  if (!tool) return CATEGORIES.GENERAL;
  const base = normalizeCategory(tool.category);
  if (base === CATEGORIES.CONFIG) return CATEGORIES.CONFIG;

  const id = (tool.id || "").toLowerCase();
  const name = (tool.name || "").toLowerCase();
  const description = (tool.description || "").toLowerCase();
  const text = `${id} ${name} ${description}`;

  // Default: App Registration-related tools belong in Config
  const registrationKeywords = ["registration", "register", "registry", "app registration", "application registration"];
  if (registrationKeywords.some((kw) => text.includes(kw))) {
    return CATEGORIES.CONFIG;
  }

  return CATEGORIES.GENERAL;
}

export function isGeneral(v) {
  return normalizeCategory(v) === CATEGORIES.GENERAL;
}

export function isConfig(v) {
  return normalizeCategory(v) === CATEGORIES.CONFIG;
}
