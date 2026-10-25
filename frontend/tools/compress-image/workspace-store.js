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
  await writes.catch(() => {});
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("workspace").objectStore("workspace").get("current");
    request.onsuccess = () => void hydrateWorkspace(request.result).then(resolve, reject);
    request.onerror = () => reject(request.error);
  });
}
export function saveWorkspace(snapshot) {
  const write = writes
    .catch(() => {})
    .then(async () => {
      const packed = await packWorkspace(snapshot);
      const db = await open();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("workspace", "readwrite");
        transaction.objectStore("workspace").put(packed, "current");
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Image cache write failed."));
      });
    });
  writes = write;
  return write;
}

// Persist bytes instead of browser-managed Blob backing files. Hydration creates
// memory-backed objects before the tool builds preview URLs or rewrites the cache.
async function packWorkspace(snapshot) {
  const blobs = new WeakMap();
  const pack = (blob) => {
    if (!blob) return undefined;
    if (!blobs.has(blob)) {
      blobs.set(
        blob,
        blob.arrayBuffer().then((bytes) => ({ bytes, type: blob.type, name: blob.name, lastModified: blob.lastModified })),
      );
    }
    return blobs.get(blob);
  };
  const items = await Promise.all(
    (snapshot.items || []).map(async (item) => {
      const fileTask = pack(item.file);
      const blobTask = pack(item.blob);
      const variantTask = Promise.all(
        Object.entries(item.variants || {}).map(async ([name, variant]) => [name, { ...variant, blob: await pack(variant.blob) }]),
      );
      const [file, blob, variants] = await Promise.all([fileTask, blobTask, variantTask]);
      return { ...item, file, blob, variants: Object.fromEntries(variants) };
    }),
  );
  return { ...snapshot, byteStorageVersion: 1, items };
}

async function hydrateWorkspace(snapshot) {
  if (!snapshot) return snapshot;
  // Read legacy Blob records completely while handling the IndexedDB response;
  // never carry their backing-file references into the mounted workspace.
  const packed = snapshot.byteStorageVersion === 1 ? snapshot : await packWorkspace(snapshot);
  const blobs = new WeakMap();
  const hydrate = (record, file = false) => {
    if (!record) return undefined;
    if (!blobs.has(record)) {
      blobs.set(
        record,
        file
          ? new File([record.bytes], record.name || "image", { type: record.type, lastModified: record.lastModified })
          : new Blob([record.bytes], { type: record.type }),
      );
    }
    return blobs.get(record);
  };
  const { byteStorageVersion: _version, ...data } = packed;
  return {
    ...data,
    items: packed.items.map((item) => ({
      ...item,
      file: hydrate(item.file, true),
      blob: hydrate(item.blob),
      variants: Object.fromEntries(
        Object.entries(item.variants || {}).map(([name, variant]) => [name, { ...variant, blob: hydrate(variant.blob) }]),
      ),
    })),
  };
}
