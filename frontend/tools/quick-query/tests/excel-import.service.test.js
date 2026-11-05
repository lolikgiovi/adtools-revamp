// @vitest-environment node
// Failure modes for reading Excel cells into Quick Query rows:
// 1. Date cells arrive as Excel serial numbers (45306) and generate wrong dates or fail validation.
// 2. Date conversion shifts the day by the machine's time zone, or drops the time part.
// 3. Calculated decimals keep binary float noise (0.30000000000000004) and fail precision checks.
// 4. Zero-padded codes (format 00000) lose their leading zeros.
// 5. Formatted but empty columns in the used range become blank headers and block generation.
// 6. A column that has data but no header is silently dropped instead of reported.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ExcelImportService } from "../services/ExcelImportService.js";

function workbookBuffer(cells, ref) {
  const sheet = { "!ref": ref, ...cells };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

const text = (v) => ({ t: "s", v });
const number = (v, z) => ({ t: "n", v, ...(z ? { z } : {}) });

describe("ExcelImportService cell values", () => {
  it("reads date cells as calendar dates, keeping the time when present", () => {
    const buffer = workbookBuffer(
      {
        A1: text("BIRTH"),
        B1: text("CREATED"),
        A2: number(45306, "yyyy-mm-dd"),
        B2: number(45306.5, "yyyy-mm-dd hh:mm:ss"),
        A3: number(21916, "dd/mm/yyyy"),
        B3: number(45306.000011574, "yyyy-mm-dd hh:mm:ss"),
      },
      "A1:B3",
    );
    const { data } = new ExcelImportService().processFromArrayBuffer(buffer);
    expect(data).toEqual([
      ["2024-01-15", "2024-01-15 12:00:00"],
      ["1960-01-01", "2024-01-15 00:00:01"],
    ]);
  });

  it("reads numbers as Excel displays them", () => {
    const buffer = workbookBuffer(
      {
        A1: text("AMT"),
        B1: text("CODE"),
        C1: text("BIG"),
        A2: number(0.1 * 3),
        B2: number(123, "00000"),
        C2: number(1234567890123),
      },
      "A1:C2",
    );
    const { data } = new ExcelImportService().processFromArrayBuffer(buffer);
    expect(data).toEqual([["0.3", "00123", "1234567890123"]]);
  });

  it("ignores empty unnamed columns but keeps unnamed columns with data", () => {
    const service = new ExcelImportService();
    const empty = service.processFromArrayBuffer(
      workbookBuffer({ A1: text("ID"), B1: text("NAME"), A2: number(1), B2: text("a") }, "A1:D3"),
    );
    expect(empty.header).toEqual(["ID", "NAME"]);
    expect(empty.data).toEqual([["1", "a"]]);

    const filled = service.processFromArrayBuffer(workbookBuffer({ A1: text("ID"), A2: number(1), B2: text("orphan") }, "A1:B2"));
    expect(filled.header).toEqual(["ID", ""]);
    expect(filled.data).toEqual([["1", "orphan"]]);
  });
});
