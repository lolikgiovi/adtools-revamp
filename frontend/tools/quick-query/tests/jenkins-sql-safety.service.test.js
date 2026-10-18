import { analyzeJenkinsSql, convertJenkinsUnsafeLiterals } from "../services/JenkinsSqlSafetyService.js";

describe("Jenkins SQL safety", () => {
  it("finds shell-sensitive content inside SQL literals but ignores comments", () => {
    expect(analyzeJenkinsSql("UPDATE config SET body = to_clob('Hello #if($active)') WHERE id = '7';")).toEqual(
      expect.objectContaining({ safe: false, literalCount: 1, characters: ["#", "$"] }),
    );
    expect(analyzeJenkinsSql("-- # comment\nUPDATE config SET body = 'safe' WHERE id = '7';").safe).toBe(true);
  });

  it("rewrites only unsafe literals as Oracle Base64 decode expressions", () => {
    const converted = convertJenkinsUnsafeLiterals("UPDATE config SET body = to_clob('Hello #if($active) It''s ready') WHERE id = '7';");

    expect(converted).toContain("to_clob(UTL_RAW.CAST_TO_VARCHAR2(UTL_ENCODE.BASE64_DECODE");
    expect(converted).toContain("WHERE id = '7'");
    expect(analyzeJenkinsSql(converted).safe).toBe(true);
  });

  it("leaves SQL unchanged when no unsafe literal exists", () => {
    const sql = "UPDATE config SET body = to_clob('Hello world') WHERE id = '7';";
    expect(convertJenkinsUnsafeLiterals(sql)).toBe(sql);
  });

  it("chunks large UTF-8 values below Oracle string literal limits", () => {
    const converted = convertJenkinsUnsafeLiterals(`UPDATE config SET body = to_clob('${"你好#".repeat(1200)}');`);
    const chunks = [...converted.matchAll(/CAST_TO_RAW\('([^']+)'\)/g)].map((match) => match[1]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length < 4000)).toBe(true);
    expect(analyzeJenkinsSql(converted).safe).toBe(true);
  });
});
