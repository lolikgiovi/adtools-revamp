const DB_VERSION = 1;
const DOCUMENTS = "documents";
const WORKSPACE = "workspace";
const WORKSPACE_ID = "default";

function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

function requested(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

export class TemplateDocumentStore {
  constructor(databaseApi = globalThis.indexedDB, storage = globalThis.localStorage, options = {}) {
    this.dbName = options.dbName || "VelocityTemplateDocuments";
    this.legacyTemplateKey = options.legacyTemplateKey || "tool:velocity-template:editor";
    this.legacyContextKey = options.legacyContextKey || "tool:velocity-template:context";
    this.databaseApi = databaseApi;
    this.storage = storage;
    this.db = null;
  }

  async open() {
    if (!this.databaseApi) throw new Error("IndexedDB is unavailable");
    const request = this.databaseApi.open(this.dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS)) db.createObjectStore(DOCUMENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(WORKSPACE)) db.createObjectStore(WORKSPACE, { keyPath: "id" });
    };
    this.db = await requested(request);
    this.db.onversionchange = () => {
      this.db.close();
      this.db = null;
    };
  }

  async load(defaultTemplate, defaultContext, createId) {
    const transaction = this.db.transaction([DOCUMENTS, WORKSPACE], "readonly");
    const done = completed(transaction);
    const [documents, workspace] = await Promise.all([
      requested(transaction.objectStore(DOCUMENTS).getAll()),
      requested(transaction.objectStore(WORKSPACE).get(WORKSPACE_ID)),
    ]);
    await done;
    if (documents.length) {
      const ordered = (workspace?.order || []).map((id) => documents.find((document) => document.id === id)).filter(Boolean);
      const remaining = documents.filter((document) => !ordered.some((item) => item.id === document.id));
      const tabs = [...ordered, ...remaining];
      return { documents: tabs, activeId: tabs.some((tab) => tab.id === workspace?.activeId) ? workspace.activeId : tabs[0].id };
    }

    let template = defaultTemplate;
    let context = defaultContext;
    let migrated = false;
    try {
      const legacyTemplate = this.storage?.getItem(this.legacyTemplateKey);
      const legacyContext = this.storage?.getItem(this.legacyContextKey);
      if (legacyTemplate !== null && legacyTemplate !== undefined) {
        template = legacyTemplate;
        migrated = true;
      }
      if (legacyContext !== null && legacyContext !== undefined) {
        context = legacyContext;
        migrated = true;
      }
    } catch (_) {
      // Storage access failures fall back to the bundled starter document.
    }
    const now = Date.now();
    const first = { id: createId(), name: "Untitled 1", template, context, createdAt: now, updatedAt: now };
    await this.saveWorkspaceAndDocument(first, { order: [first.id], activeId: first.id });
    if (migrated) {
      try {
        this.storage?.removeItem(this.legacyTemplateKey);
        this.storage?.removeItem(this.legacyContextKey);
      } catch (_) {
        // The IndexedDB copy is committed, so stale legacy values are harmless.
      }
    }
    return { documents: [first], activeId: first.id };
  }

  async saveDocument(document) {
    const transaction = this.db.transaction(DOCUMENTS, "readwrite");
    transaction.objectStore(DOCUMENTS).put(document);
    await completed(transaction);
  }

  async saveWorkspace(order, activeId) {
    const transaction = this.db.transaction(WORKSPACE, "readwrite");
    transaction.objectStore(WORKSPACE).put({ id: WORKSPACE_ID, order, activeId });
    await completed(transaction);
  }

  async saveWorkspaceAndDocument(document, { order, activeId }) {
    const transaction = this.db.transaction([DOCUMENTS, WORKSPACE], "readwrite");
    transaction.objectStore(DOCUMENTS).put(document);
    transaction.objectStore(WORKSPACE).put({ id: WORKSPACE_ID, order, activeId });
    await completed(transaction);
  }

  async updateDocuments({ deleteIds = [], documents = [], order, activeId }) {
    const transaction = this.db.transaction([DOCUMENTS, WORKSPACE], "readwrite");
    const documentStore = transaction.objectStore(DOCUMENTS);
    deleteIds.forEach((id) => documentStore.delete(id));
    documents.forEach((document) => documentStore.put(document));
    transaction.objectStore(WORKSPACE).put({ id: WORKSPACE_ID, order, activeId });
    await completed(transaction);
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}
