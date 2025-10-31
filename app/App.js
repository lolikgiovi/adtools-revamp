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
import { UsageTracker } from "./core/UsageTracker.js";
import { AnalyticsSender } from "./core/AnalyticsSender.js";
import { SplunkVTLEditor } from "./tools/splunk-template/main.js";
import { SQLInClauseTool } from "./tools/sql-in-clause/main.js";
import { CheckImageTool } from "./tools/image-checker/main.js";
import { JenkinsRunner } from "./tools/jenkins-runner/main.js";
import { RegisterPage } from "./pages/register/main.js";
import { isTauri } from "./core/Runtime.js";

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
    // Temporary store for route navigation data payloads
    this._routeData = {};

    // Update UI elements
    this._updateBannerEl = null;
    this._updateModalEl = null;
    this._updateStage = null;
    this._updateLoaded = 0;
    this._updateTotal = 0;

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
        console.info("Usage analytics cleared. Reload to start clean.");
      };
    } catch (_) {}
    // Dev convenience: disable backup to avoid fallback
    if (import.meta?.env?.DEV) {
      try {
        UsageTracker.setBackupEnabled(false);
      } catch (_) {}
    }

    this.initializeComponents();
    this.setupHeaderRuntime();
    // Apply sidebar title from stored username
    try {
      const titleEl = document.querySelector(".sidebar-title");
      const username = localStorage.getItem("user.username");
      if (titleEl && username) titleEl.textContent = `Hi, ${String(username).slice(0, 15)}`;
    } catch (_) {}
    this.registerTools();
    this.buildIconRegistry();
    this.setupRoutes();

    // Build global search index after routes/tools are ready
    this.updateGlobalSearchIndex();

    // Handle initial route after routes are registered
    this.router.handleRouteChange();

    this.bindGlobalEvents();

    // Setup auto-update checks and forced-update handling (Phase 2)
    (async () => {
      try {
        const { setupAutoUpdate } = await import("./core/Updater.js");
        this._updaterHandle = setupAutoUpdate({ eventBus: this.eventBus });
      } catch (_) {
        // Silently ignore if module fails to load
      }
    })();

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

    // Register Check Image
    const checkImage = new CheckImageTool(this.eventBus);
    this.registerTool(checkImage);

    // Register Jenkins Runner
    const jenkinsRunner = new JenkinsRunner(this.eventBus);
    this.registerTool(jenkinsRunner);

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
      this.router.register(toolId, (ctx) => {
        const data = this._routeData?.[toolId] || null;
        this.showTool(toolId, data);
        // Clear one-time data after consumption to avoid stale injections
        if (data) this._routeData[toolId] = null;
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

    // Register route for onboarding
    this.router.register("register", () => {
      const registerPage = new RegisterPage({ eventBus: this.eventBus });
      registerPage.mount(this.mainContent);
    });

    // Set default route based on registration state
    const registered = localStorage.getItem("user.registered") === "true";
    this.router.setDefaultRoute(registered ? "home" : "register");
  }

  /**
   * Show home page
   */
  showHome() {
    if (localStorage.getItem("user.registered") !== "true") {
      this.router.navigate("register");
      return;
    }
    this.updateBreadcrumb("Home", true);

    if (this.currentTool) {
      this.currentTool.deactivate();
      this.currentTool = null;
    }

    const runtimeIsTauri = isTauri();
    if (!runtimeIsTauri && !this._runtimeRetryHome) {
      this._runtimeRetryHome = true;
      setTimeout(() => this.showHome(), 150);
    }
    const toolCards = Array.from(this.tools.values())
      .filter((tool) => {
        const cfg = this.toolsConfigMap.get(tool.id);
        const enabled = cfg ? cfg.enabled !== false : true;
        const showOnHome = cfg ? cfg.showOnHome !== false : true;
        const requiresTauriOk = cfg && cfg.requiresTauri ? runtimeIsTauri : true;
        return enabled && showOnHome && requiresTauriOk;
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

  showTool(toolId, routeData = null) {
    if (localStorage.getItem("user.registered") !== "true") {
      this.router.navigate("register");
      return;
    }
    const tool = this.tools.get(toolId);

    if (!tool) {
      console.error(`Tool not found: ${toolId}`);
      this.router.navigate("home");
      return;
    }

    // Runtime gate: respect requiresTauri
    const cfg = this.toolsConfigMap.get(tool.id);
    if (cfg && cfg.requiresTauri && !isTauri()) {
      this.eventBus.emit("notification:error", {
        message: "This tool requires the desktop app (Tauri) and is hidden in the browser.",
        type: "error",
      });
      this.router.navigate("home");
      return;
    }

    this.updateBreadcrumb(tool.name);

    if (this.currentTool && this.currentTool !== tool) {
      this.currentTool.deactivate();
    }

    this.currentTool = tool;
    tool.activate();

    if (this.mainContent) {
      tool.mount(this.mainContent);
      // Pass any route data to tool if it supports it
      try {
        if (routeData && typeof tool.onRouteData === "function") {
          tool.onRouteData(routeData);
        }
      } catch (_) {}
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

    // Update sidebar title when user registers
    this.eventBus.on("user:registered", (data) => {
      const titleEl = document.querySelector(".sidebar-title");
      const username = data?.username || localStorage.getItem("user.username");
      if (titleEl && username) titleEl.textContent = `Hi, ${String(username).slice(0, 15)}`;
    });

    // Capture route data payloads from navigations
    this.eventBus.on("route:change", ({ path, data }) => {
      try {
        if (path && typeof path === "string") {
          this._routeData[path] = data || null;
        }
      } catch (_) {}
    });

    // Update integration events
    this.eventBus.on("update:show-banner", ({ result }) => {
      this.renderUpdateBanner(result);
    });
    this.eventBus.on("update:hide-banner", () => {
      this.removeUpdateBanner();
    });
    this.eventBus.on("update:forced", ({ policy, unsupported }) => {
      this.showForcedUpdateModal(policy, unsupported);
    });
    this.eventBus.on("update:error", ({ message }) => {
      // Surface error and reflect error state in UI
      this.showNotification(message || "Update error", "error");
      const stage = this._updateStage || "error";
      this.updateStageBoth(stage);
    });
    this.eventBus.on("update:stage", ({ stage }) => {
      this.updateStageBoth(stage);
    });
    this.eventBus.on("update:progress", ({ loaded, total }) => {
      this.updateProgressBoth(loaded, total);
    });

    // In Tauri desktop app, suppress the default WebView right-click menu
    // This keeps the UI cleaner and avoids native context items like "Look Up"
    if (isTauri()) {
      const preventContextMenu = (e) => {
        try {
          // Allow tools to opt-out by marking elements
          // Example: element.setAttribute('data-allow-contextmenu', 'true')
          const allow = e.target && e.target.closest && e.target.closest('[data-allow-contextmenu="true"]');
          if (!allow) e.preventDefault();
        } catch (_) {
          e.preventDefault();
        }
      };
      // Capture phase ensures we run before other handlers
      document.addEventListener("contextmenu", preventContextMenu, { capture: true });
    }
  }

  getHeaderActions() {
    return document.querySelector(".header-actions");
  }

  renderUpdateBanner(result) {
    const container = this.getHeaderActions();
    if (!container) return;
    // Create banner if not exists
    if (!this._updateBannerEl) {
      const el = document.createElement("div");
      el.className = "update-banner";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      // Insert before reload button to appear left of it
      const reloadBtn = container.querySelector(".header-reload");
      if (reloadBtn) {
        container.insertBefore(el, reloadBtn);
      } else {
        container.appendChild(el);
      }
      this._updateBannerEl = el;
    }

    const version = result?.version ? String(result.version) : "";
    const channel = result?.channel ? String(result.channel) : "";
    const label = version ? `Update available: v${version}${channel ? ` (${channel})` : ""}` : "Update available";

    this._updateBannerEl.innerHTML = /*html*/ `
      <div class="update-banner-content">
        <span class="update-banner-label">${label}</span>
        <div class="update-banner-actions">
          <button type="button" class="btn btn-sm btn-primary update-banner-update">Update Now</button>
          <button type="button" class="btn btn-sm btn-outline update-banner-later">Later</button>
        </div>
      </div>
      <div class="update-banner-progress" aria-hidden="true">
        <div class="update-banner-progressbox"><div class="update-banner-progressbar" style="width: 0%"></div></div>
        <span class="update-banner-stage">Ready</span>
      </div>
    `;

    this.attachUpdateBannerEvents();
  }

  attachUpdateBannerEvents() {
    if (!this._updateBannerEl) return;
    const updateBtn = this._updateBannerEl.querySelector(".update-banner-update");
    const laterBtn = this._updateBannerEl.querySelector(".update-banner-later");
    if (updateBtn) {
      updateBtn.onclick = async () => {
        if (!isTauri()) {
          this.eventBus.emit("notification:error", { message: "Updates are available on Desktop only." });
          return;
        }
        updateBtn.disabled = true;
        laterBtn && (laterBtn.disabled = true);
        try {
          const { performUpdate } = await import("./core/Updater.js");
          const ok = await performUpdate(
            (loaded, total) => this.eventBus.emit("update:progress", { loaded, total }),
            (stage) => this.eventBus.emit("update:stage", { stage })
          );
          if (!ok) {
            this.eventBus.emit("update:error", { message: "Update not available or install failed" });
          }
        } catch (err) {
          this.eventBus.emit("update:error", { message: String(err) || "Update failed" });
        } finally {
          updateBtn.disabled = false;
          laterBtn && (laterBtn.disabled = false);
        }
      };
    }
    if (laterBtn) {
      laterBtn.onclick = () => {
        this.removeUpdateBanner();
      };
    }
  }

  removeUpdateBanner() {
    if (this._updateBannerEl && this._updateBannerEl.parentNode) {
      try {
        this._updateBannerEl.parentNode.removeChild(this._updateBannerEl);
      } catch (_) {}
    }
    this._updateBannerEl = null;
  }

  showForcedUpdateModal(policy, unsupported) {
    // Ensure only one modal exists
    if (!this._updateModalEl) {
      const overlay = document.createElement("div");
      overlay.className = "update-overlay";
      const modal = document.createElement("div");
      modal.className = "update-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "update-modal-title");
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      this._updateModalEl = overlay;

      // Prevent background scroll
      try {
        document.body.classList.add("update-modal-open");
      } catch (_) {}
    }

    const current = policy?.current ? String(policy.current) : "";
    const min = policy?.forceMinVersion ? String(policy.forceMinVersion) : "";
    const title = unsupported ? "Update required (Desktop only)" : "Update required";
    const desc = unsupported
      ? "A forced update is required, but the desktop runtime is not available in the browser. Please run AD Tools desktop to continue."
      : `A mandatory update is required to continue. Current: v${current || "?"}, minimum required: v${min || "?"}.`;

    const inner = `
      <div class="update-modal-header">
        <h3 id="update-modal-title">${title}</h3>
      </div>
      <div class="update-modal-body">
        <p class="update-modal-desc">${desc}</p>
        <div class="update-modal-progress">
          <div class="update-modal-progressbox"><div class="update-modal-progressbar" style="width:0%"></div></div>
          <span class="update-modal-stage">Waiting…</span>
        </div>
      </div>
      <div class="update-modal-footer">
        ${unsupported ? '<button type="button" class="btn btn-sm btn-secondary update-modal-close">Dismiss</button>' : ""}
      </div>
    `;
    const modalNode = this._updateModalEl.querySelector(".update-modal");
    if (modalNode) modalNode.innerHTML = inner;

    const closeBtn = this._updateModalEl.querySelector(".update-modal-close");
    if (closeBtn) {
      closeBtn.onclick = () => this.hideForcedUpdateModal();
    }

    this._updateModalEl.classList.add("open");
  }

  hideForcedUpdateModal() {
    if (this._updateModalEl) {
      try {
        this._updateModalEl.classList.remove("open");
        this._updateModalEl.parentNode && this._updateModalEl.parentNode.removeChild(this._updateModalEl);
      } catch (_) {}
      this._updateModalEl = null;
    }
    try {
      document.body.classList.remove("update-modal-open");
    } catch (_) {}
  }

  updateStageBoth(stage) {
    this._updateStage = stage;
    // Banner stage
    if (this._updateBannerEl) {
      const stageEl = this._updateBannerEl.querySelector(".update-banner-stage");
      const progressBox = this._updateBannerEl.querySelector(".update-banner-progress");
      if (stageEl) stageEl.textContent = this.#formatStage(stage);
      if (progressBox) {
        const show = stage && stage !== "uptodate";
        if (show) progressBox.setAttribute("aria-hidden", "false");
        else progressBox.setAttribute("aria-hidden", "true");
      }
    }
    // Modal stage
    if (this._updateModalEl) {
      const stageEl = this._updateModalEl.querySelector(".update-modal-stage");
      if (stageEl) stageEl.textContent = this.#formatStage(stage);
    }
  }

  updateProgressBoth(loaded, total) {
    this._updateLoaded = loaded || 0;
    this._updateTotal = total || 0;
    const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((loaded / total) * 100))) : 0;
    // Banner progress
    if (this._updateBannerEl) {
      const bar = this._updateBannerEl.querySelector(".update-banner-progressbar");
      if (bar) bar.style.width = `${pct}%`;
    }
    // Modal progress
    if (this._updateModalEl) {
      const bar = this._updateModalEl.querySelector(".update-modal-progressbar");
      if (bar) bar.style.width = `${pct}%`;
    }
  }

  #formatStage(stage) {
    switch (stage) {
      case "checking":
        return "Checking…";
      case "downloading":
        return "Downloading…";
      case "restarting":
        return "Restarting…";
      case "uptodate":
        return "Up to date";
      default:
        return stage ? String(stage) : "";
    }
  }

  /**
   * Handle keyboard shortcuts
   * @param {KeyboardEvent} e - Keyboard event
   */
  handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + /: Toggle sidebar
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      this.sidebar.toggle();
    }

    // Cmd/Ctrl + P: Open global search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      this.globalSearch?.open();
    }

    // Cmd + R: Reload page
    if (e.metaKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      try {
        window.location.reload();
      } catch (_) {}
      return;
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

    // Cancel any scheduled updater timers
    try {
      this._updaterHandle && typeof this._updaterHandle.cancel === "function" && this._updaterHandle.cancel();
    } catch (_) {}

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
      app: [{ id: "feedback", name: "Feedback", icon: "feedback", type: "page" }],
      footer: [{ id: "settings", name: "Settings", icon: "settings", type: "page" }],
    };
  }
  renderUsagePanel() {
    const container = document.getElementById("usage-panel");
    if (!container) return;

    const { totalEvents, totalsByFeature, daily } = UsageTracker.getAggregatedStats();

    // Build features list first, so we can decide to hide if empty
    const featuresHtml = Object.entries(totalsByFeature)
      .filter(([id]) => this.toolsConfigMap.has(id))
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
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

    const featuresEmpty = featuresHtml.trim() === "";

    // Hide the entire usage overview when there is no data or no feature rows
    if (totalEvents === 0 || featuresEmpty) {
      try {
        container.style.display = "none";
        container.innerHTML = "";
      } catch (_) {}
      return;
    } else {
      try {
        container.style.display = "block";
      } catch (_) {}
    }

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
        return `<div class="usage-bar" style="height:${h}%" title="${d.label}: ${d.value}" aria-label="${d.label} ${d.value} events"><span class="usage-bar-value">${d.value}</span><span class="usage-bar-label">${d.label}</span></div>`;
      })
      .join("");

    container.innerHTML = /*html*/ `
      <div class="usage-panel">
        <div class="usage-panel-header">
          <h2>Usage Overview</h2>
          <div class="usage-total">Total activities: <strong>${totalEvents}</strong></div>
        </div>
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
      </div>
    `;
  }
  setupHeaderRuntime() {
    const header = document.querySelector(".main-header");
    const reloadBtn = document.querySelector(".header-reload");

    const applyRuntime = () => {
      const rt = isTauri() ? "tauri" : "web";
      if (header) header.setAttribute("data-runtime", rt);
      if (reloadBtn) reloadBtn.title = rt === "tauri" ? "Reload window" : "Reload";
    };

    // Initial runtime set + delayed re-check to handle late Tauri init
    applyRuntime();
    setTimeout(applyRuntime, 200);

    // Wire reload behavior
    if (reloadBtn) {
      reloadBtn.addEventListener("click", (e) => {
        e.preventDefault();
        try {
          // Attempt a standard reload
          window.location.reload();
        } catch (err) {
          // Fallback to hard navigation
          try {
            window.location.href = window.location.href;
          } catch (_) {}
        }
      });
      // Keyboard accessibility for div[role="button"]
      reloadBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          reloadBtn.click();
        }
      });
    }
  }
}

export { App };
