const DB_NAME = "TicketTemplateCreateDatabase";
const DB_VERSION = 1;
const STORE_NAME = "featureTemplates";

export class TicketTemplateStorage {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(new Error(`Unable to open ticket template storage: ${request.error?.message || "unknown error"}`));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("name", "name", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
    });
    return this.initPromise;
  }

  async list() {
    await this.init();
    const records = await this.request("readonly", (store) => store.getAll());
    return records.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  }

  async get(id) {
    await this.init();
    return (await this.request("readonly", (store) => store.get(id))) || null;
  }

  async save(template) {
    await this.init();
    const now = new Date().toISOString();
    const record = {
      ...template,
      id: template.id || this.createId(),
      version: 1,
      createdAt: template.createdAt || now,
      updatedAt: now,
    };
    await this.transaction("readwrite", (store) => store.put(record));
    return record;
  }

  async delete(id) {
    await this.init();
    await this.transaction("readwrite", (store) => store.delete(id));
  }

  async duplicate(id) {
    const source = await this.get(id);
    if (!source) throw new Error("Template not found.");
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...copy } = source;
    return this.save({ ...copy, name: `${source.name} Copy` });
  }

  request(mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  transaction(mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_NAME, mode);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
      operation(transaction.objectStore(STORE_NAME));
    });
  }

  createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `ticket-template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
