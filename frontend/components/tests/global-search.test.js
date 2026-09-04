// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "../GlobalSearch.js";

describe("GlobalSearch scopes", () => {
  it("limits prefixed searches to the requested result type", () => {
    const search = Object.create(GlobalSearch.prototype);
    search.index = [
      { id: "settings-tool", name: "Settings helper", type: "tool" },
      { id: "settings", name: "Settings", type: "page" },
    ];
    search._renderResults = vi.fn();

    search._filter("tool:settings");

    expect(search.filtered).toEqual([search.index[0]]);
  });

  it("matches tool names by Quick Query-style abbreviation", () => {
    const search = Object.create(GlobalSearch.prototype);
    search.index = [
      { id: "quick-query", name: "Quick Query", type: "tool" },
      { id: "compare-config", name: "Compare Config", type: "tool" },
    ];
    search._renderResults = vi.fn();

    search._filter("qq");

    expect(search.filtered[0]).toMatchObject({ id: "quick-query", name: "Quick Query" });

    search._filter("cc");

    expect(search.filtered[0]).toMatchObject({ id: "compare-config", name: "Compare Config" });
  });

  it("turns quick:table into a Quick Query action", () => {
    const search = Object.create(GlobalSearch.prototype);
    search.index = [];
    search._renderResults = vi.fn();

    search._filter("quick: config.app_config");

    expect(search.filtered[0]).toMatchObject({
      route: "quick-query",
      data: { tableName: "CONFIG.APP_CONFIG" },
    });
  });

  it("recommends saved Quick Query tables for a quick query", async () => {
    const search = Object.create(GlobalSearch.prototype);
    search.index = [];
    search._filterRequestId = 0;
    search.searchQuickQuery = vi.fn().mockResolvedValue([
      { fullName: "CONFIG.APP_CONFIG", schemaName: "CONFIG", tableName: "APP_CONFIG" },
      { fullName: "CONFIG.APP_SETTINGS", schemaName: "CONFIG", tableName: "APP_SETTINGS" },
    ]);
    search.resultsEl = { innerHTML: "" };
    search.inputEl = { removeAttribute: vi.fn(), setAttribute: vi.fn() };
    search._renderResults = vi.fn();

    await search._filter("qq:c.appc");

    expect(search.searchQuickQuery).toHaveBeenCalledWith("c.appc");
    expect(search.filtered).toMatchObject([
      {
        name: "CONFIG.APP_CONFIG",
        route: "quick-query",
        data: { tableName: "CONFIG.APP_CONFIG" },
      },
      {
        name: "CONFIG.APP_SETTINGS",
        route: "quick-query",
        data: { tableName: "CONFIG.APP_SETTINGS" },
      },
    ]);
  });

  it("does not render stale Quick Query results after the query changes", async () => {
    const search = Object.create(GlobalSearch.prototype);
    search.index = [];
    search._filterRequestId = 0;
    search.resultsEl = { innerHTML: "" };
    search.inputEl = { removeAttribute: vi.fn(), setAttribute: vi.fn() };
    search._renderResults = vi.fn();

    let resolveFirst;
    search.searchQuickQuery = vi.fn((term) =>
      term === "first"
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve([{ fullName: "CONFIG.SECOND", schemaName: "CONFIG", tableName: "SECOND" }]),
    );

    const first = search._filter("quick:first");
    const second = search._filter("quick:second");
    await second;
    resolveFirst([{ fullName: "CONFIG.FIRST", schemaName: "CONFIG", tableName: "FIRST" }]);
    await first;

    expect(search.filtered[0].name).toBe("CONFIG.SECOND");
  });
});
