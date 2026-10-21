import { describe, expect, it } from "vitest";
import { analyzeLedger, escapeSqlLiteral, generateInsertSql, validateBatch } from "../service.js";

const versions = [
  {
    LANGUAGE_PACK_VERSION_ID: "v78",
    RELEASE_ID: "2.0.28",
    LANGUAGE_PACK_VERSION: 78,
    CREATED_BY: "SYSTEM",
    CREATED_TIME: "2026-08-26T15:12:27.000Z",
    UPDATED_BY: "SYSTEM",
    UPDATED_TIME: "2026-08-26T15:12:27.000Z",
  },
  {
    LANGUAGE_PACK_VERSION_ID: "v77",
    RELEASE_ID: "2.0.28",
    LANGUAGE_PACK_VERSION: 77,
    CREATED_BY: "SYSTEM",
    CREATED_TIME: "2026-08-26T15:01:07.000Z",
    UPDATED_BY: "SYSTEM",
    UPDATED_TIME: "2026-08-26T15:01:07.000Z",
  },
];

const updates = [
  {
    LANGUAGE_PACK_UPDATE_ID: "u1",
    LANGUAGE_PACK_VERSION_ID: "v78",
    LOCALIZATION_KEY: "accountStatusLabel",
    ID_VALUE: "Penundaan Transaksi",
    EN_VALUE: "Transaction Restricted",
    CREATED_BY: "SYSTEM",
    CREATED_TIME: "2026-08-26T15:12:47.000Z",
    UPDATED_BY: "SYSTEM",
    UPDATED_TIME: "2026-08-26T15:12:47.000Z",
  },
  {
    LANGUAGE_PACK_UPDATE_ID: "u2",
    LANGUAGE_PACK_VERSION_ID: "v77",
    LOCALIZATION_KEY: "accountStatusLabel",
    ID_VALUE: "Diblokir",
    EN_VALUE: "Blocked",
    CREATED_BY: "SYSTEM",
    CREATED_TIME: "2026-08-26T15:01:17.000Z",
    UPDATED_BY: "SYSTEM",
    UPDATED_TIME: "2026-08-26T15:01:17.000Z",
  },
];

describe("analyzeLedger", () => {
  it("computes the global max, next version, releases, and joined history", () => {
    const analysis = analyzeLedger({ versions, updates });

    expect(analysis.maxVersion).toBe(78);
    expect(analysis.releases).toEqual(["2.0.28"]);
    expect(analysis.orphans).toHaveLength(0);
    expect(analysis.history.map((row) => row.version)).toEqual([78, 77]);
  });

  it("flags orphan updates, duplicate version numbers, and versions without updates", () => {
    const analysis = analyzeLedger({
      versions: [
        ...versions,
        { ...versions[0], LANGUAGE_PACK_VERSION_ID: "v78b" },
        { ...versions[1], LANGUAGE_PACK_VERSION_ID: "v70", LANGUAGE_PACK_VERSION: 70 },
      ],
      updates: [...updates, { ...updates[0], LANGUAGE_PACK_UPDATE_ID: "u-orphan", LANGUAGE_PACK_VERSION_ID: "missing" }],
    });

    expect(analysis.duplicateVersionNumbers).toEqual([78]);
    expect(analysis.orphans.map((row) => row.LANGUAGE_PACK_UPDATE_ID)).toEqual(["u-orphan"]);
    expect(analysis.versionsWithoutUpdates.map((row) => row.LANGUAGE_PACK_VERSION_ID)).toEqual(["v78b", "v70"]);
  });

  it("marks new keys and changed values against the previous occurrence", () => {
    const analysis = analyzeLedger({
      versions: [
        { LANGUAGE_PACK_VERSION_ID: "v1", RELEASE_ID: "1.0.0", LANGUAGE_PACK_VERSION: 1 },
        { LANGUAGE_PACK_VERSION_ID: "v2", RELEASE_ID: "1.0.0", LANGUAGE_PACK_VERSION: 2 },
      ],
      updates: [
        { LANGUAGE_PACK_UPDATE_ID: "a1", LANGUAGE_PACK_VERSION_ID: "v1", LOCALIZATION_KEY: "alpha", ID_VALUE: "A1", EN_VALUE: "A" },
        { LANGUAGE_PACK_UPDATE_ID: "a2", LANGUAGE_PACK_VERSION_ID: "v2", LOCALIZATION_KEY: "alpha", ID_VALUE: "A2", EN_VALUE: "A" },
        { LANGUAGE_PACK_UPDATE_ID: "b2", LANGUAGE_PACK_VERSION_ID: "v2", LOCALIZATION_KEY: "beta", ID_VALUE: "B", EN_VALUE: "B" },
      ],
    });

    const atV2 = analysis.history.find((row) => row.updateId === "a2");
    expect(atV2.changes).toEqual({ isNewKey: false, id: true, en: false });
    expect(analysis.history.find((row) => row.updateId === "b2").changes.isNewKey).toBe(true);
    expect(analysis.history.find((row) => row.updateId === "a1").changes.isNewKey).toBe(true);
  });
});

