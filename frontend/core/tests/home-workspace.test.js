// @vitest-environment jsdom
// Failure cases:
// - Recent Quick Query tables never reach Home, so repeat work starts from an empty table field.
// - A recent table opens Quick Query without the table, or shows when Quick Query is hidden.
// - Table names render as HTML.
// - Suggestions recommend the least-used tools overall instead of what peers rely on.
// - Suggestions repeat tools the user already uses, or break when team usage is unavailable.
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeWorkspace } from "../../components/HomeWorkspace.js";
import { RecentInteractionStore } from "../RecentInteractionStore.js";

const tools = ["velocity-template", "qr-tools", "quick-query", "run-query", "sql-in-clause", "base64-tools", "json-tools"].map(
  (id) => ({ id, name: id, icon: id }),
);

function storeWith(entries) {
  const storage = new Map([[RecentInteractionStore.STORAGE_KEY, JSON.stringify(entries)]]);
  return new RecentInteractionStore({
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
}

function mount(options = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const handlers = { onOpen: vi.fn(), onOpenTable: vi.fn(), onSearch: vi.fn() };
  const home = new HomeWorkspace(container, {
    tools,
    pinnedIds: new Set(),
    getIcon: () => "",
    usageScope: { tools: [{ id: "quick-query", count: 900 }] },
    recentStore: storeWith([]),
    ...handlers,
    ...options,
  });
  return { home, container, ...handlers };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Home recent tables", () => {
  it("lists the most recent Quick Query tables and opens them in Quick Query", () => {
    const now = Date.now();
    const { container, onOpenTable } = mount({
      recentStore: storeWith([
        { key: "quick-query-table:EXP_REFERENCE.LIST_OF_VALUE", lastInteractedAt: now },
        { key: "tool:run-query", lastInteractedAt: now - 1 },
        { key: "quick-query-table:CONFIG.<B>APP</B>", lastInteractedAt: now - 2 },
        ...[1, 2, 3, 4].map((n) => ({ key: `quick-query-table:APP.T${n}`, lastInteractedAt: now - 10 - n })),
      ]),
    });
    const rows = [...container.querySelectorAll("[data-home-table]")];
    expect(rows.map((row) => row.dataset.homeTable)).toEqual(["EXP_REFERENCE.LIST_OF_VALUE", "CONFIG.<B>APP</B>", "APP.T1", "APP.T2"]);
    expect(container.querySelector("b")).toBeNull();
    rows[0].click();
    expect(onOpenTable).toHaveBeenCalledWith("EXP_REFERENCE.LIST_OF_VALUE");
  });

  it("hides recent tables when there are none or Quick Query is not available", () => {
    expect(mount().container.querySelector(".home-recent-tables")).toBeNull();
    const { container } = mount({
      tools: tools.filter((tool) => tool.id !== "quick-query"),
      recentStore: storeWith([{ key: "quick-query-table:APP.ITEM", lastInteractedAt: Date.now() }]),
    });
    expect(container.querySelector(".home-recent-tables")).toBeNull();
  });
});

describe("Home tool suggestions", () => {
  const suggestions = (container) => [...container.querySelectorAll(".home-tip")].map((tip) => tip.dataset.homeTool);

  it("suggests the tools peers use most that this user has not tried", () => {
    const { container } = mount({
      usageScope: { tools: [{ id: "quick-query", count: 900 }, { id: "json-tools", count: 3 }] },
      peerScope: {
        tools: [
          { id: "quick-query", count: 19000 },
          { id: "run-query", count: 13000 },
          { id: "sql-in-clause", count: 3400 },
          { id: "json-tools", count: 2200 },
          { id: "base64-tools", count: 900 },
          { id: "velocity-template", count: 2 },
        ],
      },
    });
    expect(suggestions(container)).toEqual(["run-query", "sql-in-clause", "base64-tools"]);
  });

  it("falls back to the user's least-used tools without team usage", () => {
    const { container } = mount({ usageScope: { tools: [{ id: "quick-query", count: 900 }] } });
    expect(suggestions(container)).toHaveLength(3);
    expect(suggestions(container)).not.toContain("quick-query");
  });
});
