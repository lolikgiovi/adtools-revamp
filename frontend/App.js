/**
 * App - Main application class
 * Initializes and coordinates all components
 */
import { EventBus } from "./core/EventBus.js";
import { Router } from "./core/Router.js";
import { Sidebar } from "./components/Sidebar.js";
import { Breadcrumb } from "./components/Breadcrumb.js";
import { ThemeManager } from "./core/ThemeManager.js";
import { GlobalSearch } from "./components/GlobalSearch.js";
import toolsConfig from "./config/tools.json";
import { getIconSvg } from "./config/iconRegistry.js";
import { buildToolDefinitions, getToolDefinition, getToolDefinitionsList } from "./config/toolDefinitions.js";
import { UsageTracker } from "./core/UsageTracker.js";
import { ErrorMonitor } from "./core/ErrorMonitor.js";
import { isTauri } from "./core/Runtime.js";
import { categorizeTool } from "./core/Categories.js";
import WebUpdateChecker from "./core/WebUpdateChecker.js";

const ASSET_LOAD_RETRY_DELAY_MS = 3000;
const ASSET_LOAD_MAX_RETRIES = 3;
const ASSET_LOAD_MAX_RELOADS = 3;
const ASSET_LOAD_RELOAD_KEY_PREFIX = "adtools.assetLoadReloads";

