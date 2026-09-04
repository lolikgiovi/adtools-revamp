// @vitest-environment node
import { describe, expect, it } from "vitest";
import { collapseSearchName, getSearchAbbreviations, scoreFuzzyTerm } from "../FuzzySearch.js";

describe("FuzzySearch", () => {
  it("ranks an exact display-name abbreviation above a subsequence", () => {
    const abbreviations = getSearchAbbreviations("Quick Query");

    expect(abbreviations).toContain("qq");
    expect(scoreFuzzyTerm("qq", { name: "Quick Query", abbrs: abbreviations, collapsed: collapseSearchName("Quick Query") })).toBe(100);
    expect(scoreFuzzyTerm("qury", { name: "Quick Query", abbrs: abbreviations, collapsed: collapseSearchName("Quick Query") })).toBe(60);
  });

  it("supports collapsed names and common config abbreviations", () => {
    const abbreviations = getSearchAbbreviations("Config Tools");

    expect(
      scoreFuzzyTerm("configtools", { name: "Config Tools", abbrs: abbreviations, collapsed: collapseSearchName("Config Tools") }),
    ).toBe(80);
    expect(abbreviations).toContain("cfg");
  });
});
