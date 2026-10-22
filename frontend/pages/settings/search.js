/**
 * Filter rendered settings categories and items without re-rendering them.
 * Re-rendering would discard in-progress edits and rebuild heavy editors, so
 * matching only toggles visibility and expansion state.
 */
class SettingsSearch {
  constructor(root) {
    this.root = root || null;
    this.expansionState = null;
  }

  /**
   * Apply a search query to the rendered settings tree.
   * Returns the match count so callers can show feedback.
   */
  apply(query) {
    const q = String(query || "")
      .trim()
      .toLowerCase();
    if (!this.root) return { active: false, matches: 0, total: 0 };
    if (!q) {
      this.clear();
      return { active: false, matches: 0, total: 0 };
    }

    if (!this.expansionState) {
      this.expansionState = new Map();
      this.root.querySelectorAll(".settings-category").forEach((category) => {
        this.expansionState.set(category, category.getAttribute("aria-expanded") === "true");
      });
    }

    let matches = 0;
    let total = 0;

    const visit = (category, ancestorMatches = false) => {
      const header = category.querySelector(":scope > .settings-category-heading > .settings-category-header");
      const categoryMatches =
        ancestorMatches ||
        String(header?.textContent || "")
          .toLowerCase()
          .includes(q);
      const content = category.querySelector(":scope > .settings-category-content");
      let childMatches = false;

      if (content) {
        for (const item of content.querySelectorAll(":scope > .setting-item")) {
          total += 1;
          const haystack = `${item.dataset.setting || ""} ${item.textContent || ""}`.toLowerCase();
          const isMatch = categoryMatches || haystack.includes(q);
          item.hidden = !isMatch;
          if (isMatch) {
            matches += 1;
            childMatches = true;
          }
        }

        for (const subcategory of content.querySelectorAll(":scope > .settings-category")) {
          if (visit(subcategory, categoryMatches)) childMatches = true;
        }
      }

      category.hidden = !categoryMatches && !childMatches;
      if (childMatches) {
        category.setAttribute("aria-expanded", "true");
        header?.setAttribute("aria-expanded", "true");
      }
      return childMatches;
    };

    this.root.querySelectorAll(":scope > .settings-category").forEach((category) => visit(category));

    return { active: true, matches, total };
  }

  /** Restore every item and the category expansion state from before the search. */
  clear() {
    if (!this.root) return;

    this.root.querySelectorAll(".settings-category").forEach((category) => {
      category.hidden = false;
      const expanded = this.expansionState?.get(category);
      if (typeof expanded === "boolean") {
        category.setAttribute("aria-expanded", String(expanded));
        category
          .querySelector(":scope > .settings-category-heading > .settings-category-header")
          ?.setAttribute("aria-expanded", String(expanded));
      }
    });
    this.root.querySelectorAll(".setting-item").forEach((item) => {
      item.hidden = false;
    });
    this.expansionState = null;
  }
}

export { SettingsSearch };
