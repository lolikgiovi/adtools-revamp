import { describe, it, expect } from "vitest";
import { MasterLockeyService } from "../service.js";

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

    describe("whole word search", () => {
      const testRows = [
        { key: "btn1", id: "Kartu Kredit", en: "Credit Card" },
        { key: "btn2", id: "Kartu Kredit Utama", en: "Primary Credit Card" },
        { key: "btn3", id: "Aktivasi Kartu", en: "Card Activation" },
        { key: "btn4", id: "testing test tested", en: "test testing" },
      ];

      it("should match whole word only when enabled", () => {
        const result = service.filterByContent(testRows, languages, "Kartu", true);
        // Should match all rows containing "Kartu" as a whole word
        expect(result).toHaveLength(3);
        expect(result.map((r) => r.key)).toEqual(["btn1", "btn2", "btn3"]);
      });

      it("should match partial words when whole word is disabled", () => {
        const result = service.filterByContent(testRows, languages, "test", false);
        // Should match "testing", "test", and "tested"
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe("btn4");
      });

      it("should only match exact word when whole word is enabled", () => {
        const result = service.filterByContent(testRows, languages, "test", true);
        // Should only match standalone "test", not "testing" or "tested"
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe("btn4");
      });

      it("should handle multi-word queries with whole word search", () => {
        const result = service.filterByContent(testRows, languages, "Credit Card", true);
        // Should match both rows containing "Credit Card"
        expect(result).toHaveLength(2);
        expect(result.map((r) => r.key)).toEqual(["btn1", "btn2"]);
      });
    });

    describe("real-world sample data tests", () => {
      // Simulate data from sample.json
      const sampleRows = [
        {
          key: "vobddrybt.dd.BxbkLddtCotplytyTdtlyLxbyl",
          dd: "Bxbk Lxdbbyx",
          en: "Other Banks",
        },
        {
          key: "vobddrybt.dd.BxbkLddtPopulxkTdtlyLxbyl",
          dd: "Pxldbg Sykdbg Ddtuju",
          en: "Popular Destinations",
        },
        {
          key: "vudxAvvvoubtSyttdbgAvtdvxtdobFkyyAvtdvxtdobButtob",
          dd: "Oky",
          en: "Okay",
        },
      ];

      it("should filter Indonesian text with special characters", () => {
        const result = service.filterByContent(sampleRows, ["dd", "en"], "Bxbk");
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe("vobddrybt.dd.BxbkLddtCotplytyTdtlyLxbyl");
      });

      it("should handle whole word search with special characters", () => {
        const result = service.filterByContent(sampleRows, ["dd", "en"], "Pxldbg", true);
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe("vobddrybt.dd.BxbkLddtPopulxkTdtlyLxbyl");
      });

      it("should filter by short abbreviations", () => {
        const result = service.filterByContent(sampleRows, ["dd", "en"], "Oky", true);
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe("vudxAvvvoubtSyttdbgAvtdvxtdobFkyyAvtdvxtdobButtob");
      });
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

  // =====================
  // Confluence Integration Tests
  // =====================

  describe("parseConfluenceTableForLockeys", () => {
    it("should parse table with 'Localization Key' header", () => {
      const html = `
        <table>
          <tr><th>Localization Key</th><th>Description</th></tr>
          <tr><td>homeScreenTitle</td><td>Home Title</td></tr>
          <tr><td>homeScreenSubtitle</td><td>Home Subtitle</td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(2);
      expect(result[0].key).toBe("homeScreenTitle");
      expect(result[0].status).toBe("plain");
    });

    it("should parse table with 'Lockey' header (case-insensitive)", () => {
      const html = `
        <table>
          <tr><th>LOCKEY</th></tr>
          <tr><td>myKey</td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("myKey");
    });

    it("should extract key with color styling as 'plain' status (color detection not implemented)", () => {
      const html = `
        <table>
          <tr><th>Lockey</th></tr>
          <tr><td><span style="color: blue;">newFeatureKey</span></td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(1);
      // Note: Color detection is not implemented, so colored text returns 'plain'
      expect(result[0].status).toBe("plain");
    });

    it("should detect strikethrough as 'striked' status", () => {
      const html = `
        <table>
          <tr><th>Lockey</th></tr>
          <tr><td><del>oldKeyRemoved</del></td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("striked");
    });

    it("should detect strikethrough with color as 'striked' status (color not tracked separately)", () => {
      const html = `
        <table>
          <tr><th>Lockey</th></tr>
          <tr><td><del><span style="color: red;">recentlyRemovedKey</span></del></td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(1);
      // Strikethrough takes precedence; color is not tracked separately
      expect(result[0].status).toBe("striked");
    });

    it("should return empty array for empty content", () => {
      expect(service.parseConfluenceTableForLockeys("")).toEqual([]);
      expect(service.parseConfluenceTableForLockeys(null)).toEqual([]);
    });

    it("should return empty array if no lockey column found", () => {
      const html = `
        <table>
          <tr><th>Name</th><th>Value</th></tr>
          <tr><td>foo</td><td>bar</td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(0);
    });

    it("should reject dotted values like 'context.key' in main column", () => {
      const html = `
        <table>
          <tr><th>Lockey</th></tr>
          <tr><td>context.someKey</td></tr>
          <tr><td>prefix.anotherKey</td></tr>
          <tr><td>validCamelCase</td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("validCamelCase");
    });

    it("should extract camelCase value from nested table with 'lockey' column header", () => {
      // Note: The service only looks for columns matching lockeyColumnNames:
      // ["localization key", "lockey", "loc key", "localizationkey", "loc_key"]
      // 'Value' is not in this list, so we use 'Lockey' as the column header
      const html = `
        <table>
          <tr><th>Lockey</th></tr>
          <tr><td>
            <table>
              <tr><th>Context</th><th>Lockey</th></tr>
              <tr><td>context.x.something</td><td>myLockeyKey</td></tr>
            </table>
          </td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("myLockeyKey");
    });

    it("should extract from nested table with 'lockey' column", () => {
      const html = `
        <table>
          <tr><th>Localization Key</th></tr>
          <tr><td>
            <table>
              <tr><th>Lockey</th><th>Other</th></tr>
              <tr><td>camelCaseValue</td><td>ignored</td></tr>
            </table>
          </td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("camelCaseValue");
    });

    it("should reject dotted values like 'context.x.key' from nested tables", () => {
      const html = `
        <table>
          <tr><th>Lockey</th></tr>
          <tr><td>
            <table>
              <tr><th>Value</th></tr>
              <tr><td>context.x.someKey</td></tr>
            </table>
          </td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(0);
    });
  });

  describe("isStandaloneCamelCase", () => {
    it("should accept valid camelCase identifiers", () => {
      expect(service.isStandaloneCamelCase("myKey")).toBe(true);
      expect(service.isStandaloneCamelCase("anotherLockeyName")).toBe(true);
      expect(service.isStandaloneCamelCase("simpleValue")).toBe(true);
      expect(service.isStandaloneCamelCase("key123")).toBe(true);
    });

    it("should reject dotted values", () => {
      expect(service.isStandaloneCamelCase("context.x.key")).toBe(false);
      expect(service.isStandaloneCamelCase("prefix.value")).toBe(false);
      expect(service.isStandaloneCamelCase("x.camelCase")).toBe(false);
    });

    it("should reject invalid formats", () => {
      expect(service.isStandaloneCamelCase("")).toBe(false);
      expect(service.isStandaloneCamelCase(null)).toBe(false);
      expect(service.isStandaloneCamelCase("123key")).toBe(false);
      expect(service.isStandaloneCamelCase("Key")).toBe(false); // Starts with uppercase
    });
  });

  describe("extractCamelCaseKeysFromText", () => {
    it("should extract camelCase keys (15+ chars) from inline text", () => {
      const text =
        "IF features[] contains 'livin-care-voip' then livinCareLandingCallUsCardVoipTitleLabel ELSE livinCareLandingCallUsCardCallCenterTitleLabel";
      const result = service.extractCamelCaseKeysFromText(text);
      expect(result).toHaveLength(2);
      expect(result).toContain("livinCareLandingCallUsCardVoipTitleLabel");
      expect(result).toContain("livinCareLandingCallUsCardCallCenterTitleLabel");
    });

    it("should reject keys shorter than 15 characters", () => {
      const text = "forEach indexOf myShortKey someLongerKeyThatMakesIt";
      const result = service.extractCamelCaseKeysFromText(text);
      // Only someLongerKeyThatMakesIt should pass (21 chars)
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("someLongerKeyThatMakesIt");
    });

    it("should require at least one uppercase letter after first char", () => {
      const text = "somelongertextwithnouppercase ALLUPPER SomeLongCamelCaseKey";
      const result = service.extractCamelCaseKeysFromText(text);
      // Only SomeLongCamelCaseKey would match but it starts with uppercase
      // Actually, pattern requires lowercase start, so nothing matches uppercase start
      expect(result).toHaveLength(0);
    });

    it("should handle empty or null input", () => {
      expect(service.extractCamelCaseKeysFromText("")).toEqual([]);
      expect(service.extractCamelCaseKeysFromText(null)).toEqual([]);
      expect(service.extractCamelCaseKeysFromText(undefined)).toEqual([]);
    });

    it("should not extract dotted values (property accessors)", () => {
      const text = "context.x.livinCareLandingCallUsCardVoipTitleLabel";
      const result = service.extractCamelCaseKeysFromText(text);
      // Should NOT extract because it's preceded by a dot (property accessor)
      expect(result).not.toContain("livinCareLandingCallUsCardVoipTitleLabel");
      expect(result).toHaveLength(0);
    });

    it("should handle lowercase keywords with spaces (if, else)", () => {
      // Lowercase keywords work when they have spaces around them (realistic Confluence output)
      const text = "if someCondition then livinCareLandingCallUsTitle else livinCareLandingCallUsDescription";
      const result = service.extractCamelCaseKeysFromText(text);
      expect(result).toHaveLength(2);
      expect(result).toContain("livinCareLandingCallUsTitle");
      expect(result).toContain("livinCareLandingCallUsDescription");
    });

    it("should handle ALL-CAPS keywords concatenated (ELSE)", () => {
      // This is the realistic case when Confluence bullet points get stripped
      // The text becomes: "...TitleLabelELSE..." which is handled by the ALL-CAPS splitting
      const text = "livinCareLandingCallUsCardVoipTitleLabelELSElivinCareLandingCallUsCardCallCenterTitleLabel";
      const result = service.extractCamelCaseKeysFromText(text);
      expect(result).toHaveLength(2);
      expect(result).toContain("livinCareLandingCallUsCardVoipTitleLabel");
      expect(result).toContain("livinCareLandingCallUsCardCallCenterTitleLabel");
    });

    it("should not break camelCase words containing keyword substrings", () => {
      // Words like "Landing" contain "and", "Contains" contains "contain"
      // These should NOT be split
      const text = "livinCareLandingCallUsCardVoipTitleLabel";
      const result = service.extractCamelCaseKeysFromText(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("livinCareLandingCallUsCardVoipTitleLabel");
    });

    it("should handle mixed case keywords with spaces", () => {
      // Mixed case keywords work when space-separated
      const text = "someValue Else anotherVeryLongValueHere";
      const result = service.extractCamelCaseKeysFromText(text);
      expect(result).toHaveLength(1);
      expect(result).toContain("anotherVeryLongValueHere");
    });
  });

  describe("parseConfluenceTableForLockeys with inline statements", () => {
    it("should extract embedded lockeys from inline statements as 'uncertain'", () => {
      const html = `
        <table>
          <tr><th>Lockey</th></tr>
          <tr><td>IF features[] contains 'voip' livinCareLandingCallUsCardVoipTitleLabel ELSE livinCareLandingCallUsCardCenterLabel</td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.status === "uncertain")).toBe(true);
      expect(result.map((r) => r.key)).toContain("livinCareLandingCallUsCardVoipTitleLabel");
      expect(result.map((r) => r.key)).toContain("livinCareLandingCallUsCardCenterLabel");
    });

    it("should prefer 'plain' over 'uncertain' in deduplication", () => {
      const html = `
        <table>
          <tr><th>Lockey</th></tr>
          <tr><td>homeScreenTitleLabel</td></tr>
          <tr><td>Also homeScreenTitleLabel embedded in text</td></tr>
        </table>
      `;
      const result = service.parseConfluenceTableForLockeys(html);
      // homeScreenTitleLabel should appear once with 'plain' status
      const homeKey = result.find((r) => r.key === "homeScreenTitleLabel");
      expect(homeKey).toBeDefined();
      expect(homeKey.status).toBe("plain");
    });
  });

  describe("compareLockeyWithRemote", () => {
    const remoteData = {
      rows: [{ key: "existing.key1" }, { key: "existing.key2" }],
    };

    it("should mark existing keys as inRemote: true", () => {
      const lockeys = [{ key: "existing.key1", status: "plain" }];
      const result = service.compareLockeyWithRemote(lockeys, remoteData);
      expect(result[0].inRemote).toBe(true);
    });

    it("should mark missing keys as inRemote: false", () => {
      const lockeys = [{ key: "missing.key", status: "plain" }];
      const result = service.compareLockeyWithRemote(lockeys, remoteData);
      expect(result[0].inRemote).toBe(false);
    });

    it("should handle empty remoteData", () => {
      const lockeys = [{ key: "test.key", status: "plain" }];
      const result = service.compareLockeyWithRemote(lockeys, null);
      expect(result[0].inRemote).toBe(false);
    });

    it("should preserve status from input", () => {
      const lockeys = [{ key: "existing.key1", status: "new" }];
      const result = service.compareLockeyWithRemote(lockeys, remoteData);
      expect(result[0].status).toBe("new");
      expect(result[0].inRemote).toBe(true);
    });
  });

  describe("exportAsTsv", () => {
    it("should format data as TSV with header", () => {
      const data = [
        { key: "key1", status: "plain", inRemote: true },
        { key: "key2", status: "striked", inRemote: false },
      ];
      const result = service.exportAsTsv(data);
      const lines = result.split("\n");
      expect(lines[0]).toBe("Lockey\tConflu Style\tIn Remote");
      expect(lines[1]).toBe("key1\tPlain\tYes");
      expect(lines[2]).toBe("key2\tStriked\tNo");
    });
  });

  describe("exportAsCsv", () => {
    it("should format data as CSV with header", () => {
      const data = [{ key: "key1", status: "plain", inRemote: true }];
      const result = service.exportAsCsv(data);
      const lines = result.split("\n");
      expect(lines[0]).toBe("Lockey,Conflu Style,In Remote");
      expect(lines[1]).toBe("key1,Plain,Yes");
    });

    it("should escape commas in values", () => {
      const data = [{ key: "key,with,commas", status: "plain", inRemote: true }];
      const result = service.exportAsCsv(data);
      expect(result).toContain('"key,with,commas"');
    });
  });
});
