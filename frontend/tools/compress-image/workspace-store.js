let database;
let writes = Promise.resolve();
function open() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("adtools-compress-image", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("workspace");
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = null;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        database = null;
        reject(request.error);
      };
      request.onblocked = () => {
        database = null;
        reject(new Error("Image cache is blocked by another window."));
      };
    });
  }
  return database;
}
export async function loadWorkspace() {
  await writes;
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("workspace").objectStore("workspace").get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function saveWorkspace(snapshot) {
  const write = writes
    .catch(() => {})
    .then(async () => {
      const db = await open();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("workspace", "readwrite");
        transaction.objectStore("workspace").put(snapshot, "current");
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Image cache write failed."));
      });
    });
  writes = write;
  return write;
}
