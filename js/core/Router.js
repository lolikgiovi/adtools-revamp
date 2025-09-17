/**
 * Router - Simple hash-based routing system
 * Manages navigation between different tools
 */
class Router {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.routes = new Map();
    this.currentRoute = null;
    this.defaultRoute = "home";

    this.init();
  }

  /**
   * Initialize the router
   */
  init() {
    // Listen for hash changes
    window.addEventListener("hashchange", () => {
      this.handleRouteChange();
    });

    // Don't handle initial route here - let the app handle it after routes are registered
  }

  /**
   * Register a route
   * @param {string} path - Route path (without #)
   * @param {Function} handler - Route handler function
   */
  register(path, handler) {
    this.routes.set(path, handler);
  }

  /**
   * Navigate to a route
   * @param {string} path - Route path
   * @param {Object} data - Optional data to pass
   */
  navigate(path, data = {}) {
    window.location.hash = path;
    this.eventBus.emit("route:change", { path, data });
  }

  /**
   * Handle route changes
   */
  handleRouteChange() {
    const hash = window.location.hash.slice(1) || this.defaultRoute;
    const hashParts = hash.split("/");
    const path = hashParts[0];
    const params = hashParts.slice(1);

    if (this.routes.has(path)) {
      this.currentRoute = path;
      const handler = this.routes.get(path);

      try {
        handler({ path, params, query: this.parseQuery() });
        this.eventBus.emit("route:changed", {
          path,
          params,
          previous: this.currentRoute,
        });
      } catch (error) {
        console.error(`Error handling route ${path}:`, error);
        this.navigate(this.defaultRoute);
      }
    } else {
      console.warn(`Route not found: ${path}`);
      this.navigate(this.defaultRoute);
    }
  }

  /**
   * Parse query parameters from URL
   * @returns {Object} Query parameters
   */
  parseQuery() {
    const query = {};
    const queryString = window.location.search.slice(1);

    if (queryString) {
      queryString.split("&").forEach((param) => {
        const [key, value] = param.split("=");
        query[decodeURIComponent(key)] = decodeURIComponent(value || "");
      });
    }

    return query;
  }

  /**
   * Get current route
   * @returns {string} Current route path
   */
  getCurrentRoute() {
    return this.currentRoute;
  }

  /**
   * Set default route
   * @param {string} path - Default route path
   */
  setDefaultRoute(path) {
    this.defaultRoute = path;
  }
}

// Export for use in other modules
window.Router = Router;
