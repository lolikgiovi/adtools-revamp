/**
 * GlobalSearch - Universal search overlay similar to Notion/Spotlight
 * - Cmd+P opens the search
 * - Real-time filtering of feature names and pages
 * - Keyboard navigation (Up/Down, Enter)
 * - Click outside or Escape closes
 * - Accessible dialog semantics and focus management
 */
class GlobalSearch {
  constructor({ eventBus, router, app, getIcon } = {}) {
    this.eventBus = eventBus;
    this.router = router;
    this.app = app;
    this.getIcon = typeof getIcon === "function" ? getIcon : null;

    this.index = []; // { id, name, description, route, type, icon }
    this.filtered = [];
    this.activeIndex = -1;
    this.isOpen = false;
    this.previousActiveElement = null;
    this._debounceTimer = null;

    this.overlayEl = null;
    this.modalEl = null;
    this.inputEl = null;
    this.resultsEl = null;
    this.helpEl = null;

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
    this.inputEl.placeholder = "Search tools and pages";
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
    this.helpEl.textContent = "Arrow keys to navigate • Enter to open • Esc to close";
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
      this._scheduleFilter(query);
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

      // Update index if new tools are registered
      this.eventBus.on("tool:registered", (data) => {
        const tool = data.tool;
        const md = tool.getMetadata();
        this._addToIndex({
          id: md.id,
          name: md.name,
          description: md.description || "",
          route: md.id,
          type: "tool",
          icon: md.icon || null,
        });
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
    this._renderResults(this.index.slice(0, 8));
  }

  /** Close the overlay */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

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

  /** Schedule filter with small debounce for smoothness */
  _scheduleFilter(query) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._filter(query), 80);
  }

  /** Filter index by query */
  _filter(query) {
    if (!query) {
      this.filtered = this.index.slice(0, 8);
    } else {
      const q = query.toLowerCase();
      // Simple scoring: name startsWith > includes in name > includes in description/id
      const scored = this.index
        .map((item) => {
          const name = item.name.toLowerCase();
          const desc = (item.description || "").toLowerCase();
          const id = item.id.toLowerCase();
          let score = 0;
          if (name.startsWith(q)) score += 3;
          if (name.includes(q)) score += 2;
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
    const list = this.filtered.length ? this.filtered : this.index;
    const item = list[this.activeIndex] || list[0];
    if (!item) return;

    // Close first to avoid flicker
    this.close();

    // Navigate
    if (item.type === "tool") {
      this.router.navigate(item.route);
    } else if (item.type === "page") {
      this.router.navigate(item.route);
    }
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
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

export { GlobalSearch };