/**
 * Master Lockey Service
 * Handles data fetching, parsing, and filtering for localization keys
 */

class MasterLockeyService {
  /**
   * Fetch lockey data from a URL using Tauri backend (bypasses CORS)
   * @param {string} url - URL to fetch from
   * @returns {Promise<Object>} Fetched JSON data
   */
  async fetchLockeyData(url) {
    try {
      // Use Tauri's invoke to fetch via Rust backend (no CORS restrictions)
      const { invoke } = await import("@tauri-apps/api/core");
      const data = await invoke("fetch_lockey_json", { url });
      return data;
    } catch (error) {
      // Handle Tauri invoke errors
      if (typeof error === "string") {
        throw new Error(error);
      } else if (error.message) {
        throw new Error(error.message);
      }
      throw new Error("Failed to fetch lockey data");
    }
  }

  /**
   * Parse lockey JSON into table-friendly format with dynamic language detection
   * @param {Object} json - Raw JSON data
   * @returns {Object} Parsed data { languagePackId, languages, rows }
   */
  parseLockeyData(json) {
    if (!json || typeof json !== "object") {
      throw new Error("Invalid JSON structure: Expected an object");
    }

    if (!json.content || typeof json.content !== "object") {
      throw new Error('Invalid JSON structure: Missing "content" property');
    }

    const { content, languagePackId } = json;

    // Extract language codes (all keys except non-language properties)
    const languages = Object.keys(content).filter((key) => typeof content[key] === "object" && content[key] !== null);

    if (languages.length === 0) {
      throw new Error("Invalid JSON structure: No language data found in content");
    }

    // Get all unique localization keys from the first language
    const firstLang = languages[0];
    const lockeyKeys = Object.keys(content[firstLang] || {});

    // Reformat content to be key-centric for easier processing
    const keyCentricData = {};
    lockeyKeys.forEach((key) => {
      keyCentricData[key] = {};
      languages.forEach((lang) => {
        keyCentricData[key][lang] = content[lang][key];
      });
    });

    // Transform data into rows with key + language values
    const rows = Object.entries(keyCentricData).map(([key, translations]) => {
      const row = { key };

      languages.forEach((lang) => {
        const value = translations[lang];

        // Debug logging for first few rows
        if (Object.keys(keyCentricData).indexOf(key) < 3) {
          console.log(`Key: ${key}, Lang: ${lang}, Value:`, value, `Type: ${typeof value}, Length: ${value?.length}`);
        }

        // Transform null/undefined/empty values to searchable placeholders
        if (value === null || value === undefined) {
          row[lang] = "json raw value is null";
        } else if (typeof value === "string") {
          if (value === "") {
            // Empty string
            row[lang] = 'json raw value is ""';
          } else if (value.trim() === "") {
            // Whitespace only (spaces, tabs, etc.) - has length but trims to empty
            row[lang] = `json raw value is "${value}"`;
          } else {
            // Normal string value
            row[lang] = value;
          }
        } else {
          row[lang] = value;
        }
      });

      return row;
    });

    // Sort rows alphabetically by key (ascending)
    rows.sort((a, b) => a.key.localeCompare(b.key));

    return {
      languagePackId: languagePackId || "N/A",
      languages,
      rows,
    };
  }

  /**
   * Filter data by key search (comma-separated keys)
   * @param {Array} rows - Array of row objects
   * @param {string} keysString - Comma-separated keys to search for
   * @param {boolean} wholeWord - Match whole words only
   * @returns {Array} Filtered rows
   */
  filterByKeys(rows, keysString, wholeWord = false) {
    if (!keysString || keysString.trim() === "") {
      return rows;
    }

    // Split by comma, trim whitespace, and filter out empty strings
    const searchKeys = keysString
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0);

    if (searchKeys.length === 0) {
      return rows;
    }

    return rows.filter((row) => {
      const rowKey = (row.key || "").toLowerCase();

      // Match if any search key is found in the row key
      return searchKeys.some((searchKey) => {
        if (wholeWord) {
          // Match whole word only using word boundaries
          const regex = new RegExp(`\\b${searchKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
          return regex.test(rowKey);
        } else {
          // Partial match
          return rowKey.includes(searchKey);
        }
      });
    });
  }

  /**
   * Filter data by content search across all or specific language
   * @param {Array} rows - Array of row objects
   * @param {Array} languages - Array of language codes to search in
   * @param {string} query - Search query
   * @param {boolean} wholeWord - Match whole words only
   * @param {string} [specificLang] - Optional specific language to search in
   * @returns {Array} Filtered rows
   */
  filterByContent(rows, languages, query, wholeWord = false, specificLang = null) {
    if (!query || query.trim() === "") {
      return rows;
    }

    const searchQuery = query.trim();
    const langsToSearch = specificLang ? [specificLang] : languages;

    return rows.filter((row) => {
      // Search across specified languages
      return langsToSearch.some((lang) => {
        const content = row[lang] || "";

        if (wholeWord) {
          // Match whole word only using word boundaries
          const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(`\\b${escapedQuery}\\b`, "i");
          return regex.test(content);
        } else {
          // Partial match (case-insensitive)
          return content.toLowerCase().includes(searchQuery.toLowerCase());
        }
      });
    });
  }

  /**
   * Main filter orchestrator
   * @param {Array} rows - Array of row objects
   * @param {Object} searchConfig - { mode: 'key'|'content', query: string, languages: [] }
   * @returns {Array} Filtered rows
   */
  filterData(rows, searchConfig) {
    const { mode, query, languages } = searchConfig;

    if (mode === "key") {
      return this.filterByKeys(rows, query);
    } else if (mode === "content") {
      return this.filterByContent(rows, query, languages);
    }

    return rows;
  }

  /**
   * Format timestamp to human-readable string
   * @param {number} timestamp - Unix timestamp
   * @returns {string} Formatted date string
   */
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

export { MasterLockeyService };
