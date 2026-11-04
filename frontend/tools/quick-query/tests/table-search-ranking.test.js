// @vitest-environment node
// Failure cases: recently used tables sink below alphabetical matches; tables never used keep a
// random order instead of the storage order; recency entries for unrelated tables leak in as results.
import { describe, expect, it } from "vitest";
import { rankTableResults } from "../services/TableSearchRanking.js";

describe("Quick Query table search ranking", () => {
  const results = ["APP.A", "APP.B", "CFG.C", "CFG.D"].map((fullName) => {
    const [schemaName, tableName] = fullName.split(".");
    return { fullName, schemaName, tableName };
  });

  it("puts recently used tables first, newest first, and keeps the rest in order", () => {
    const recency = new Map([
      ["quick-query-table:CFG.D", { order: 0 }],
      ["tool:run-query", { order: 1 }],
      ["quick-query-table:APP.B", { order: 2 }],
      ["quick-query-table:OTHER.X", { order: 3 }],
    ]);
    expect(rankTableResults(results, recency).map((item) => item.fullName)).toEqual(["CFG.D", "APP.B", "APP.A", "CFG.C"]);
  });

  it("matches recency case-insensitively and leaves results untouched without recency", () => {
    expect(rankTableResults(results, new Map([["quick-query-table:CFG.C", { order: 0 }]]))[0].fullName).toBe("CFG.C");
    expect(rankTableResults([{ fullName: "app.a" }], new Map([["quick-query-table:APP.A", { order: 0 }]]))[0].fullName).toBe("app.a");
    expect(rankTableResults(results, new Map())).toEqual(results);
  });
});
