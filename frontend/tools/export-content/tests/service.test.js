// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { ExportContentService } from "../service.js";

function createService(overrides = {}) {
  return new ExportContentService(overrides);
}

describe("ExportContentService SQL validation", () => {
  it("allows SELECT and WITH queries only", () => {
    const service = createService();

    expect(service.isReadonlySelect("SELECT * FROM CONTENT.MESSAGE_TEMPLATE")).toBe(true);
    expect(service.isReadonlySelect("WITH data AS (SELECT 1 FROM dual) SELECT * FROM data")).toBe(true);
    expect(service.isReadonlySelect("DELETE FROM CONTENT.MESSAGE_TEMPLATE")).toBe(false);
    expect(service.isReadonlySelect("SELECT * FROM A; DROP TABLE B")).toBe(false);
  });

  it("starts the shared Oracle sidecar through the query service", async () => {
    const queryService = {
      ensureSidecarStarted: vi.fn().mockResolvedValue(true),
    };
    const service = createService({ queryService });

    await expect(service.ensureSidecarStarted()).resolves.toBe(true);
    expect(queryService.ensureSidecarStarted).toHaveBeenCalledTimes(1);
  });
});

describe("ExportContentService snippets", () => {
  it("creates named snippets with trimmed name and SQL", () => {
    const service = createService();
    const snippet = service.createSnippet({
      id: "snippet-1",
      name: " Gold Loan ",
      sql: " SELECT * FROM CONTENT.MESSAGE_TEMPLATE ",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(snippet).toEqual({
      id: "snippet-1",
      name: "Gold Loan",
      sql: "SELECT * FROM CONTENT.MESSAGE_TEMPLATE",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
  });

  it("requires snippet name and SQL", () => {
    const service = createService();

    expect(() => service.createSnippet({ name: "", sql: "SELECT 1 FROM DUAL" })).toThrow(/Snippet name/);
    expect(() => service.createSnippet({ name: "One", sql: "" })).toThrow(/SQL query/);
  });
});

describe("ExportContentService column detection", () => {
  it("detects _EN and _ID content columns", () => {
    const service = createService();

    expect(service.detectContentColumns(["TOPIC", "TEMPLATE_MESSAGE_EN", "TEMPLATE_MESSAGE_ID", "ENV"])).toEqual([
      "TEMPLATE_MESSAGE_EN",
      "TEMPLATE_MESSAGE_ID",
    ]);
    expect(service.deriveLanguageSuffix("TEMPLATE_MESSAGE_ID")).toBe("ID");
    expect(service.deriveLanguageSuffix("template_message_en")).toBe("EN");
  });

  it("defaults identifier columns to the first non-content column", () => {
    const service = createService();
    const contentColumns = ["TEMPLATE_MESSAGE_EN", "TEMPLATE_MESSAGE_ID"];

    expect(service.detectIdentifierColumns(["TOPIC", "ENV", ...contentColumns], contentColumns)).toEqual(["TOPIC"]);
  });
});

describe("ExportContentService filenames and items", () => {
  it("derives zip filename from the first qualified schema.table in the SQL", () => {
    const service = createService();
    const sourceName = service.deriveSourceNameFromSql(`
      SELECT mt.TOPIC, mt.TEMPLATE_MESSAGE_ID
      FROM CONTENT.MESSAGE_TEMPLATE mt
      WHERE mt.TOPIC = 'terms'
    `);

    expect(sourceName).toBe("CONTENT.MESSAGE_TEMPLATE");
    expect(service.buildZipFilename({ sourceName, timestamp: "2026_07_09-14_30" })).toBe("CONTENT.MESSAGE_TEMPLATE-2026_07_09-14_30.zip");
  });

  it("supports quoted schema.table names when deriving zip filenames", () => {
    const service = createService();
    const sourceName = service.deriveSourceNameFromSql('SELECT * FROM "CONTENT"."MESSAGE_TEMPLATE" mt');

    expect(sourceName).toBe("CONTENT.MESSAGE_TEMPLATE");
  });

  it("builds one HTML item per selected non-empty content value", () => {
    const service = createService();
    const result = service.buildExportItems({
      timestamp: "2026_07_09-14_30",
      identifierColumns: ["TOPIC"],
      contentColumns: ["TEMPLATE_MESSAGE_EN", "TEMPLATE_MESSAGE_ID"],
      rows: [
        {
          TOPIC: "gold-loan-agreement-template",
          TEMPLATE_MESSAGE_EN: "<html>EN</html>",
          TEMPLATE_MESSAGE_ID: "<html>ID</html>",
        },
      ],
    });

    expect(result.skippedEmpty).toBe(0);
    expect(result.items.map((item) => item.filename)).toEqual([
      "gold-loan-agreement-template-EN-2026_07_09-14_30.html",
      "gold-loan-agreement-template-ID-2026_07_09-14_30.html",
    ]);
    expect(result.items[0].content).toBe("<html>EN</html>");
  });

  it("supports composite identifiers and sanitizes unsafe characters", () => {
    const service = createService();
    const result = service.buildExportItems({
      timestamp: "2026_07_09-14_30",
      identifierColumns: ["TOPIC", "ENV"],
      contentColumns: ["BODY_ID"],
      rows: [{ TOPIC: "gold/loan:terms", ENV: "SIT 1", BODY_ID: "<p>ok</p>" }],
    });

    expect(result.items[0].filename).toBe("gold_loan_terms-SIT_1-ID-2026_07_09-14_30.html");
  });

  it("deduplicates generated filenames and skips empty content", () => {
    const service = createService();
    const result = service.buildExportItems({
      timestamp: "2026_07_09-14_30",
      identifierColumns: ["TOPIC"],
      contentColumns: ["BODY_ID"],
      rows: [
        { TOPIC: "terms", BODY_ID: "<p>one</p>" },
        { TOPIC: "terms", BODY_ID: "<p>two</p>" },
        { TOPIC: "empty", BODY_ID: "   " },
      ],
    });

    expect(result.skippedEmpty).toBe(1);
    expect(result.items.map((item) => item.filename)).toEqual(["terms-ID-2026_07_09-14_30.html", "terms-ID-2026_07_09-14_30-2.html"]);
  });

  it("preserves VARCHAR and CLOB text content as strings", () => {
    const service = createService();
    const clobHtml = "<html><body>Mandiri & Gadai</body></html>";
    const result = service.buildExportItems({
      timestamp: "2026_07_09-14_30",
      identifierColumns: ["TOPIC"],
      contentColumns: ["BODY_ID"],
      rows: [{ TOPIC: "terms", BODY_ID: clobHtml }],
    });

    expect(result.items[0].contentType).toBe("text");
    expect(result.items[0].content).toBe(clobHtml);
  });

  it("decodes Oracle BLOB markers to exact bytes instead of stringifying them", () => {
    const service = createService();
    const originalBytes = Uint8Array.from([0, 60, 104, 116, 109, 108, 62, 255]);
    const result = service.buildExportItems({
      timestamp: "2026_07_09-14_30",
      identifierColumns: ["TOPIC"],
      contentColumns: ["BODY_ID"],
      rows: [
        {
          TOPIC: "blob-html",
          BODY_ID: {
            __adtools_type: "oracle_blob",
            encoding: "base64",
            data: Buffer.from(originalBytes).toString("base64"),
            byte_length: originalBytes.byteLength,
          },
        },
      ],
    });

    expect(result.items[0].contentType).toBe("oracle_blob");
    expect(Array.from(result.items[0].content)).toEqual(Array.from(originalBytes));
  });

  it("passes BLOB bytes to JSZip with binary mode", async () => {
    const file = vi.fn();
    const generateAsync = vi.fn().mockResolvedValue(new Blob(["zip"]));
    const service = createService({
      zipFactory: () => ({ file, generateAsync }),
    });
    const bytes = Uint8Array.from([1, 2, 3, 255]);

    await service.buildZipBlob([{ filename: "blob-ID-2026_07_09-14_30.html", content: bytes, contentType: "oracle_blob" }]);

    expect(file).toHaveBeenCalledWith("blob-ID-2026_07_09-14_30.html", bytes, { binary: true });
    expect(generateAsync).toHaveBeenCalledWith({ type: "blob" });
  });

  it("round-trips BLOB bytes through the generated zip without mutation", async () => {
    const service = createService();
    const originalBytes = Uint8Array.from([0, 1, 2, 60, 104, 116, 109, 108, 62, 128, 255]);
    const zipBlob = await service.buildZipBlob([
      {
        filename: "blob-ID-2026_07_09-14_30.html",
        content: originalBytes,
        contentType: "oracle_blob",
      },
    ]);

    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const extracted = await zip.file("blob-ID-2026_07_09-14_30.html").async("uint8array");

    expect(Array.from(extracted)).toEqual(Array.from(originalBytes));
  });

  it("decodes BLOB content as UTF-8 for preview only", () => {
    const service = createService();
    const text = "<html><body>Preview</body></html>";
    const bytes = new TextEncoder().encode(text);

    expect(service.contentToPreviewText(bytes, "oracle_blob")).toBe(text);
  });

  it("builds a manifest for generated files without embedding HTML content", () => {
    const service = createService();
    const manifest = service.buildManifest({
      generatedAt: "2026-07-09T07:00:00.000Z",
      environment: "UAT 3 Comp",
      savedQueryName: "Gold Loan Content",
      preview: {
        sourceName: "CONTENT.MESSAGE_TEMPLATE",
        columns: ["TOPIC", "TEMPLATE_MESSAGE_EN"],
        rows: [{ TOPIC: "terms", TEMPLATE_MESSAGE_EN: "<html>Terms</html>" }],
      },
      identifierColumns: ["TOPIC"],
      contentColumns: ["TEMPLATE_MESSAGE_EN"],
      skippedEmpty: 1,
      items: [
        {
          filename: "terms-EN-2026_07_09-14_30.html",
          column: "TEMPLATE_MESSAGE_EN",
          language: "EN",
          identifierValues: ["terms"],
          content: "<html>Terms</html>",
        },
      ],
    });

    expect(manifest).toEqual({
      sourceName: "CONTENT.MESSAGE_TEMPLATE",
      environment: "UAT 3 Comp",
      savedQueryName: "Gold Loan Content",
      rowCount: 1,
      columns: ["TOPIC", "TEMPLATE_MESSAGE_EN"],
      identifierColumns: ["TOPIC"],
      contentColumns: ["TEMPLATE_MESSAGE_EN"],
      generatedAt: "2026-07-09T07:00:00.000Z",
      skippedEmpty: 1,
      files: [
        {
          filename: "terms-EN-2026_07_09-14_30.html",
          column: "TEMPLATE_MESSAGE_EN",
          language: "EN",
          identifierValues: ["terms"],
        },
      ],
    });
  });
});

describe("ExportContentService preview", () => {
  it("runs Oracle query through the shared sidecar service and maps rows to objects", async () => {
    const queryService = {
      queryViaSidecar: vi.fn().mockResolvedValue({
        columns: ["TOPIC", "TEMPLATE_MESSAGE_ID"],
        rows: [["terms", "<html>ID</html>"]],
        row_count: 1,
        execution_time_ms: 12,
      }),
    };
    const service = createService({ queryService });
    const connection = { name: "SIT", connect_string: "host:1521/service" };

    await expect(service.previewQuery({ connection, sql: "SELECT * FROM T;", maxRows: 10 })).resolves.toEqual({
      columns: ["TOPIC", "TEMPLATE_MESSAGE_ID"],
      rows: [{ TOPIC: "terms", TEMPLATE_MESSAGE_ID: "<html>ID</html>" }],
      rowCount: 1,
      executionTimeMs: 12,
      sourceName: "query-result",
    });

    expect(queryService.queryViaSidecar).toHaveBeenCalledWith("SIT", connection, "SELECT * FROM T", 10);
  });
});
