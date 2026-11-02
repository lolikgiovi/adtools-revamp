import { initialWorkspace, validateWorkspace } from "./workspace.js";

function requested(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Workspace save failed"));
  });
}

/** Serialized, revision-checked saves keep a second window from overwriting local edits. */
export class PlantUmlStore {
  constructor() {
    this.revision = 0;
    this.queue = Promise.resolve();
    this.failed = false;
  }

  async load() {
    const request = indexedDB.open("adtools-plantuml", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspaces", { keyPath: "id" });
    this.db = await requested(request);
    this.db.onversionchange = () => this.db.close();
    const record = await requested(this.db.transaction("workspaces").objectStore("workspaces").get("local"));
    this.revision = record?.revision || 0;
    return record ? validateWorkspace(record.workspace) : initialWorkspace();
  }

  save(workspace) {
    const snapshot = structuredClone(workspace);
    this.queue = this.queue.then(async () => {
      if (this.failed) throw new Error("Export your workspace, then reload to resume saving.");
      const transaction = this.db.transaction("workspaces", "readwrite");
      const done = completed(transaction);
      const store = transaction.objectStore("workspaces");
      // Keep the read and conditional write in one transaction.
      store.get("local").onsuccess = (event) => {
        if ((event.target.result?.revision || 0) !== this.revision) {
          transaction.abort();
          return;
        }
        store.put({ id: "local", revision: this.revision + 1, workspace: snapshot });
      };
      try {
        await done;
        this.revision++;
      } catch (error) {
        this.failed = true;
        throw new Error("Workspace could not be saved or changed in another window. Export your work, then reload.", { cause: error });
      }
    });
    return this.queue;
  }

  async close() {
    await this.queue.catch(() => {});
    this.db?.close();
  }
}
