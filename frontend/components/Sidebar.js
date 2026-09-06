/**
 * Sidebar - Modular sidebar component
 * Manages navigation and tool selection
 */
import { UsageTracker } from "../core/UsageTracker.js";

class Sidebar {
  static PINNED_TOOLS_STORAGE_KEY = "sidebar.pinnedTools.v1";
  static PIN_EDUCATION_STORAGE_KEY = "sidebar.pinEducationShown.v1";
  static MAX_PIN_EDUCATION_SHOWN = 1;

  constructor(config = {}) {
    this.eventBus = config.eventBus;
    this.router = config.router;
    this.tools = config.tools || [];
    this.getIcon = typeof config.getIcon === "function" ? config.getIcon : null;
    this.menuConfig = config.menuConfig || { app: [], config: [], footer: [] };
    this.getMenuConfig = typeof config.getMenuConfig === "function" ? config.getMenuConfig : null;
    this.toolsConfigMap = config.toolsConfigMap || new Map();
    this.categoriesMap = config.categoriesMap || new Map();

    // State management - matching script.js
    this.state = {
      isOpen: false,
      isCollapsed: false,
      isMobile: false,
    };

    this.currentTool = null;
    this.mobileBreakpoint = 768;
    this.storage = config.storage || null;
    this.pinnedTools = this.normalizePinnedTools(config.pinnedTools ?? this.loadPinnedTools());
    this.pinEducationShown = this.loadPinEducationShown();
    this.contextMenuEl = null;
    this.contextMenuToolId = null;
    this.pinEducationEl = null;
    this.pinEducationAnchor = null;
    this.pinEducationTimer = null;
    this.pinEducationSuppressed = false;
    // Runtime detection may initialize slightly after first render in Tauri
    this._runtimeRetry = false;
    this._menuRuntimeRetry = false;

    this.init();
  }

  /**
   * Initialize the sidebar
   */
  init() {
    this.bindEvents();
    this.setupToggle();
    this.initializeAccessibility();
    this.setupMenuButtons();
    this.renderTools();
    this.renderMenuGroups();

    // Set initial state - start with sidebar expanded on desktop
    if (!this.state.isMobile) {
      this.state.isCollapsed = false;
    }
    this.updateSidebarState();
  }

  /**
   * Initialize accessibility features
   */
  initializeAccessibility() {
    const sidebar = document.querySelector(".sidebar");
    const toggleBtn = document.querySelector(".sidebar-trigger");

    if (!sidebar || !toggleBtn) return;

    // Set initial ARIA attributes
    sidebar.setAttribute("role", "navigation");
    sidebar.setAttribute("aria-label", "Main navigation");

    toggleBtn.setAttribute("type", "button");
    toggleBtn.setAttribute("aria-controls", "sidebar");

    // Set initial state
    this.updateAriaStates();
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    if (this.eventBus) {
      this.eventBus.on("route:changed", (data) => {
        this.updateActiveItem(data.path);
      });
    }

    this._handleDocumentPointerDown = (event) => {
      if (this.contextMenuEl && !this.contextMenuEl.contains(event.target)) {
        this.closeContextMenu();
      }
    };
    document.addEventListener("pointerdown", this._handleDocumentPointerDown);

    this._handleEducationReposition = () => this.positionPinEducation();
    window.addEventListener("resize", this._handleEducationReposition);
    window.addEventListener("scroll", this._handleEducationReposition, true);
  }

