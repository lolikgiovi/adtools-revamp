const DB_NAME = "HtmlTemplateDocuments";
const DB_VERSION = 1;
const DOCUMENTS = "documents";
const WORKSPACE = "workspace";
const WORKSPACE_ID = "default";
const LEGACY_HTML_KEY = "tool:html-template:editor";
const LEGACY_VTL_KEY = "tool:html-template:vtl-values";

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

export class HtmlDocumentStore {
  constructor(databaseApi = globalThis.indexedDB, storage = globalThis.localStorage) {
    this.databaseApi = databaseApi;
    this.storage = storage;
    this.db = null;
  }

  async open() {
    if (!this.databaseApi) throw new Error("IndexedDB is unavailable");
    const request = this.databaseApi.open(DB_NAME, DB_VERSION);
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

  async load(defaultHtml, createId) {
    const transaction = this.db.transaction([DOCUMENTS, WORKSPACE], "readonly");
    const done = completed(transaction);
    const documentsRequest = transaction.objectStore(DOCUMENTS).getAll();
    const workspaceRequest = transaction.objectStore(WORKSPACE).get(WORKSPACE_ID);
    const [documents, workspace] = await Promise.all([requested(documentsRequest), requested(workspaceRequest)]);
    await done;
    if (documents.length) {
      const ordered = (workspace?.order || []).map((id) => documents.find((document) => document.id === id)).filter(Boolean);
      const remaining = documents.filter((document) => !ordered.some((item) => item.id === document.id));
      const tabs = [...ordered, ...remaining];
      return { documents: tabs, activeId: tabs.some((tab) => tab.id === workspace?.activeId) ? workspace.activeId : tabs[0].id };
    }

    let html = defaultHtml;
    let vtlValues = {};
    let migrated = false;
    try {
      const legacyHtml = this.storage?.getItem(LEGACY_HTML_KEY);
      if (legacyHtml !== null && legacyHtml !== undefined) {
        html = legacyHtml;
        migrated = true;
      }
      const legacyVtl = this.storage?.getItem(LEGACY_VTL_KEY);
      if (legacyVtl) {
        const parsed = JSON.parse(legacyVtl);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) vtlValues = parsed;
        migrated = true;
      }
    } catch (_) {
      // A malformed legacy VTL value must not block the HTML draft migration.
    }
    const now = Date.now();
    const first = { id: createId(), name: "Untitled 1", html, vtlValues, createdAt: now, updatedAt: now };
    await this.saveWorkspaceAndDocument(first, { order: [first.id], activeId: first.id });
    if (migrated) {
      try {
        this.storage?.removeItem(LEGACY_HTML_KEY);
        this.storage?.removeItem(LEGACY_VTL_KEY);
      } catch (_) {
        // The IndexedDB copy is already committed, so keep using it.
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
