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
    console.log("[Parse] HTML content:", htmlContent);

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Find all tables (like Python's soup.select("table.confluenceTable"))
    // Then filter out nested tables
    const allTables = doc.querySelectorAll("table");
    const lockeys = [];

    console.log(`[Parse] Found ${allTables.length} total tables`);

    // Column name variations (case-insensitive) - exact matches
    const lockeyColumnExactNames = ["localization key", "lockey", "loc key", "localizationkey", "loc_key", "localization"];

    // Partial matches - if header contains these patterns
    const lockeyColumnPatterns = ["lockey", "localization", "loc key"];

    allTables.forEach((table, tableIndex) => {
      // Skip if this table is nested inside another table's cell (it's a nested table)
      if (table.closest("td") || table.closest("th")) {
        console.log(`[Parse] Table ${tableIndex} skipped - nested in td/th`);
        return;
      }

      const headerRow = table.querySelector("tr");
      if (!headerRow) return;

      // Find the lockey column index (case-insensitive)
      // Handle colspan by tracking logical column positions
      const headerCells = Array.from(headerRow.querySelectorAll("th, td"));
      const headers = [];
      let logicalIndex = 0;

      headerCells.forEach((header) => {
        const colspan = parseInt(header.getAttribute("colspan") || "1", 10);
        const text = (header.textContent || "").trim();
        // Store the first logical index for this header
        headers.push({ text, logicalIndex, colspan });
        logicalIndex += colspan;
      });

      console.log(
        `[Parse] Table ${tableIndex} headers:`,
        headers.map((h) => h.text)
      );

      let lockeyColIndex = -1;
      let matchedHeader = "";

      // First try exact matches
      headers.forEach((header) => {
        const text = header.text.toLowerCase();
        if (lockeyColumnExactNames.includes(text)) {
          lockeyColIndex = header.logicalIndex;
          matchedHeader = header.text;
          console.log(`[Parse] Found lockey column "${text}" at index ${lockeyColIndex} (exact match)`);
        }
      });

      // If no exact match, try partial matches
      if (lockeyColIndex === -1) {
        headers.forEach((header) => {
          const text = header.text.toLowerCase();
          for (const pattern of lockeyColumnPatterns) {
            if (text.includes(pattern)) {
              lockeyColIndex = header.logicalIndex;
              matchedHeader = header.text;
              console.log(`[Parse] Found lockey column "${header.text}" at index ${lockeyColIndex} (partial match: "${pattern}")`);
              break;
            }
          }
        });
      }

      if (lockeyColIndex === -1) return;

      // Process data rows
      const rows = table.querySelectorAll(":scope > tbody > tr, :scope > tr");
      console.log(`[Parse] Table ${tableIndex} has ${rows.length} rows`);

      // Track rowspan state for each LOGICAL column (accounting for colspan in headers)
      // logicalIndex from the last header gives us the total logical column count
      const totalLogicalCols = headers.reduce((max, h) => Math.max(max, h.logicalIndex + h.colspan), 0);
      const rowspanState = new Array(totalLogicalCols).fill(0);

      rows.forEach((row, rowIndex) => {
        if (rowIndex === 0) return; // Skip header row

        const cells = row.querySelectorAll(":scope > td");

        // Build a set of logical columns that are occupied by rowspans from previous rows
        const rowspanOccupiedCols = new Set();
        for (let col = 0; col < totalLogicalCols; col++) {
          if (rowspanState[col] > 0) {
            rowspanOccupiedCols.add(col);
            rowspanState[col]--;
          }
        }

        // Map physical cells to their logical column positions, accounting for:
        // 1. Columns occupied by rowspans from previous rows
        // 2. Colspan in current row's cells
        let logicalCol = 0;
        let targetPhysicalCellIndex = -1;
        const cellLogicalPositions = []; // Track each cell's logical start column

        for (let physicalIdx = 0; physicalIdx < cells.length; physicalIdx++) {
          // Skip logical columns occupied by rowspans
          while (rowspanOccupiedCols.has(logicalCol)) {
            logicalCol++;
          }

          const cell = cells[physicalIdx];
          const colspan = parseInt(cell.getAttribute("colspan") || "1", 10);
          const rowspan = parseInt(cell.getAttribute("rowspan") || "1", 10);

          cellLogicalPositions.push({ physicalIdx, logicalStart: logicalCol, colspan });

          // Check if this cell contains or starts at the target lockey column
          if (targetPhysicalCellIndex === -1 && logicalCol <= lockeyColIndex && lockeyColIndex < logicalCol + colspan) {
            targetPhysicalCellIndex = physicalIdx;
          }

          // Update rowspan state for this cell's logical columns
          if (rowspan > 1) {
            for (let c = logicalCol; c < logicalCol + colspan && c < totalLogicalCols; c++) {
              rowspanState[c] = rowspan - 1;
            }
          }

          logicalCol += colspan;
        }

        // Debug log for complex rows
        if (rowspanOccupiedCols.size > 0 || targetPhysicalCellIndex !== -1) {
          console.log(
            `[Parse] Row ${rowIndex}: targetLogical=${lockeyColIndex}, targetPhysical=${targetPhysicalCellIndex}, rowspanCols=[${[
              ...rowspanOccupiedCols,
            ].join(",")}] (cells: ${cells.length})`
          );
        }

        // Due to rowspan/colspan in Confluence tables, column indices can shift
        // So we need to check ALL cells in the row for nested tables with matching columns
        let foundNestedTable = false;
        cells.forEach((cell, cellIndex) => {
          const nestedTable = cell.querySelector("table");
          if (nestedTable) {
            // Try to extract from this nested table
            const nestedLockeys = this.extractFromNestedTable(nestedTable, lockeyColumnExactNames);
            if (nestedLockeys.length > 0) {
              foundNestedTable = true;
              console.log(`[Parse] Row ${rowIndex} cell ${cellIndex} has nested table with ${nestedLockeys.length} lockeys`);
              nestedLockeys.forEach((lockey) => {
                lockeys.push(lockey);
                console.log(`[Parse] From nested table: ${lockey.key} (status: ${lockey.status})`);
              });
            }
          }
        });

        // If no nested tables with lockeys found, try the expected column for direct text
        if (!foundNestedTable && targetPhysicalCellIndex >= 0 && targetPhysicalCellIndex < cells.length) {
          const cell = cells[targetPhysicalCellIndex];
          let foundInRow = false;

          // First, check for ul/ol list structures and extract from nested li elements
          const lists = cell.querySelectorAll("ul, ol");
          if (lists.length > 0) {
            const listLockeys = this.extractFromListElements(cell);
            if (listLockeys.length > 0) {
              listLockeys.forEach((lockey) => {
                lockeys.push(lockey);
                console.log(`[Parse] Found key from list: ${lockey.key} (status: ${lockey.status})`);
              });
              foundInRow = true;
            }
          }

          // If no lists or no keys found from lists, try paragraphs or cell text
          if (!foundInRow) {
            const paragraphs = cell.querySelectorAll("p");
            const elements = paragraphs.length > 0 ? Array.from(paragraphs) : [cell];

            elements.forEach((element) => {
              const text = (element.textContent || "").trim();

              // Check if it's a standalone camelCase value (high confidence)
              if (this.isStandaloneCamelCase(text)) {
                const status = this.detectCellStatus(element);
                lockeys.push({ key: text, status });
                console.log(`[Parse] Found camelCase key: ${text} (status: ${status})`);
                foundInRow = true;
              } else if (text && text.length > 0) {
                // Try to extract camelCase keys from within inline statements (uncertain)
                const embeddedKeys = this.extractCamelCaseKeysFromText(text);
                embeddedKeys.forEach((key) => {
                  // Mark as 'uncertain' since extracted from inline text
                  lockeys.push({ key, status: "uncertain" });
                  console.log(`[Parse] Found embedded key: ${key} (status: uncertain)`);
                  foundInRow = true;
                });
              }
            });
          }

          // Debug: log when row has content but no lockey found
          if (!foundInRow) {
            const cellText = (cell.textContent || "").trim();
            if (cellText && cellText.length > 0 && cellText.length < 100) {
              console.log(`[Parse] Row ${rowIndex} has content but no lockey: "${cellText.substring(0, 50)}..."`);
            }
          }
        } else if (!foundNestedTable) {
          // Debug: log when we couldn't access the expected cell
          console.log(
            `[Parse] Row ${rowIndex} skipped: targetPhysical=${targetPhysicalCellIndex} (lockeyCol=${lockeyColIndex}, cells: ${cells.length})`
          );
        }
      });
    });

    console.log(`[Parse] Total lockeys found (before dedup): ${lockeys.length}`);

    // Deduplicate: if same lockey appears multiple times, prefer "plain" over "striked"
    const deduped = this.deduplicateLockeys(lockeys);
    console.log(`[Parse] Total lockeys after dedup: ${deduped.length}`);

    return deduped;
  }

  /**
   * Deduplicate lockeys, preferring higher confidence statuses
   * Priority: plain > uncertain > striked
   * @param {Array<{key: string, status: string}>} lockeys
   * @returns {Array<{key: string, status: string}>}
   */
  deduplicateLockeys(lockeys) {
    const keyMap = new Map();
    // Priority: plain (2) > uncertain (1) > striked (0)
    const statusPriority = { plain: 2, uncertain: 1, striked: 0 };

    for (const lockey of lockeys) {
      const existing = keyMap.get(lockey.key);
      if (!existing) {
        // First occurrence
        keyMap.set(lockey.key, lockey);
      } else {
        const existingPriority = statusPriority[existing.status] ?? 0;
        const newPriority = statusPriority[lockey.status] ?? 0;
        if (newPriority > existingPriority) {
          // Higher priority status found
          keyMap.set(lockey.key, lockey);
          console.log(`[Dedup] Key "${lockey.key}" upgraded from ${existing.status} to ${lockey.status}`);
        }
      }
    }

    return Array.from(keyMap.values());
  }

  /**
   * Extract ALL standalone camelCase lockey values from a nested table
   * Looks for columns: "lockey", "localization key", "value" (case-insensitive)
   * Returns only standalone camelCase values (not prefixed like "context.x.key")
   * @param {Element} nestedTable - Table element inside a cell
   * @param {string[]} columnNames - Column names to search for
   * @returns {Array<{key: string, status: string}>} Array of extracted lockey objects with status
   */
  extractFromNestedTable(nestedTable, columnNames) {
    const results = [];
    const headerRow = nestedTable.querySelector("tr");
    if (!headerRow) {
      console.log("[Nested Table] No header row found");
      return results;
    }

    // Column patterns for partial matching
    const partialPatterns = ["lockey", "localization", "loc key"];

    // Find the value column index (case-insensitive), accounting for colspan
    const headerCells = Array.from(headerRow.querySelectorAll("th, td"));
    console.log(
      "[Nested Table] Headers found:",
      headerCells.map((h) => h.textContent?.trim())
    );

    // Build headers with logical index (accounting for colspan)
    const headers = [];
    let logicalIndex = 0;
    headerCells.forEach((header) => {
      const text = (header.textContent || "").trim().toLowerCase();
      const colspan = parseInt(header.getAttribute("colspan") || "1", 10);
      headers.push({ text, logicalIndex, colspan });
      logicalIndex += colspan;
    });
    const totalLogicalCols = logicalIndex;

    let valueColIndex = -1;

    // First try exact matches
    headers.forEach((header) => {
      if (columnNames.includes(header.text)) {
        valueColIndex = header.logicalIndex;
        console.log(`[Nested Table] Found matching column "${header.text}" at logical index ${header.logicalIndex} (exact)`);
      }
    });

    // If no exact match, try partial matches
    if (valueColIndex === -1) {
      headers.forEach((header) => {
        for (const pattern of partialPatterns) {
          if (header.text.includes(pattern)) {
            valueColIndex = header.logicalIndex;
            console.log(
              `[Nested Table] Found matching column "${header.text}" at logical index ${header.logicalIndex} (partial: "${pattern}")`
            );
            break;
          }
        }
      });
    }

    if (valueColIndex === -1) {
      console.log("[Nested Table] No matching column found. Looking for:", columnNames);
      // Fallback: Check for key-value row pattern (e.g., "localizationKey" | "eKtpConfirmationNIKPlaceholder")
      // This handles tables where the first column is the key name and second column is the value
      const keyValueResults = this.extractFromKeyValueTable(nestedTable, columnNames, partialPatterns);
      if (keyValueResults.length > 0) {
        return keyValueResults;
      }
      return results;
    }

    // Get ALL data rows (not just the first one)
    const rows = nestedTable.querySelectorAll("tr");
    console.log(`[Nested Table] Found ${rows.length - 1} data rows`);

    // Track rowspan state for each logical column
    const rowspanState = new Array(totalLogicalCols).fill(0);

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll("td");

      // Build a set of logical columns occupied by rowspans from previous rows
      const rowspanOccupiedCols = new Set();
      for (let col = 0; col < totalLogicalCols; col++) {
        if (rowspanState[col] > 0) {
          rowspanOccupiedCols.add(col);
          rowspanState[col]--;
        }
      }

      // Map physical cells to logical columns, find the target cell
      let logicalCol = 0;
      let targetPhysicalCellIndex = -1;

      for (let physicalIdx = 0; physicalIdx < cells.length; physicalIdx++) {
        // Skip logical columns occupied by rowspans
        while (rowspanOccupiedCols.has(logicalCol)) {
          logicalCol++;
        }

        const cell = cells[physicalIdx];
        const colspan = parseInt(cell.getAttribute("colspan") || "1", 10);
        const rowspan = parseInt(cell.getAttribute("rowspan") || "1", 10);

        // Check if this cell contains the target logical column
        if (targetPhysicalCellIndex === -1 && logicalCol <= valueColIndex && valueColIndex < logicalCol + colspan) {
          targetPhysicalCellIndex = physicalIdx;
        }

        // Update rowspan state for this cell's logical columns
        if (rowspan > 1) {
          for (let c = logicalCol; c < logicalCol + colspan && c < totalLogicalCols; c++) {
            rowspanState[c] = rowspan - 1;
          }
        }

        logicalCol += colspan;
      }

      // Check if we can access the cell
      if (targetPhysicalCellIndex < 0 || targetPhysicalCellIndex >= cells.length) {
        console.log(
          `[Nested Table] Row ${i} skipped - targetPhysical=${targetPhysicalCellIndex} (valueCol=${valueColIndex}, cells: ${cells.length})`
        );
        continue;
      }

      const cell = cells[targetPhysicalCellIndex];
      const cellText = (cell.textContent || "").trim();
      console.log(
        `[Nested Table] Row ${i} cell text: "${cellText}" (physicalIndex: ${targetPhysicalCellIndex}, logicalCol: ${valueColIndex})`
      );

      // Check if this is a standalone camelCase value (not prefixed) - high confidence
      if (this.isStandaloneCamelCase(cellText)) {
        // Detect status from THIS cell, not the parent
        const status = this.detectCellStatus(cell);
        results.push({ key: cellText, status });
        console.log(`[Nested Table] Added key: ${cellText} (status: ${status})`);
      } else {
        // Try to extract camelCase keys from within inline statements (uncertain)
        const embeddedKeys = this.extractCamelCaseKeysFromText(cellText);
        embeddedKeys.forEach((key) => {
          results.push({ key, status: "uncertain" });
          console.log(`[Nested Table] Added embedded key: ${key} (status: uncertain)`);
        });
        if (embeddedKeys.length === 0) {
          console.log(`[Nested Table] Rejected "${cellText}" - not camelCase and no embedded keys`);
        }
      }
    }

    console.log(`[Nested Table] Total keys extracted: ${results.length}`);
    return results;
  }

  /**
   * Extract lockeys from a key-value table pattern
   * This handles tables where the first column is a key name (e.g., "localizationKey")
   * and the second column contains the value (e.g., "eKtpConfirmationNIKPlaceholder")
   * @param {Element} table - Table element
   * @param {string[]} exactNames - Exact key names to match (case-insensitive)
   * @param {string[]} partialPatterns - Partial patterns to match
   * @returns {Array<{key: string, status: string}>} Extracted lockeys with status
   */
  extractFromKeyValueTable(table, exactNames, partialPatterns) {
    const results = [];
    const rows = table.querySelectorAll("tr");

    console.log(`[Key-Value Table] Checking ${rows.length} rows for key-value pattern`);

    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll("td, th");
      if (cells.length < 2) return; // Need at least 2 cells for key-value

      const keyCell = cells[0];
      const valueCell = cells[1];
      const keyText = (keyCell.textContent || "").trim().toLowerCase();
      const valueText = (valueCell.textContent || "").trim();

      // Check if the key cell matches our lockey patterns
      let isMatch = false;

      // Check exact matches
      if (exactNames.includes(keyText)) {
        isMatch = true;
        console.log(`[Key-Value Table] Row ${rowIndex}: Found exact key match "${keyText}"`);
      }

      // Check partial matches
      if (!isMatch) {
        for (const pattern of partialPatterns) {
          if (keyText.includes(pattern)) {
            isMatch = true;
            console.log(`[Key-Value Table] Row ${rowIndex}: Found partial key match "${keyText}" (pattern: "${pattern}")`);
            break;
          }
        }
      }

      if (isMatch) {
        // Extract the value from the second column
        if (this.isStandaloneCamelCase(valueText)) {
          const status = this.detectCellStatus(valueCell);
          results.push({ key: valueText, status });
          console.log(`[Key-Value Table] Extracted key: ${valueText} (status: ${status})`);
        } else if (valueText && valueText.length > 0) {
          // Try heuristic extraction
          const embeddedKeys = this.extractCamelCaseKeysFromText(valueText);
          embeddedKeys.forEach((key) => {
            results.push({ key, status: "uncertain" });
            console.log(`[Key-Value Table] Extracted embedded key: ${key} (status: uncertain)`);
          });
        }
      }
    });

    console.log(`[Key-Value Table] Total keys extracted: ${results.length}`);
    return results;
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
   * Extract camelCase lockey keys from within inline text/statements
   * Used for cells containing conditional logic like "IF... ELSE..." with embedded lockeys
   * @param {string} text - Text that may contain embedded lockey keys
   * @returns {Array<string>} Array of extracted camelCase keys (15+ chars)
   */
  extractCamelCaseKeysFromText(text) {
    if (!text || typeof text !== "string") return [];

    // Preprocess: Add spaces to separate concatenated words
    let processedText = text;

    // 1. Handle space-separated lowercase keywords (already have spaces around them)
    //    e.g., "someKey else anotherKey" - just needs word boundary splitting
    //    This regex is safe because it requires word boundaries (spaces/start/end)
    processedText = processedText.replace(/\b(if|else|then|and|or|when|contains|feature)\b/gi, " $1 ");

    // 2. Add space before ALL-CAPS words (2+ uppercase letters) when preceded by lowercase
    //    e.g., "someLabelELSE" → "someLabel ELSE"
    //    This handles: IFsomething, ELSEanother, THENfoo, etc.
    processedText = processedText.replace(/([a-z])([A-Z]{2,})/g, "$1 $2");

    // 3. Add space after ALL-CAPS words when followed by lowercase
    //    e.g., "ELSEsomeKey" → "ELSE someKey"
    processedText = processedText.replace(/([A-Z]{2,})([a-z])/g, "$1 $2");

    // 4. Separate comparison values from camelCase patterns
    //    When there's "== X<camelCase>", the X is likely a comparison value, not part of the key
    //    e.g., "== AtestScreenLabel" → "== A testScreenLabel"
    //    e.g., "== btestScreenLabel" → "== b testScreenLabel"
    //    This handles HTML list items concatenated without whitespace
    processedText = processedText.replace(/([=<>!]=?\s*)([a-zA-Z0-9])([a-z]+[A-Z])/g, "$1$2 $3");

    // Clean up multiple spaces
    processedText = processedText.replace(/\s+/g, " ").trim();

    console.log(`[ExtractFromText] Preprocessed text: "${processedText}"`);

    // Find potential camelCase patterns:
    // - Start with lowercase letter
    // - Contain at least one uppercase letter (true camelCase)
    // - Only alphanumeric characters
    // - 15+ characters to filter out common programming keywords
    const pattern = /\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\b/g;
    const matches = [...processedText.matchAll(pattern)];

    const results = [];
    for (const match of matches) {
      const key = match[1];
      const matchIndex = match.index;

      // Must be 15+ characters to avoid false positives like forEach, getElementById
      if (key.length < 15) continue;

      // Skip if contains dots (shouldn't happen with word boundary but safety check)
      if (key.includes(".")) continue;

      // Skip if preceded by a dot (property accessor like "context.someThing")
      if (matchIndex > 0 && processedText[matchIndex - 1] === ".") {
        console.log(`[ExtractFromText] Skipping "${key}" - preceded by dot (property accessor)`);
        continue;
      }

      results.push(key);
    }

    console.log(`[ExtractFromText] Found ${results.length} potential lockeys in text:`, results);
    return results;
  }

  /**
   * Detect the status of a table cell based on styling
   * @param {Element} cell - TD element
   * @returns {string} Status: 'plain' | 'striked'
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

    return hasStrikethrough ? "striked" : "plain";
  }

  /**
   * Extract lockey keys from ul/ol list elements
   * Parses the HTML structure to find innermost li elements containing lockey keys
   * @param {Element} cell - Cell element containing lists
   * @returns {Array<{key: string, status: string}>} Extracted lockeys with status
   */
  extractFromListElements(cell) {
    const results = [];
    const lists = cell.querySelectorAll("ul, ol");

    console.log(`[List Parse] Found ${lists.length} list(s) in cell`);

    lists.forEach((list) => {
      // Skip if this list is nested inside another list (we want to start from top-level)
      if (list.parentElement.closest("ul, ol")) {
        return;
      }

      // Get all li elements in this list (including nested)
      const allLiElements = list.querySelectorAll("li");
      console.log(`[List Parse] Found ${allLiElements.length} li element(s)`);

      allLiElements.forEach((li) => {
        // Check if this li has nested ul/ol (meaning the lockey is in a child li)
        const nestedList = li.querySelector(":scope > ul, :scope > ol");

        if (nestedList) {
          // This li has nested list - the lockey is in the child li, not here
          // Skip this li, we'll process the nested li elements directly
          return;
        }

        // This is a "leaf" li - check if it contains a lockey
        // Get only the direct text content (not from nested elements)
        const directText = this.getDirectTextContent(li).trim();
        console.log(`[List Parse] Leaf li text: "${directText}"`);

        if (this.isStandaloneCamelCase(directText)) {
          // Clean standalone camelCase key - high confidence
          const status = this.detectCellStatus(li);
          results.push({ key: directText, status });
          console.log(`[List Parse] Found key: ${directText} (status: ${status})`);
        } else if (directText && directText.length > 0) {
          // Mixed text like "else lockeyKey" - needs heuristic extraction
          const embeddedKeys = this.extractCamelCaseKeysFromText(directText);
          embeddedKeys.forEach((key) => {
            results.push({ key, status: "uncertain" });
            console.log(`[List Parse] Found embedded key: ${key} (status: uncertain)`);
          });
        }
      });
    });

    console.log(`[List Parse] Total keys extracted: ${results.length}`);
    return results;
  }

  /**
   * Get direct text content of an element, excluding nested element text
   * @param {Element} element - DOM element
   * @returns {string} Direct text content only
   */
  getDirectTextContent(element) {
    let text = "";
    element.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    });
    return text;
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
   * Get style label for export
   * @param {string} status - Internal status key
   * @returns {string} Human-readable style label
   */
  getStyleLabel(status) {
    const styleLabels = {
      plain: "Plain",
      uncertain: "Uncertain",
      striked: "Striked",
    };
    return styleLabels[status] || status;
  }

  /**
   * Export comparison results as TSV
   * @param {Array<{key: string, status: string, inRemote: boolean}>} data
   * @param {string} domainName - Domain name for column header
   * @returns {string} TSV string
   */
  exportAsTsv(data, domainName = "In Remote") {
    const header = `Lockey\tConflu Style\t${domainName}`;
    const rows = data.map((row) => `${row.key}\t${this.getStyleLabel(row.status)}\t${row.inRemote ? "Yes" : "No"}`);
    return [header, ...rows].join("\n");
  }

  /**
   * Export comparison results as CSV
   * @param {Array<{key: string, status: string, inRemote: boolean}>} data
   * @param {string} domainName - Domain name for column header
   * @returns {string} CSV string
   */
  exportAsCsv(data, domainName = "In Remote") {
    const escapeCSV = (value) => {
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = `Lockey,Conflu Style,${escapeCSV(domainName)}`;
    const rows = data.map((row) => `${escapeCSV(row.key)},${escapeCSV(this.getStyleLabel(row.status))},${row.inRemote ? "Yes" : "No"}`);
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
