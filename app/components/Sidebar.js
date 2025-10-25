/**
 * Sidebar - Modular sidebar component
 * Manages navigation and tool selection
 */
class Sidebar {
  constructor(config = {}) {
    this.eventBus = config.eventBus;
    this.router = config.router;
    this.tools = config.tools || [];
    this.getIcon = typeof config.getIcon === "function" ? config.getIcon : null;
    this.menuConfig = config.menuConfig || { app: [], config: [], footer: [] };
    this.toolsConfigMap = config.toolsConfigMap || new Map();

    // State management - matching script.js
    this.state = {
      isOpen: false,
      isCollapsed: false,
      isMobile: false,
    };

    this.currentTool = null;
    this.mobileBreakpoint = 768;
    // Runtime detection may initialize slightly after first render in Tauri
    this._runtimeRetry = false;

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
      this.eventBus.on("tool:registered", (data) => {
        this.addTool(data.tool);
      });

      this.eventBus.on("route:changed", (data) => {
        this.updateActiveItem(data.path);
      });
    }
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

    // Update main content margin based on sidebar state
    if (main) {
      if (this.state.isMobile) {
        main.style.marginLeft = "0";
      } else {
        main.style.marginLeft = this.state.isCollapsed ? "0" : "12rem";
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
        : "Collapse sidebar"
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
      })
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
   * Add a tool to the sidebar
   * @param {BaseTool} tool - Tool instance
   */
  addTool(tool) {
    const metadata = tool.getMetadata();
    this.tools.push(metadata);
    this.renderTools();
  }

  /**
   * Render tools in the sidebar
   */
  async renderTools() {
    const applicationGroup = document.querySelector('.sidebar-group[data-category="application"] .sidebar-menu');

    if (!applicationGroup) return;

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

    const toolsByCategory = sourceTools.reduce((acc, tool) => {
      const cat = categorizeTool(tool);
      if (!acc[cat]) {
        acc[cat] = [];
      }
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

    if (toolsByCategory.general) {
      applicationGroup.innerHTML = toolsByCategory.general
        .map((tool) => {
          const rawSvg = this.getIcon ? this.getIcon(tool.icon) : this.getToolIcon(tool.icon);
          const svg = ensureSvgClass(rawSvg);
          return `
            <div class="sidebar-menu-item" data-tool="${tool.id}">
              <button class="sidebar-menu-button" type="button">
                ${svg}
                <span>${tool.name}</span>
              </button>
            </div>
          `;
        })
        .join("");

      applicationGroup.querySelectorAll(".sidebar-menu-item").forEach((item) => {
        const button = item.querySelector(".sidebar-menu-button");
        if (button) {
          button.addEventListener("click", (e) => {
            e.preventDefault();
            const toolId = item.dataset.tool;
            this.selectTool(toolId);
          });
        }
      });
    }
  }

  async renderMenuGroups() {
    const { categorizeTool } = await import("../core/Categories.js");
    const { isTauri } = await import("../core/Runtime.js");
    const runtimeIsTauri = isTauri();

    // If runtime detection might not be ready yet, re-render once shortly
    if (!runtimeIsTauri && !this._runtimeRetry) {
      this._runtimeRetry = true;
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

      let merged = [...(items || [])];
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
          const dataAttr =
            item.type === "tool"
              ? `data-tool="${item.id}"`
              : item.type === "action"
              ? `data-action="${item.id}"`
              : `data-page="${item.id}"`;
          return `
            <div class=\"sidebar-menu-item\" ${dataAttr}>
              <button class=\"sidebar-menu-button\" type=\"button\">
                ${svg}
                <span>${item.name}</span>
              </button>
            </div>
          `;
        })
        .join("");

      container.querySelectorAll(".sidebar-menu-item .sidebar-menu-button").forEach((button) => {
        button.addEventListener("click", (e) => this.handleMenuClick(e));
      });
    };

    renderGroup("config", this.menuConfig?.config);
    renderGroup("app", this.menuConfig?.app);
    renderGroup("footer", this.menuConfig?.footer);
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

    if (this.eventBus) {
      this.eventBus.emit("tool:activate", { toolId });
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
      button.addEventListener("click", (e) => {
        this.handleMenuClick(e);
      });
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
