import { describe, expect, it, vi } from "vitest";
import { VelocityDocumentStore } from "../documentStore.js";

function readDatabase(documents = [], workspace = undefined) {
  return {
    transaction() {
      const transaction = {
        objectStore(name) {
          return {
            getAll() {
              const request = {};
              queueMicrotask(() => {
                request.result = documents;
                request.onsuccess?.();
              });
              return request;
            },
            get() {
              const request = {};
              queueMicrotask(() => {
                request.result = name === "workspace" ? workspace : undefined;
                request.onsuccess?.();
              });
              return request;
            },
          };
        },
      };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    },
  };
}

describe("VelocityDocumentStore", () => {
  it("migrates the existing template and context into the first tab", async () => {
    const values = new Map([
      ["tool:velocity-template:editor", "Hello $name"],
      ["tool:velocity-template:context", '{"name":"Maya"}'],
    ]);
    const store = new VelocityDocumentStore(null, {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
    });
    store.db = readDatabase();
    store.saveWorkspaceAndDocument = vi.fn().mockResolvedValue();

    const result = await store.load("default", "{}", () => "first-id");

    expect(result.documents[0]).toMatchObject({ id: "first-id", template: "Hello $name", context: '{"name":"Maya"}' });
    expect(values.has("tool:velocity-template:editor")).toBe(false);
    expect(values.has("tool:velocity-template:context")).toBe(false);
  });

  it("restores tab order and the active tab without storing a rendered result", async () => {
    const a = { id: "a", name: "A", template: "a", context: "{}" };
    const b = { id: "b", name: "B", template: "b", context: "{}" };
    const store = new VelocityDocumentStore();
    store.db = readDatabase([a, b], { order: ["b", "a"], activeId: "b" });

    const result = await store.load("default", "{}", () => "unused");

    expect(result.documents.map((document) => document.id)).toEqual(["b", "a"]);
    expect(result.activeId).toBe("b");
    expect(result.documents.every((document) => !("result" in document))).toBe(true);
  });
});
