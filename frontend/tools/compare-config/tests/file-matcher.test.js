/**
 * Unit tests for file-matcher.js
 */
import { describe, it, expect } from "vitest";
import {
  autoMatch,
  autoMatchFolders,
  getRelativePath,
  extractBaseDir,
  getMatchStats,
  areFileNamesSimilar,
  suggestMatches,
  createManualMatch,
} from "../lib/file-matcher.js";

// Helper to create mock File objects
function createMockFile(name, webkitRelativePath = "") {
  return {
    name,
    webkitRelativePath: webkitRelativePath || name,
    size: 0,
    type: "",
  };
}

describe("FileMatcher", () => {
  describe("autoMatch", () => {
    it("matches files with same name", () => {
      const refFiles = [createMockFile("data.xlsx"), createMockFile("report.csv")];
      const compFiles = [createMockFile("data.xlsx"), createMockFile("report.csv")];

      const result = autoMatch(refFiles, compFiles);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedRef).toHaveLength(0);
      expect(result.unmatchedComp).toHaveLength(0);
    });

    it("is case-insensitive", () => {
      const refFiles = [createMockFile("DATA.XLSX")];
      const compFiles = [createMockFile("data.xlsx")];

      const result = autoMatch(refFiles, compFiles);

      expect(result.matches).toHaveLength(1);
    });

    it("tracks unmatched reference files", () => {
      const refFiles = [createMockFile("file1.xlsx"), createMockFile("file2.xlsx")];
      const compFiles = [createMockFile("file1.xlsx")];

      const result = autoMatch(refFiles, compFiles);

      expect(result.matches).toHaveLength(1);
      expect(result.unmatchedRef).toHaveLength(1);
      expect(result.unmatchedRef[0].name).toBe("file2.xlsx");
    });

    it("tracks unmatched comparator files", () => {
      const refFiles = [createMockFile("file1.xlsx")];
      const compFiles = [createMockFile("file1.xlsx"), createMockFile("extra.xlsx")];

      const result = autoMatch(refFiles, compFiles);

      expect(result.matches).toHaveLength(1);
      expect(result.unmatchedComp).toHaveLength(1);
      expect(result.unmatchedComp[0].name).toBe("extra.xlsx");
    });

    it("handles empty inputs", () => {
      expect(autoMatch([], [])).toEqual({
        matches: [],
        unmatchedRef: [],
        unmatchedComp: [],
      });

      const files = [createMockFile("a.xlsx")];
      expect(autoMatch(files, [])).toEqual({
        matches: [],
        unmatchedRef: files,
        unmatchedComp: [],
      });

      expect(autoMatch([], files)).toEqual({
        matches: [],
        unmatchedRef: [],
        unmatchedComp: files,
      });
    });

    it("handles duplicate filenames in comparator", () => {
      const refFiles = [createMockFile("file.xlsx")];
      const compFiles = [createMockFile("file.xlsx"), createMockFile("file.xlsx")];

      const result = autoMatch(refFiles, compFiles);

      expect(result.matches).toHaveLength(1);
      expect(result.unmatchedComp).toHaveLength(1);
    });
  });

  describe("autoMatchFolders", () => {
    it("matches files by relative path", () => {
      const refFiles = [createMockFile("data.xlsx", "folderA/sub/data.xlsx"), createMockFile("report.xlsx", "folderA/report.xlsx")];
      const compFiles = [createMockFile("data.xlsx", "folderB/sub/data.xlsx"), createMockFile("report.xlsx", "folderB/report.xlsx")];

      const result = autoMatchFolders(refFiles, compFiles, "folderA", "folderB");

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].relativePath).toBe("sub/data.xlsx");
    });

    it("is case-insensitive for paths", () => {
      const refFiles = [createMockFile("a.xlsx", "FolderA/SUB/a.xlsx")];
      const compFiles = [createMockFile("a.xlsx", "FolderB/sub/a.xlsx")];

      const result = autoMatchFolders(refFiles, compFiles, "FolderA", "FolderB");

      expect(result.matches).toHaveLength(1);
    });
  });

  describe("getRelativePath", () => {
    it("strips base directory", () => {
      const file = createMockFile("data.xlsx", "myFolder/sub/data.xlsx");
      expect(getRelativePath(file, "myFolder")).toBe("sub/data.xlsx");
    });

    it("returns full path if base not found", () => {
      const file = createMockFile("data.xlsx", "other/data.xlsx");
      expect(getRelativePath(file, "myFolder")).toBe("other/data.xlsx");
    });

    it("returns filename if no webkitRelativePath", () => {
      const file = createMockFile("data.xlsx", "");
      // Need to clear webkitRelativePath
      file.webkitRelativePath = "";
      expect(getRelativePath(file, "anything")).toBe("data.xlsx");
    });
  });

  describe("extractBaseDir", () => {
    it("extracts first path segment", () => {
      const files = [createMockFile("a.xlsx", "myFolder/a.xlsx"), createMockFile("b.xlsx", "myFolder/sub/b.xlsx")];
      expect(extractBaseDir(files)).toBe("myFolder");
    });

    it("returns null for empty array", () => {
      expect(extractBaseDir([])).toBeNull();
    });

    it("returns null if no webkitRelativePath", () => {
      const files = [createMockFile("a.xlsx", "")];
      files[0].webkitRelativePath = "";
      expect(extractBaseDir(files)).toBeNull();
    });
  });

  describe("getMatchStats", () => {
    it("calculates statistics correctly", () => {
      const result = {
        matches: [{}, {}, {}],
        unmatchedRef: [{}, {}],
        unmatchedComp: [{}],
      };

      const stats = getMatchStats(result);

      expect(stats.matched).toBe(3);
      expect(stats.unmatchedRef).toBe(2);
      expect(stats.unmatchedComp).toBe(1);
      expect(stats.total).toBe(6);
    });
  });

  describe("areFileNamesSimilar", () => {
    it("returns true for identical names", () => {
      expect(areFileNamesSimilar("file.xlsx", "file.xlsx")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(areFileNamesSimilar("FILE.xlsx", "file.xlsx")).toBe(true);
    });

    it("returns true for similar names", () => {
      // Files with significant common substring should match (LCS/maxLen >= 0.4)
      // 'report.xlsx' (11) vs 'report2.xlsx' (12) -> LCS = 'report.' (7) -> 7/12 = 58%
      expect(areFileNamesSimilar("report.xlsx", "report2.xlsx")).toBe(true);
      // 'data.csv' (8) vs 'data_v2.csv' (11) -> LCS = 'data' (4) -> 4/11 = 36% - slightly below but check
      expect(areFileNamesSimilar("data.csv", "data_v2.csv", 0.3)).toBe(true);
    });

    it("returns false for very different names", () => {
      expect(areFileNamesSimilar("abc.xlsx", "xyz.csv")).toBe(false);
    });

    it("respects threshold parameter", () => {
      // With high threshold, require more similarity
      expect(areFileNamesSimilar("abc", "abd", 0.9)).toBe(false);
      // With lower threshold, accept less similarity
      expect(areFileNamesSimilar("abc", "abd", 0.5)).toBe(true);
    });
  });

  describe("suggestMatches", () => {
    it("suggests similar files", () => {
      const unmatchedRef = [createMockFile("config.xlsx"), createMockFile("unique.csv")];
      const unmatchedComp = [createMockFile("config_backup.xlsx"), createMockFile("other.xlsx")];

      const suggestions = suggestMatches(unmatchedRef, unmatchedComp);

      expect(suggestions.length).toBeGreaterThan(0);
      const configSuggestion = suggestions.find((s) => s.reference.name === "config.xlsx");
      expect(configSuggestion).toBeDefined();
      expect(configSuggestion.candidates.length).toBeGreaterThan(0);
    });

    it("returns empty for no similar files", () => {
      const unmatchedRef = [createMockFile("abc.xlsx")];
      const unmatchedComp = [createMockFile("xyz.csv")];

      const suggestions = suggestMatches(unmatchedRef, unmatchedComp);

      expect(suggestions).toHaveLength(0);
    });
  });

  describe("createManualMatch", () => {
    it("creates a match with isManual flag", () => {
      const ref = createMockFile("a.xlsx");
      const comp = createMockFile("b.xlsx");

      const match = createManualMatch(ref, comp);

      expect(match.reference).toBe(ref);
      expect(match.comparator).toBe(comp);
      expect(match.isManual).toBe(true);
    });
  });
});
