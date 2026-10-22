import { expect, it } from "vitest";
import { analyzeSql } from "../sql-analysis.js";
it("finds actual binds without interpreting quoted strings, identifiers or comments", () => {
  const result = analyzeSql(`select count(*) AS TOTAL from T where d >= :startDate and d < :endDate
    and x=':ignored' and y=q'[Bob''s :ignored]' -- :ignored
    /* :ignored */ and z=":ignored"`);
  expect(result.binds).toEqual(["startDate", "endDate"]);
});
it("reports simple aliases but marks wildcard and nested projections unverified", () => {
  expect(analyzeSql("select count(*) AS TOTAL, sum(AMOUNT) VALUE from TX").aliases).toEqual(["TOTAL", "VALUE"]);
  expect(analyzeSql("select * from TX").projectionVerified).toBe(false);
  expect(analyzeSql("select (select max(ID) from OTHER) RESULT from TX").projectionVerified).toBe(false);
});
