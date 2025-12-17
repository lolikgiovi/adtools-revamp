import { describe, it, expect, beforeEach, vi } from "vitest";
import { MasterLockey } from "../app/tools/master-lockey/main.js";

describe("MasterLockey - escapeSpecialChars", () => {
  let tool;

  beforeEach(() => {
    // Create a mock eventBus
    const mockEventBus = {
      on: vi.fn(),
      emit: vi.fn(),
    };

    tool = new MasterLockey(mockEventBus);
  });

  describe("escapeSpecialChars", () => {
    it("should escape newline characters", () => {
      const input = "Line 1\nLine 2";
      const result = tool.escapeSpecialChars(input);
      expect(result).toBe("Line 1\\nLine 2");
    });

    it("should escape tab characters", () => {
      const input = "Column1\tColumn2";
      const result = tool.escapeSpecialChars(input);
      expect(result).toBe("Column1\\tColumn2");
    });

    it("should escape carriage return characters", () => {
      const input = "Text\rMore text";
      const result = tool.escapeSpecialChars(input);
      expect(result).toBe("Text\\rMore text");
    });

    it("should escape backslash characters", () => {
      const input = "Path\\to\\file";
      const result = tool.escapeSpecialChars(input);
      expect(result).toBe("Path\\\\to\\\\file");
    });

    it("should escape multiple special characters", () => {
      const input = "Line 1\nLine 2\tTabbed\rReturn\\Path";
      const result = tool.escapeSpecialChars(input);
      expect(result).toBe("Line 1\\nLine 2\\tTabbed\\rReturn\\\\Path");
    });

    it("should handle empty string", () => {
      const result = tool.escapeSpecialChars("");
      expect(result).toBe("");
    });

    it("should handle null/undefined", () => {
      expect(tool.escapeSpecialChars(null)).toBe(null);
      expect(tool.escapeSpecialChars(undefined)).toBe(undefined);
    });

    it("should preserve regular text without special characters", () => {
      const input = "Regular text without special chars";
      const result = tool.escapeSpecialChars(input);
      expect(result).toBe("Regular text without special chars");
    });

    it("should escape form feed and vertical tab", () => {
      const input = "Text\fForm feed\vVertical tab";
      const result = tool.escapeSpecialChars(input);
      expect(result).toBe("Text\\fForm feed\\vVertical tab");
    });
  });

  describe("highlightText", () => {
    it("should escape HTML tags before highlighting", () => {
      const input = "<b>Bold text</b>";
      const query = "Bold";
      const result = tool.highlightText(input, query);

      // Should contain escaped HTML and highlighted text
      expect(result).toContain("&lt;b&gt;");
      expect(result).toContain("&lt;/b&gt;");
      expect(result).toContain('<mark class="search-highlight">Bold</mark>');
    });

    it("should escape newlines and then highlight", () => {
      const input = "Line 1\nLine 2";
      const query = "Line";
      const result = tool.highlightText(input, query);

      // Should contain escaped newline
      expect(result).toContain("\\n");
      // Should contain highlighted text
      expect(result).toContain('<mark class="search-highlight">Line</mark>');
    });

    it("should handle HTML tags with newlines", () => {
      const input = "<div>\nContent\n</div>";
      const query = "Content";
      const result = tool.highlightText(input, query);

      // Should escape both HTML and newlines
      expect(result).toContain("&lt;div&gt;");
      expect(result).toContain("\\n");
      expect(result).toContain('<mark class="search-highlight">Content</mark>');
      expect(result).toContain("&lt;/div&gt;");
    });

    it("should return original text if query is empty", () => {
      const input = "Test text";
      const result = tool.highlightText(input, "");
      expect(result).toBe("Test text");
    });

    it("should return original text if text is empty", () => {
      const result = tool.highlightText("", "query");
      expect(result).toBe("");
    });

    it("should escape special regex characters in query", () => {
      const input = "Price: $100";
      const query = "$100";
      const result = tool.highlightText(input, query);

      // Should highlight the literal $100
      expect(result).toContain('<mark class="search-highlight">$100</mark>');
    });

    it("should handle case-insensitive search", () => {
      const input = "Hello World";
      const query = "hello";
      const result = tool.highlightText(input, query);

      // Should highlight despite case difference
      expect(result).toContain('<mark class="search-highlight">Hello</mark>');
    });

    it("should respect whole word setting when enabled", () => {
      tool.wholeWord = true;
      const input = "testing test tested";
      const query = "test";
      const result = tool.highlightText(input, query);

      // Should only highlight the standalone "test", not "testing" or "tested"
      const matches = result.match(/<mark class="search-highlight">test<\/mark>/gi);
      expect(matches).toHaveLength(1);
    });

    it("should not respect whole word setting when disabled", () => {
      tool.wholeWord = false;
      const input = "testing test tested";
      const query = "test";
      const result = tool.highlightText(input, query);

      // Should highlight "test" in all three words
      const matches = result.match(/<mark class="search-highlight">test<\/mark>/gi);
      expect(matches).toHaveLength(3);
    });
  });

  describe("Integration - HTML and Special Chars", () => {
    it("should handle complex localization content with HTML and escape sequences", () => {
      const input = "At the Livin' app, click <b>Scan QR CSM</b>, then point\nthe camera to the QR code displayed on the screen.";
      const result = tool.escapeSpecialChars(input);

      // Should preserve all special characters as literal text
      expect(result).toContain("\\n");
      expect(result).toContain("Livin'");
      expect(result).toContain("<b>");
      expect(result).toContain("</b>");
    });

    it("should display markdown-like syntax literally", () => {
      const input = "**Bold**\n*Italic*\n- List item";
      const result = tool.escapeSpecialChars(input);

      expect(result).toBe("**Bold**\\n*Italic*\\n- List item");
    });
  });
});
