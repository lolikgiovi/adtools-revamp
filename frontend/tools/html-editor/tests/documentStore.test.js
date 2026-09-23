import { describe, expect, it, vi } from "vitest";
import { HtmlDocumentStore } from "../documentStore.js";

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

describe("HtmlDocumentStore migration", () => {
  it("moves the existing HTML and VTL values, then removes the legacy draft", async () => {
    const values = new Map([
      ["tool:html-template:editor", "<p>existing draft</p>"],
      ["tool:html-template:vtl-values", '{"customer":"Dewi"}'],
    ]);
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
    };
    const store = new HtmlDocumentStore(null, storage);
    store.db = readDatabase();
    store.saveWorkspaceAndDocument = vi.fn().mockResolvedValue();

    const result = await store.load("default", () => "first-id");

    expect(result.documents[0]).toMatchObject({ id: "first-id", html: "<p>existing draft</p>", vtlValues: { customer: "Dewi" } });
    expect(store.saveWorkspaceAndDocument).toHaveBeenCalledWith(result.documents[0], {
      order: ["first-id"],
      activeId: "first-id",
    });
    expect(values.has("tool:html-template:editor")).toBe(false);
    expect(values.has("tool:html-template:vtl-values")).toBe(false);
  });

  it("keeps the legacy draft if the IndexedDB write fails", async () => {
    const values = new Map([["tool:html-template:editor", "<p>keep me</p>"]]);
    const store = new HtmlDocumentStore(null, {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
    });
    store.db = readDatabase();
    store.saveWorkspaceAndDocument = vi.fn().mockRejectedValue(new Error("quota"));

    await expect(store.load("default", () => "first-id")).rejects.toThrow("quota");
    expect(values.get("tool:html-template:editor")).toBe("<p>keep me</p>");
  });

  it("restores saved tab order and the active document", async () => {
    const a = { id: "a", name: "A", html: "a" };
    const b = { id: "b", name: "B", html: "b" };
    const store = new HtmlDocumentStore();
    store.db = readDatabase([a, b], { order: ["b", "a"], activeId: "b" });

    const result = await store.load("default", () => "unused");

    expect(result.documents.map((document) => document.id)).toEqual(["b", "a"]);
    expect(result.activeId).toBe("b");
  });
});
