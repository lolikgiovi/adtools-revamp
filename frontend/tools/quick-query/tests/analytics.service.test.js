import { describe, expect, it } from "vitest";
import {
  buildQuickQueryGeneratedMeta,
  summarizeQuickQueryAttachments,
  summarizeQuickQuerySchema,
} from "../services/QuickQueryAnalyticsService.js";

describe("QuickQueryAnalyticsService", () => {
  const schema = [
    ["ID", "VARCHAR2(36)", "No", "", "1", "Yes"],
    ["AMOUNT", "NUMBER(18,2)", "Yes", "", "2", "No"],
    ["CREATED_AT", "TIMESTAMP(6)", "No", "", "3", "No"],
  ];

  it("preserves full schema.table names and computes query generation counts", () => {
    const meta = buildQuickQueryGeneratedMeta({
      tableName: "inhouse_forex.rate_tiering",
      queryType: "merge",
      schemaData: schema,
      inputData: [
        ["ID", "AMOUNT", "CREATED_AT"],
        ["RT-1", "10", "2026-01-01"],
        ["RT-2", "20", "2026-01-02"],
      ],
      dataSource: "manual",
      attachments: [{ name: "contract.pdf", type: "application/pdf", size: 1000 }],
      usedWorker: false,
      uuidSession: { generated_count: 3, copied_count: 2 },
    });

    expect(meta.table_name).toBe("inhouse_forex.rate_tiering");
    expect(meta.query_type).toBe("merge");
    expect(meta.row_count).toBe(2);
    expect(meta.schema_column_count).toBe(3);
    expect(meta.pk_column_count).toBe(1);
    expect(meta.nullable_column_count).toBe(1);
    expect(meta.data_type_mix).toBe("NUMBER:1,TIMESTAMP:1,VARCHAR2:1");
    expect(meta.has_attachments).toBe(true);
    expect(meta.attachment_count).toBe(1);
    expect(meta.attachment_total_size).toBe(1000);
    expect(meta.attachment_types).toBe("pdf:1");
    expect(meta.uuid_generated_in_session).toBe(true);
    expect(meta.uuid_copied_in_session).toBe(true);
    expect(meta.uuid_count_session).toBe(3);
  });

  it("summarizes schema without exposing column names", () => {
    const summary = summarizeQuickQuerySchema(schema);

    expect(summary).toEqual({
      schema_column_count: 3,
      pk_column_count: 1,
      nullable_column_count: 1,
      data_type_mix: "NUMBER:1,TIMESTAMP:1,VARCHAR2:1",
    });
    expect(JSON.stringify(summary)).not.toContain("CREATED_AT");
  });

  it("summarizes attachments without exposing filenames or content", () => {
    const summary = summarizeQuickQueryAttachments([
      {
        name: "customer-private-contract.pdf",
        type: "application/pdf",
        size: 500,
        processedFormats: { original: "secret text", base64: "secret base64" },
      },
      { name: "payload.json", type: "application/json", size: 250 },
    ]);

    expect(summary).toEqual({
      has_attachments: true,
      attachment_count: 2,
      attachment_total_size: 750,
      attachment_types: "json:1,pdf:1",
    });
    expect(JSON.stringify(summary)).not.toContain("customer-private-contract");
    expect(JSON.stringify(summary)).not.toContain("secret");
  });
});
