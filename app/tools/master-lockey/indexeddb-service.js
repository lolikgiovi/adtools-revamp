/**
 * IndexedDB Service for Master Lockey
 * Handles caching of localization data
 */

const DB_NAME = 'MasterLockeyDB';
const DB_VERSION = 1;
const STORE_NAME = 'lockeyCache';

class IndexedDBService {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize the IndexedDB database
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'domain' });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * Save lockey data to IndexedDB
   * @param {string} domain - Domain identifier
   * @param {Object} data - Lockey data to cache
   * @returns {Promise<void>}
   */
  async saveLockeyData(domain, data) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const cacheEntry = {
        domain,
        data,
        timestamp: Date.now(),
      };

      const request = store.put(cacheEntry);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieve lockey data from IndexedDB
   * @param {string} domain - Domain identifier
   * @returns {Promise<Object|null>} Cached data or null if not found
   */
  async getLockeyData(domain) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.get(domain);
      
      request.onsuccess = () => {
        const result = request.result;
        resolve(result || null);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get cache information for a domain
   * @param {string} domain - Domain identifier
   * @returns {Promise<Object|null>} Cache info { timestamp, size } or null
   */
  async getCacheInfo(domain) {
    const cached = await this.getLockeyData(domain);
    
    if (!cached) return null;
    
    return {
      timestamp: cached.timestamp,
      size: JSON.stringify(cached.data).length,
    };
  }

  /**
   * Clear cache for specific domain or all domains
   * @param {string} [domain] - Domain identifier, or undefined to clear all
   * @returns {Promise<void>}
   */
  async clearCache(domain) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      let request;
      if (domain) {
        request = store.delete(domain);
      } else {
        request = store.clear();
      }
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all cached domains
   * @returns {Promise<string[]>} Array of domain identifiers
   */
  async getAllDomains() {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.getAllKeys();
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }
}

export { IndexedDBService };
