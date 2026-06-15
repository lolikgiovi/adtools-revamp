import { describe, expect, it } from "vitest";
import { isTabDraftContentEmpty } from "../services/TabDraftStateService.js";

describe("TabDraftStateService", () => {
  it("treats a completely blank tab as empty", () => {
    expect(
      isTabDraftContentEmpty({
        tableName: "",
        schemaData: [["", "", "", "", "", ""]],
        inputData: [[null, null], ["", ""]],
        sql: "",
        attachments: [],
      }),
    ).toBe(true);
  });

  it("can ignore table name text when deciding whether schema load should replace a blank tab", () => {
    expect(
      isTabDraftContentEmpty(
        {
          tableName: "loan.config",
          schemaData: [["", "", "", "", "", ""]],
          inputData: [[null, null], ["", ""]],
          sql: "",
          attachments: [],
        },
        { ignoreTableName: true },
      ),
    ).toBe(true);
  });

  it("does not treat table name text as empty unless requested", () => {
    expect(
      isTabDraftContentEmpty({
        tableName: "loan.config",
        schemaData: [["", "", "", "", "", ""]],
        inputData: [[null, null], ["", ""]],
        sql: "",
        attachments: [],
      }),
    ).toBe(false);
  });

  it("does not ignore real schema, data, SQL, or attachments", () => {
    expect(isTabDraftContentEmpty({ schemaData: [["ID", "", "", "", "", ""]] }, { ignoreTableName: true })).toBe(false);
    expect(isTabDraftContentEmpty({ inputData: [["1"]] }, { ignoreTableName: true })).toBe(false);
    expect(isTabDraftContentEmpty({ sql: "MERGE INTO loan.config" }, { ignoreTableName: true })).toBe(false);
    expect(isTabDraftContentEmpty({ attachments: [{ name: "payload.json" }] }, { ignoreTableName: true })).toBe(false);
  });
});
