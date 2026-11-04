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

// Empty searches and failures: what people look for and don't find, and which lookups break.
// Ways it could go wrong: every typing pause of an empty query reports (overcount); content searches leak the
// typed text; restored filters report; a failed Confluence page or an all-failed bulk search records nothing.
describe("Master Lockey empty searches and failures", () => {
  let events;
  let failures;

  beforeEach(() => {
    events = [];
    failures = [];
    UsageTracker.trackEvent.mockImplementation((id, event, meta) => events.push({ event, ...meta }));
    vi.spyOn(UsageTracker, "trackFailure").mockImplementation((id, action, error) => failures.push(`${id}:${action}`));
  });

  it("reports a settled key search with no results once, with the key", () => {
    for (const query of ["home.tit", "home.titel"]) {
      search(query, 0);
      vi.advanceTimersByTime(800);
    }
    vi.advanceTimersByTime(1500);
    search("home.titel", 0);
    vi.advanceTimersByTime(1500);
    expect(events.filter((item) => item.event === "search_empty")).toEqual([{ event: "search_empty", mode: "key", term: "home.titel" }]);
    expect(uses).toEqual([]);
  });

  it("reports only the length of an empty content search", () => {
    tool.els.searchMode.value = "content";
    search("Nomor rekening 1234", 0);
    vi.advanceTimersByTime(1500);
    expect(events.filter((item) => item.event === "search_empty")).toEqual([{ event: "search_empty", mode: "content", term_length: 19 }]);
    expect(JSON.stringify(events)).not.toContain("rekening");
  });

  it("does not report a restored filter with no results", () => {
    tool.els.searchInput.value = "restored";
    tool.filteredRows = [];
    vi.advanceTimersByTime(5000);
    expect(events.filter((item) => item.event === "search_empty")).toEqual([]);
  });

  it("records a failed Confluence page fetch", async () => {
    Object.assign(tool, {
      els: {
        ...tool.els,
        confluencePageInput: { value: "12345" },
        btnFetchConfluence: { classList: { add() {}, remove() {} }, querySelector: () => ({ style: {} }), disabled: false },
        confluenceResults: { style: {} },
      },
      service: { fetchConfluencePage: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status: 401 })) },
      hideConfluenceError: vi.fn(),
      showConfluenceError: vi.fn(),
    });
    await tool.fetchFromConfluence();
    expect(failures).toEqual(["master-lockey:confluence_search"]);
  });
});
