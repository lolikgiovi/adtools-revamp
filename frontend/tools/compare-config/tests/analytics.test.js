import { describe, expect, it } from "vitest";
import {
  buildCompareConfigSuccessMeta,
  buildQualifiedTable,
  buildUnifiedSourceAnalytics,
} from "../lib/compare-config-analytics.js";

describe("Compare Config analytics", () => {
  it("records the env and table pair for Oracle table comparisons", () => {
    const meta = buildCompareConfigSuccessMeta({
      mode: "table",
      sourceA: {
        type: "oracle",
        queryMode: "table",
        connection: { name: "SIT" },
        schema: "ADTOOLS",
        table: "FEATURE_FLAGS",
        whereClause: "IS_ACTIVE = 1",
        maxRows: 500,
        rowCount: 12,
      },
      sourceB: {
        type: "oracle",
        queryMode: "table",
        connection: { name: "UAT" },
        schema: "ADTOOLS",
        table: "FEATURE_FLAGS",
        maxRows: 500,
        rowCount: 10,
      },
      result: {
        rows: [{}, {}],
        summary: { matches: 1, differs: 1, only_in_env1: 0, only_in_env2: 0 },
      },
      pkFields: ["ID"],
      compareFields: ["ID", "VALUE"],
      queryMode: "table",
    });

    expect(meta.source_a_env).toBe("SIT");
    expect(meta.source_a_table).toBe("ADTOOLS.FEATURE_FLAGS");
    expect(meta.source_b_env).toBe("UAT");
    expect(meta.source_b_table).toBe("ADTOOLS.FEATURE_FLAGS");
    expect(meta.source_a_has_where_clause).toBe(true);
    expect(meta.rows_compared).toBe(2);
    expect(meta.rows_differ).toBe(1);
    expect(meta.pk_fields).toBe(1);
    expect(meta.compare_fields).toBe(2);
    expect(meta.compare_pair).toBe("SIT:ADTOOLS.FEATURE_FLAGS -> UAT:ADTOOLS.FEATURE_FLAGS");
  });

  it("summarizes unified Oracle sources without storing raw SQL text or connect strings", () => {
    const source = {
      type: "oracle",
      queryMode: "sql",
      connection: { name: "PROD", connect_string: "secret-host/service" },
      sql: "select * from PRIVATE_TABLE",
      data: {
        metadata: {
          connectionName: "PROD",
          rowCount: 3,
          sourceType: "oracle-sql",
        },
      },
    };

    const analyticsSource = buildUnifiedSourceAnalytics(source, source.data);
    const meta = buildCompareConfigSuccessMeta({
      mode: "unified_oracle_oracle",
      sourceA: analyticsSource,
      sourceB: analyticsSource,
      result: { rows: [], summary: {} },
      queryMode: "sql",
    });

    expect(meta.source_a_env).toBe("PROD");
    expect(meta.source_a_table).toBe("raw_sql");
    expect(JSON.stringify(meta)).not.toContain("secret-host");
    expect(JSON.stringify(meta)).not.toContain("PRIVATE_TABLE");
  });

  it("builds qualified table names conservatively", () => {
    expect(buildQualifiedTable("CORE", "APP_PARAM")).toBe("CORE.APP_PARAM");
    expect(buildQualifiedTable("", "APP_PARAM")).toBe("APP_PARAM");
    expect(buildQualifiedTable("CORE", "")).toBe("");
  });
});
