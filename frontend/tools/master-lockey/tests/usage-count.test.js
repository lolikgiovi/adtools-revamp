// Master Lockey counts one Tool Use per search the user lands on, per Confluence page fetch, and per bulk search.
// Ways it could go wrong: every typing pause of the live filter counts (overcount); copying results counts again
// (overcount); restoring cached data or a search with no results counts (overcount); a search the user only
// reads, or copies before it settles, never counts (undercount); a new query after the first never counts (undercount).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { MasterLockey } from "../main.js";

let uses;
let tool;

beforeEach(() => {
  vi.useFakeTimers();
  uses = [];
  vi.spyOn(UsageTracker, "trackToolUse").mockImplementation((id, action) => uses.push(`${id}:${action}`));
  vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
  tool = Object.assign(Object.create(MasterLockey.prototype), {
    els: { searchInput: { value: "" }, searchMode: { value: "key" } },
    parsedData: { languages: ["en"], rows: [] },
    filteredRows: [],
    showSuccess: vi.fn(),
    showError: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function search(query, results = 3) {
  tool.els.searchInput.value = query;
  tool.filteredRows = Array.from({ length: results }, (_, i) => ({ key: `${query}.${i}`, en: "x" }));
  tool.scheduleSearchUse();
}

describe("Master Lockey usage counting", () => {
  it("counts a live search once when the user lands on it, not per typing pause", () => {
    for (const query of ["a", "ab", "abc"]) {
      search(query);
      vi.advanceTimersByTime(800);
    }
    vi.advanceTimersByTime(1500);
    search("abc");
    vi.advanceTimersByTime(1500);
    expect(uses).toEqual(["master-lockey:search"]);
  });

  it("counts each new query and a query typed again after clearing", () => {
    search("home.title");
    vi.advanceTimersByTime(1500);
    search("login.title");
    vi.advanceTimersByTime(1500);
    search("", 0);
    vi.advanceTimersByTime(1500);
    search("login.title");
    vi.advanceTimersByTime(1500);
    expect(uses).toEqual(["master-lockey:search", "master-lockey:search", "master-lockey:search"]);
  });

  it("does not count searches without results or filters the user did not type", () => {
    search("missing", 0);
    vi.advanceTimersByTime(1500);
    tool.els.searchInput.value = "restored";
    tool.filteredRows = [{ key: "restored.key" }];
    vi.advanceTimersByTime(5000);
    expect(uses).toEqual([]);
  });

  it("counts a copy as the search it came from, never as a second use", async () => {
    search("home.title");
    await tool.copySearchResults(true);
    vi.advanceTimersByTime(1500);
    await tool.copySearchResults(false);
    expect(uses).toEqual(["master-lockey:search"]);
  });

  it("does not count copies of Confluence or bulk results", async () => {
    tool.confluenceResults = [{ key: "a" }];
    tool.hiddenKeys = [];
    tool.copyLockeyColumn();
    tool.bulkConfluenceResults = [{ pageTitle: "P", lockeys: [{ key: "a" }] }];
    await Promise.resolve();
    await Promise.resolve();
    expect(uses).toEqual([]);
  });
});
