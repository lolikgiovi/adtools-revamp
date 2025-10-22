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
import { HTMLTemplateTool } from "./tools/html-editor/main.js";
import { SettingsPage } from "./pages/settings/main.js";
import { GlobalSearch } from "./components/GlobalSearch.js";
import { getIconSvg as getSettingsIconSvg } from "./pages/settings/icon.js";
import { getIconSvg as getFeedbackIconSvg } from "./pages/feedback/icon.js";
import { getIconSvg as getSignoutIconSvg } from "./pages/signout/icon.js";
import { FeedbackPage } from "./pages/feedback/main.js";
import toolsConfig from "./config/tools.json";
import { UsageTracker } from './core/UsageTracker.js';
import { SplunkVTLEditor } from "./tools/splunk-template/main.js";
import { SQLInClauseTool } from "./tools/sql-in-clause/main.js";

class App {
  constructor() {
    this.eventBus = new EventBus();
    this.router = new Router(this.eventBus);
    this.sidebar = null;
    this.tools = new Map();
    this.currentTool = null;
    this.mainContent = null;
    this.iconRegistry = new Map();
    this.toolsConfigMap = new Map();

    this.init();
  }

  /**
   * Initialize the application
   */
  init() {
    this.setupDOM();
    this.buildToolsConfigMap();
    // Initialize usage tracking early with the app event bus
    UsageTracker.init(this.eventBus);
    // Always expose a global reset helper so it’s callable from console
    try {
      window.resetUsageAnalytics = () => {
        UsageTracker.resetDev();
        console.info('Usage analytics cleared. Reload to start clean.');
      };
    } catch (_) {}
    // Dev convenience: disable backup to avoid fallback
    if (import.meta?.env?.DEV) {
      try {
        UsageTracker.setBackupEnabled(false);
      } catch (_) {}
    }

    this.initializeComponents();
    this.registerTools();
    this.buildIconRegistry();
    this.setupRoutes();

    // Build global search index after routes/tools are ready
    this.updateGlobalSearchIndex();

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

  buildToolsConfigMap() {
    const list = toolsConfig && toolsConfig.tools ? toolsConfig.tools : [];
    this.toolsConfigMap.clear();
    list.forEach((cfg) => {
      if (cfg && cfg.id) this.toolsConfigMap.set(cfg.id, cfg);
    });
  }

  /**
   * Initialize core components
   */
  initializeComponents() {
    // Initialize sidebar
    this.sidebar = new Sidebar({
      eventBus: this.eventBus,
      router: this.router,
      getIcon: this.getToolIcon.bind(this),
      menuConfig: this.buildMenuConfig(),
      toolsConfigMap: this.toolsConfigMap,
    });

    // Initialize breadcrumb
    this.breadcrumb = new Breadcrumb({
      eventBus: this.eventBus,
      router: this.router,
      app: this,
    });

    // Initialize theme manager
    this.themeManager = new ThemeManager(this.eventBus);

    // Initialize global search
    this.globalSearch = new GlobalSearch({
      eventBus: this.eventBus,
      router: this.router,
      app: this,
      getIcon: this.getToolIcon.bind(this),
    });

    // Setup notification system
    this.setupNotifications();
  }

  /** Build icon registry from registered tools */
  buildIconRegistry() {
    this.iconRegistry.clear();
    this.tools.forEach((tool) => {
      const md = tool.getMetadata();
      if (typeof tool.getIconSvg === "function" && md.icon) {
        this.iconRegistry.set(md.icon, () => tool.getIconSvg());
      }
    });
    // Page and action icons
    this.iconRegistry.set("settings", () => getSettingsIconSvg());
    this.iconRegistry.set("feedback", () => getFeedbackIconSvg());
    this.iconRegistry.set("signout", () => getSignoutIconSvg());
  }

  /** Get SVG icon by alias, preferring tool-provided icon */
  getToolIcon(iconName) {
    const provider = this.iconRegistry.get(iconName);
    if (provider) {
      try {
        return provider();
      } catch (e) {
        // fallback below
      }
    }
    // Fallback to sidebar's built-in icons
    return this.sidebar?.getToolIcon(iconName);
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

    // Register HTML Template
    const htmlTemplate = new HTMLTemplateTool(this.eventBus);
    this.registerTool(htmlTemplate);

    // Register Splunk VTL Editor
    const splunkVtl = new SplunkVTLEditor(this.eventBus);
    this.registerTool(splunkVtl);

    // Register SQL IN Clause
    const sqlInClause = new SQLInClauseTool(this.eventBus);
    this.registerTool(sqlInClause);

    // Add more tools here as they are implemented
  }

  /**
   * Register a tool
   * @param {BaseTool} tool - Tool instance
   */
  registerTool(tool) {
    // Apply config overrides before registering
    const cfg = this.toolsConfigMap.get(tool.id);
    if (cfg) {
      if (typeof cfg.name === "string") tool.name = cfg.name;
      if (typeof cfg.icon === "string") tool.icon = cfg.icon;
      if (typeof cfg.category === "string") tool.category = cfg.category;
      tool.__config = cfg;
    }

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

    // Settings route
    this.router.register("settings", () => {
      this.showSettings();
    });

    // Feedback route
    this.router.register("feedback", () => {
      this.showFeedback();
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

    const toolCards = Array.from(this.tools.values())
      .filter((tool) => {
        const cfg = this.toolsConfigMap.get(tool.id);
        const enabled = cfg ? cfg.enabled !== false : true;
        const showOnHome = cfg ? cfg.showOnHome !== false : true;
        return enabled && showOnHome;
      })
      .sort((a, b) => {
        const ca = this.toolsConfigMap.get(a.id)?.order ?? 0;
        const cb = this.toolsConfigMap.get(b.id)?.order ?? 0;
        return ca - cb;
      })
      .map((tool) => {
        const metadata = tool.getMetadata();
        return `
            <div class="tool-card" data-tool="${metadata.id}" onclick="app.navigateToTool('${metadata.id}')">
              <div class="tool-card-icon">
                ${this.getToolIcon(metadata.icon)}
              </div>
              <h3 class="tool-card-title">${metadata.name}</h3>
              <p class="tool-card-description">${metadata.description}</p>
            </div>
          `;
      })
      .join("");

    if (this.mainContent) {
      this.mainContent.innerHTML = `
        <div class="home-container">
          <div class="home-header">
            <div id="usage-panel"></div>
          </div>
          <div class="tools-grid">${toolCards}</div>
        </div>
      `;
      this.renderUsagePanel();
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
      // Record mount in usage analytics under the tool’s feature
    }

    this.eventBus.emit("page:changed", { page: "tool", toolId });
  }

  showSettings() {
    // Update breadcrumb for settings
    this.updateBreadcrumb("Settings");

    // Ensure no tool is active
    if (this.currentTool) {
      this.currentTool.deactivate();
      this.currentTool = null;
    }

    if (this.mainContent) {
      const settingsPage = new SettingsPage({ eventBus: this.eventBus, themeManager: this.themeManager });
      settingsPage.mount(this.mainContent);
    }

    // Emit page change
    this.eventBus.emit("page:changed", { page: "settings" });
  }

  showFeedback() {
    // Update breadcrumb for feedback
    this.updateBreadcrumb("Feedback");

    // Ensure no tool is active
    if (this.currentTool) {
      this.currentTool.deactivate();
      this.currentTool = null;
    }

    if (this.mainContent) {
      const feedbackPage = new FeedbackPage({ eventBus: this.eventBus });
      feedbackPage.mount(this.mainContent);
    }

    // Emit page change
    this.eventBus.emit("page:changed", { page: "feedback" });
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

    // Live update usage panel on usage changes when home is visible
    this.eventBus.on("usage:updated", () => {
      if (document.querySelector(".home-container")) {
        this.renderUsagePanel();
      }
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

    // Cmd/Ctrl + P: Open global search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      this.globalSearch?.open();
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

  updateGlobalSearchIndex() {
    if (!this.globalSearch) return;
    const items = [];

    // Pages
    items.push({
      id: "home",
      name: "Home",
      description: "Go to home page",
      route: "home",
      type: "page",
      icon: null,
    });
    items.push({
      id: "settings",
      name: "Settings",
      description: "Adjust application settings",
      route: "settings",
      type: "page",
      icon: "settings",
    });
    items.push({
      id: "feedback",
      name: "Feedback",
      description: "Send feedback",
      route: "feedback",
      type: "page",
      icon: "feedback",
    });

    // Tools
    this.tools.forEach((tool) => {
      const md = tool.getMetadata();
      items.push({
        id: md.id,
        name: md.name,
        description: md.description || "",
        route: md.id,
        type: "tool",
        icon: md.icon || null,
      });
    });

    this.globalSearch.setIndex(items);
  }
  /** Build app-level menu config for dynamic sidebar groups */
  buildMenuConfig() {
    return {
      config: [],
      app: [
        { id: "settings", name: "Settings", icon: "settings", type: "page" },
        { id: "feedback", name: "Feedback", icon: "feedback", type: "page" },
      ],
      footer: [{ id: "signout", name: "Sign out", icon: "signout", type: "action" }],
    };
  }
  renderUsagePanel() {
    const container = document.getElementById("usage-panel");
    if (!container) return;

    const { totalEvents, totalsByFeature, daily } = UsageTracker.getAggregatedStats();

    const featuresHtml = Object.entries(totalsByFeature)
      .sort(([, a], [, b]) => b - a)
      .map(([id, count]) => {
        const name = this.tools.get(id)?.name || id;
        return `
          <div class="usage-feature-row">
            <span class="usage-feature-name">${name}</span>
            <span class="usage-feature-count">${count}</span>
          </div>
        `;
      })
      .join("");

    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const value = Object.values(daily[dayStr] || {}).reduce((s, v) => s + v, 0);
      const label = d.toLocaleDateString(undefined, { weekday: "short" });
      days.push({ label, value });
    }
    const max = Math.max(1, ...days.map((d) => d.value));
    const barsHtml = days
      .map((d) => {
        const h = Math.round((d.value / max) * 100);
        return `<div class="usage-bar" style="height:${h}%" title="${d.label}: ${d.value}"><span class="usage-bar-label">${d.label}</span></div>`;
      })
      .join("");

    const emptyHtml = `<div class="usage-empty">No usage data yet. Start using tools to see stats.</div>`;

    container.innerHTML = `
      <div class="usage-panel">
        <div class="usage-panel-header">
          <h2>Usage Overview</h2>
          <div class="usage-total">Total events: <strong>${totalEvents}</strong></div>
        </div>
        ${
          totalEvents === 0
            ? emptyHtml
            : `
        <div class="usage-grid">
          <div class="usage-card">
            <h3>By Feature</h3>
            <div class="usage-feature-list">${featuresHtml}</div>
          </div>
          <div class="usage-card">
            <h3>7-day Activity</h3>
            <div class="usage-trend">
              ${barsHtml}
            </div>
          </div>
        </div>
        `
        }
      </div>
    `;
  }
}

export { App };
