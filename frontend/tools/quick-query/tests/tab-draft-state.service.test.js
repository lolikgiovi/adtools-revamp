import { describe, expect, it } from "vitest";
import { isTabDraftContentEmpty, mergeDraftSchema } from "../services/TabDraftStateService.js";

describe("TabDraftStateService", () => {
  it("treats a completely blank tab as empty", () => {
    expect(
      isTabDraftContentEmpty({
        tableName: "",
        schemaData: [["", "", "", "", "", ""]],
        inputData: [
          [null, null],
          ["", ""],
        ],
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
          inputData: [
            [null, null],
            ["", ""],
          ],
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
        inputData: [
          [null, null],
          ["", ""],
        ],
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

  it("keeps the saved table schema while applying draft primary keys and column order", () => {
    const saved = [
      ["CONFIG_INTEGRATION_ID", "VARCHAR2(36)", "No", "", "", "Yes"],
      ["SERVICE_CODE", "VARCHAR2(50)", "No", "", "", "No"],
      ["ENVIRONMENT", "VARCHAR2(10)", "No", "", "", "No"],
      ["REQ_MAP_TEMPLATE", "CLOB", "Yes", "", "", "No"],
      ["CREATED_TIME", "TIMESTAMP(6)", "No", "", "", "No"],
    ];
    const draft = [
      ["SERVICE_CODE", "VARCHAR2", "No", "", "", "Yes"],
      ["ENVIRONMENT", "VARCHAR2", "No", "", "", "Yes"],
      ["REQ_MAP_TEMPLATE", "CLOB", "Yes", "", "", "No"],
      ["NEW_FIELD", "NUMBER", "Yes", "", "", "No"],
    ];

    expect(mergeDraftSchema(saved, draft)).toEqual([
      ["CONFIG_INTEGRATION_ID", "VARCHAR2(36)", "No", "", "", "No"],
      ["SERVICE_CODE", "VARCHAR2(50)", "No", "", "", "Yes"],
      ["ENVIRONMENT", "VARCHAR2(10)", "No", "", "", "Yes"],
      ["REQ_MAP_TEMPLATE", "CLOB", "Yes", "", "", "No"],
      ["CREATED_TIME", "TIMESTAMP(6)", "No", "", "", "No"],
      ["NEW_FIELD", "NUMBER", "Yes", "", "", "No"],
    ]);
  });

  it("falls back to the draft when the table has no saved schema", () => {
    const draft = [["service_code", "VARCHAR2", "No", "", "", "Yes"]];
    expect(mergeDraftSchema(null, draft)).toEqual([["service_code", "VARCHAR2", "No", "", "", "Yes"]]);
    expect(mergeDraftSchema([["", "", "", "", "", ""]], draft)).toEqual([["service_code", "VARCHAR2", "No", "", "", "Yes"]]);
  });
});
