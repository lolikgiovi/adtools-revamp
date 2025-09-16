// shadcn/ui Sidebar JavaScript Implementation
class SidebarProvider {
  constructor() {
    this.sidebar = document.querySelector(".sidebar");
    this.sidebarTrigger = document.querySelector(".sidebar-trigger");
    this.sidebarOverlay = document.querySelector(".sidebar-overlay");
    this.main = document.querySelector(".main");

    // State management
    this.state = {
      isOpen: false,
      isCollapsed: false,
      isMobile: false,
    };

    // Breakpoint for mobile detection
    this.mobileBreakpoint = 768;

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.handleResize();
    this.initializeAccessibility();

    // Set initial state - start with sidebar expanded on desktop
    if (!this.state.isMobile) {
      this.state.isCollapsed = false;
    }
    this.updateSidebarState();
  }

  setupEventListeners() {
    // Sidebar trigger click
    if (this.sidebarTrigger) {
      this.sidebarTrigger.addEventListener("click", () => {
        this.toggle();
      });
    }

    // Overlay click (mobile only)
    if (this.sidebarOverlay) {
      this.sidebarOverlay.addEventListener("click", () => {
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
    window.addEventListener("resize", () => {
      this.handleResize();
    });

    // Menu button clicks
    this.setupMenuButtons();
  }

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

    // Remove active state from all buttons
    document.querySelectorAll(".sidebar-menu-button").forEach((btn) => {
      btn.setAttribute("data-active", "false");
    });

    // Set active state on clicked button
    button.setAttribute("data-active", "true");

    // Close sidebar on mobile after selection
    if (this.state.isMobile && this.state.isOpen) {
      setTimeout(() => {
        this.close();
      }, 150);
    }
  }

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

  handleResize() {
    const isMobile = window.innerWidth <= this.mobileBreakpoint;
    const wasMobile = this.state.isMobile;

    this.state.isMobile = isMobile;

    // Reset states when switching between mobile/desktop
    if (wasMobile !== isMobile) {
      if (isMobile) {
        this.state.isOpen = false;
        this.state.isCollapsed = false;
      } else {
        this.state.isOpen = false;
        this.state.isCollapsed = false; // Start expanded on desktop
      }
      this.updateSidebarState();
    }
  }

  toggle() {
    if (this.state.isMobile) {
      this.state.isOpen = !this.state.isOpen;
    } else {
      this.state.isCollapsed = !this.state.isCollapsed;
    }

    this.updateSidebarState();
  }

  open() {
    if (this.state.isMobile) {
      this.state.isOpen = true;
    } else {
      this.state.isCollapsed = false;
    }

    this.updateSidebarState();
  }

  close() {
    if (this.state.isMobile) {
      this.state.isOpen = false;
    } else {
      this.state.isCollapsed = true;
    }

    this.updateSidebarState();
  }

  updateSidebarState() {
    if (!this.sidebar) return;

    // Update sidebar data attributes
    if (this.state.isMobile) {
      // Mobile behavior
      this.sidebar.setAttribute(
        "data-state",
        this.state.isOpen ? "open" : "closed"
      );
      this.sidebar.setAttribute("data-mobile", "true");
    } else {
      // Desktop behavior
      this.sidebar.setAttribute(
        "data-state",
        this.state.isCollapsed ? "collapsed" : "expanded"
      );
      this.sidebar.setAttribute("data-mobile", "false");
    }

    // Update main content margin based on sidebar state
    if (this.main) {
      if (this.state.isMobile) {
        this.main.style.marginLeft = "0";
      } else {
        this.main.style.marginLeft = this.state.isCollapsed ? "0" : "16rem";
      }
    }

    // Update overlay
    if (this.sidebarOverlay) {
      this.sidebarOverlay.setAttribute(
        "data-state",
        this.state.isMobile && this.state.isOpen ? "open" : "closed"
      );
    }

    // Update trigger icon rotation
    this.updateTriggerIcon();

    // Update ARIA attributes
    this.updateAriaStates();

    // Emit custom event
    this.emitStateChange();
  }

  updateTriggerIcon() {
    if (!this.sidebarTrigger) return;

    const icon = this.sidebarTrigger.querySelector(".sidebar-trigger-icon");
    if (!icon) return;

    // Rotate icon based on state
    if (this.state.isMobile) {
      icon.style.transform = this.state.isOpen
        ? "rotate(180deg)"
        : "rotate(0deg)";
    } else {
      icon.style.transform = this.state.isCollapsed
        ? "rotate(0deg)"
        : "rotate(180deg)";
    }
  }

  updateAriaStates() {
    if (!this.sidebar || !this.sidebarTrigger) return;

    // Update sidebar ARIA attributes
    this.sidebar.setAttribute(
      "aria-hidden",
      this.state.isMobile && !this.state.isOpen ? "true" : "false"
    );

    // Update trigger ARIA attributes
    this.sidebarTrigger.setAttribute(
      "aria-expanded",
      this.state.isMobile
        ? this.state.isOpen.toString()
        : (!this.state.isCollapsed).toString()
    );

    this.sidebarTrigger.setAttribute(
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

  emitStateChange() {
    const event = new CustomEvent("sidebarStateChange", {
      detail: {
        isOpen: this.state.isOpen,
        isCollapsed: this.state.isCollapsed,
        isMobile: this.state.isMobile,
      },
    });

    document.dispatchEvent(event);
  }

  initializeAccessibility() {
    if (!this.sidebar || !this.sidebarTrigger) return;

    // Set initial ARIA attributes
    this.sidebar.setAttribute("role", "navigation");
    this.sidebar.setAttribute("aria-label", "Main navigation");

    this.sidebarTrigger.setAttribute("type", "button");
    this.sidebarTrigger.setAttribute("aria-controls", "sidebar");

    // Set up focus management
    this.setupFocusManagement();
  }

  setupFocusManagement() {
    // Focus trap for mobile sidebar
    if (this.state.isMobile && this.state.isOpen) {
      this.trapFocus();
    }
  }

  trapFocus() {
    const focusableElements = this.sidebar.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleTabKey);

    // Remove listener when sidebar closes
    const removeListener = () => {
      document.removeEventListener("keydown", handleTabKey);
      document.removeEventListener("sidebarStateChange", removeListener);
    };

    document.addEventListener("sidebarStateChange", removeListener);
  }

  // Public API methods
  getState() {
    return { ...this.state };
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.updateSidebarState();
  }

  // Utility methods for external use
  isOpen() {
    return this.state.isMobile ? this.state.isOpen : !this.state.isCollapsed;
  }

  isClosed() {
    return !this.isOpen();
  }

  isMobile() {
    return this.state.isMobile;
  }

  isDesktop() {
    return !this.state.isMobile;
  }
}

// Theme management
class ThemeManager {
  constructor() {
    this.theme = localStorage.getItem("theme") || "light";
    this.init();
  }

  init() {
    this.applyTheme();
    this.setupThemeToggle();
  }

  applyTheme() {
    document.documentElement.classList.toggle("dark", this.theme === "dark");
  }

  setupThemeToggle() {
    // Add theme toggle button if needed
    const themeToggle = document.querySelector("[data-theme-toggle]");
    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        this.toggleTheme();
      });
    }
  }

  toggleTheme() {
    this.theme = this.theme === "light" ? "dark" : "light";
    localStorage.setItem("theme", this.theme);
    this.applyTheme();

    // Emit theme change event
    document.dispatchEvent(
      new CustomEvent("themeChange", {
        detail: { theme: this.theme },
      })
    );
  }

  getTheme() {
    return this.theme;
  }

  setTheme(theme) {
    if (["light", "dark"].includes(theme)) {
      this.theme = theme;
      localStorage.setItem("theme", this.theme);
      this.applyTheme();
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  // Initialize sidebar
  window.sidebarProvider = new SidebarProvider();

  // Initialize theme manager
  window.themeManager = new ThemeManager();

  // Global event listeners for debugging (can be removed in production)
  document.addEventListener("sidebarStateChange", (e) => {
    console.log("Sidebar state changed:", e.detail);
  });

  document.addEventListener("themeChange", (e) => {
    console.log("Theme changed:", e.detail);
  });
});

// Export for module usage (if needed)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SidebarProvider, ThemeManager };
}
