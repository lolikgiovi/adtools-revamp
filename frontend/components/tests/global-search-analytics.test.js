// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "../GlobalSearch.js";
import { UsageTracker } from "../../core/UsageTracker.js";

// Failure modes: duplicate opens/closes, query/table/setting text leaks, selection counted as
// tool success, stale async results attributed to the next search, or analytics breaks navigation.
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  localStorage.clear();
});
describe("command search behavior", () => {
  it("tracks shortcut open, selection and close without query or result content", () => {
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const router = { navigate: vi.fn() };
    const search = new GlobalSearch({ router });
    search.setIndex([{ id: "private-setting", name: "SECRET", route: "settings", type: "setting", data: { value: "SECRET" } }]);
    search.open("shortcut");
    search.open("shortcut");
    search.inputEl.value = "SECRET";
    search.inputEl.dispatchEvent(new Event("input"));
    search.modalEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    search.close();
    expect(spy.mock.calls.map((call) => call[1])).toEqual(["search_open", "search_select", "search_close"]);
    expect(spy.mock.calls[1][2]).toMatchObject({ target: "settings", result_type: "setting", input_method: "keyboard", query_length: 6 });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("private-setting");
    expect(router.navigate).toHaveBeenCalledWith("settings", { value: "SECRET" }, { source: "search" });
  });

  it("records an abandoned zero-result search", () => {
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const search = new GlobalSearch();
    search.open("header");
    search.inputEl.value = "unknown";
    search.inputEl.dispatchEvent(new Event("input"));
    search.modalEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(spy.mock.calls.at(-1)[2]).toMatchObject({ reason: "escape", query_length: 7, result_count: 0 });
  });

  // Searches that find nothing show what people look for. Ways it could go wrong: it reports per keystroke,
  // on a search that found something, or leaks free text that is not a plain tool or table name.
  it("reports a search abandoned with no results once, with its length but never its text", () => {
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const search = new GlobalSearch();
    search.open("header");
    for (const term of ["CUST", "CUST_ACCT", "CUST_ACCT_X"]) {
      search.inputEl.value = term;
      search.inputEl.dispatchEvent(new Event("input"));
    }
    search.close("escape");
    const empty = spy.mock.calls.filter((call) => call[1] === "no_results");
    expect(empty).toEqual([["global-search", "no_results", expect.objectContaining({ term_length: 11 })]]);
    // Table and setting names typed here are search text too, and search text never leaves the app.
    expect(JSON.stringify(spy.mock.calls)).not.toContain("CUST");
  });

  it("keeps free text out of the no-result report", () => {
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const search = new GlobalSearch();
    search.open("header");
    search.inputEl.value = "budi@bank.co.id";
    search.inputEl.dispatchEvent(new Event("input"));
    search.close("escape");
    const [[, , meta]] = spy.mock.calls.filter((call) => call[1] === "no_results");
    expect(meta.term_length).toBe(15);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("budi");
  });

  it("does not report a search that found something", () => {
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const search = new GlobalSearch();
    search.setIndex([{ id: "json-tools", name: "JSON Tools", route: "json-tools", type: "tool" }]);
    search.open("header");
    search.inputEl.value = "JSON";
    search.inputEl.dispatchEvent(new Event("input"));
    search.close("escape");
    expect(spy.mock.calls.filter((call) => call[1] === "no_results")).toEqual([]);
  });
});
