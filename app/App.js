/**
 * App - Main application class
 * Initializes and coordinates all components
 */
import { UUIDGenerator } from "./tools/uuid-generator/main.js";
import { JSONTools } from "./tools/json-tools/main.js";
import { QRTools } from "./tools/qr-tools/main.js";
import { Base64Tools } from "./tools/base64-tools/main.js";
import { EventBus } from "./core/EventBus.js";
import { Router } from "./core/Router.js";
import { Sidebar } from "./components/Sidebar.js";
import { Breadcrumb } from "./components/Breadcrumb.js";
import { ThemeManager } from "./core/ThemeManager.js";
import { QuickQuery } from "./tools/quick-query/main.js";

class App {
  constructor() {
    this.eventBus = new EventBus();
    this.router = new Router(this.eventBus);
    this.sidebar = null;
    this.tools = new Map();
    this.currentTool = null;
    this.mainContent = null;

    this.init();
  }

  /**
   * Initialize the application
   */
  init() {
    this.setupDOM();
    this.initializeComponents();
    this.registerTools();
    this.setupRoutes();

    // Handle initial route after routes are registered
    this.router.handleRouteChange();

    this.bindGlobalEvents();

    console.log("AD Tools app initialized successfully");
  }

  /**
   * Setup DOM references
   */
  setupDOM() {
    this.mainContent = document.querySelector(".main-content");
    if (!this.mainContent) {
      console.error("Main content container not found");
    }
  }

  /**
   * Initialize core components
   */
  initializeComponents() {
    // Initialize sidebar
    this.sidebar = new Sidebar({
      eventBus: this.eventBus,
      router: this.router,
    });

    // Initialize breadcrumb
    this.breadcrumb = new Breadcrumb({
      eventBus: this.eventBus,
      router: this.router,
      app: this,
    });

    // Initialize theme manager
    this.themeManager = new ThemeManager(this.eventBus);

    // Setup notification system
    this.setupNotifications();
  }

  /**
   * Register all tools
   */
  registerTools() {
    // Register UUID Generator
    const uuidGenerator = new UUIDGenerator(this.eventBus);
    this.registerTool(uuidGenerator);

    // Register JSON Tools
    const jsonTools = new JSONTools(this.eventBus);
    this.registerTool(jsonTools);

    // Register Base64 Tools
    const base64Tools = new Base64Tools(this.eventBus);
    this.registerTool(base64Tools);

    // Register QR Tools
    const qrTools = new QRTools(this.eventBus);
    this.registerTool(qrTools);

    // Register Quick Query
    const quickQuery = new QuickQuery(this.eventBus);
    this.registerTool(quickQuery);

    // Add more tools here as they are implemented
  }

  /**
   * Register a tool
   * @param {BaseTool} tool - Tool instance
   */
  registerTool(tool) {
    this.tools.set(tool.id, tool);

    // Notify sidebar about new tool
    this.eventBus.emit("tool:registered", { tool });

    console.log(`Tool registered: ${tool.name}`);
  }

  /**
   * Setup routing
   */
  setupRoutes() {
    // Home route
    this.router.register("home", () => {
      this.showHome();
    });

    // Tool routes
    this.tools.forEach((tool, toolId) => {
      this.router.register(toolId, () => {
        this.showTool(toolId);
      });
    });

    // Set default route
    this.router.setDefaultRoute("home");
  }

  /**
   * Show home page
   */
  showHome() {
    // Update breadcrumb for home
    this.updateBreadcrumb("Home", true);

    if (this.currentTool) {
      this.currentTool.deactivate();
      this.currentTool = null;
    }

    if (this.mainContent) {
      this.mainContent.innerHTML = `
                <div class="home-container">
                    <div class="home-header">
                    </div>
                    
                    <div class="tools-grid">
                        ${Array.from(this.tools.values())
                          .map((tool) => {
                            const metadata = tool.getMetadata();
                            return `
                                <div class="tool-card" data-tool="${metadata.id}" onclick="app.navigateToTool('${metadata.id}')">
                                    <div class="tool-card-icon">
                                        ${this.sidebar.getToolIcon(metadata.icon)}
                                    </div>
                                    <h3 class="tool-card-title">${metadata.name}</h3>
                                    <p class="tool-card-description">${metadata.description}</p>
                                </div>
                            `;
                          })
                          .join("")}
                    </div>
                </div>
            `;
    }

    this.eventBus.emit("page:changed", { page: "home" });
  }

