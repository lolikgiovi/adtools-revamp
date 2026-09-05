// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getQuickQueryTableInteractionKey, getSearchInteractionKey, RecentInteractionStore } from "../RecentInteractionStore.js";

describe("RecentInteractionStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps interacted destinations newest first and persists them", () => {
    const store = new RecentInteractionStore({ now: () => 300 });

    store.touch("tool:json-tools", 100);
    store.touch("tool:check-image", 200);
    store.touch("tool:json-tools", 300);

    expect(store.getEntries()).toEqual([
      { key: "tool:json-tools", lastInteractedAt: 300 },
      { key: "tool:check-image", lastInteractedAt: 200 },
    ]);
    expect(JSON.parse(localStorage.getItem(RecentInteractionStore.STORAGE_KEY))).toEqual(store.getEntries());
  });

  it("builds distinct keys for tools and Quick Query tables", () => {
    expect(getSearchInteractionKey({ type: "tool", route: "json-tools" })).toBe("tool:json-tools");
    expect(getQuickQueryTableInteractionKey("config.app_config")).toBe("quick-query-table:CONFIG.APP_CONFIG");
    expect(
      getSearchInteractionKey({ type: "action", route: "quick-query", data: { tableName: "config.app_config" } }),
    ).toBe("quick-query-table:CONFIG.APP_CONFIG");
  });
});
