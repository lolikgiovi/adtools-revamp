/**
 * Unit tests for file-parser.js
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  parseCSV,
  parseCSVText,
  parseExcel,
  getFileExtension,
  isSupported,
  filterSupportedFiles,
  SUPPORTED_EXTENSIONS,
} from "../lib/file-parser.js";

describe("FileParser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getFileExtension", () => {
    it("extracts extension from filename", () => {
      expect(getFileExtension("data.xlsx")).toBe("xlsx");
      expect(getFileExtension("report.csv")).toBe("csv");
      expect(getFileExtension("file.xls")).toBe("xls");
    });

    it("handles multiple dots in filename", () => {
      expect(getFileExtension("my.data.file.xlsx")).toBe("xlsx");
      expect(getFileExtension("backup.2024.01.csv")).toBe("csv");
    });

    it("returns empty string for no extension", () => {
      expect(getFileExtension("noextension")).toBe("");
    });

    it("returns lowercase extension", () => {
      expect(getFileExtension("FILE.XLSX")).toBe("xlsx");
      expect(getFileExtension("Data.CSV")).toBe("csv");
    });
  });

  describe("isSupported", () => {
    it("returns true for supported extensions", () => {
      expect(isSupported("data.xlsx")).toBe(true);
      expect(isSupported("data.xls")).toBe(true);
      expect(isSupported("data.csv")).toBe(true);
    });

    it("returns false for unsupported extensions", () => {
      expect(isSupported("data.txt")).toBe(false);
      expect(isSupported("data.pdf")).toBe(false);
      expect(isSupported("data.json")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isSupported("DATA.XLSX")).toBe(true);
      expect(isSupported("Data.Csv")).toBe(true);
    });

    it("accepts File-like objects", () => {
      expect(isSupported({ name: "test.xlsx" })).toBe(true);
      expect(isSupported({ name: "test.pdf" })).toBe(false);
    });
  });

  describe("filterSupportedFiles", () => {
    it("filters to only supported files", () => {
      const files = [{ name: "data.xlsx" }, { name: "readme.txt" }, { name: "report.csv" }, { name: "image.png" }];
      const result = filterSupportedFiles(files);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("data.xlsx");
      expect(result[1].name).toBe("report.csv");
    });

    it("returns empty array for no supported files", () => {
      const files = [{ name: "doc.pdf" }, { name: "image.png" }];
      expect(filterSupportedFiles(files)).toHaveLength(0);
    });
  });

  describe("SUPPORTED_EXTENSIONS", () => {
    it("includes xlsx, xls, and csv", () => {
      expect(SUPPORTED_EXTENSIONS).toContain("xlsx");
      expect(SUPPORTED_EXTENSIONS).toContain("xls");
      expect(SUPPORTED_EXTENSIONS).toContain("csv");
    });
  });

  describe("parseCSVText", () => {
    it("parses simple CSV", () => {
      const csv = "a,b,c\n1,2,3\n4,5,6";
      const result = parseCSVText(csv);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(["a", "b", "c"]);
      expect(result[1]).toEqual(["1", "2", "3"]);
      expect(result[2]).toEqual(["4", "5", "6"]);
    });

    it("handles quoted fields", () => {
      const csv = '"name","value"\n"John Doe","100"\n"Jane, Doe","200"';
      const result = parseCSVText(csv);

      expect(result).toHaveLength(3);
      expect(result[1]).toEqual(["John Doe", "100"]);
      expect(result[2]).toEqual(["Jane, Doe", "200"]);
    });

    it("handles escaped quotes", () => {
      const csv = 'text\n"He said ""hello"""\nvalue';
      const result = parseCSVText(csv);

      expect(result[1][0]).toBe('He said "hello"');
    });

    it("handles CRLF line endings", () => {
      const csv = "a,b\r\n1,2\r\n3,4";
      const result = parseCSVText(csv);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(["a", "b"]);
    });

    it("handles quoted fields with newlines", () => {
      const csv = 'name,address\n"John","123 Main St\nApt 4"';
      const result = parseCSVText(csv);

      expect(result).toHaveLength(2);
      expect(result[1][1]).toContain("\n");
    });

    it("handles empty CSV", () => {
      expect(parseCSVText("")).toEqual([]);
    });

    it("handles single column", () => {
      const csv = "header\nvalue1\nvalue2";
      const result = parseCSVText(csv);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(["header"]);
    });

    it("trims whitespace from fields", () => {
      const csv = " a , b , c \n 1 , 2 , 3 ";
      const result = parseCSVText(csv);

      expect(result[0]).toEqual(["a", "b", "c"]);
      expect(result[1]).toEqual(["1", "2", "3"]);
    });

    it("skips empty lines", () => {
      const csv = "a,b\n\n1,2\n\n";
      const result = parseCSVText(csv);

      expect(result).toHaveLength(2);
    });
  });

  describe("worker and fallback parsing", () => {
    it("falls back to the core parser when workers are unavailable", async () => {
      vi.stubGlobal("Worker", undefined);
      const result = await parseCSV({ name: "fallback.csv", text: async () => "name,value\nAda,1" });

      expect(result.headers).toEqual(["name", "value"]);
      expect(result.rows).toEqual([{ name: "Ada", value: "1" }]);
      expect(result.metadata.fileName).toBe("fallback.csv");
    });

    it("transfers Excel input to a short-lived worker", async () => {
      const arrayBuffer = new ArrayBuffer(8);
      const workerCalls = [];
      let workerInstance;
      class FakeWorker {
        constructor(url, options) {
          workerInstance = this;
          this.url = url;
          this.options = options;
        }

        postMessage(message, transferList) {
          workerCalls.push({ message, transferList });
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                ok: true,
                result: {
                  headers: ["id"],
                  rows: [{ id: "1" }],
                  metadata: { fileName: message.fileName, rowCount: 1, columnCount: 1 },
                },
              },
            });
          });
        }

        terminate() {
          this.terminated = true;
        }
      }

      vi.stubGlobal("Worker", FakeWorker);
      const result = await parseExcel({ name: "data.xlsx", arrayBuffer: async () => arrayBuffer });

      expect(workerCalls[0].message.operation).toBe("excel");
      expect(workerCalls[0].message.arrayBuffer).toBe(arrayBuffer);
      expect(workerCalls[0].transferList).toEqual([arrayBuffer]);
      expect(workerInstance.options).toEqual({ type: "module" });
      expect(workerInstance.terminated).toBe(true);
      expect(result.metadata.fileName).toBe("data.xlsx");
    });

    it("keeps worker parse failures as parse failures", async () => {
      let workerInstance;
      class FailingWorker {
        constructor() {
          workerInstance = this;
        }

        postMessage() {
          queueMicrotask(() => this.onerror?.({ message: "malformed workbook" }));
        }

        terminate() {
          this.terminated = true;
        }
      }

      vi.stubGlobal("Worker", FailingWorker);
      await expect(parseCSV({ name: "bad.csv", text: async () => "a,b\n1,2" })).rejects.toThrow("malformed workbook");
      expect(workerInstance.terminated).toBe(true);
    });
  });
});
