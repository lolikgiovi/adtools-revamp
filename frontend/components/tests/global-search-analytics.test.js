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
    expect(router.navigate).toHaveBeenCalledWith("settings", { value: "SECRET" });
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
});
