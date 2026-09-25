/**
 * Unit tests for file-parser.js
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  parseCSV,
  parseCSVText,
  parseExcel,
} from "../lib/file-parser.js";

describe("FileParser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
