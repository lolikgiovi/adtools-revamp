/**
 * Feature Flags for Compare Config
 *
 * Manages feature toggles for gradual rollout of new functionality.
 * Flags can be overridden via localStorage for testing.
 */

/**
 * Default feature flag values
 */
const DEFAULT_FLAGS = {
  // Use JavaScript diff engine for character-level diff enhancement
  // When true: Rust fetches data + does comparison, JS enhances with char-level diff
  // When false: Pure Rust comparison (current behavior)
  ENHANCE_DIFF_WITH_JS: true,

  // Debug mode: log comparison details to console
  DIFF_DEBUG_MODE: false,

  // Future: Use JS for full comparison (requires Rust data-fetch-only command)
  // USE_JS_DIFF_ENGINE: false,
};

/**
 * LocalStorage key prefix for flag overrides
 */
const FLAG_STORAGE_PREFIX = 'compare-config:flag:';

/**
 * Get a feature flag value
 * @param {string} flagName - Flag name (e.g., 'ENHANCE_DIFF_WITH_JS')
 * @returns {boolean} Flag value
 */
export function getFeatureFlag(flagName) {
  // Check localStorage override first
  try {
    const override = localStorage.getItem(`${FLAG_STORAGE_PREFIX}${flagName}`);
    if (override !== null) {
      return override === 'true';
    }
  } catch (e) {
    // localStorage not available (e.g., in tests)
  }

  // Return default value
  return DEFAULT_FLAGS[flagName] ?? false;
}

/**
 * Set a feature flag override (persisted to localStorage)
 * @param {string} flagName - Flag name
 * @param {boolean} value - Flag value
 */
export function setFeatureFlag(flagName, value) {
  try {
    localStorage.setItem(`${FLAG_STORAGE_PREFIX}${flagName}`, String(value));
  } catch (e) {
    console.warn('Could not save feature flag to localStorage:', e);
  }
}

/**
 * Clear a feature flag override (revert to default)
 * @param {string} flagName - Flag name
 */
export function clearFeatureFlag(flagName) {
  try {
    localStorage.removeItem(`${FLAG_STORAGE_PREFIX}${flagName}`);
  } catch (e) {
    // Ignore
  }
}

/**
 * Get all feature flags with their current values
 * @returns {Object} All flags and values
 */
export function getAllFeatureFlags() {
  const flags = {};
  for (const [name, defaultValue] of Object.entries(DEFAULT_FLAGS)) {
    flags[name] = {
      value: getFeatureFlag(name),
      default: defaultValue,
      overridden: localStorage.getItem(`${FLAG_STORAGE_PREFIX}${name}`) !== null
    };
  }
  return flags;
}

/**
 * Reset all feature flag overrides to defaults
 */
export function resetAllFeatureFlags() {
  for (const name of Object.keys(DEFAULT_FLAGS)) {
    clearFeatureFlag(name);
  }
}

// Export flag names as constants for type safety
export const FLAGS = {
  ENHANCE_DIFF_WITH_JS: 'ENHANCE_DIFF_WITH_JS',
  DIFF_DEBUG_MODE: 'DIFF_DEBUG_MODE',
  // USE_JS_DIFF_ENGINE: 'USE_JS_DIFF_ENGINE',
};

export default {
  getFeatureFlag,
  setFeatureFlag,
  clearFeatureFlag,
  getAllFeatureFlags,
  resetAllFeatureFlags,
  FLAGS
};
