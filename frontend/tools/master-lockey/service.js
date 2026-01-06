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
      return this.filterByContent(rows, languages, query);
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

  // =====================
  // Confluence Integration
  // =====================

  /**
   * Check if Confluence PAT is stored in keychain
   * @returns {Promise<boolean>}
   */
  async hasConfluencePat() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("has_confluence_pat");
    } catch (_) {
      return false;
    }
  }

  /**
   * Fetch Confluence page content
   * @param {string} pageIdOrUrl - Page ID or full Confluence URL
   * @returns {Promise<{id: string, title: string, html: string}>} Page content with id, title, and html
   */
  async fetchConfluencePage(pageIdOrUrl) {
    const { invoke } = await import("@tauri-apps/api/core");

    // Get settings from localStorage
    const domain = localStorage.getItem("config.confluence.domain");
    const username = localStorage.getItem("config.confluence.username");

    if (!domain) {
      throw new Error("Confluence domain not configured. Go to Settings → Confluence Integration.");
    }
    if (!username) {
      throw new Error("Confluence username not configured. Go to Settings → Confluence Integration.");
    }

    // Check for display URL format first
    const displayInfo = this.parseDisplayUrl(pageIdOrUrl);

    if (displayInfo) {
      // Use direct lookup by space key and title (like Python PoC)
      console.log(`[Confluence] Fetching by space="${displayInfo.space}" title="${displayInfo.title}"`);
      try {
        return await invoke("confluence_fetch_by_space_title", {
          domain,
          spaceKey: displayInfo.space,
          title: displayInfo.title,
          username,
        });
      } catch (error) {
        if (typeof error === "string") throw new Error(error);
        throw new Error(error.message || "Failed to fetch Confluence page");
      }
    }

    // Extract page ID from URL if necessary
    const pageId = this.extractPageId(pageIdOrUrl);
    if (!pageId) {
      throw new Error(
        "Invalid page URL or ID. Supported formats:\n• Page ID (e.g., 12345)\n• URL with pageId parameter\n• Display URL: /display/SPACE/PageTitle"
      );
    }

    try {
      // Returns { id, title, html }
      return await invoke("confluence_fetch_page", { domain, pageId, username });
    } catch (error) {
      if (typeof error === "string") throw new Error(error);
      throw new Error(error.message || "Failed to fetch Confluence page");
    }
  }

  /**
   * Parse /display/SPACE/PageTitle URL format
   * @param {string} input - URL to parse
   * @returns {{space: string, title: string}|null} Parsed info or null
   */
  parseDisplayUrl(input) {
    if (!input || typeof input !== "string") return null;

    try {
      const url = new URL(input.trim());
      const path = url.pathname;

      // Match /display/SPACE/PageTitle pattern
      const displayMatch = path.match(/\/display\/([^/]+)\/(.+)/);
      if (displayMatch) {
        const space = decodeURIComponent(displayMatch[1]);
        // Page titles in URLs use + for spaces
        const title = decodeURIComponent(displayMatch[2].replace(/\+/g, " "));
        return { space, title };
      }
    } catch (_) {
      // Not a valid URL
    }

    return null;
  }

  /**
   * Extract page ID from URL or return as-is if already an ID
   * @param {string} input - Page URL or ID
   * @returns {string|null} Page ID or null if invalid
   */
  extractPageId(input) {
    if (!input || typeof input !== "string") return null;

    const trimmed = input.trim();

    // If it's just digits, assume it's a page ID
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }

    // Try to extract from URL patterns:
    // https://confluence.example.com/pages/viewpage.action?pageId=12345
    // https://confluence.example.com/display/SPACE/PageTitle (need to handle differently)
    // https://confluence.example.com/x/AbCd (short link)

    try {
      const url = new URL(trimmed);
      const pageIdParam = url.searchParams.get("pageId");
      if (pageIdParam) return pageIdParam;

      // For short links /x/xxxxx, the ID is base64 encoded - not supported for now
      // For display links, we'd need to search - not supported for now
    } catch (_) {
      // Not a valid URL
    }

    return null;
  }

  /**
   * Parse Confluence HTML content to extract lockeys from tables
   * @param {string} htmlContent - HTML content from Confluence page
   * @returns {Array<{key: string, status: string}>} Extracted lockeys with status
   */
  parseConfluenceTableForLockeys(htmlContent) {
    if (!htmlContent) return [];

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Find all tables (like Python's soup.select("table.confluenceTable"))
    // Then filter out nested tables
    const allTables = doc.querySelectorAll("table");
    const lockeys = [];

    console.log(`[Parse] Found ${allTables.length} total tables`);

    // Column name variations (case-insensitive)
    const lockeyColumnNames = ["localization key", "lockey", "loc key", "localizationkey", "loc_key"];

    allTables.forEach((table, tableIndex) => {
      // Skip if this table is nested inside another table's cell (it's a nested table)
      if (table.closest("td") || table.closest("th")) {
        console.log(`[Parse] Table ${tableIndex} skipped - nested in td/th`);
        return;
      }

      const headerRow = table.querySelector("tr");
      if (!headerRow) return;

      // Find the lockey column index (case-insensitive)
      const headers = Array.from(headerRow.querySelectorAll("th, td"));
      console.log(
        `[Parse] Table ${tableIndex} headers:`,
        headers.map((h) => h.textContent?.trim())
      );

      let lockeyColIndex = -1;

      headers.forEach((header, index) => {
        const text = (header.textContent || "").trim().toLowerCase();
        if (lockeyColumnNames.includes(text)) {
          lockeyColIndex = index;
          console.log(`[Parse] Found lockey column "${text}" at index ${index}`);
        }
      });

      if (lockeyColIndex === -1) return;

      // Process data rows
      const rows = table.querySelectorAll(":scope > tbody > tr, :scope > tr");
      console.log(`[Parse] Table ${tableIndex} has ${rows.length} rows`);

      rows.forEach((row, rowIndex) => {
        if (rowIndex === 0) return; // Skip header row

        const cells = row.querySelectorAll(":scope > td");
        if (cells.length <= lockeyColIndex) return;

        const cell = cells[lockeyColIndex];

        // Check if cell contains a nested table
        const nestedTable = cell.querySelector("table");

        if (nestedTable) {
          // Extract lockeys from nested table's "Localization Key" column
          console.log(`[Parse] Row ${rowIndex} has nested table, extracting lockeys...`);
          const nestedLockeys = this.extractFromNestedTable(nestedTable, lockeyColumnNames);
          nestedLockeys.forEach((key) => {
            const status = this.detectCellStatus(cell);
            lockeys.push({ key, status });
            console.log(`[Parse] From nested table: ${key} (status: ${status})`);
          });
        } else {
          // Extract lockeys from paragraphs or cell text
          const paragraphs = cell.querySelectorAll("p");
          const elements = paragraphs.length > 0 ? Array.from(paragraphs) : [cell];

          elements.forEach((element) => {
            const text = (element.textContent || "").trim();

            // Check if it's a standalone camelCase value
            if (this.isStandaloneCamelCase(text)) {
              const status = this.detectCellStatus(element);
              lockeys.push({ key: text, status });
              console.log(`[Parse] Found camelCase key: ${text} (status: ${status})`);
            }
          });
        }
      });
    });

    console.log(`[Parse] Total lockeys found: ${lockeys.length}`);
    return lockeys;
  }

  /**
   * Extract ALL standalone camelCase lockey values from a nested table
   * Looks for columns: "lockey", "localization key", "value" (case-insensitive)
   * Returns only standalone camelCase values (not prefixed like "context.x.key")
   * @param {Element} nestedTable - Table element inside a cell
   * @param {string[]} columnNames - Column names to search for
   * @returns {string[]} Array of extracted lockey keys
   */
  extractFromNestedTable(nestedTable, columnNames) {
    const keys = [];
    const headerRow = nestedTable.querySelector("tr");
    if (!headerRow) {
      console.log("[Nested Table] No header row found");
      return keys;
    }

    // Find the value column index (case-insensitive)
    const headers = Array.from(headerRow.querySelectorAll("th, td"));
    console.log(
      "[Nested Table] Headers found:",
      headers.map((h) => h.textContent?.trim())
    );

    let valueColIndex = -1;

    headers.forEach((header, index) => {
      const text = (header.textContent || "").trim().toLowerCase();
      if (columnNames.includes(text)) {
        valueColIndex = index;
        console.log(`[Nested Table] Found matching column "${text}" at index ${index}`);
      }
    });

    if (valueColIndex === -1) {
      console.log("[Nested Table] No matching column found. Looking for:", columnNames);
      return keys;
    }

    // Get ALL data rows (not just the first one)
    const rows = nestedTable.querySelectorAll("tr");
    console.log(`[Nested Table] Found ${rows.length - 1} data rows`);

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll("td");
      if (cells.length <= valueColIndex) continue;

      const cellText = (cells[valueColIndex].textContent || "").trim();
      console.log(`[Nested Table] Row ${i} cell text: "${cellText}"`);

      // Check if this is a standalone camelCase value (not prefixed)
      if (this.isStandaloneCamelCase(cellText)) {
        keys.push(cellText);
        console.log(`[Nested Table] Added key: ${cellText}`);
      } else {
        console.log(`[Nested Table] Rejected "${cellText}" - not camelCase`);
      }
    }

    console.log(`[Nested Table] Total keys extracted: ${keys.length}`);
    return keys;
  }

  /**
   * Check if a value is a standalone camelCase identifier
   * Rejects values with dot prefixes like "context.x.key" or "prefix.value"
   * @param {string} value - Value to check
   * @returns {boolean} True if standalone camelCase
   */
  isStandaloneCamelCase(value) {
    if (!value || typeof value !== "string") return false;

    // Reject if contains dots (like "context.x.key" or "prefix.value")
    if (value.includes(".")) return false;

    // Basic check: starts with lowercase letter, contains only valid identifier chars
    // camelCase pattern: starts with lowercase, can have uppercase letters
    const camelCasePattern = /^[a-z][a-zA-Z0-9]*$/;
    return camelCasePattern.test(value);
  }

  /**
   * Detect the status of a table cell based on styling
   * @param {Element} cell - TD element
   * @returns {string} Status: 'plain' | 'new' | 'removed' | 'removed-new'
   */
  detectCellStatus(cell) {
    const html = cell.innerHTML;
    const style = cell.getAttribute("style") || "";

    // Check for strikethrough
    const hasStrikethrough =
      cell.querySelector("del, s, strike") !== null ||
      style.includes("line-through") ||
      html.includes("text-decoration: line-through") ||
      html.includes("text-decoration:line-through");

    // Check for color (non-black/default color indicates new)
    const hasColor = this.detectNonDefaultColor(cell);

    if (hasStrikethrough && hasColor) return "removed-new";
    if (hasStrikethrough) return "removed";
    if (hasColor) return "new";
    return "plain";
  }

  /**
   * Detect if cell has non-default (non-black) text color
   * @param {Element} cell - TD element
   * @returns {boolean}
   */
  detectNonDefaultColor(cell) {
    // Check for color on spans, fonts, or inline styles
    const colorElements = cell.querySelectorAll("[style*='color'], [color], font[color]");
    if (colorElements.length > 0) return true;

    // Check inline style on the cell itself
    const style = cell.getAttribute("style") || "";
    if (style.includes("color:") || style.includes("color :")) {
      // Exclude black variants
      const colorMatch = style.match(/color\s*:\s*([^;]+)/i);
      if (colorMatch) {
        const colorValue = colorMatch[1].toLowerCase().trim();
        if (colorValue !== "black" && colorValue !== "#000" && colorValue !== "#000000" && colorValue !== "rgb(0, 0, 0)") {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Compare lockeys from Confluence with remote lockey.json data
   * @param {Array<{key: string, status: string}>} confluenceLockeys
   * @param {Object} remoteData - Parsed remote lockey data with rows
   * @returns {Array<{key: string, status: string, inRemote: boolean}>}
   */
  compareLockeyWithRemote(confluenceLockeys, remoteData) {
    if (!remoteData || !remoteData.rows) return confluenceLockeys.map((l) => ({ ...l, inRemote: false }));

    const remoteKeys = new Set(remoteData.rows.map((r) => r.key));

    return confluenceLockeys.map((lockey) => ({
      ...lockey,
      inRemote: remoteKeys.has(lockey.key),
    }));
  }

  /**
   * Export comparison results as TSV
   * @param {Array<{key: string, status: string, inRemote: boolean}>} data
   * @returns {string} TSV string
   */
  exportAsTsv(data) {
    const header = "Lockey\tStatus\tIn Remote";
    const rows = data.map((row) => `${row.key}\t${row.status}\t${row.inRemote ? "Yes" : "No"}`);
    return [header, ...rows].join("\n");
  }

  /**
   * Export comparison results as CSV
   * @param {Array<{key: string, status: string, inRemote: boolean}>} data
   * @returns {string} CSV string
   */
  exportAsCsv(data) {
    const escapeCSV = (value) => {
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = "Lockey,Status,In Remote";
    const rows = data.map((row) => `${escapeCSV(row.key)},${escapeCSV(row.status)},${row.inRemote ? "Yes" : "No"}`);
    return [header, ...rows].join("\n");
  }

  // =====================
  // IndexedDB Cache for Confluence Pages
  // =====================

  /**
   * Initialize IndexedDB for Confluence page cache
   * @returns {Promise<IDBDatabase>}
   */
  async initConfluenceDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("MasterLockeyConfluence", 1);

      request.onerror = () => reject(new Error("Failed to open IndexedDB"));

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("confluencePages")) {
          const store = db.createObjectStore("confluencePages", { keyPath: "pageId" });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
    });
  }

  /**
   * Save parsed Confluence page to cache
   * @param {string} pageId - Confluence page ID
   * @param {string} title - Page title (formatted)
   * @param {Array} lockeys - Parsed lockeys with status and inRemote
   * @param {string[]} hiddenKeys - Keys hidden by user (optional, preserves existing if not provided)
   * @returns {Promise<void>}
   */
  async saveConfluenceCache(pageId, title, lockeys, hiddenKeys = null) {
    const db = await this.initConfluenceDB();

    // If hiddenKeys not provided, try to preserve existing ones
    let existingHiddenKeys = [];
    if (hiddenKeys === null) {
      try {
        const existing = await this.loadConfluenceCache(pageId);
        if (existing && existing.hiddenKeys) {
          existingHiddenKeys = existing.hiddenKeys;
        }
      } catch (_) {
        // No existing cache, use empty array
      }
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction("confluencePages", "readwrite");
      const store = tx.objectStore("confluencePages");

      const data = {
        pageId,
        title,
        lockeys,
        hiddenKeys: hiddenKeys !== null ? hiddenKeys : existingHiddenKeys,
        timestamp: Date.now(),
      };

      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("Failed to save cache"));

      tx.oncomplete = () => db.close();
    });
  }

  /**
   * Load cached Confluence page by ID
   * @param {string} pageId - Confluence page ID
   * @returns {Promise<Object|null>} Cached data or null
   */
  async loadConfluenceCache(pageId) {
    const db = await this.initConfluenceDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction("confluencePages", "readonly");
      const store = tx.objectStore("confluencePages");
      const request = store.get(pageId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error("Failed to load cache"));

      tx.oncomplete = () => db.close();
    });
  }

  /**
   * Load all cached Confluence pages (for dropdown)
   * @returns {Promise<Array<{pageId, title, timestamp}>>}
   */
  async loadAllCachedPages() {
    const db = await this.initConfluenceDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction("confluencePages", "readonly");
      const store = tx.objectStore("confluencePages");
      const request = store.getAll();

      request.onsuccess = () => {
        const pages = (request.result || []).map(({ pageId, title, timestamp }) => ({
          pageId,
          title,
          timestamp,
        }));
        // Sort by timestamp descending (most recent first)
        pages.sort((a, b) => b.timestamp - a.timestamp);
        resolve(pages);
      };
      request.onerror = () => reject(new Error("Failed to load cached pages"));

      tx.oncomplete = () => db.close();
    });
  }

  /**
   * Delete cached Confluence page
   * @param {string} pageId - Confluence page ID
   * @returns {Promise<void>}
   */
  async deleteConfluenceCache(pageId) {
    const db = await this.initConfluenceDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction("confluencePages", "readwrite");
      const store = tx.objectStore("confluencePages");
      const request = store.delete(pageId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("Failed to delete cache"));

      tx.oncomplete = () => db.close();
    });
  }

  /**
   * Hide a key for a specific page
   * @param {string} pageId - Confluence page ID
   * @param {string} key - Lockey key to hide
   * @returns {Promise<void>}
   */
  async hideKey(pageId, key) {
    const cached = await this.loadConfluenceCache(pageId);
    if (!cached) throw new Error("Page not found in cache");

    const hiddenKeys = cached.hiddenKeys || [];
    if (!hiddenKeys.includes(key)) {
      hiddenKeys.push(key);
    }

    await this.saveConfluenceCache(pageId, cached.title, cached.lockeys, hiddenKeys);
  }

  /**
   * Unhide a key for a specific page
   * @param {string} pageId - Confluence page ID
   * @param {string} key - Lockey key to unhide
   * @returns {Promise<void>}
   */
  async unhideKey(pageId, key) {
    const cached = await this.loadConfluenceCache(pageId);
    if (!cached) throw new Error("Page not found in cache");

    const hiddenKeys = (cached.hiddenKeys || []).filter((k) => k !== key);
    await this.saveConfluenceCache(pageId, cached.title, cached.lockeys, hiddenKeys);
  }

  /**
   * Format Confluence page title
   * Transforms "Rxx - Mobile Screen - User Settings Screen" → "Rxx - User Settings Screen"
   * @param {string} title - Original page title
   * @returns {string} Formatted title
   */
  formatPageTitle(title) {
    if (!title) return title;
    // Remove " - Mobile Screen" segment (case-insensitive)
    return title
      .replace(/ - Mobile Screen -/i, " -")
      .replace(/ - Mobile Screen$/i, "")
      .trim();
  }
}

export { MasterLockeyService };
