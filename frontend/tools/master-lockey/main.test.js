import { describe, it, expect, beforeEach, vi } from "vitest";
import { MasterLockey } from "./main.js";

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

    describe("real-world localization content from sample.json", () => {
      it("should handle Indonesian text with newlines and special formatting", () => {
        const input =
          "Proses akan berlangsung hingga __matchStp__ WIB. Kami akan mengirimkan hasil verifikasi Anda melalui Inbox di Pusat Pesan, ya.";
        const result = tool.escapeSpecialChars(input);

        // Should preserve underscores and special characters
        expect(result).toContain("__matchStp__");
        expect(result).toContain("Pusat Pesan");
      });

      it("should handle content with HTML-like tags in localization", () => {
        const input = "Pastikan untuk <b>menyimpan</b> file dengan aman.\nJangan bagikan <i>password</i> Anda.";
        const result = tool.escapeSpecialChars(input);

        // Should escape newlines but preserve HTML tags
        expect(result).toContain("\\n");
        expect(result).toContain("<b>menyimpan</b>");
        expect(result).toContain("<i>password</i>");
      });

      it("should escape content with multiple consecutive newlines", () => {
        const input = "Line 1\n\nLine 2\n\n\nLine 3";
        const result = tool.escapeSpecialChars(input);

        expect(result).toBe("Line 1\\n\\nLine 2\\n\\n\\nLine 3");
      });

      it("should handle mixed Indonesian and English content with special chars", () => {
        const input = "Transfer ke __accountNumber__\nMaksimal Rp __maxAmount__";
        const result = tool.escapeSpecialChars(input);

        expect(result).toContain("__accountNumber__");
        expect(result).toContain("__maxAmount__");
        expect(result).toContain("\\n");
      });

      it("should preserve apostrophes and quotes in localization strings", () => {
        const input = "At the user's account, you'll see \"Balance\" information.";
        const result = tool.escapeSpecialChars(input);

        expect(result).toContain("user's");
        expect(result).toContain("you'll");
        expect(result).toContain('"Balance"');
      });

      it("should handle complex notification templates", () => {
        const input = "Transaksi Anda:\n- Jumlah: __amount__\n- Waktu: __timestamp__\n- Status: __status__";
        const result = tool.escapeSpecialChars(input);

        const newlineCount = (result.match(/\\n/g) || []).length;
        expect(newlineCount).toBe(3);
        expect(result).toContain("__amount__");
        expect(result).toContain("__timestamp__");
        expect(result).toContain("__status__");
      });
    });

    describe("highlighting with real-world content", () => {
      it("should highlight search terms in Indonesian text with HTML", () => {
        const input = "Kartu <b>Kredit</b> Anda akan diproses";
        const query = "Kredit";
        const result = tool.highlightText(input, query);

        // Should escape HTML and highlight the search term
        expect(result).toContain("&lt;b&gt;");
        expect(result).toContain("&lt;/b&gt;");
        expect(result).toContain('<mark class="search-highlight">Kredit</mark>');
      });

      it("should handle highlighting with newlines and variable placeholders", () => {
        const input = "Saldo Anda:\n__balance__";
        const query = "Saldo";
        const result = tool.highlightText(input, query);

        expect(result).toContain('<mark class="search-highlight">Saldo</mark>');
        expect(result).toContain("\\n");
        expect(result).toContain("__balance__");
      });

      it("should respect whole word when searching Indonesian words", () => {
        tool.wholeWord = true;
        const input = "Kartu kredit, kartu debit, dan kartu lainnya";
        const query = "kartu";
        const result = tool.highlightText(input, query);

        // Should match all three instances of standalone "kartu"
        const matches = result.match(/<mark class="search-highlight">kartu<\/mark>/gi);
        expect(matches).toHaveLength(3);
      });
    });
  });
});
