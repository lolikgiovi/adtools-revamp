// @vitest-environment node
// Failure modes for one-step Generate & Run:
// 1. Empty editor is sent to Run Query instead of generating first.
// 2. The grid changed after generating, and stale SQL is run.
// 3. The user hand-edited SQL, and Run silently overwrites their edits by regenerating.
// 4. Nothing changed, and Run regenerates anyway (re-prompting BLOB/CONFIG_ID dialogs).
// 5. Generation fails or is cancelled, and Run Query still opens with empty or old SQL.
import { describe, expect, it } from "vitest";
import { fingerprintQueryInputs, needsRegeneration } from "../services/GenerateAndRunService.js";

describe("Generate & Run freshness", () => {
  const inputs = { tableName: "APP.ITEM", queryType: "merge", schemaData: [["ID", "NUMBER"]], inputData: [["ID"], [1]] };
  const fingerprint = fingerprintQueryInputs(inputs);
  const generated = { sql: "MERGE INTO APP.ITEM ...", fingerprint };

  it("generates when the editor is empty", () => {
    expect(needsRegeneration({ sql: "  ", fingerprint, generated })).toBe(true);
    expect(needsRegeneration({ sql: "", fingerprint, generated: null })).toBe(true);
  });

  it("regenerates when the grid changed since the SQL was generated", () => {
    const changed = fingerprintQueryInputs({ ...inputs, inputData: [["ID"], [2]] });
    expect(changed).not.toBe(fingerprint);
    expect(needsRegeneration({ sql: generated.sql, fingerprint: changed, generated })).toBe(true);
    expect(fingerprintQueryInputs({ ...inputs, queryType: "insert" })).not.toBe(fingerprint);
    expect(fingerprintQueryInputs({ ...inputs, tableName: "APP.OTHER" })).not.toBe(fingerprint);
  });

  it("keeps hand-edited SQL", () => {
    const changed = fingerprintQueryInputs({ ...inputs, inputData: [["ID"], [2]] });
    expect(needsRegeneration({ sql: `${generated.sql}\n-- reviewed`, fingerprint: changed, generated })).toBe(false);
    expect(needsRegeneration({ sql: "SELECT 1 FROM DUAL", fingerprint, generated: null })).toBe(false);
  });

  it("does not regenerate unchanged SQL", () => {
    expect(needsRegeneration({ sql: generated.sql, fingerprint, generated })).toBe(false);
  });
});
