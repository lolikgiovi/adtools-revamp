// WebUpdateChecker - Web-only automatic update checker
// Checks for new deployments hourly and auto-reloads when detected

import { isTauri } from "./Runtime.js";

const STORAGE_KEY = "web.lastBuildId";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BUILD_JSON_URL = "/web-build.json";

class WebUpdateChecker {
  constructor() {
    this._intervalId = null;
    this._isChecking = false;
  }

  /**
   * Initialize the update checker.
   * Starts initial check and sets up hourly interval.
   * Web-only: Does nothing in Tauri runtime.
   */
  init() {
    // Only run in web browser, not in Tauri desktop app
    if (isTauri()) {
      return;
    }

    // Perform initial check
    this.checkForUpdate();

    // Set up hourly interval
    this._intervalId = setInterval(() => {
      this.checkForUpdate();
    }, CHECK_INTERVAL_MS);

    console.log("[WebUpdateChecker] Initialized with hourly checks");
  }

  /**
   * Check for updates by fetching web-build.json and comparing build IDs.
   */
  async checkForUpdate() {
    // Prevent concurrent checks
    if (this._isChecking) {
      return;
    }

    this._isChecking = true;

    try {
      // Fetch the build info from server
      const response = await fetch(BUILD_JSON_URL, {
        method: "GET",
        cache: "no-cache", // Always get fresh version
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        console.warn(`[WebUpdateChecker] Failed to fetch build info: ${response.status}`);
        return;
      }

      const buildInfo = await response.json();
      const serverBuildId = buildInfo?.build;

      if (!serverBuildId) {
        console.warn("[WebUpdateChecker] No build ID found in web-build.json");
        return;
      }

      // Get cached build ID
      const cachedBuildId = this._getCachedBuildId();

      // First time - just cache the build ID
      if (!cachedBuildId) {
        this._setCachedBuildId(serverBuildId);
        console.log(`[WebUpdateChecker] Initial build ID cached: ${serverBuildId}`);
        return;
      }

      // Compare build IDs
      if (serverBuildId !== cachedBuildId) {
        console.log(
          `[WebUpdateChecker] New build detected! Old: ${cachedBuildId}, New: ${serverBuildId}`
        );
        this.performReload(serverBuildId);
      } else {
        console.log(`[WebUpdateChecker] Build is up to date: ${serverBuildId}`);
      }
    } catch (error) {
      console.error("[WebUpdateChecker] Error checking for updates:", error);
    } finally {
      this._isChecking = false;
    }
  }

  /**
   * Perform the reload after updating the cached build ID.
   * @param {string} newBuildId - The new build ID to cache
   */
  performReload(newBuildId) {
    // Update cache before reloading
    this._setCachedBuildId(newBuildId);

    console.log("[WebUpdateChecker] Reloading to apply new build...");

    // Small delay to ensure log is visible and cache is saved
    setTimeout(() => {
      try {
        window.location.reload();
      } catch (error) {
        console.error("[WebUpdateChecker] Failed to reload:", error);
      }
    }, 100);
  }

  /**
   * Get the cached build ID from localStorage.
   * @returns {string|null} Cached build ID or null
   */
  _getCachedBuildId() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error("[WebUpdateChecker] Error reading from localStorage:", error);
      return null;
    }
  }

  /**
   * Set the cached build ID in localStorage.
   * @param {string} buildId - Build ID to cache
   */
  _setCachedBuildId(buildId) {
    try {
      localStorage.setItem(STORAGE_KEY, String(buildId));
    } catch (error) {
      console.error("[WebUpdateChecker] Error writing to localStorage:", error);
    }
  }

  /**
   * Cancel the update checker and clear the interval.
   */
  cancel() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      console.log("[WebUpdateChecker] Cancelled");
    }
  }
}

// Export singleton instance
export default new WebUpdateChecker();