  /**
   * Setup sidebar toggle functionality
   */
  setupToggle() {
    const toggleBtn = document.querySelector(".sidebar-trigger");
    const sidebar = document.querySelector(".sidebar");
    const overlay = document.querySelector(".sidebar-overlay");

    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        this.toggle();
      });
    }

    if (overlay) {
      overlay.addEventListener("click", () => {
        if (this.state.isMobile) {
          this.close();
        }
      });
    }

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
      this.handleKeydown(e);
    });

    // Window resize
    this.handleResize();
    window.addEventListener("resize", () => {
      this.handleResize();
    });
  }

  /**
   * Handle keyboard events
   */
  handleKeydown(e) {
    if (this.contextMenuEl) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeContextMenu();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.moveContextMenuFocus(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
    }

    // ESC key closes sidebar on mobile
    if (e.key === "Escape" && this.state.isMobile && this.state.isOpen) {
      this.close();
    }

    // Toggle with Ctrl/Cmd + B
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      this.toggle();
    }
  }

  /**
   * Handle window resize for mobile detection
   */
  handleResize() {
    const isMobile = window.innerWidth <= this.mobileBreakpoint;
    const wasMobile = this.state.isMobile;

    this.state.isMobile = isMobile;

    // If switching between mobile and desktop
    if (wasMobile !== isMobile) {
      // Reset collapsed state based on device type
      this.state.isCollapsed = isMobile ? true : false;
      this.updateSidebarState();
    }

    // Initial run - set state based on device type
    if (wasMobile === undefined) {
      this.state.isCollapsed = isMobile ? true : false;
      this.updateSidebarState();
    }
  }

  /**
   * Update sidebar state and DOM attributes
   */
  updateSidebarState() {
    const sidebar = document.querySelector(".sidebar");
    const overlay = document.querySelector(".sidebar-overlay");
    const main = document.querySelector(".main");

    if (!sidebar) return;

    if ((this.state.isMobile && !this.state.isOpen) || (!this.state.isMobile && this.state.isCollapsed)) {
      this.closeContextMenu();
      this.hidePinEducation();
    }

    // Update sidebar data attributes
    if (this.state.isMobile) {
      // Mobile behavior
      sidebar.setAttribute("data-state", this.state.isOpen ? "open" : "closed");
      sidebar.setAttribute("data-mobile", "true");
    } else {
      // Desktop behavior
      sidebar.setAttribute("data-state", this.state.isCollapsed ? "collapsed" : "expanded");
      sidebar.setAttribute("data-mobile", "false");
    }

    // Update main content position based on sidebar state
    if (main) {
      if (this.state.isMobile) {
        main.style.marginLeft = "0";
      } else {
        const sidebarWidth = getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width").trim() || "12rem";
        main.style.marginLeft = this.state.isCollapsed ? "0" : sidebarWidth;
      }
    }

    // Update overlay
    if (overlay) {
      overlay.setAttribute("data-state", this.state.isMobile && this.state.isOpen ? "open" : "closed");
    }

    // Update trigger icon rotation
    this.updateTriggerIcon();

    // Update ARIA attributes
    this.updateAriaStates();
  }

  /**
   * Update trigger icon rotation based on sidebar state
   */
  updateTriggerIcon() {
    const toggleBtn = document.querySelector(".sidebar-trigger");
    if (!toggleBtn) return;

    const icon = toggleBtn.querySelector(".sidebar-trigger-icon");
    if (!icon) return;

    // Rotate icon based on state
    if (this.state.isMobile) {
      icon.style.transform = this.state.isOpen ? "rotate(180deg)" : "rotate(0deg)";
    } else {
      icon.style.transform = this.state.isCollapsed ? "rotate(0deg)" : "rotate(180deg)";
    }
  }

  /**
   * Update ARIA states for accessibility
   */
  updateAriaStates() {
    const sidebar = document.querySelector(".sidebar");
    const toggleBtn = document.querySelector(".sidebar-trigger");

    if (!sidebar || !toggleBtn) return;

    sidebar.setAttribute("aria-hidden", this.state.isMobile && !this.state.isOpen ? "true" : "false");

    toggleBtn.setAttribute("aria-expanded", this.state.isMobile ? this.state.isOpen.toString() : (!this.state.isCollapsed).toString());

    toggleBtn.setAttribute(
      "aria-label",
      this.state.isMobile
        ? this.state.isOpen
          ? "Close sidebar"
          : "Open sidebar"
        : this.state.isCollapsed
          ? "Expand sidebar"
          : "Collapse sidebar",
    );
  }

  /**
   * Emit state change event
   */
  emitStateChange() {
    if (this.eventBus) {
      this.eventBus.emit("sidebar:stateChange", {
        isOpen: this.state.isOpen,
        isCollapsed: this.state.isCollapsed,
        isMobile: this.state.isMobile,
      });
    }

    // Also emit to document for compatibility
    document.dispatchEvent(
      new CustomEvent("sidebarStateChange", {
        detail: {
          isOpen: this.state.isOpen,
          isCollapsed: this.state.isCollapsed,
          isMobile: this.state.isMobile,
        },
      }),
    );
  }

  /**
   * Toggle sidebar state
   */
  toggle() {
    if (this.state.isMobile) {
      if (this.state.isOpen) {
        this.close();
      } else {
        this.open();
      }
    } else {
      if (this.state.isCollapsed) {
        this.expand();
      } else {
        this.collapse();
      }
    }
  }

  /**
   * Open sidebar (mobile)
   */
  open() {
    this.state.isOpen = true;
    this.updateSidebarState();

    if (this.eventBus) {
      this.eventBus.emit("sidebar:opened");
    }
  }

  /**
   * Close sidebar (mobile)
   */
  close() {
    this.state.isOpen = false;
    this.updateSidebarState();

    if (this.eventBus) {
      this.eventBus.emit("sidebar:closed");
    }
  }

  /**
   * Expand sidebar (desktop)
   */
  expand() {
    this.state.isCollapsed = false;
    this.updateSidebarState();

    if (this.eventBus) {
      this.eventBus.emit("sidebar:expanded");
    }
  }

  /**
   * Collapse sidebar (desktop)
   */
  collapse() {
    this.state.isCollapsed = true;
    this.updateSidebarState();

    if (this.eventBus) {
      this.eventBus.emit("sidebar:collapsed");
    }
  }

  /**
   * Render tools in the sidebar
   */
  async renderTools() {
    const sidebarContent = document.querySelector(".sidebar-content");
    if (!sidebarContent) return;

    const { categorizeTool } = await import("../core/Categories.js");
    const { isTauri } = await import("../core/Runtime.js");
    const runtimeIsTauri = isTauri();

    const sourceTools = (this.tools || [])
      .filter((tool) => {
        const cfg = this.toolsConfigMap.get(tool.id);
        const enabled = cfg ? cfg.enabled !== false : true;
        const showInSidebar = cfg ? cfg.showInSidebar !== false : true;
        const requiresTauriOk = cfg && cfg.requiresTauri ? runtimeIsTauri : true;
        return enabled && showInSidebar && requiresTauriOk;
      })
      .sort((a, b) => {
        const ca = this.toolsConfigMap.get(a.id)?.order ?? 0;
        const cb = this.toolsConfigMap.get(b.id)?.order ?? 0;
        return ca - cb;
      });

    // If runtime detection might not be ready yet, re-render once shortly
    if (!runtimeIsTauri && !this._runtimeRetry) {
      this._runtimeRetry = true;
      setTimeout(() => this.renderTools(), 150);
    }

    const pinnedToolIds = this.getPinnedToolIds();
    const toolById = new Map(sourceTools.map((tool) => [tool.id, tool]));
    const pinnedTools = Array.from(pinnedToolIds)
      .map((toolId) => toolById.get(toolId))
      .filter(Boolean);
    const unpinnedTools = sourceTools.filter((tool) => !pinnedToolIds.has(tool.id));
    const toolsByCategory = unpinnedTools.reduce((acc, tool) => {
      const cat = categorizeTool(tool);
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(tool);
      return acc;
    }, {});

    const ensureSvgClass = (svgString, className = "sidebar-menu-icon") => {
      if (!svgString) return svgString;
      if (svgString.includes("<svg") && !svgString.includes('class="' + className + '"')) {
        return svgString.replace("<svg", `<svg class=\"${className}\"`);
      }
      return svgString;
    };

    const renderToolItems = (menuEl, list) => {
      menuEl.innerHTML = list
        .map((tool) => {
          const rawSvg = this.getIcon ? this.getIcon(tool.icon) : this.getToolIcon(tool.icon);
          const svg = ensureSvgClass(rawSvg);
          const toolId = this.escapeHtml(tool.id);
          const toolName = this.escapeHtml(tool.name);
          const isPinned = pinnedToolIds.has(tool.id);
          return `
            <div class="sidebar-menu-item" data-tool="${toolId}" data-pinned="${isPinned ? "true" : "false"}">
              <button class="sidebar-menu-button" type="button">
                ${isPinned ? `<span class="sidebar-pin-indicator" title="Pinned" aria-label="Pinned">${this.getPinIconSvg()}</span>` : ""}
                ${svg}
                <span class="sidebar-menu-label">${toolName}</span>
              </button>
            </div>
          `;
        })
        .join("");

      menuEl.querySelectorAll(".sidebar-menu-item .sidebar-menu-button").forEach((button) => {
        this.bindMenuButton(button);
      });
    };

    // Build category groups dynamically based on categoriesMap order
    // Filter out categories that require Tauri if not running in Tauri
    const categoriesList = Array.from(this.categoriesMap.values())
      .filter((cat) => !(cat.requiresTauri && !runtimeIsTauri))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Clear existing category groups inside sidebar-content
    sidebarContent.innerHTML = "";

    if (pinnedTools.length > 0) {
      const pinnedGroupEl = document.createElement("div");
      pinnedGroupEl.className = "sidebar-group sidebar-pinned-group";
      pinnedGroupEl.setAttribute("data-category", "pinned");
      pinnedGroupEl.innerHTML = `
        <div class="sidebar-group-label">Pinned</div>
        <div class="sidebar-group-content">
          <div class="sidebar-menu" data-category="pinned"></div>
        </div>
      `;
      sidebarContent.appendChild(pinnedGroupEl);
      renderToolItems(pinnedGroupEl.querySelector('.sidebar-menu[data-category="pinned"]'), pinnedTools);
    }

    categoriesList.forEach((cat) => {
      const groupEl = document.createElement("div");
      groupEl.className = "sidebar-group";
      groupEl.setAttribute("data-category", String(cat.id));
      groupEl.innerHTML = `
        <div class="sidebar-group-label">${cat.name || cat.id}</div>
        <div class="sidebar-group-content">
          <div class="sidebar-menu" data-category="${cat.id}"></div>
        </div>
      `;
      sidebarContent.appendChild(groupEl);

      const menuEl = groupEl.querySelector(".sidebar-menu");
      const list = toolsByCategory[cat.id] || [];
      renderToolItems(menuEl, list);
    });

    // After tools render, ensure the current route is highlighted (handles reload/deep links)
    try {
      const current =
        this.router && typeof this.router.getCurrentRoute === "function"
          ? this.router.getCurrentRoute()
          : window.location.hash
            ? window.location.hash.slice(1).split("/")[0]
            : "";
      if (current) this.updateActiveItem(current);
    } catch (_) {}
  }

  async renderMenuGroups() {
    const { categorizeTool } = await import("../core/Categories.js");
    const { isTauri } = await import("../core/Runtime.js");
    const runtimeIsTauri = isTauri();

    // If runtime detection might not be ready yet, re-render once shortly
    if (!runtimeIsTauri && !this._menuRuntimeRetry) {
      this._menuRuntimeRetry = true;
      setTimeout(() => this.renderMenuGroups(), 150);
    }

    const renderGroup = (groupName, items) => {
      const container = document.querySelector(`.sidebar-menu[data-group="${groupName}"]`);
      if (!container) return;

      const ensureSvgClass = (svgString, className = "sidebar-menu-icon") => {
        if (!svgString) return svgString;
        if (svgString.includes("<svg") && !svgString.includes('class="' + className + '"')) {
          return svgString.replace("<svg", `<svg class=\"${className}\"`);
        }
        return svgString;
      };

      let merged = [...(items || [])].filter((item) => !(item?.requiresTauri && !runtimeIsTauri));
      if (groupName === "config") {
        const configTools = (this.tools || [])
          .filter((t) => {
            const cfg = this.toolsConfigMap.get(t.id);
            const enabled = cfg ? cfg.enabled !== false : true;
            const showInSidebar = cfg ? cfg.showInSidebar !== false : true;
            const requiresTauriOk = cfg && cfg.requiresTauri ? runtimeIsTauri : true;
            return categorizeTool(t) === "config" && enabled && showInSidebar && requiresTauriOk;
          })
          .sort((a, b) => {
            const ca = this.toolsConfigMap.get(a.id)?.order ?? 0;
            const cb = this.toolsConfigMap.get(b.id)?.order ?? 0;
            return ca - cb;
          })
          .map((t) => ({ id: t.id, name: t.name, icon: t.icon, type: "tool" }));
        merged = [...merged, ...configTools];
      }

      container.innerHTML = merged
        .map((item) => {
          const rawSvg = this.getIcon ? this.getIcon(item.icon) : this.getToolIcon(item.icon);
          const svg = ensureSvgClass(rawSvg);
          const itemId = this.escapeHtml(item.id);
          const dataAttr =
            item.type === "tool" ? `data-tool="${itemId}"` : item.type === "action" ? `data-action="${itemId}"` : `data-page="${itemId}"`;
          const itemName = this.escapeHtml(item.name);
          const isPinned = item.type === "tool" && this.getPinnedToolIds().has(item.id);
          return `
            <div class=\"sidebar-menu-item\" ${dataAttr} data-pinned=\"${isPinned ? "true" : "false"}\">
              <button class=\"sidebar-menu-button\" type=\"button\">
                ${isPinned ? `<span class=\"sidebar-pin-indicator\" title=\"Pinned\" aria-label=\"Pinned\">${this.getPinIconSvg()}</span>` : ""}
                ${svg}
                <span class=\"sidebar-menu-label\">${itemName}</span>
              </button>
            </div>
          `;
        })
        .join("");

      container.querySelectorAll(".sidebar-menu-item .sidebar-menu-button").forEach((button) => {
        this.bindMenuButton(button);
      });
    };

    // Category groups are rendered dynamically in renderTools(); only render non-category groups here
    const menuConfig = this.getMenuConfig ? this.getMenuConfig() : this.menuConfig;
    renderGroup("app", menuConfig?.app);
    renderGroup("footer", menuConfig?.footer);

    // Category labels are set during dynamic group creation

    // After groups render, ensure the current route/page is highlighted (handles reload)
    try {
      const current =
        this.router && typeof this.router.getCurrentRoute === "function"
          ? this.router.getCurrentRoute()
          : window.location.hash
            ? window.location.hash.slice(1).split("/")[0]
            : "";
      if (current) this.updateActiveItem(current);
    } catch (_) {}
  }

  updateCategoryLabels() {
    try {
      // Config group label
      const configMenu = document.querySelector('.sidebar-menu[data-group="config"]');
      const configGroup = configMenu ? configMenu.closest(".sidebar-group") : null;
      const configLabel = configGroup ? configGroup.querySelector(".sidebar-group-label") : null;
      if (configLabel) {
        const cfg = this.categoriesMap.get("config");
        configLabel.textContent = cfg && cfg.name ? cfg.name : "Config";
      }

      // General group label (application section)
      const generalGroup = document.querySelector('.sidebar-group[data-category="application"]');
      const generalLabel = generalGroup ? generalGroup.querySelector(".sidebar-group-label") : null;
      if (generalLabel) {
        const gen = this.categoriesMap.get("general");
        generalLabel.textContent = gen && gen.name ? gen.name : "General";
      }
    } catch (_) {}
  }

  /**
   * Get icon SVG for a tool
   * @param {string} iconName - Icon name
   * @returns {string} SVG string
   */
  getToolIcon(iconName) {
    // Minimal fallback: default generic icon
    const defaultSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10" />
      <path d="M7 12h10" />
    </svg>`;
    return defaultSvg;
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  getPinIconSvg() {
    return `<svg class="sidebar-pin-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16 9V4h1V2H7v2h1v5c0 1.66-1.34 3-3 3v2h5v8h2v-8h5v-2c-1.66 0-3-1.34-3-3Z" />
    </svg>`;
  }

  getStorage() {
    if (this.storage) return this.storage;
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (_) {
      return null;
    }
  }

  normalizePinnedTools(value) {
    const list = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : [];
    return new Set(list.map((toolId) => String(toolId || "").trim()).filter(Boolean));
  }

  loadPinnedTools() {
    const storage = this.getStorage();
    if (!storage) return new Set();

    try {
      const value = JSON.parse(storage.getItem(Sidebar.PINNED_TOOLS_STORAGE_KEY) || "[]");
      return this.normalizePinnedTools(value);
    } catch (_) {
      return new Set();
    }
  }

  getPinnedToolIds() {
    if (!(this.pinnedTools instanceof Set)) {
      this.pinnedTools = this.loadPinnedTools();
    }
    return this.pinnedTools;
  }

  savePinnedTools() {
    const storage = this.getStorage();
    if (!storage) return;

    try {
      storage.setItem(Sidebar.PINNED_TOOLS_STORAGE_KEY, JSON.stringify(Array.from(this.getPinnedToolIds())));
    } catch (_) {}
  }

  loadPinEducationShown() {
    const storage = this.getStorage();
    if (!storage) return 0;

    try {
      const count = Number.parseInt(storage.getItem(Sidebar.PIN_EDUCATION_STORAGE_KEY) || "0", 10);
      return Number.isFinite(count) && count > 0 ? Math.min(count, Sidebar.MAX_PIN_EDUCATION_SHOWN) : 0;
    } catch (_) {
      return 0;
    }
  }

  getPinEducationShown() {
    if (!Number.isFinite(this.pinEducationShown)) {
      this.pinEducationShown = this.loadPinEducationShown();
    }
    return this.pinEducationShown;
  }

  savePinEducationShown() {
    const storage = this.getStorage();
    if (!storage) return;

    try {
      storage.setItem(Sidebar.PIN_EDUCATION_STORAGE_KEY, String(this.getPinEducationShown()));
    } catch (_) {}
  }

  maybeShowPinEducation() {
    if (this.state?.isMobile || this.pinEducationSuppressed) return;

    const anchor = document.querySelector(".sidebar-content .sidebar-menu-item[data-tool]");
    if (!anchor) return;

    if (this.pinEducationEl) {
      if (!this.pinEducationAnchor || !document.body.contains(this.pinEducationAnchor)) {
        this.pinEducationAnchor = anchor;
        this.positionPinEducation();
      }
      return;
    }

    if (this.getPinEducationShown() >= Sidebar.MAX_PIN_EDUCATION_SHOWN) return;
    this.showPinEducation(anchor);
  }

  showPinEducation(anchor) {
    if (!anchor || this.state?.isMobile || this.getPinEducationShown() >= Sidebar.MAX_PIN_EDUCATION_SHOWN) return;

    const education = document.createElement("div");
    education.className = "sidebar-pin-education";
    education.setAttribute("role", "status");
    education.setAttribute("aria-live", "polite");
    education.setAttribute("data-placement", "right");
    education.innerHTML = `
      <span class="sidebar-pin-education-copy">Tip: Right-click a tool to pin or unpin it.</span>
      <button class="sidebar-pin-education-dismiss" type="button" aria-label="Dismiss pinning tip">×</button>
    `;

    document.body.appendChild(education);
    this.pinEducationEl = education;
    this.pinEducationAnchor = anchor;
    this.pinEducationShown = this.getPinEducationShown() + 1;
    this.savePinEducationShown();
    this.positionPinEducation();

    education.querySelector(".sidebar-pin-education-dismiss")?.addEventListener("click", () => {
      this.pinEducationSuppressed = true;
      this.hidePinEducation();
    });

    if (this.pinEducationTimer) clearTimeout(this.pinEducationTimer);
    this.pinEducationTimer = setTimeout(() => this.hidePinEducation(), 6500);
  }

  positionPinEducation() {
    if (!this.pinEducationEl || !this.pinEducationAnchor) return;

    const anchorRect = this.pinEducationAnchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
    const tooltipWidth = Math.min(264, Math.max(220, viewportWidth - 16));
    const tooltipHeight = this.pinEducationEl.offsetHeight || 54;
    const gap = 8;
    const canPlaceRight = anchorRect.right + gap + tooltipWidth <= viewportWidth - 8;
    const left = canPlaceRight ? anchorRect.right + gap : Math.max(8, anchorRect.left);
    const top = canPlaceRight
      ? Math.min(Math.max(8, anchorRect.top + (anchorRect.height - tooltipHeight) / 2), viewportHeight - tooltipHeight - 8)
      : Math.min(Math.max(8, anchorRect.bottom + gap), viewportHeight - tooltipHeight - 8);

    this.pinEducationEl.dataset.placement = canPlaceRight ? "right" : "bottom";
    this.pinEducationEl.style.left = `${Math.max(8, left)}px`;
    this.pinEducationEl.style.top = `${Math.max(8, top)}px`;
  }

  hidePinEducation() {
    if (this.pinEducationTimer) {
      clearTimeout(this.pinEducationTimer);
      this.pinEducationTimer = null;
    }
    this.pinEducationEl?.remove();
    this.pinEducationEl = null;
    this.pinEducationAnchor = null;
  }

  bindMenuButton(button) {
    if (!button) return;
    button.addEventListener("click", (e) => this.handleMenuClick(e));
    button.addEventListener("contextmenu", (e) => this.handleMenuContextMenu(e));
    button.addEventListener("keydown", (e) => {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;

      e.preventDefault();
      const rect = button.getBoundingClientRect();
      this.handleMenuContextMenu({
        currentTarget: button,
        preventDefault: () => {},
        clientX: rect.left,
        clientY: rect.bottom,
      });
    });
  }

  handleMenuContextMenu(e) {
    const button = e.currentTarget;
    const menuItem = button?.closest(".sidebar-menu-item");
    const toolId = menuItem?.getAttribute("data-tool");
    if (!toolId) return;

    e.preventDefault();
    this.pinEducationSuppressed = true;
    this.hidePinEducation();
    this.showContextMenu(toolId, e.clientX, e.clientY);
  }

  getToolName(toolId) {
    const tool = (this.tools || []).find((item) => item?.id === toolId);
    if (tool?.name) return String(tool.name);

    const label = Array.from(document.querySelectorAll(".sidebar-menu-item[data-tool]"))
      .find((item) => item.getAttribute("data-tool") === toolId)
      ?.querySelector(".sidebar-menu-label");
    return label?.textContent?.trim() || toolId;
  }

  showContextMenu(toolId, clientX = 0, clientY = 0) {
    this.closeContextMenu();

    const isPinned = this.getPinnedToolIds().has(toolId);
    const action = isPinned ? "unpin" : "pin";
    const actionLabel = isPinned ? "Unpin" : "Pin";
    const menu = document.createElement("div");
    menu.className = "sidebar-pin-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `${actionLabel} ${this.getToolName(toolId)}`);
    menu.innerHTML = `
      <button type="button" role="menuitem" data-pin-action="${action}">
        ${this.getPinIconSvg()}
        <span>${actionLabel} <strong>${this.escapeHtml(this.getToolName(toolId))}</strong></span>
      </button>
    `;

    document.body.appendChild(menu);
    this.contextMenuEl = menu;
    this.contextMenuToolId = toolId;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
    const menuWidth = menu.offsetWidth || 220;
    const menuHeight = menu.offsetHeight || 44;
    const left = Math.min(Math.max(8, Number(clientX) || 0), Math.max(8, viewportWidth - menuWidth - 8));
    const top = Math.min(Math.max(8, Number(clientY) || 0), Math.max(8, viewportHeight - menuHeight - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const actionButton = menu.querySelector("[role='menuitem']");
    actionButton?.addEventListener("click", () => this.togglePin(toolId));
    actionButton?.focus({ preventScroll: true });
  }

  moveContextMenuFocus(direction) {
    const items = Array.from(this.contextMenuEl?.querySelectorAll("[role='menuitem']") || []);
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : items.length - 1) : (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus({ preventScroll: true });
  }

  closeContextMenu() {
    this.contextMenuEl?.remove();
    this.contextMenuEl = null;
    this.contextMenuToolId = null;
  }

  togglePin(toolId) {
    const normalizedToolId = String(toolId || "").trim();
    if (!normalizedToolId) return false;

    const pinnedTools = this.getPinnedToolIds();
    const isPinned = !pinnedTools.has(normalizedToolId);
    if (isPinned) pinnedTools.add(normalizedToolId);
    else pinnedTools.delete(normalizedToolId);
    this.pinEducationSuppressed = true;
    this.savePinnedTools();
    this.closeContextMenu();
    this.hidePinEducation();

    try {
      UsageTracker.trackEvent(normalizedToolId, isPinned ? "sidebar_pin" : "sidebar_unpin", {
        tool_id: normalizedToolId,
        source: "sidebar_context_menu",
      });
    } catch (_) {}

    this.eventBus?.emit?.("sidebar:pinChanged", {
      toolId: normalizedToolId,
      isPinned,
      source: "context_menu",
    });

    this.renderTools();
    return isPinned;
  }

  /**
   * Select a tool
   * @param {string} toolId - Tool ID
   */
  selectTool(toolId) {
    this.currentTool = toolId;
    this.updateActiveItem(toolId);

    if (this.router) {
      this.router.navigate(toolId);
    }

    // Close sidebar on mobile after selection
    if (this.state.isMobile && this.state.isOpen) {
      setTimeout(() => {
        this.close();
      }, 150);
    }
  }

  /**
   * Update active item in sidebar
   * @param {string} id - Route or tool ID
   */
  updateActiveItem(id) {
    // Remove active state from all menu buttons
    document.querySelectorAll(".sidebar-menu-button").forEach((button) => {
      button.removeAttribute("data-active");
    });

    // Prefer tool match, otherwise page match
    const activeButton =
      document.querySelector(`[data-tool="${id}"] .sidebar-menu-button`) ||
      document.querySelector(`[data-page="${id}"] .sidebar-menu-button`);

    if (activeButton) {
      activeButton.setAttribute("data-active", "true");
    }
  }

  /**
   * Setup menu click handlers for existing menu items
   */
  setupMenuButtons() {
    const menuButtons = document.querySelectorAll(".sidebar-menu-button");
    menuButtons.forEach((button) => {
      this.bindMenuButton(button);
    });
  }

  handleMenuClick(e) {
    const button = e.currentTarget;
    const menuItem = button.closest(".sidebar-menu-item");

    // Prefer explicit page or action navigation
    const pageId = menuItem ? menuItem.getAttribute("data-page") : null;
    const actionId = menuItem ? menuItem.getAttribute("data-action") : null;

    // Get the tool ID from data attribute
    const toolId = menuItem ? menuItem.getAttribute("data-tool") : null;

    // Remove active state from all buttons
    document.querySelectorAll(".sidebar-menu-button").forEach((btn) => {
      btn.setAttribute("data-active", "false");
    });

    // Set active state on clicked button
    button.setAttribute("data-active", "true");

    // Navigate to the tool, page, or action
    if (toolId) {
      this.selectTool(toolId);
    } else if (pageId) {
      this.navigateToPage(pageId);
    } else if (actionId) {
      switch (actionId) {
        case "signout":
          this.handleSignOut();
          break;
        case "feedback":
          // For now, just show a notification
          if (this.eventBus) {
            this.eventBus.emit("notification:show", {
              message: "Thanks for your feedback!",
              type: "info",
            });
          }
          break;
        default:
          // Fallback to special navigation handler
          this.handleSpecialNavigation(actionId);
      }
    } else {
      // Handle navigation for items without explicit attributes (fallback)
      const spanText = button.querySelector("span")?.textContent?.trim();
      if (spanText) {
        this.handleSpecialNavigation(spanText);
      }
    }

    // Close sidebar on mobile after selection
    if (this.state.isMobile && this.state.isOpen) {
      setTimeout(() => {
        this.close();
      }, 150);
    }
  }

  /**
   * Handle navigation for special menu items that don't have tools
   * @param {string} itemName - Name of the menu item
   */
  handleSpecialNavigation(itemName) {
    switch (itemName) {
      case "Documentation":
        this.navigateToPage("documentation");
        break;
      case "Templates":
        this.navigateToPage("templates");
        break;
      case "Workflows":
        this.navigateToPage("workflows");
        break;
      case "Sign out":
        this.handleSignOut();
        break;
      default:
        console.log(`Navigation not implemented for: ${itemName}`);
    }
  }

  /**
   * Navigate to a special page
   * @param {string} pageId - Page identifier
   */
  navigateToPage(pageId) {
    if (this.router) {
      this.router.navigate(pageId);
    }

    if (this.eventBus) {
      this.eventBus.emit("page:navigate", { pageId });
    }
  }

  /**
   * Handle sign out action
   */
  handleSignOut() {
    // Implement sign out logic here
    console.log("Sign out clicked");
    // For now, just show a notification
    if (this.eventBus) {
      this.eventBus.emit("notification:show", {
        message: "Sign out functionality not implemented yet",
        type: "info",
      });
    }
  }

  /**
   * Get current tool
   * @returns {string} Current tool ID
   */
  getCurrentTool() {
    return this.currentTool;
  }
}

export { Sidebar };
