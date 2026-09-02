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
});
