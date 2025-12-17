/**
 * Master Lockey Service
 * Handles data fetching, parsing, and filtering for localization keys
 */

class MasterLockeyService {
  /**
   * Fetch lockey data from a URL
   * @param {string} url - URL to fetch from
   * @returns {Promise<Object>} Fetched JSON data
   */
  async fetchLockeyData(url) {
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to the server. Check your internet connection.');
      }
      throw error;
    }
  }

  /**
   * Parse lockey JSON into table-friendly format with dynamic language detection
   * @param {Object} json - Raw JSON data
   * @returns {Object} Parsed data { languagePackId, languages, rows }
   */
  parseLockeyData(json) {
    if (!json || typeof json !== 'object') {
      throw new Error('Invalid JSON structure: Expected an object');
    }

    if (!json.content || typeof json.content !== 'object') {
      throw new Error('Invalid JSON structure: Missing "content" property');
    }

    const { content, languagePackId } = json;

    // Extract language codes (all keys except non-language properties)
    const languages = Object.keys(content).filter(key => 
      typeof content[key] === 'object' && content[key] !== null
    );

    if (languages.length === 0) {
      throw new Error('Invalid JSON structure: No language data found in content');
    }

    // Get all unique localization keys from the first language
    const firstLang = languages[0];
    const lockeyKeys = Object.keys(content[firstLang] || {});

    // Build rows: { key, [lang1]: "...", [lang2]: "...", ... }
    const rows = lockeyKeys.map(key => {
      const row = { key };
      
      languages.forEach(lang => {
        row[lang] = content[lang][key] || '';
      });
      
      return row;
    });

    return {
      languagePackId: languagePackId || 'N/A',
      languages,
      rows,
    };
  }

  /**
   * Filter data by comma-separated key names
   * @param {Array} rows - Array of row objects
   * @param {string} keysString - Comma-separated key names
   * @returns {Array} Filtered rows
   */
  filterByKeys(rows, keysString) {
    if (!keysString || keysString.trim() === '') {
      return rows;
    }

    // Split by comma, trim whitespace, and filter out empty strings
    const searchKeys = keysString
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);

    if (searchKeys.length === 0) {
      return rows;
    }

    return rows.filter(row => {
      const rowKey = (row.key || '').toLowerCase();
      
      // Match if any search key is found in the row key (partial match)
      return searchKeys.some(searchKey => rowKey.includes(searchKey));
    });
  }

  /**
   * Filter data by content search across all or specific language
   * @param {Array} rows - Array of row objects
   * @param {string} query - Search query
   * @param {Array} languages - Array of language codes to search in
   * @param {string} [specificLang] - Optional specific language to search in
   * @returns {Array} Filtered rows
   */
  filterByContent(rows, query, languages, specificLang = null) {
    if (!query || query.trim() === '') {
      return rows;
    }

    const searchQuery = query.toLowerCase();
    const langsToSearch = specificLang ? [specificLang] : languages;

    return rows.filter(row => {
      // Search across specified languages
      return langsToSearch.some(lang => {
        const content = (row[lang] || '').toLowerCase();
        return content.includes(searchQuery);
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

    if (mode === 'key') {
      return this.filterByKeys(rows, query);
    } else if (mode === 'content') {
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

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

export { MasterLockeyService };
