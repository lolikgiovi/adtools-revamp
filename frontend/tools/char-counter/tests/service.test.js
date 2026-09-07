import { describe, expect, it } from "vitest";
import { getLineCounts, getTextCounts } from "../service.js";

describe("getTextCounts", () => {
  it("returns zero counts for empty text", () => {
    expect(getTextCounts("")).toEqual({
      characters: 0,
      charactersNoSpaces: 0,
      words: 0,
      lines: 0,
      bytes: 0,
    });
  });

  it("counts common text metrics", () => {
    expect(getTextCounts("Hello world\nAgain")).toEqual({
      characters: 17,
      charactersNoSpaces: 15,
      words: 3,
      lines: 2,
      bytes: 17,
    });
  });

  it("counts emoji and combining marks as user-perceived characters", () => {
    const counts = getTextCounts("👨‍👩‍👧‍👦 e\u0301");

    expect(counts.characters).toBe(3);
    expect(counts.charactersNoSpaces).toBe(2);
    expect(counts.words).toBe(1);
    expect(counts.bytes).toBe(new TextEncoder().encode("👨‍👩‍👧‍👦 e\u0301").length);
  });

  it("supports Windows and classic Mac line endings", () => {
    expect(getTextCounts("one\r\ntwo\rthree").lines).toBe(3);
  });
});

describe("getLineCounts", () => {
  it("returns the length of each row", () => {
    expect(getLineCounts("config-integration-service-code-01\nconfig-integration-service-code-0124234234")).toEqual([
      { line: 1, content: "config-integration-service-code-01", characters: 34 },
      { line: 2, content: "config-integration-service-code-0124234234", characters: 42 },
    ]);
  });

  it("preserves empty rows and counts Unicode graphemes", () => {
    expect(getLineCounts("👨‍👩‍👧‍👦\n\ne\u0301")).toEqual([
      { line: 1, content: "👨‍👩‍👧‍👦", characters: 1 },
      { line: 2, content: "", characters: 0 },
      { line: 3, content: "e\u0301", characters: 1 },
    ]);
  });

  it("returns no rows for empty text", () => {
    expect(getLineCounts("")).toEqual([]);
  });
});