class App {
  constructor() {
    this.eventBus = new EventBus();
    this.router = new Router(this.eventBus);
    this.toolDefinitions = new Map();
    this.sidebar = null;
    this.tools = new Map();
    this.pendingToolLoads = new Map();
    this.pageComponents = new Map();
    this.pendingAssetRecoveryReload = false;
    this.currentTool = null;
    this.mainContent = null;
    this.toolsConfigMap = new Map();
    this.categoriesConfigMap = new Map();
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
    this.buildCategoriesConfigMap();
    this.buildToolDefinitions();
    // Dev: speed up analytics batch interval for quicker feedback
    if (import.meta?.env?.DEV) {
      try {
        localStorage.setItem("usage.analytics.batch.interval.ms", String(15 * 60 * 1000));
      } catch (_) {}
    }
    // Initialize usage tracking early with the app event bus
    UsageTracker.init(this.eventBus);
    ErrorMonitor.init({
      eventBus: this.eventBus,
      router: this.router,
      getCurrentTool: () => this.currentTool?.id || this.router?.getCurrentRoute?.() || null,
    });
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
    this.syncDeviceVersion();
    // Apply sidebar title from stored username
    try {
      const titleEl = document.querySelector(".sidebar-title");
      const username = localStorage.getItem("user.username");
      if (titleEl && username) titleEl.textContent = `Hi, ${String(username).slice(0, 15)}`;
    } catch (_) {}
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

    // Setup web-only update checker (hourly build checks)
    if (!isTauri()) {
      try {
        WebUpdateChecker.init();
      } catch (err) {
        console.warn("WebUpdateChecker initialization failed:", err);
      }
    }

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

  buildCategoriesConfigMap() {
    const cats = toolsConfig && Array.isArray(toolsConfig.categories) ? toolsConfig.categories : [];
    this.categoriesConfigMap.clear();
    if (cats.length > 0) {
      cats.forEach((c) => {
        if (c && c.id)
          this.categoriesConfigMap.set(String(c.id), {
            id: String(c.id),
            name: String(c.name || c.id),
            order: Number(c.order) || 0,
            requiresTauri: Boolean(c.requiresTauri),
          });
      });
    } else {
      // Fallback defaults
      this.categoriesConfigMap.set("config", { id: "config", name: "Config", order: 10 });
      this.categoriesConfigMap.set("general", { id: "general", name: "General", order: 20 });
    }
  }

  buildToolDefinitions() {
    this.toolDefinitions = buildToolDefinitions(toolsConfig?.tools || []);
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
      tools: this.getToolDefinitions(),
      menuConfig: this.buildMenuConfig(),
      toolsConfigMap: this.toolsConfigMap,
      categoriesMap: this.categoriesConfigMap,
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

  /** Get SVG icon by alias from the shell registry */
  getToolIcon(iconName) {
    return getIconSvg(iconName) || this.sidebar?.getToolIcon(iconName);
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
    this.toolDefinitions.forEach((definition, toolId) => {
      this.router.register(toolId, () => {
        const data = this._routeData?.[toolId] || null;
        this.showTool(toolId, data).catch((error) => {
          if (this.isAssetRecoveryHandled(error)) {
            return;
          }
          console.error(`Failed to show tool ${toolId}:`, error);
          this.showNotification(`Failed to load ${definition.name}`, "error", 2500);
          this.router.navigate("home");
        });
        // Clear one-time data after consumption to avoid stale injections
        if (data) this._routeData[toolId] = null;
      });
    });

    // Settings route
    this.router.register("settings", () => {
      this.showSettings().catch((error) => {
        console.error("Failed to show settings page:", error);
      });
    });

    // About route
    this.router.register("about", () => {
      this.showAbout().catch((error) => {
        console.error("Failed to show about page:", error);
      });
    });

    // Feedback route removed

    // Register route for onboarding
    this.router.register("register", () => {
      this.showRegister().catch((error) => {
        console.error("Failed to show register page:", error);
      });
    });

    // Analytics dashboard (no sidebar entry, direct URL access only)
    this.router.register("analytics-dashboard", () => {
      this.showAnalyticsDashboard().catch((error) => {
        console.error("Failed to show analytics dashboard:", error);
      });
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
    this.clearCurrentTool();

    const runtimeIsTauri = isTauri();
    if (!runtimeIsTauri && !this._runtimeRetryHome) {
      this._runtimeRetryHome = true;
      setTimeout(() => this.showHome(), 150);
    }
    const eligibleTools = this.getVisibleToolDefinitions({ runtimeIsTauri, forHome: true });

    const grouped = eligibleTools.reduce((acc, definition) => {
      const cat = categorizeTool(definition);
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(definition);
      return acc;
    }, {});

    const sortedCategoryIds = Array.from(this.categoriesConfigMap.values())
      .sort((a, b) => a.order - b.order)
      .map((c) => c.id);

    const toolCards = sortedCategoryIds
      .flatMap((catId) => {
        const toolsInCat = grouped[catId] || [];
        return toolsInCat
          .sort((a, b) => a.order - b.order)
          .map((definition) => {
            return `
              <div class="tool-card" data-tool="${definition.id}" onclick="app.navigateToTool('${definition.id}')">
                <div class="tool-card-icon">
                  ${this.getToolIcon(definition.icon)}
                </div>
                <h3 class="tool-card-title">${definition.name}</h3>
                <p class="tool-card-description">${definition.description}</p>
              </div>
            `;
          });
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

  async showTool(toolId, routeData = null) {
    if (localStorage.getItem("user.registered") !== "true") {
      this.router.navigate("register");
      return;
    }
    const definition = this.getToolDefinition(toolId);

    if (!definition) {
      console.error(`Tool not found: ${toolId}`);
      this.router.navigate("home");
      return;
    }

    // Runtime gate: respect requiresTauri
    if (definition.requiresTauri && !isTauri()) {
      this.eventBus.emit("notification:error", {
        message: "This tool requires the desktop app (Tauri) and is hidden in the browser.",
        type: "error",
      });
      this.router.navigate("home");
      return;
    }

    if (this.currentTool && this.currentTool.id !== toolId) {
      this.clearCurrentTool();
    }
    this.renderLoadingState({
      title: definition.name,
      message: "Loading tool and preparing the interface.",
    });
    const tool = await this.loadWithAssetRecovery(() => this.ensureToolLoaded(toolId), {
      id: toolId,
      label: definition.name,
    });
    this.clearAssetRecoveryState(toolId);
    this.updateBreadcrumb(definition.name);

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

    this.eventBus.emit("page:changed", { page: "tool", toolId, title: definition.name });
    UsageTracker.trackFeature(toolId, "open", { route: `#${toolId}` }, 2000);
  }

  showSettings() {
    return this.showShellPage({
      pageId: "settings",
      title: "Settings",
      eventName: "settings",
      loader: () => import("./pages/settings/main.js").then((module) => module.SettingsPage),
      createOptions: () => ({ eventBus: this.eventBus, themeManager: this.themeManager }),
    });
  }

  showAbout() {
    return this.showShellPage({
      pageId: "about",
      title: "About",
      eventName: "about",
      loader: () => import("./pages/about/main.js").then((module) => module.AboutPage),
      createOptions: () => ({ eventBus: this.eventBus }),
    });
  }

  showAnalyticsDashboard() {
    return this.showShellPage({
      pageId: "analytics-dashboard",
      title: "Analytics Dashboard",
      eventName: "analytics-dashboard",
      loader: () => import("./pages/analytics-dashboard/main.js").then((module) => module.AnalyticsDashboardPage),
      createOptions: () => ({ eventBus: this.eventBus }),
    });
  }

  showRegister() {
    return this.showShellPage({
      pageId: "register",
      title: "Register",
      eventName: "register",
      loader: () => import("./pages/register/main.js").then((module) => module.RegisterPage),
      createOptions: () => ({ eventBus: this.eventBus }),
    });
  }

  async showShellPage({ pageId, title, eventName, loader, createOptions }) {
    // Update breadcrumb for settings
    this.updateBreadcrumb(title);
    this.clearCurrentTool();
    this.renderLoadingState({
      title,
      message: "Loading page content.",
    });

    const PageClass = await this.loadWithAssetRecovery(() => this.loadPageComponent(pageId, loader), {
      id: pageId,
      label: title,
    });
    this.clearAssetRecoveryState(pageId);
    if (this.mainContent) {
      const page = new PageClass(createOptions?.() || {});
      page.mount(this.mainContent);
    }

    this.eventBus.emit("page:changed", { page: eventName, title });
  }

  // Feedback page removed

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
      this.syncDeviceVersion();
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
    this.eventBus.on("update:forced", ({ policy, unsupported, manifest }) => {
      this.showForcedUpdateModal(policy, unsupported, manifest);
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
    // Store channel for use when user clicks "Update Now"
    this._updateChannel = result?.channel || undefined;
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
    const notes = result?.manifest?.notes || "";
    const label = version ? `Update available: v${version}${channel ? ` (${channel})` : ""}` : "Update available";

    this._updateBannerEl.innerHTML = /*html*/ `
      <div class="update-banner-content">
        <span class="update-banner-label">${label}</span>
        ${
          notes
            ? '<button type="button" class="btn btn-sm btn-text update-banner-toggle" aria-expanded="true">Hide notes</button>'
            : ""
        }
        <div class="update-banner-actions">
          <button type="button" class="btn btn-sm btn-primary update-banner-update">Update Now</button>
          <button type="button" class="btn btn-sm btn-outline update-banner-later">Later</button>
        </div>
      </div>
      ${notes ? `<div class="update-banner-notes" aria-hidden="false"><div class="update-banner-notes-content">${this.#renderMarkdown(notes)}</div></div>` : ""}
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
    const toggleBtn = this._updateBannerEl.querySelector(".update-banner-toggle");
    const notesEl = this._updateBannerEl.querySelector(".update-banner-notes");

    if (toggleBtn && notesEl) {
      toggleBtn.onclick = () => {
        const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";
        toggleBtn.setAttribute("aria-expanded", String(!isExpanded));
        notesEl.setAttribute("aria-hidden", String(isExpanded));
        toggleBtn.textContent = isExpanded ? "What's new?" : "Hide notes";
      };
    }

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
            (stage) => this.eventBus.emit("update:stage", { stage }),
            this._updateChannel
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

  showForcedUpdateModal(policy, unsupported, manifest) {
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
    const notes = manifest?.notes || "";
    const title = unsupported ? "Update required (Desktop only)" : "Update required";
    const desc = unsupported
      ? "A forced update is required, but the desktop runtime is not available in the browser. Please run AD Tools desktop to continue."
      : `A mandatory update is required to continue. Current: v${current || "?"}, minimum required: v${min || "?"}.`;

    const notesSection = notes
      ? `
      <div class="update-modal-notes">
        <h4>What's new:</h4>
        <div class="update-modal-notes-content">${this.#renderMarkdown(notes)}</div>
      </div>
    `
      : "";

    const inner = `
      <div class="update-modal-header">
        <h3 id="update-modal-title">${title}</h3>
      </div>
      <div class="update-modal-body">
        <p class="update-modal-desc">${desc}</p>
        ${notesSection}
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

#escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  #renderMarkdown(markdown) {
    if (!markdown) return "";

    let html = markdown.trim();

    html = html
      .replace(/&(?!amp;|lt;|gt;|quot;|#)/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang || "text"}">${code.trim()}</code></pre>`;
    });

    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote><p>$1</p></blockquote>");
    html = html.replace(/^---$/gm, "<hr>");

    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>[\n\r]*)+/g, (match) => {
      if (!match.includes("<li>")) return match;
      return `<ul>${match}</ul>`;
    });

    html = html.replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>[\n\r]*)+/g, (match) => {
      if (!match.includes("<li>")) return match;
      return `<ol>${match}</ol>`;
    });

    html = html.replace(/\n\n+/g, "</p><p>");
    html = html.replace(/^(?!<[hulopbhrc])(.+)$/gm, "<p>$1</p>");
    html = html.replace(/<p><\/p>/g, "");

    return html;
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

  getToolDefinitions() {
    return getToolDefinitionsList(this.toolDefinitions);
  }

  getToolDefinition(toolId) {
    return getToolDefinition(this.toolDefinitions, toolId);
  }

  getToolNameById(toolId) {
    return this.getToolDefinition(toolId)?.name || this.tools.get(toolId)?.name || toolId;
  }

  getVisibleToolDefinitions({ runtimeIsTauri = isTauri(), forHome = false } = {}) {
    return this.getToolDefinitions()
      .filter((definition) => {
        if (!definition.enabled) return false;
        if (forHome && !definition.showOnHome) return false;
        if (!forHome && !definition.showInSidebar) return false;
        if (definition.requiresTauri && !runtimeIsTauri) return false;
        return true;
      })
      .sort((a, b) => a.order - b.order);
  }

  async ensureToolLoaded(toolId) {
    const existing = this.tools.get(toolId);
    if (existing) return existing;

    const pending = this.pendingToolLoads.get(toolId);
    if (pending) return pending;

    const definition = this.getToolDefinition(toolId);
    if (!definition) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    const loadPromise = definition
      .load()
      .then((contract) => {
        const tool = this.createToolInstance(definition, contract);
        this.tools.set(toolId, tool);
        return tool;
      })
      .finally(() => {
        this.pendingToolLoads.delete(toolId);
      });

    this.pendingToolLoads.set(toolId, loadPromise);
    return loadPromise;
  }

  createToolInstance(definition, contract) {
    if (contract?.createTool && typeof contract.createTool === "function") {
      return contract.createTool(this.eventBus);
    }
    if (contract?.ToolClass) {
      return new contract.ToolClass(this.eventBus);
    }
    throw new Error(`Invalid tool contract for ${definition.id}`);
  }

  async loadPageComponent(pageId, loader) {
    if (this.pageComponents.has(pageId)) {
      return this.pageComponents.get(pageId);
    }
    const PageClass = await loader();
    this.pageComponents.set(pageId, PageClass);
    return PageClass;
  }

  async loadWithAssetRecovery(loadFn, { id, label }) {
    let lastError;

    for (let attempt = 0; attempt <= ASSET_LOAD_MAX_RETRIES; attempt++) {
      try {
        return await loadFn();
      } catch (error) {
        lastError = error;
        if (!this.shouldRecoverAssetLoad(error)) {
          throw error;
        }

        if (attempt >= ASSET_LOAD_MAX_RETRIES) {
          this.scheduleAssetRecoveryReload({ id, label, error });
          if (error && typeof error === "object") {
            error.assetRecoveryHandled = true;
          }
          throw error;
        }

        const nextAttempt = attempt + 1;
        console.warn(
          `[AssetLoadRecovery] Failed to load assets for ${id}; retrying ${nextAttempt}/${ASSET_LOAD_MAX_RETRIES}`,
          error
        );
        this.renderLoadingState({
          title: label || "Loading",
          message: `Network hiccup while loading assets. Retrying ${nextAttempt}/${ASSET_LOAD_MAX_RETRIES}...`,
        });
        await this.wait(ASSET_LOAD_RETRY_DELAY_MS);
      }
    }

    throw lastError;
  }

  shouldRecoverAssetLoad(error) {
    if (isTauri()) return false;

    const message = String(error?.message || error || "");
    const name = String(error?.name || "");

    return (
      /Unable to preload CSS/i.test(message) ||
      /Failed to fetch dynamically imported module/i.test(message) ||
      /Importing a module script failed/i.test(message) ||
      /Loading chunk \d+ failed/i.test(message) ||
      /ChunkLoadError/i.test(message) ||
      /CSS_CHUNK_LOAD_FAILED/i.test(message) ||
      /ERR_TIMED_OUT/i.test(message) ||
      /ChunkLoadError/i.test(name)
    );
  }

  isAssetRecoveryHandled(error) {
    return Boolean(error?.assetRecoveryHandled || this.pendingAssetRecoveryReload);
  }

  scheduleAssetRecoveryReload({ id, label, error }) {
    if (isTauri() || this.pendingAssetRecoveryReload) return false;

    const key = this.getAssetRecoveryStorageKey(id);
    const reloads = this.getSessionNumber(key);

    if (reloads >= ASSET_LOAD_MAX_RELOADS) {
      console.warn(`[AssetLoadRecovery] Reload limit reached for ${id}`, error);
      this.renderLoadingState({
        title: label || "Loading failed",
        message: "Still unable to load required assets. Please reload once your connection is stable.",
      });
      this.showNotification(
        "Still unable to load required assets. Please reload once your connection is stable.",
        "error",
        5000
      );
      return false;
    }

    this.pendingAssetRecoveryReload = true;
    this.setSessionNumber(key, reloads + 1);
    console.warn(`[AssetLoadRecovery] Reloading after repeated asset load failures for ${id}`, error);
    this.renderLoadingState({
      title: label || "Reloading",
      message: `Still having trouble loading assets. Reloading ${reloads + 1}/${ASSET_LOAD_MAX_RELOADS}...`,
    });

    setTimeout(() => {
      try {
        window.location.reload();
      } catch (_) {
        try {
          window.location.href = window.location.href;
        } catch (_) {}
      }
    }, 250);

    return true;
  }

  clearAssetRecoveryState(id) {
    if (isTauri()) return;
    try {
      sessionStorage.removeItem(this.getAssetRecoveryStorageKey(id));
    } catch (_) {}
  }

  getAssetRecoveryStorageKey(id) {
    const buildId = this.getCachedWebBuildId();
    return `${ASSET_LOAD_RELOAD_KEY_PREFIX}:${buildId}:${id || "route"}`;
  }

  getCachedWebBuildId() {
    try {
      return localStorage.getItem("web.lastBuildId") || "unknown";
    } catch (_) {
      return "unknown";
    }
  }

  getSessionNumber(key) {
    try {
      const value = Number(sessionStorage.getItem(key));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_) {
      return 0;
    }
  }

  setSessionNumber(key, value) {
    try {
      sessionStorage.setItem(key, String(value));
    } catch (_) {}
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

    // Cancel web update checker
    try {
      WebUpdateChecker.cancel();
    } catch (_) {}

    // Deactivate current tool
    if (this.currentTool) {
      this.currentTool.deactivate();
      this.currentTool.unmount();
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
      id: "about",
      name: "About",
      description: "Learn about AD Tools and how to use it",
      route: "about",
      type: "page",
      icon: "about",
    });
    items.push({
      id: "settings",
      name: "Settings",
      description: "Adjust application settings",
      route: "settings",
      type: "page",
      icon: "settings",
    });
    // Feedback removed from global search

    // Tools
    this.getVisibleToolDefinitions().forEach((definition) => {
      items.push({
        id: definition.id,
        name: definition.name,
        description: definition.description || "",
        route: definition.id,
        type: "tool",
        icon: definition.icon || null,
      });
    });

    this.globalSearch.setIndex(items);
  }
  /** Build app-level menu config for dynamic sidebar groups */
  buildMenuConfig() {
    return {
      config: [],
      // App group removed
      footer: [
        { id: "about", name: "About", icon: "about", type: "page" },
        { id: "settings", name: "Settings", icon: "settings", type: "page" },
      ],
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
        const name = this.getToolNameById(id);
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
    setTimeout(() => {
      applyRuntime();
      this.updateGlobalSearchIndex();
    }, 200);

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

  async syncDeviceVersion() {
    try {
      let version = null;
      if (isTauri()) {
        try {
          const { getVersion } = await import("@tauri-apps/api/app");
          version = await getVersion();
        } catch (_) {}
      }

      if (!version) {
        try {
          const res = await fetch("./web-build.json", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            version = data?.version || data?.buildVersion || data?.build || null;
          }
        } catch (_) {}
      }

      if (version) {
        localStorage.setItem("app.version", String(version));
        UsageTracker.reportDeviceVersion(String(version)).catch(() => {});
      }
    } catch (_) {}
  }

  clearCurrentTool() {
    if (!this.currentTool) return;
    this.currentTool.deactivate();
    this.currentTool.unmount();
    this.currentTool = null;
  }

  renderLoadingState({ title = "Loading", message = "Preparing the interface." } = {}) {
    if (!this.mainContent) return;
    this.mainContent.innerHTML = /*html*/ `
      <div class="shell-loading" role="status" aria-live="polite" aria-busy="true">
        <div class="shell-loading-card">
          <div class="shell-loading-spinner" aria-hidden="true">
            <span class="shell-loading-ring"></span>
          </div>
          <h2 class="shell-loading-title">${this.#escapeHtml(title)}</h2>
          <p class="shell-loading-message">${this.#escapeHtml(message)}</p>
        </div>
      </div>
    `;
  }
}

export { App };
