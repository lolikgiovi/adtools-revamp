// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ExportContentComparisonService } from "../comparison-service.js";

const service = new ExportContentComparisonService();

describe("ExportContentComparisonService", () => {
  it("compares visible HTML text separately from source formatting", () => {
    const result = service.compare("<p>Hello <strong>world</strong></p>", "<p>Hello <b>world</b></p>");

    expect(result.changed).toBe(true);
    expect(result.textChanged).toBe(false);
    expect(result.stats).toEqual({ added: 0, removed: 0 });
  });

  it("reports word-level visible text changes", () => {
    const result = service.compare("<p>Hello old world</p>", "<p>Hello new world today</p>");

    expect(result.textChanged).toBe(true);
    expect(result.stats).toEqual({ added: 2, removed: 1 });
    expect(result.textSegments.some((part) => part.type === "insert" && part.value.includes("new"))).toBe(true);
  });

  it("parses every Excel sheet and suggests the matching Oracle row and content column", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["TOPIC", "TEMPLATE_MESSAGE_ID"],
        ["other", "<p>Other</p>"],
        ["terms", "<p>Terms candidate</p>"],
      ]),
      "Templates",
    );
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const file = {
      name: "candidate.xlsx",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes,
    };

    const parsed = await service.parseExcelFile(file);
    const mapping = service.suggestExcelMapping({
      sheet: parsed.sheets[0],
      oracleIdentifierColumn: "TOPIC",
      oracleIdentifierValue: "terms",
      oracleContentColumn: "TEMPLATE_MESSAGE_ID",
    });
    const candidate = service.getExcelCandidate({
      workbook: parsed,
      sheetName: "Templates",
      rowIndex: mapping.rowIndex,
      contentColumn: mapping.contentColumn,
    });

    expect(mapping).toEqual({ identifierColumn: "TOPIC", contentColumn: "TEMPLATE_MESSAGE_ID", rowIndex: 1 });
    expect(candidate.content).toBe("<p>Terms candidate</p>");
    expect(candidate.label).toContain("row 3");
  });

  it("rejects malformed XML when extracting visible text", () => {
    expect(() =>
      service.extractVisibleText("<root><item></root>", { mediaType: "application/xml" }),
    ).toThrow(/not well formed/);
  });
});
