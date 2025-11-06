/**
 * Sanitizer - XSS protection utility
 * Provides methods to safely handle user-controlled HTML content
 */
export class Sanitizer {
  /**
   * Escape HTML entities to prevent XSS
   * @param {string} str - String to escape
   * @returns {string} - Safe HTML string
   */
  static escapeHTML(str) {
    if (typeof str !== 'string') return '';

    // Manual escaping for full control and consistency
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Allow only safe HTML tags (whitelist approach)
   * @param {string} html - HTML string to sanitize
   * @param {Array} allowedTags - Allowed HTML tags
   * @returns {string} - Sanitized HTML
   */
  static sanitizeHTML(html, allowedTags = ['b', 'i', 'em', 'strong', 'code']) {
    if (typeof html !== 'string') return '';

    const div = document.createElement('div');
    div.innerHTML = html;

    // Remove all tags except whitelisted
    const elements = div.querySelectorAll('*');
    elements.forEach((el) => {
      if (!allowedTags.includes(el.tagName.toLowerCase())) {
        el.replaceWith(...el.childNodes); // Keep text, remove tag
      }

      // Remove all attributes except safe ones
      const attrs = [...el.attributes];
      attrs.forEach((attr) => {
        if (!['class', 'title'].includes(attr.name)) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return div.innerHTML;
  }

  /**
   * Create DOM element safely with text content
   * @param {string} tag - HTML tag name
   * @param {string} text - Text content
   * @param {string} className - Optional class name
   * @returns {HTMLElement}
   */
  static createSafeElement(tag, text, className = '') {
    const el = document.createElement(tag);
    el.textContent = text; // Safe: no HTML parsing
    if (className) el.className = className;
    return el;
  }

  /**
   * Validate that a string does not contain HTML tags
   * @param {string} str - String to validate
   * @returns {boolean} - True if safe (no HTML), false otherwise
   */
  static isHTMLFree(str) {
    if (typeof str !== 'string') return true;
    return !/<[^>]+>/.test(str);
  }
}
