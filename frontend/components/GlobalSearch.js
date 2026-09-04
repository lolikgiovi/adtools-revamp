import { collapseSearchName, getSearchAbbreviations, scoreFuzzyTerm } from "../core/FuzzySearch.js";

/**
 * GlobalSearch - Universal search overlay similar to Notion/Spotlight
 * - Cmd+K opens the search
 * - Real-time filtering of feature names, pages, and Quick Query tables
 * - Keyboard navigation (Up/Down, Enter)
 * - Click outside or Escape closes
 * - Accessible dialog semantics and focus management
 */
class GlobalSearch {
  constructor({ eventBus, router, app, getIcon, searchQuickQuery } = {}) {
    this.eventBus = eventBus;
    this.router = router;
    this.app = app;
    this.getIcon = typeof getIcon === "function" ? getIcon : null;
    this.searchQuickQuery = typeof searchQuickQuery === "function" ? searchQuickQuery : null;

    this.index = []; // { id, name, description, route, type, icon }
    this.filtered = [];
    this.activeIndex = -1;
    this.isOpen = false;
    this.previousActiveElement = null;
    this.overlayEl = null;
    this.modalEl = null;
    this.inputEl = null;
    this.resultsEl = null;
    this.helpEl = null;
    this._filterRequestId = 0;

    this._buildDOM();
    this._bindEvents();
  }

  /** Build overlay and modal DOM once */
  _buildDOM() {
    // Overlay
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "global-search-overlay";
    this.overlayEl.setAttribute("aria-hidden", "true");
    this.overlayEl.style.display = "none";

    // Modal
    this.modalEl = document.createElement("div");
    this.modalEl.className = "global-search-modal";
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.modalEl.setAttribute("aria-labelledby", "global-search-label");
    this.modalEl.style.display = "none";

    const container = document.createElement("div");
    container.className = "global-search-container";

    // Label (screen-reader only)
    const label = document.createElement("label");
    label.id = "global-search-label";
    label.className = "sr-only";
    label.textContent = "Search";
    container.appendChild(label);

    // Input
    this.inputEl = document.createElement("input");
    this.inputEl.type = "text";
    this.inputEl.id = "global-search-input";
    this.inputEl.className = "global-search-input";
    this.inputEl.placeholder = "Search tools, pages, or qq:schema.table...";
    this.inputEl.setAttribute("autocomplete", "off");
    this.inputEl.setAttribute("aria-controls", "global-search-results");
    container.appendChild(this.inputEl);

    // Results list
    this.resultsEl = document.createElement("ul");
    this.resultsEl.id = "global-search-results";
    this.resultsEl.className = "global-search-results";
    this.resultsEl.setAttribute("role", "listbox");
    container.appendChild(this.resultsEl);

    // Help footer
    this.helpEl = document.createElement("div");
    this.helpEl.className = "global-search-help";
    this.helpEl.textContent = "Try qq:c.appc to open Quick Query with config.app_config table • ↑↓ navigate • Enter open • Esc close";
    container.appendChild(this.helpEl);

    this.modalEl.appendChild(container);

    // Append to body
    document.body.appendChild(this.overlayEl);
    document.body.appendChild(this.modalEl);
  }

  /** Wire interactions */
  _bindEvents() {
    // Outside click closes
    this.overlayEl.addEventListener("click", () => this.close());

    // Prevent clicks inside modal from closing
    this.modalEl.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Input events
    this.inputEl.addEventListener("input", () => {
      const query = this.inputEl.value.trim();
      void this._filter(query);
    });

    // Keyboard navigation within modal
    this.modalEl.addEventListener("keydown", (e) => {
      if (!this.isOpen) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          this._moveSelection(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          this._moveSelection(-1);
          break;
        case "Enter":
          e.preventDefault();
          this._confirmSelection();
          break;
        case "Escape":
          e.preventDefault();
          this.close();
          break;
        default:
          break;
      }
    });

    // Global escape support via event bus
    if (this.eventBus) {
      this.eventBus.on("escape:pressed", () => {
        if (this.isOpen) this.close();
      });
    }
  }

  /** Add items to index safely */
  _addToIndex(item) {
    // Avoid duplicates by id+type
    if (this.index.find((i) => i.id === item.id && i.type === item.type)) return;
    this.index.push(item);
  }

  /** Set the search index from tools/pages */
  setIndex(items = []) {
    this.index = Array.isArray(items) ? items.slice() : [];
  }

  /** Open the overlay */
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.previousActiveElement = document.activeElement;