describe("validateBatch", () => {
  const validRows = [{ key: "accountStatusLabel", idValue: "Diblokir", enValue: "Blocked" }];

  it("accepts a valid batch without a loaded ledger", () => {
    const result = validateBatch({
      releaseTargets: ["2.0.29"],
      auditUser: "SYSTEM",
      rows: validRows,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts two release targets and preserves their order", () => {
    const result = validateBatch({
      releaseTargets: ["2.0.29", "2.0.30"],
      auditUser: "SYSTEM",
      rows: validRows,
    });

    expect(result.ok).toBe(true);
    expect(result.releaseTargets).toEqual(["2.0.29", "2.0.30"]);
    expect(result.targets.map((target) => target.errors)).toEqual([[], []]);
  });

  it("rejects duplicate targets and more than four targets", () => {
    const duplicate = validateBatch({
      releaseTargets: ["2.0.29", "2.0.29"],
      auditUser: "SYSTEM",
      rows: validRows,
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.join(" ")).toMatch(/duplicate release target/i);

    const tooMany = validateBatch({
      releaseTargets: ["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4"],
      auditUser: "SYSTEM",
      rows: validRows,
    });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.errors.join(" ")).toMatch(/up to 4 release targets/i);
  });

  it("reports which release target failed validation", () => {
    const result = validateBatch({
      releaseTargets: ["2.0.29", "2.0"],
      auditUser: "SYSTEM",
      rows: validRows,
    });

    expect(result.ok).toBe(false);
    expect(result.targets[0].errors).toEqual([]);
    expect(result.targets[1].errors.join(" ")).toMatch(/x\.x\.x/);
    expect(result.errors.join(" ")).toContain("Release target 2");
  });

  it("drops blank release targets", () => {
    const result = validateBatch({
      releaseTargets: ["2.0.29", "   "],
      auditUser: "SYSTEM",
      rows: validRows,
    });

    expect(result.ok).toBe(true);
    expect(result.releaseTargets).toEqual(["2.0.29"]);
  });

  it("rejects duplicate keys inside one batch", () => {
    const result = validateBatch({
      releaseTargets: ["2.0.29"],
      auditUser: "SYSTEM",
      rows: [...validRows, { ...validRows[0] }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/duplicate localization key/i);
  });

  it("enforces column widths in bytes", () => {
    const longValue = "x".repeat(1501);
    const tooLong = validateBatch({
      releaseTargets: ["2.0.29"],
      auditUser: "SYSTEM",
      rows: [{ key: "k", idValue: longValue, enValue: "ok" }],
    });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.errors.join(" ")).toMatch(/1500/);

    const longRelease = validateBatch({
      releaseTargets: ["123.456.789"],
      auditUser: "SYSTEM",
      rows: validRows,
    });
    expect(longRelease.ok).toBe(false);
    expect(longRelease.errors.join(" ")).toMatch(/release target/i);
  });

  it("requires an x.x.x release id and trims surrounding whitespace", () => {
    const invalid = validateBatch({ releaseTargets: ["2.0"], auditUser: "SYSTEM", rows: validRows });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.join(" ")).toMatch(/x\.x\.x/);

    const padded = validateBatch({ releaseTargets: ["  2.0.29  "], auditUser: "SYSTEM", rows: validRows });
    expect(padded.ok).toBe(true);
    expect(padded.releaseTargets).toEqual(["2.0.29"]);
  });

  it("requires an audit trail", () => {
    const result = validateBatch({ releaseTargets: ["2.0.29"], auditUser: "   ", rows: validRows });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/audit trail is required/i);
  });

  it("ignores blank grid rows and warns about empty values", () => {
    const result = validateBatch({
      releaseTargets: ["2.0.29"],
      auditUser: "SYSTEM",
      rows: [
        { key: "", idValue: "", enValue: "" },
        { key: "k", idValue: "", enValue: "ok" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/empty/i);
  });
});

describe("generateInsertSql", () => {
  it("renders the Quick Query-style two-table script with a shared version id", () => {
    const ids = ["version-id", "update-id-1", "update-id-2"];
    const sql = generateInsertSql({
      releaseTargets: ["2.0.29"],
      auditUser: "O'Brien",
      rows: [
        { key: "alpha", idValue: "It's here", enValue: "It's here" },
        { key: "beta", idValue: "B", enValue: "" },
      ],
      uuidFn: () => ids.shift(),
    });

    expect(sql.startsWith("SET DEFINE OFF;")).toBe(true);
    expect(sql).toContain("INSERT INTO LOCALIZATION.LANGUAGE_PACK_VERSION");
    expect(sql).toContain(
      "VALUES ('version-id', '2.0.29', (SELECT NVL(MAX(LANGUAGE_PACK_VERSION)+1, 1) FROM LOCALIZATION.LANGUAGE_PACK_VERSION), 'O''Brien', SYSDATE, 'O''Brien', SYSDATE);",
    );
    expect(sql.match(/INSERT INTO LOCALIZATION\.LANGUAGE_PACK_UPDATE/g)).toHaveLength(2);
    expect(sql.match(/'version-id'/g)).toHaveLength(3);
    expect(sql).toContain("'It''s here'");
    expect(sql).toContain("------ SELECT Statement --------");
    expect(sql).toContain("FETCH FIRST 12 ROWS ONLY;");
    expect(sql).toContain("SELECT * FROM LOCALIZATION.LANGUAGE_PACK_VERSION WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE");
    expect(sql).toContain("SELECT * FROM LOCALIZATION.LANGUAGE_PACK_UPDATE WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE");
    expect(sql).not.toContain("COMMIT;");
  });

  it("emits one version row and one update copy per release target", () => {
    const ids = ["version-1", "update-1a", "update-1b", "version-2", "update-2a", "update-2b"];
    const sql = generateInsertSql({
      releaseTargets: ["2.0.29", "2.0.30"],
      auditUser: "SYSTEM",
      rows: [
        { key: "alpha", idValue: "A", enValue: "Alpha" },
        { key: "beta", idValue: "B", enValue: "Beta" },
      ],
      uuidFn: () => ids.shift(),
    });

    expect(sql.match(/INSERT INTO LOCALIZATION\.LANGUAGE_PACK_VERSION/g)).toHaveLength(2);
    expect(sql.match(/INSERT INTO LOCALIZATION\.LANGUAGE_PACK_UPDATE/g)).toHaveLength(4);
    expect(sql.match(/'version-1'/g)).toHaveLength(3);
    expect(sql.match(/'version-2'/g)).toHaveLength(3);
    expect(sql).toContain("-- RELEASE_ID 1: 2.0.29");
    expect(sql).toContain("-- RELEASE_ID 2: 2.0.30");
    expect(sql).not.toContain("-- Run all statements in order");
    expect(sql).toContain("FETCH FIRST 14 ROWS ONLY;");
    ["update-1a", "update-1b", "update-2a", "update-2b"].forEach((id) => {
      expect(sql.split(`'${id}'`)).toHaveLength(2);
    });
    expect(ids).toHaveLength(0);
  });

  it("escapes single quotes", () => {
    expect(escapeSqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(escapeSqlLiteral("")).toBe("''");
  });
});
