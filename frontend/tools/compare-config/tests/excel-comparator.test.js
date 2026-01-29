import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelComparator from "../lib/excel-comparator.js";
import * as FileParser from "../lib/file-parser.js";
import * as DiffEngine from "../lib/diff-engine.js";

// Mock FileParser and DiffEngine
vi.mock("../lib/file-parser.js");

describe("ExcelComparator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should compare a single pair of files with key matching", async () => {
    const mockRef = { name: "ref.csv" };
    const mockComp = { name: "comp.csv" };
    const matches = [{ reference: mockRef, comparator: mockComp }];

    FileParser.parseFile.mockImplementation(async (file) => {
      if (file.name === "ref.csv") {
        return {
          headers: ["ID", "NAME"],
          rows: [{ ID: "1", NAME: "Alice" }],
        };
      }
      return {
        headers: ["ID", "NAME"],
        rows: [{ ID: "1", NAME: "Bob" }],
      };
    });

    const results = await ExcelComparator.compareFileSets(matches, {
      rowMatching: "key",
      pkColumns: "ID",
    });

    expect(results.summary.total).toBe(1);
    expect(results.summary.differs).toBe(1);
    expect(results.rows[0].status).toBe("differ");
    expect(results.rows[0].key).toEqual({ ID: "1" });
    expect(results.rows[0].env1_data.NAME).toBe("Alice");
    expect(results.rows[0].env2_data.NAME).toBe("Bob");
  });

  it("should compare by position when specified", async () => {
    const mockRef = { name: "ref.csv" };
    const mockComp = { name: "comp.csv" };
    const matches = [{ reference: mockRef, comparator: mockComp }];

    FileParser.parseFile.mockImplementation(async (file) => {
      return {
        headers: ["NAME"],
        rows: [{ NAME: "Alice" }, { NAME: "Charlie" }],
      };
    });

    const results = await ExcelComparator.compareFileSets(matches, {
      rowMatching: "position",
    });

    expect(results.summary.total).toBe(2);
    expect(results.summary.matches).toBe(2);
    // GridView logic will determine PK display, but for consolidation we use first col as key if none provided
    expect(results.rows[0].key).toEqual({ NAME: "Alice" });
  });

  it("should consolidate results from multiple file pairs", async () => {
    const matches = [
      { reference: { name: "file1.csv" }, comparator: { name: "file1_c.csv" } },
      { reference: { name: "file2.csv" }, comparator: { name: "file2_c.csv" } },
    ];

    FileParser.parseFile.mockImplementation(async (file) => {
      if (file.name.includes("file1")) {
        return { headers: ["ID"], rows: [{ ID: "A" }] };
      }
      return { headers: ["ID"], rows: [{ ID: "B" }] };
    });

    const results = await ExcelComparator.compareFileSets(matches);

    expect(results.summary.total).toBe(2);
    expect(results.rows.length).toBe(2);
    expect(results.rows[0]._sourceFile).toBeDefined();
  });

  it("should handle parsing errors gracefully", async () => {
    const matches = [
      { reference: { name: "good.csv" }, comparator: { name: "good_c.csv" } },
      { reference: { name: "bad.csv" }, comparator: { name: "bad_c.csv" } },
    ];

    FileParser.parseFile.mockImplementation(async (file) => {
      if (file.name.includes("bad")) throw new Error("Parse failed");
      return { headers: ["ID"], rows: [{ ID: "OK" }] };
    });

    const results = await ExcelComparator.compareFileSets(matches);

    expect(results.summary.total).toBe(1);
    expect(results.rows[0].env1_data.ID).toBe("OK");
  });
});