    // Show overlay/modal
    this.overlayEl.style.display = "block";
    this.modalEl.style.display = "block";
    this.overlayEl.setAttribute("aria-hidden", "false");
    this.overlayEl.classList.add("open");
    this.modalEl.classList.add("open");
    document.body.classList.add("global-search-open");

    // Reset input and populate
    this.inputEl.value = "";
    this.inputEl.focus({ preventScroll: true });

    // Initialize filtered list so keyboard nav works immediately
    this.filtered = this.index.slice(0, 8);
    this.activeIndex = this.filtered.length ? 0 : -1;
    this._renderResults(this.filtered);
  }

  /** Close the overlay */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this._filterRequestId += 1;

    this.overlayEl.classList.remove("open");
    this.modalEl.classList.remove("open");
    document.body.classList.remove("global-search-open");

    this.overlayEl.style.display = "none";
    this.modalEl.style.display = "none";
    this.overlayEl.setAttribute("aria-hidden", "true");

    this.activeIndex = -1;
    this.resultsEl.innerHTML = "";

    // Restore focus
    if (this.previousActiveElement && typeof this.previousActiveElement.focus === "function") {
      this.previousActiveElement.focus({ preventScroll: true });
    }
  }

  /** Filter index by query */
  _filter(query) {
    const requestId = (this._filterRequestId || 0) + 1;
    this._filterRequestId = requestId;
    const quickMatch = query.match(/^(?:qq|quick):\s*(.*)$/i);
    if (quickMatch) {
      return this._filterQuickQuery(quickMatch[1], requestId);
    }

    const scopeMatch = query.match(/^(tools?|pages?):(.*)$/i);
    const scope = scopeMatch ? (scopeMatch[1].toLowerCase().startsWith("tool") ? "tool" : "page") : null;
    const q = (scopeMatch ? scopeMatch[2] : query).trim().toLowerCase();
    const candidates = scope ? this.index.filter((item) => item.type === scope) : this.index;

    if (!q) {
      this.filtered = candidates.slice(0, 8);
    } else {
      // Quick Query-style scoring: abbreviations/subsequences supplement exact and name matches.
      const scored = candidates
        .map((item) => {
          const name = String(item.name || "").toLowerCase();
          const desc = (item.description || "").toLowerCase();
          const id = String(item.id || "").toLowerCase();
          let score = scoreFuzzyTerm(q, {
            name,
            abbrs: getSearchAbbreviations(name),
            collapsed: collapseSearchName(name),
          });
          if (id.includes(q)) score += 1;
          if (desc.includes(q)) score += 1;
          return { item, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item);

      this.filtered = scored.slice(0, 8);
    }
    this.activeIndex = this.filtered.length ? 0 : -1;
    this._renderResults(this.filtered);
  }

  /** Search the persisted Quick Query table catalog for a qq: or quick: query. */
  _filterQuickQuery(rawTerm, requestId) {
    const searchTerm = String(rawTerm || "").trim();

    // Keep the command useful in tests, during migrations, or in older embeds
    // that have not supplied a Quick Query search adapter yet.
    if (!this.searchQuickQuery) {
      this._setQuickQueryFallback(searchTerm, requestId);
      return;
    }

    this.filtered = [];
    this.activeIndex = -1;
    this._renderStatus(searchTerm ? "Searching saved Quick Query schemas…" : "Loading recent Quick Query schemas…", "loading");

    return Promise.resolve()
      .then(() => this.searchQuickQuery(searchTerm))
      .then((matches) => {
        if (requestId !== this._filterRequestId) return;

        const items = (Array.isArray(matches) ? matches : [])
          .map((match) => this._createQuickQueryResult(match))
          .filter(Boolean)
          .slice(0, 8);

        if (items.length > 0) {
          this.filtered = items;
          this.activeIndex = 0;
          this._renderResults(items);
          return;
        }

        this._setQuickQueryFallback(searchTerm, requestId);
      })
      .catch(() => {
        if (requestId !== this._filterRequestId) return;

        const fallback = this._buildQuickQueryFallback(searchTerm, "Quick Query search is unavailable; open a new tab anyway");
        if (fallback) {
          this.filtered = [fallback];
          this.activeIndex = 0;
          this._renderResults(this.filtered);
        } else {
          this.filtered = [];
          this.activeIndex = -1;
          this._renderStatus("Quick Query search is unavailable right now.", "error");
        }
      });
  }

  _createQuickQueryResult(match) {
    const fullName = String(match?.fullName || `${match?.schemaName || ""}.${match?.tableName || ""}`)
      .trim()
      .toUpperCase();
    if (!/^[A-Z][A-Z0-9_$#]*\.[A-Z][A-Z0-9_$#]*$/.test(fullName)) return null;

    return {
      id: `quick-table-${fullName}`,
      name: fullName,
      description: "Quick Query · Switch to an existing tab or create a new one",
      route: "quick-query",
      type: "action",
      icon: "database",
      data: { tableName: fullName },
    };
  }

  _setQuickQueryFallback(searchTerm, requestId) {
    if (requestId !== this._filterRequestId) return;

    const fallback = this._buildQuickQueryFallback(searchTerm);
    if (fallback) {
      this.filtered = [fallback];
      this.activeIndex = 0;
      this._renderResults(this.filtered);
      return;
    }

    this.filtered = [];
    this.activeIndex = -1;
    this._renderStatus(searchTerm ? `No saved Quick Query schemas match “${searchTerm}”.` : "No saved Quick Query schemas yet.", "empty");
  }

  _buildQuickQueryFallback(searchTerm, description = "No saved schema found · Open a new Quick Query tab") {
    const tableName = String(searchTerm || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z][A-Z0-9_$#]*\.[A-Z][A-Z0-9_$#]*$/.test(tableName)) return null;

    return {
      id: `quick-open-${tableName}`,
      name: tableName,
      description,
      route: "quick-query",
      type: "action",
      icon: "database",
      data: { tableName },
    };
  }

  _renderStatus(message, state = "empty") {
    this.resultsEl.innerHTML = `<li class="global-search-status global-search-status-${state}" role="status" aria-live="polite">${this._escapeHtml(message)}</li>`;
    this.inputEl.removeAttribute("aria-activedescendant");
  }

  /** Render results list */
  _renderResults(list) {
    const html = list
      .map((item, idx) => {
        const isActive = idx === this.activeIndex;
        const iconSvg = this._getIconSvg(item);
        const idAttr = `global-search-option-${item.type}-${item.id}`;
        return `
          <li id="${idAttr}" class="global-search-result-item${isActive ? " active" : ""}" role="option" aria-selected="${isActive}">
            <div class="global-search-result-icon">${iconSvg || ""}</div>
            <div class="global-search-result-text">
              <div class="result-title">${this._escapeHtml(item.name)}</div>
              ${item.description ? `<div class="result-sub">${this._escapeHtml(item.description)}</div>` : ""}
            </div>
          </li>
        `;
      })
      .join("");

    this.resultsEl.innerHTML = html;

    // Click handlers
    this.resultsEl.querySelectorAll(".global-search-result-item").forEach((li, idx) => {
      li.addEventListener("click", () => {
        this.activeIndex = idx;
        this._confirmSelection();
      });
    });

    // Update activedescendant
    if (this.activeIndex >= 0 && list[this.activeIndex]) {
      const activeId = `global-search-option-${list[this.activeIndex].type}-${list[this.activeIndex].id}`;
      this.inputEl.setAttribute("aria-activedescendant", activeId);
    } else {
      this.inputEl.removeAttribute("aria-activedescendant");
    }
  }

  /** Move selection by delta */
  _moveSelection(delta) {
    if (!this.filtered.length) return;
    this.activeIndex = Math.max(0, Math.min(this.filtered.length - 1, this.activeIndex + delta));
    // Re-render to reflect active state
    this._renderResults(this.filtered);

    // Ensure active item is scrolled into view
    const activeEl = this.resultsEl.querySelector(".global-search-result-item.active");
    activeEl?.scrollIntoView({ block: "nearest" });
  }

  /** Confirm selection and navigate */
  _confirmSelection() {
    const item = this.filtered[this.activeIndex >= 0 ? this.activeIndex : 0];
    if (!item) return;

    // Close first to avoid flicker
    this.close();

    this.router.navigate(item.route, item.data);
  }

  /** Icon helper */
  _getIconSvg(item) {
    // Prefer app.sidebar.getToolIcon for tool icons if provided
    if (this.getIcon && item.icon) {
      try {
        return this.getIcon(item.icon);
      } catch (_) {
        // fallback below
      }
    }
    // Default icons
    switch (item.type) {
      case "page":
        if (item.id === "home") {
          return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M9 21V9h6v12"/></svg>`;
        }
        if (item.id === "settings") {
          return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
        }
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
      case "tool":
      default:
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M7 12h10"/></svg>`;
    }
  }

  _escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
}

export { GlobalSearch };
