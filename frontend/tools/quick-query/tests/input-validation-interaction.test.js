// Failure cases: untouched required cells interrupt entry; selection alone reports an error;
// range selection visits every cell; edits/pastes hide missing values; row moves target wrong cells;
// explicit NULL is suppressed; Generate becomes incomplete; or state leaks across datasets/tabs.
import { describe, expect, it } from "vitest";
import { InputValidationInteraction } from "../services/InputValidationInteraction.js";
import { collectInputIssues } from "../services/InputValidationService.js";

const schemaData = [
  ["ID", "NUMBER", "No"],
  ["NAME", "VARCHAR2(3)", "No"],
];
const inputData = [
  ["ID", "NAME"],
  ["1", ""],
];
const collect = (state, data = inputData, extra = {}) =>
  collectInputIssues({
    schemaData,
    inputData: data,
    queryType: "insert",
    reportMissing: (row, col) => state.shouldReportMissing(row, col),
    ...extra,
  });

describe("input validation interaction timing", () => {
  it("keeps untouched cells quiet until the user leaves the cell or row", () => {
    const state = new InputValidationInteraction();
    state.select(1, 0, 1, 0);
    state.commit([[1, 0, "", "1"]], "edit");
    state.select(1, 1, 1, 1);
    expect(collect(state).issues).toEqual([]);
    state.select(1, 0, 1, 0);
    expect(collect(state).issues[0]).toMatchObject({ row: 1, col: 1, type: "null_not_allowed" });
  });

  it("checks a partially completed row on departure but ignores entirely blank rows", () => {
    const state = new InputValidationInteraction();
    state.select(1, 0, 1, 0);
    state.select(2, 0, 2, 0);
    expect(collect(state).issues).toHaveLength(1);
    expect(
      collect(state, [
        ["ID", "NAME"],
        ["", ""],
      ]).issues,
    ).toEqual([]);
  });

  it("does not visit all cells covered by a range", () => {
    const state = new InputValidationInteraction();
    state.select(1, 0, 3, 1);
    expect(state.shouldReportMissing(1, 1)).toBe(false);
    expect(state.shouldReportMissing(3, 1)).toBe(false);
  });

  it("reports actual invalid values and explicit NULL without requiring visits", () => {
    const state = new InputValidationInteraction();
    expect(
      collect(state, [
        ["ID", "NAME"],
        ["abc", "long"],
      ]).issues.map((x) => x.type),
    ).toEqual(["invalid_number", "max_length_exceeded"]);
    expect(
      collect(state, [
        ["ID", "NAME"],
        ["1", "NULL"],
      ]).issues[0].type,
    ).toBe("null_not_allowed");
    expect(
      collect(
        state,
        [
          ["ID", "NAME"],
          ["NULL", "ok"],
        ],
        { queryType: "update" },
      ).issues[0].type,
    ).toBe("missing_primary_key");
  });

  it("checks committed empty cells and whole pasted rows", () => {
    const state = new InputValidationInteraction();
    state.commit([[1, 1, "a", ""]], "edit");
    expect(collect(state).issues).toHaveLength(1);
    const pasted = new InputValidationInteraction();
    pasted.commit([[1, 0, "", "1"]], "CopyPaste.paste");
    expect(collect(pasted).issues).toHaveLength(1);
  });

  it("keeps full validation after Generate, and defaults to full validation outside live UI", () => {
    const state = new InputValidationInteraction();
    state.revealAll = true;
    expect(collect(state).issues).toHaveLength(1);
    expect(collectInputIssues({ schemaData, inputData, queryType: "insert" }).issues).toHaveLength(1);
  });

  it("retains UPDATE blank semantics and validates missing matching keys on departure", () => {
    const state = new InputValidationInteraction();
    expect(
      collect(
        state,
        [
          ["ID", "NAME"],
          ["", "ok"],
        ],
        { queryType: "update" },
      ).issues,
    ).toEqual([]);
    state.select(1, 1, 1, 1);
    state.leave();
    expect(
      collect(
        state,
        [
          ["ID", "NAME"],
          ["", "ok"],
        ],
        { queryType: "update" },
      ).issues[0].type,
    ).toBe("missing_primary_key");
    expect(
      collect(
        state,
        [
          ["ID", "NAME"],
          ["1", ""],
        ],
        { queryType: "update" },
      ).issues,
    ).toEqual([]);
  });

  it("moves cell and row history with inserted and removed rows/columns", () => {
    const state = new InputValidationInteraction();
    state.select(2, 1, 2, 1);
    state.select(2, 0, 2, 0);
    state.splice("row", 1, 0, 1);
    state.splice("col", 0, 0, 1);
    expect(state.shouldReportMissing(3, 2)).toBe(true);
    expect(state.shouldReportMissing(2, 2)).toBe(false);
    state.splice("row", 3, 1, 0);
    expect(state.shouldReportMissing(3, 2)).toBe(false);
    expect(state.active).toBe(null);
  });
});
