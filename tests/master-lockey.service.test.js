import { describe, it, expect } from "vitest";
import { MasterLockeyService } from "../app/tools/master-lockey/service.js";

describe("MasterLockeyService", () => {
  const service = new MasterLockeyService();

  describe("parseLockeyData", () => {
    it("should parse valid JSON with multiple languages", () => {
      const json = {
        content: {
          id: { key1: "Halo", key2: "Selamat pagi" },
          en: { key1: "Hello", key2: "Good morning" },
          zh: { key1: "你好", key2: "早上好" },
        },
        languagePackId: "test-uuid-123",
      };

      const result = service.parseLockeyData(json);

      expect(result.languagePackId).toBe("test-uuid-123");
      expect(result.languages).toEqual(["id", "en", "zh"]);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({
        key: "key1",
        id: "Halo",
        en: "Hello",
        zh: "你好",
      });
    });

    it("should handle missing languagePackId", () => {
      const json = {
        content: {
          en: { key1: "Hello" },
        },
      };

      const result = service.parseLockeyData(json);
      expect(result.languagePackId).toBe("N/A");
    });

    it("should throw error for invalid JSON structure", () => {
      expect(() => service.parseLockeyData(null)).toThrow("Invalid JSON structure");
      expect(() => service.parseLockeyData({})).toThrow('Missing "content" property');
      expect(() => service.parseLockeyData({ content: {} })).toThrow("No language data found");
    });
  });

  describe("filterByKeys", () => {
    const rows = [
      { key: "user.name", en: "Name" },
      { key: "user.email", en: "Email" },
      { key: "product.title", en: "Title" },
    ];

    it("should filter by single key", () => {
      const result = service.filterByKeys(rows, "user.name");
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("user.name");
    });

    it("should filter by multiple keys (comma-separated)", () => {
      const result = service.filterByKeys(rows, "user.name, product.title");
      expect(result).toHaveLength(2);
    });

    it("should support partial key matching", () => {
      const result = service.filterByKeys(rows, "user");
      expect(result).toHaveLength(2);
    });

    it("should be case-insensitive", () => {
      const result = service.filterByKeys(rows, "USER.NAME");
      expect(result).toHaveLength(1);
    });

    it("should return all rows if query is empty", () => {
      const result = service.filterByKeys(rows, "");
      expect(result).toHaveLength(3);
    });
  });

  describe("filterByContent", () => {
    const rows = [
      { key: "key1", id: "Halo dunia", en: "Hello world" },
      { key: "key2", id: "Selamat pagi", en: "Good morning" },
      { key: "key3", id: "Terima kasih", en: "Thank you" },
    ];
    const languages = ["id", "en"];

    it("should filter by content across all languages", () => {
      const result = service.filterByContent(rows, languages, "morning");
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("key2");
    });

    it("should filter by content in specific language", () => {
      const result = service.filterByContent(rows, languages, "kasih", false, "id");
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("key3");
    });

    it("should be case-insensitive", () => {
      const result = service.filterByContent(rows, languages, "HELLO");
      expect(result).toHaveLength(1);
    });

    it("should return all rows if query is empty", () => {
      const result = service.filterByContent(rows, languages, "");
      expect(result).toHaveLength(3);
    });
  });

  describe("filterData", () => {
    const rows = [
      { key: "user.name", id: "Nama", en: "Name" },
      { key: "user.email", id: "Email", en: "Email" },
    ];
    const languages = ["id", "en"];

    it("should filter by key mode", () => {
      const result = service.filterData(rows, {
        mode: "key",
        query: "email",
        languages,
      });
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("user.email");
    });

    it("should filter by content mode", () => {
      const result = service.filterData(rows, {
        mode: "content",
        query: "Nama",
        languages,
      });
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("user.name");
    });
  });

  describe("formatTimestamp", () => {
    it("should format recent timestamps", () => {
      const now = Date.now();
      expect(service.formatTimestamp(now)).toBe("Just now");
      expect(service.formatTimestamp(now - 120000)).toContain("min"); // 2 mins ago
      expect(service.formatTimestamp(now - 7200000)).toContain("hour"); // 2 hours ago
      expect(service.formatTimestamp(now - 172800000)).toContain("day"); // 2 days ago
    });
  });
});
