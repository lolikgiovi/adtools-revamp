// Feature-owned storage. Every write resolves only after the IDB transaction commits.
export class MonitoringDraftStore {
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("MonitoringQueryDatabase", 1);
      request.onupgradeneeded = () => {
        for (const name of ["drafts", "packages"])
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name, { keyPath: "key" });
          }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Local draft storage unavailable. Your work is retained in memory."));
    });
    this.db.onversionchange = () => {
      this.db.close();
      this.db = null;
    };
    return this.db;
  }
  async transaction(store, mode, callback) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = callback(tx.objectStore(store));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(new Error("Local storage write failed. Keep this window open to preserve your work."));
      tx.onabort = tx.onerror;
    });
  }
  put(value, store = "drafts") {
    return this.transaction(store, "readwrite", (objectStore) => objectStore.put(value));
  }
  remove(key) {
    return this.transaction("drafts", "readwrite", (objectStore) => objectStore.delete(key));
  }
  async latest(targetKey) {
    const all = await this.transaction("drafts", "readonly", (store) => store.getAll());
    return all.filter((item) => item.targetKey === targetKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
  }
  close() {
    this.db?.close();
    this.db = null;
  }
}
