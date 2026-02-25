// Node v25+ ships a built-in localStorage that lacks Web Storage API methods
// (clear, getItem, setItem, etc.), which conflicts with jsdom's implementation.
// This polyfill ensures a spec-compliant localStorage is available for tests.
if (typeof localStorage !== "undefined" && typeof localStorage.clear !== "function") {
  const store = {};
  globalThis.localStorage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    },
    get length() {
      return Object.keys(store).length;
    },
    key(index) {
      return Object.keys(store)[index] ?? null;
    },
  };
}