  /**
   * Show a specific tool
   * @param {string} toolId - Tool ID
   */
  showTool(toolId) {
    const tool = this.tools.get(toolId);

    if (!tool) {
      console.error(`Tool not found: ${toolId}`);
      this.router.navigate("home");
      return;
    }

    // Update breadcrumb for tool
    this.updateBreadcrumb(tool.name);

    // Deactivate current tool
    if (this.currentTool && this.currentTool !== tool) {
      this.currentTool.deactivate();
    }

    // Activate new tool
    this.currentTool = tool;
    tool.activate();

    // Mount tool to main content
    if (this.mainContent) {
      tool.mount(this.mainContent);
    }

    this.eventBus.emit("page:changed", { page: "tool", toolId });
  }

  /**
   * Navigate to a tool (public method for global access)
   * @param {string} toolId - Tool ID
   */
  navigateToTool(toolId) {
    this.router.navigate(toolId);
  }

  updateBreadcrumb(title, isHome = false) {
    const breadcrumbCurrent = document.getElementById("breadcrumb-current");
    const breadcrumbSeparator = document.querySelector(".breadcrumb-separator");
    const breadcrumbCurrentItem = document.querySelector(".breadcrumb-current");

    if (breadcrumbCurrent) {
      breadcrumbCurrent.textContent = title;
    }

    // Show/hide separator and current item based on whether we're on home
    if (isHome) {
      breadcrumbSeparator.style.display = "none";
      breadcrumbCurrentItem.style.display = "none";
    } else {
      breadcrumbSeparator.style.display = "flex";
      breadcrumbCurrentItem.style.display = "block";
    }
  }

  /**
   * Setup notification system
   */
  setupNotifications() {
    this.eventBus.on("notification:success", (data) => {
      this.showNotification(data.message, "success", data.duration);
    });

    this.eventBus.on("notification:error", (data) => {
      this.showNotification(data.message, "error", data.duration);
    });

    this.eventBus.on("notification:info", (data) => {
      this.showNotification(data.message, "info", data.duration);
    });
  }

  /**
   * Show notification
   * @param {string} message - Notification message
   * @param {string} type - Notification type (success, error, info)
   */
  showNotification(message, type = "info", durationMs = 1000) {
    // Create notification container if it doesn't exist
    let container = document.querySelector(".notification-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "notification-container";
      document.body.appendChild(container);
    }

    // Limit to maximum 3 notifications
    const existingNotifications = container.querySelectorAll(".notification");
    if (existingNotifications.length >= 3) {
      // Remove the oldest notification
      existingNotifications[0].remove();
    }

    // Create notification element
    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-message">${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `;

    // Add to container
    container.appendChild(notification);

    // Auto-remove after configured duration
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, durationMs);

    // Add slide-in animation
    setTimeout(() => {
      notification.classList.add("show");
    }, 10);
  }

  /**
   * Bind global events
   */
  bindGlobalEvents() {
    // Handle window resize
    window.addEventListener("resize", () => {
      this.eventBus.emit("window:resize", {
        width: window.innerWidth,
        height: window.innerHeight,
      });
    });

    // Handle keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      this.handleKeyboardShortcuts(e);
    });

    // Handle theme changes
    this.eventBus.on("theme:change", (data) => {
      document.documentElement.setAttribute("data-theme", data.theme);
    });
  }

  /**
   * Handle keyboard shortcuts
   * @param {KeyboardEvent} e - Keyboard event
   */
  handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + /: Toggle sidebar
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      this.sidebar.toggle();
    }

    // Escape: Close modals/overlays
    if (e.key === "Escape") {
      this.eventBus.emit("escape:pressed");
    }
  }

  /**
   * Get current tool
   * @returns {BaseTool|null} Current tool instance
   */
  getCurrentTool() {
    return this.currentTool;
  }

  /**
   * Get all registered tools
   * @returns {Map} Map of tool instances
   */
  getTools() {
    return this.tools;
  }

  /**
   * Destroy the application
   */
  destroy() {
    // Cleanup event listeners
    this.eventBus.clear();

    // Deactivate current tool
    if (this.currentTool) {
      this.currentTool.deactivate();
    }

    console.log("AD Tools app destroyed");
  }
}

export { App };
