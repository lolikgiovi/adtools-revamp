/**
 * IndexedDB Manager for Merge SQL Tool
 * Manages persistent storage for files, results, and user edits
 */

const DB_NAME = "MergeSqlDB";
const DB_VERSION = 1;

export const STORES = {
  FILES: "files",
  STATE: "state",
  RESULTS: "results",
};

let dbInstance = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("[MergeSql] Failed to open IndexedDB:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.FILES)) {
        db.createObjectStore(STORES.FILES, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.STATE)) {
        db.createObjectStore(STORES.STATE, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORES.RESULTS)) {
        db.createObjectStore(STORES.RESULTS, { keyPath: "key" });
      }
    };
  });
}

export function isIndexedDBAvailable() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

export async function saveFiles(files) {
  if (!isIndexedDBAvailable()) return;

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.FILES, "readwrite");
    const store = tx.objectStore(STORES.FILES);

    await store.clear();

    for (const fileItem of files) {
      const arrayBuffer = await fileItem.file.arrayBuffer();
      await store.put({
        id: fileItem.id,
        name: fileItem.name,
        content: arrayBuffer,
        size: fileItem.file.size,
        lastModified: fileItem.file.lastModified,
      });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error("[MergeSql] Failed to save files:", error);
  }
}

export async function loadFiles() {
  if (!isIndexedDBAvailable()) return [];

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.FILES, "readonly");
    const store = tx.objectStore(STORES.FILES);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = request.result || [];
        const files = items.map((item) => ({
          id: item.id,
          name: item.name,
          file: new File([item.content], item.name, {
            type: "text/plain",
            lastModified: item.lastModified,
          }),
        }));
        resolve(files);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("[MergeSql] Failed to load files:", error);
    return [];
  }
}

export async function saveState(state) {
  if (!isIndexedDBAvailable()) return;

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.STATE, "readwrite");
    const store = tx.objectStore(STORES.STATE);

    await store.put({
      key: "toolState",
      sortOrder: state.sortOrder,
      folderName: state.folderName,
      currentTab: state.currentTab,
      updatedAt: Date.now(),
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error("[MergeSql] Failed to save state:", error);
  }
}

export async function loadState() {
  if (!isIndexedDBAvailable()) return null;

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.STATE, "readonly");
    const store = tx.objectStore(STORES.STATE);

    return new Promise((resolve, reject) => {
      const request = store.get("toolState");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("[MergeSql] Failed to load state:", error);
    return null;
  }
}

export async function saveResults(mergedSql, selectSql, duplicates) {
  if (!isIndexedDBAvailable()) return;

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.RESULTS, "readwrite");
    const store = tx.objectStore(STORES.RESULTS);

    await store.put({
      key: "results",
      mergedSql,
      selectSql,
      duplicates,
      updatedAt: Date.now(),
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error("[MergeSql] Failed to save results:", error);
  }
}

export async function loadResults() {
  if (!isIndexedDBAvailable()) return null;

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.RESULTS, "readonly");
    const store = tx.objectStore(STORES.RESULTS);

    return new Promise((resolve, reject) => {
      const request = store.get("results");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("[MergeSql] Failed to load results:", error);
    return null;
  }
}

export async function clearAll() {
  if (!isIndexedDBAvailable()) return;

  try {
    const db = await openDatabase();
    const tx = db.transaction([STORES.FILES, STORES.STATE, STORES.RESULTS], "readwrite");

    tx.objectStore(STORES.FILES).clear();
    tx.objectStore(STORES.STATE).clear();
    tx.objectStore(STORES.RESULTS).clear();

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error("[MergeSql] Failed to clear data:", error);
  }
}
