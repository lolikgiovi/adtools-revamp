/**
 * Router - Simple hash-based routing system
 * Manages navigation between different tools
 */
class Router {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.routes = new Map();
    this.currentRoute = null;
    this.navigationId = 0;
    this.defaultRoute = "home";
    // Where the current route was opened from; reported with the page view, never passed to the route.
    this.currentSource = null;
    this.pendingSource = null;

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
   * @param {Object} options
   * @param {string} options.source - Where the user opened it: sidebar, search, home, release_tour, resume. Data without a source is a hand-off.
   */
  navigate(path, data = {}, { source } = {}) {
    this.pendingSource = source || (data && Object.keys(data).length ? "handoff" : "app");
    const isCurrentRoute = window.location.hash === `#${path}`;
    window.location.hash = path;
    this.eventBus.emit("route:change", { path, data });
    if (isCurrentRoute) this.handleRouteChange();
  }

  /**
   * Handle route changes
   */
  handleRouteChange() {
    const navigationId = ++this.navigationId;
    // A hash change no navigate() call announced is back/forward or a typed link.
    this.currentSource = this.pendingSource || "history";
    this.pendingSource = null;
    const hash = window.location.hash.slice(1) || this.defaultRoute;
    const hashParts = hash.split("/");
    const path = hashParts[0];
    const params = hashParts.slice(1);

    if (this.routes.has(path)) {
      this.currentRoute = path;
      const handler = this.routes.get(path);

      try {
        handler({ path, params, query: this.parseQuery(), navigationId });
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
   * Get the monotonically increasing identity of the current navigation.
   * Async route handlers use this to ignore work that completed after a
   * newer navigation started.
   * @returns {number}
   */
  getCurrentNavigationId() {
    return this.navigationId;
  }

  /**
   * Set default route
   * @param {string} path - Default route path
   */
  setDefaultRoute(path) {
    this.defaultRoute = path;
  }
}

export { Router };
