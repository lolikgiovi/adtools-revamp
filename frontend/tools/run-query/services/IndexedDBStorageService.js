import { UsageTracker } from "../../../core/UsageTracker.js";

const DB_NAME = "RunQueryDatabase";
const DB_VERSION = 1;
const TEMPLATES_STORE = "templates";
const HISTORY_STORE = "history";
const SETTINGS_STORE = "settings";

const LEGACY_TEMPLATES_KEY = "tool:run-query:templates";
const LEGACY_HISTORY_KEY = "tool:run-query:history";
const LEGACY_ENV_KEY = "tool:run-query:env";
const LEGACY_STATE_KEY = "tool:run-query:lastState";

export class IndexedDBStorageService {
  constructor() {
    this.db = null;
    this._initPromise = null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._openDatabase()
      .then(() => this._migrateFromLocalStorage())
      .catch((error) => {
        console.error("[RunQuery] Failed to initialize IndexedDB:", error);
        UsageTracker.trackEvent("run-query", "storage_error", {
          type: "indexeddb_init_failed",
          message: error.message,
        });
        throw error;
      });

    return this._initPromise;
  }

  _openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(TEMPLATES_STORE)) {
          const templatesStore = db.createObjectStore(TEMPLATES_STORE, { keyPath: "name" });
          templatesStore.createIndex("createdAt", "createdAt", { unique: false });
        }

        if (!db.objectStoreNames.contains(HISTORY_STORE)) {
          const historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: "id", autoIncrement: true });
          historyStore.createIndex("timestamp", "timestamp", { unique: false });
        }

        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
        }
      };
    });
  }

  async _migrateFromLocalStorage() {
    try {
      const legacyTemplates = localStorage.getItem(LEGACY_TEMPLATES_KEY);
      const legacyHistory = localStorage.getItem(LEGACY_HISTORY_KEY);
      const legacyEnv = localStorage.getItem(LEGACY_ENV_KEY);
      const legacyState = localStorage.getItem(LEGACY_STATE_KEY);

      if (!legacyTemplates && !legacyHistory && !legacyEnv && !legacyState) {
        return;
      }

      console.log("[RunQuery] Starting migration from localStorage...");
      let migratedCount = 0;

      if (legacyTemplates) {
        try {
          const templates = JSON.parse(legacyTemplates);
          if (Array.isArray(templates)) {
            for (const tpl of templates) {
              if (tpl?.name) {
                await this._putRecord(TEMPLATES_STORE, {
                  ...tpl,
                  createdAt: tpl.createdAt || new Date().toISOString(),
                });
                migratedCount++;
              }
            }
          }
        } catch (e) {
          console.warn("[RunQuery] Failed to parse legacy templates:", e);
        }
      }

      if (legacyHistory) {
        try {
          const history = JSON.parse(legacyHistory);
          if (Array.isArray(history)) {
            for (const entry of history) {
              if (entry) {
                await this._putRecord(HISTORY_STORE, {
                  ...entry,
                  timestamp: entry.timestamp || new Date().toISOString(),
                });
                migratedCount++;
              }
            }
          }
        } catch (e) {
          console.warn("[RunQuery] Failed to parse legacy history:", e);
        }
      }

      if (legacyEnv) {
        await this._putRecord(SETTINGS_STORE, { key: "env", value: legacyEnv });
        migratedCount++;
      }

      if (legacyState) {
        try {
          const state = JSON.parse(legacyState);
          await this._putRecord(SETTINGS_STORE, { key: "lastState", value: state });
          migratedCount++;
        } catch (e) {
          console.warn("[RunQuery] Failed to parse legacy state:", e);
        }
      }

      if (migratedCount > 0) {
        localStorage.removeItem(LEGACY_TEMPLATES_KEY);
        localStorage.removeItem(LEGACY_HISTORY_KEY);
        localStorage.removeItem(LEGACY_ENV_KEY);
        localStorage.removeItem(LEGACY_STATE_KEY);
        console.log(`[RunQuery] Successfully migrated ${migratedCount} items.`);
        UsageTracker.trackEvent("run-query", "storage_migration", {
          count: migratedCount,
          success: true,
        });
      }
    } catch (error) {
      console.error("[RunQuery] Migration failed:", error);
      UsageTracker.trackEvent("run-query", "storage_error", {
        type: "migration_failed",
        message: error.message,
      });
    }
  }

  _putRecord(storeName, record) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));

      const store = tx.objectStore(storeName);
      store.put(record);
    });
  }

  _getRecord(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  _deleteRecord(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));

      const store = tx.objectStore(storeName);
      store.delete(key);
    });
  }

  _getAllRecords(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async loadTemplates() {
    try {
      return await this._getAllRecords(TEMPLATES_STORE);
    } catch (_) {
      return [];
    }
  }

  async saveTemplate(template) {
    if (!template?.name) return false;
    try {
      await this._putRecord(TEMPLATES_STORE, {
        ...template,
        createdAt: template.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async deleteTemplate(name) {
    try {
      await this._deleteRecord(TEMPLATES_STORE, name);
      return true;
    } catch (_) {
      return false;
    }
  }

  async findTemplateByName(name) {
    try {
      return await this._getRecord(TEMPLATES_STORE, name);
    } catch (_) {
      return null;
    }
  }

  async loadHistory() {
    try {
      const records = await this._getAllRecords(HISTORY_STORE);
      return records.map((r) => {
        const { id, ...rest } = r;
        return { _id: id, ...rest };
      });
    } catch (_) {
      return [];
    }
  }

  async addHistoryEntry(entry) {
    try {
      await this._putRecord(HISTORY_STORE, {
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString(),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async deleteHistoryEntry(id) {
    try {
      await this._deleteRecord(HISTORY_STORE, id);
      return true;
    } catch (_) {
      return false;
    }
  }

  async clearHistory() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(HISTORY_STORE, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));

      const store = tx.objectStore(HISTORY_STORE);
      store.clear();
    });
  }

  async getSetting(key) {
    try {
      const record = await this._getRecord(SETTINGS_STORE, key);
      return record?.value ?? null;
    } catch (_) {
      return null;
    }
  }

  async setSetting(key, value) {
    try {
      await this._putRecord(SETTINGS_STORE, { key, value });
      return true;
    } catch (_) {
      return false;
    }
  }

  async getLastState() {
    return await this.getSetting("lastState") || {};
  }

  async saveLastState(partialState) {
    const current = await this.getLastState();
    const merged = { ...current, ...partialState };
    return await this.setSetting("lastState", merged);
  }

  async getEnv() {
    return await this.getSetting("env") || "";
  }

  async setEnv(env) {
    return await this.setSetting("env", env);
  }
}
