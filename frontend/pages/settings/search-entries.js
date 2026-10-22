/**
 * Build command-palette entries for the settings defined in config.json.
 * Nested categories are flattened into "Category › Subcategory" context so a
 * result reads like "Settings: Theme" while still explaining where it lives.
 */
export function buildSettingsSearchEntries(config, { runtime = "web", userRole = "user" } = {}) {
  const entries = [];

  const isVisible = (node) => {
    if (!node) return false;
    if (node.requiresTauri && runtime !== "tauri") return false;
    if (Array.isArray(node.roles) && node.roles.length) return node.roles.includes(userRole);
    return true;
  };

  const visit = (categories, categoryPath = []) => {
    for (const category of categories || []) {
      if (!isVisible(category)) continue;
      const nextPath = [...categoryPath, category.label];

      for (const item of category.items || []) {
        if (!isVisible(item)) continue;
        entries.push({
          id: `setting-${item.key}`,
          name: `Settings: ${item.label}`,
          description: [nextPath.join(" › "), item.description].filter(Boolean).join(" · "),
          route: "settings",
          type: "setting",
          icon: "settings",
          interactionKey: `setting:${item.key}`,
          data: { setting: item.key },
        });
      }

      visit(category.categories, nextPath);
    }
  };

  visit(config?.categories);
  return entries;
}
