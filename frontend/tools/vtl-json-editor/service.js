/**
 * VTL JSON Editor Service
 * Business logic for VTL template validation, parsing, and rendering
 */

import Velocity from "velocityjs";

export class VTLJSONEditorService {
  /**
   * Validate VTL syntax based on Apache Velocity 2.3 syntax rules
   * @param {string} template - VTL template string
   * @returns {{ valid: boolean, errors: Array<{line: number, message: string}>, warnings: Array<{line: number, message: string}> }}
   */
  static validateVTL(template) {
    const errors = [];
    const warnings = [];
    const lines = template.split("\n");

    // Track block nesting - these directives require #end
    const blockStack = [];

    // All valid Apache Velocity directives
    // Block directives (require #end): #if, #foreach, #macro, #define
    // Conditional modifiers (inside #if): #elseif, #else
    // Simple directives (no #end): #set, #include, #parse, #break, #stop, #evaluate
    const blockDirectives = ["if", "foreach", "macro", "define"];
    const conditionalModifiers = ["else", "elseif"];
    const simpleDirectives = ["set", "include", "parse", "break", "stop", "evaluate"];
    const allDirectives = [...blockDirectives, ...conditionalModifiers, ...simpleDirectives, "end"];

    // Check for unparsed content block #[[ ... ]]#
    let inUnparsedBlock = false;
    let unparsedBlockStartLine = 0;

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmedLine = line.trim();

      // Handle unparsed content blocks #[[ ... ]]#
      if (/#\[\[/.test(line)) {
        inUnparsedBlock = true;
        unparsedBlockStartLine = lineNum;
      }
      if (/\]\]#/.test(line)) {
        inUnparsedBlock = false;
      }

      // Skip validation inside unparsed blocks
      if (inUnparsedBlock) return;

      // Skip block comment lines (## or #* ... *#)
      if (/^##/.test(trimmedLine) || /^#\*/.test(trimmedLine)) return;

      // Check for block directive openings: #if, #foreach, #macro, #define
      for (const directive of blockDirectives) {
        const pattern = new RegExp(`#${directive}\\s*\\(`);
        if (pattern.test(trimmedLine)) {
          blockStack.push({ name: `#${directive}`, line: lineNum });
        }
      }

      // Check for #end
      if (/#end\b/.test(trimmedLine)) {
        if (blockStack.length === 0) {
          errors.push({ line: lineNum, message: "Unexpected #end without matching opening directive" });
        } else {
          blockStack.pop();
        }
      }

      // Check for #else/#elseif - must be inside #if block
      if (/#else\b/.test(trimmedLine) && !/#elseif/.test(trimmedLine)) {
        const hasIf = blockStack.some((b) => b.name === "#if");
        if (!hasIf) {
          errors.push({ line: lineNum, message: "#else without matching #if" });
        }
      }
      if (/#elseif\s*\(/.test(trimmedLine)) {
        const hasIf = blockStack.some((b) => b.name === "#if");
        if (!hasIf) {
          errors.push({ line: lineNum, message: "#elseif without matching #if" });
        }
      }

      // Validate #set directive syntax: #set($var = value)
      const setMatch = trimmedLine.match(/^#set\s*\(/);
      if (setMatch) {
        // Check for required = sign
        if (!/=/.test(trimmedLine)) {
          errors.push({ line: lineNum, message: "#set directive missing '=' assignment operator" });
        }
        // Check parentheses balance
        if (!this.checkParenthesesBalance(trimmedLine)) {
          errors.push({ line: lineNum, message: "Unclosed parenthesis in #set directive" });
        }
      }

      // Validate #if, #elseif, #foreach directive syntax (require condition/expression)
      const conditionalMatch = trimmedLine.match(/^#(if|elseif|foreach)\s*\(/);
      if (conditionalMatch) {
        if (!this.checkParenthesesBalance(trimmedLine)) {
          errors.push({ line: lineNum, message: `Unclosed parenthesis in #${conditionalMatch[1]} directive` });
        }
      }

      // Validate #foreach has 'in' keyword
      if (/#foreach\s*\(/.test(trimmedLine)) {
        if (!/\s+in\s+/.test(trimmedLine)) {
          errors.push({ line: lineNum, message: "#foreach directive missing 'in' keyword (syntax: #foreach($item in $list))" });
        }
      }

      // Validate #macro definition syntax: #macro(name $arg1 $arg2)
      if (/#macro\s*\(/.test(trimmedLine)) {
        // Must start with a name (not a variable)
        const macroContent = trimmedLine.match(/#macro\s*\(\s*(\w+)/);
        if (!macroContent) {
          errors.push({ line: lineNum, message: "#macro directive requires a name" });
        }
      }

      // Validate #include and #parse directives
      if (/#include\s*\(/.test(trimmedLine) || /#parse\s*\(/.test(trimmedLine)) {
        if (!this.checkParenthesesBalance(trimmedLine)) {
          const directive = /#include/.test(trimmedLine) ? "include" : "parse";
          errors.push({ line: lineNum, message: `Unclosed parenthesis in #${directive} directive` });
        }
      }

      // Warning: Unknown directive (starts with # followed by word but not valid)
      const directiveMatch = trimmedLine.match(/^#(\w+)/);
      if (directiveMatch && !allDirectives.includes(directiveMatch[1])) {
        // Could be a macro call #macroName() or escaped #{
        if (!/^#\{/.test(trimmedLine) && !/^#\w+\s*\(/.test(trimmedLine)) {
          // Not a macro call pattern either - might be intentional or typo
          // Don't warn for potential macro calls
        }
      }

      // Warning: Unquoted string concatenation (common mistake in #set)
      const concatMatch = trimmedLine.match(/\$[\w.]+\s*\+\s*([^"\s$])/);
      if (concatMatch && !concatMatch[1].match(/[\d(]/)) {
        warnings.push({ line: lineNum, message: "Possible unquoted string in concatenation - strings should be quoted" });
      }

      // Warning: Using single quotes for strings that need interpolation
      if (/#set\s*\(.*'.*\$.*'/.test(trimmedLine)) {
        warnings.push({ line: lineNum, message: "Variables inside single-quoted strings won't be interpolated - use double quotes" });
      }
    });

    // Check for unclosed unparsed block
    if (inUnparsedBlock) {
      errors.push({ line: unparsedBlockStartLine, message: "Unclosed #[[ unparsed content block (missing ]]#)" });
    }

    // Check for unclosed blocks at end
    for (const block of blockStack) {
      errors.push({ line: block.line, message: `Unclosed ${block.name} block (missing #end)` });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Helper to check parentheses balance in a line
   * @param {string} line
   * @returns {boolean}
   */
  static checkParenthesesBalance(line) {
    let parenCount = 0;
    let inString = false;
    let stringChar = null;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const prevChar = i > 0 ? line[i - 1] : "";

      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && prevChar !== "\\") {
        inString = false;
      } else if (!inString) {
        if (char === "(") parenCount++;
        if (char === ")") parenCount--;
      }
    }

    return parenCount === 0;
  }

  /**
   * Validate JSON structure (ignoring VTL blocks)
   * @param {string} template - VTL template string
   * @returns {{ valid: boolean, errors: Array<{line: number, column: number, message: string}>, warnings: Array<{line: number, message: string}> }}
   */
  static validateJSON(template) {
    const errors = [];
    const warnings = [];
    const lines = template.split("\n");

    // Find where the JSON actually starts (first line with '{' that's not inside a VTL directive)
    let jsonStartLine = -1;
    let jsonEndLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Skip VTL directive lines
      if (/^#(set|if|else|elseif|foreach|end|macro|include|parse)\b/.test(trimmed)) {
        continue;
      }
      // Check for opening brace
      if (trimmed.startsWith("{") || trimmed === "{") {
        jsonStartLine = i;
        break;
      }
    }

    // Find where JSON ends (last line with '}')
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed.endsWith("}") || trimmed === "}") {
        jsonEndLine = i;
        break;
      }
    }

    if (jsonStartLine === -1 || jsonEndLine === -1) {
      errors.push({ line: 1, column: 1, message: "No JSON object found in template" });
      return { valid: false, errors, warnings };
    }

    // Extract just the JSON portion (from jsonStartLine to jsonEndLine)
    const jsonLines = lines.slice(jsonStartLine, jsonEndLine + 1);

    // Check for unquoted JSON keys in the JSON portion only
    jsonLines.forEach((line, index) => {
      const actualLineNum = jsonStartLine + index + 1;
      const trimmed = line.trim();

      // Skip VTL directive lines and empty lines
      if (/^#/.test(trimmed) || !trimmed) return;

      // Check for unquoted keys: `key:` without quotes, but not inside VTL variable like $var.key
      // Match patterns like: `  keyName:` or `keyName :` at start of meaningful content
      const unquotedKeyMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*:/);
      if (unquotedKeyMatch) {
        // Make sure it's not already quoted
        if (!trimmed.match(/^"[^"]+"\s*:/)) {
          warnings.push({
            line: actualLineNum,
            message: `Unquoted JSON key: "${unquotedKeyMatch[1]}" should be quoted as "${unquotedKeyMatch[1]}"`,
          });
        }
      }
    });

    // Build a cleaned JSON string for parsing validation
    let cleanedJson = jsonLines
      .map((line) => {
        let cleaned = line;

        // Remove VTL directive lines entirely
        if (/^\s*#(set|if|else|elseif|foreach|end|macro|include|parse)\b/.test(cleaned)) {
          return "";
        }

        // Replace VTL variables with valid JSON string placeholders
        // We need to handle multiple cases:
        // 1. "$var" (entire quoted value is variable) -> "__VTL_VAR__" (keep quotes)
        // 2. "text $var text" (embedded in string) -> "text __VTL_VAR__ text" (no extra quotes)
        // 3. $var (bare variable as value) -> "__VTL_VAR__" (add quotes for valid JSON)

        // First, handle variables that are the entire content of a quoted string: "$var"
        cleaned = cleaned.replace(/"(\$!?\{?[\w.]+\}?)"/g, '"__VTL_VAR__"');

        // Now handle remaining $variables - they could be:
        // - Embedded in a quoted string: "Bearer $token" (already inside quotes, just replace text)
        // - Bare as a value: $var (needs quotes added to be valid JSON)

        // Check if variable is inside a quoted string
        // We'll do a smarter replacement: look for $var patterns
        // If they're between quotes, just replace the var. If bare, add quotes.

        // Simple approach: replace all $vars with __VTL_VAR__ first (handles embedded case)
        // Then fix any bare __VTL_VAR__ that aren't in quotes
        cleaned = cleaned.replace(/\$!?\{?[\w.]+\}?/g, "__VTL_VAR__");

        // Now find bare __VTL_VAR__ (as JSON value, not inside string) and quote them
        // Pattern: after : and optional whitespace, __VTL_VAR__ not surrounded by quotes
        cleaned = cleaned.replace(/:\s*__VTL_VAR__(?=\s*[,}\]]|$)/g, ': "__VTL_VAR__"');

        // Remove VTL inline comments
        cleaned = cleaned.replace(/##.*/g, "");

        return cleaned;
      })
      .filter((line) => line.trim())
      .join("\n");

    // Try to parse the cleaned JSON
    try {
      JSON.parse(cleanedJson);
    } catch (e) {
      // Extract position from error message if available
      const posMatch = e.message.match(/position\s+(\d+)/i);

      if (posMatch) {
        const pos = parseInt(posMatch[1], 10);

        // Map position back to original line in cleaned JSON
        let charCount = 0;
        let cleanedLine = 0;
        const cleanedLines = cleanedJson.split("\n");

        for (let i = 0; i < cleanedLines.length; i++) {
          if (charCount + cleanedLines[i].length >= pos) {
            cleanedLine = i;
            break;
          }
          charCount += cleanedLines[i].length + 1;
        }

        // Map back to original template line (approximate)
        const actualLine = jsonStartLine + cleanedLine + 1;

        errors.push({
          line: actualLine,
          column: 1,
          message: e.message.replace(/^JSON\.parse:\s*/, "").replace(/at position \d+/, ""),
        });
      } else {
        // No position info, report on JSON start line
        errors.push({
          line: jsonStartLine + 1,
          column: 1,
          message: e.message.replace(/^JSON\.parse:\s*/, ""),
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Extract all variables from VTL template
   * @param {string} template - VTL template string
   * @returns {Array<{name: string, path: string, line: number}>}
   */
  static extractVariables(template) {
    const variables = [];
    const seen = new Set();
    const lines = template.split("\n");

    // Pattern to match VTL variables: $var, $!var, ${var}, $var.path, $!{var.path}
    const varPattern = /\$!?\{?([\w]+(?:\.[\w]+)*)\}?/g;

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      let match;

      while ((match = varPattern.exec(line)) !== null) {
        const fullPath = match[1];
        const parts = fullPath.split(".");
        const name = parts[0];

        // Skip built-in VTL variables and functions
        if (["foreach", "velocityCount", "velocityHasNext"].includes(name)) continue;

        const key = `${name}:${fullPath}`;
        if (!seen.has(key)) {
          seen.add(key);
          variables.push({
            name,
            path: fullPath,
            line: lineNum,
          });
        }
      }
    });

    // Sort by name, then by path
    variables.sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.path.localeCompare(b.path);
    });

    return variables;
  }

  /**
   * Render template with mock data using velocityjs
   * @param {string} template - VTL template string
   * @param {object} mockData - Mock data object
   * @returns {{ success: boolean, result: string, error: string|null }}
   */
  static renderPreview(template, mockData) {
    try {
      // Create context with mock data and common functions
      const context = {
        ...mockData,
        fn: {
          now: (format) => {
            const now = new Date();
            // Simple format implementation
            return now.toISOString();
          },
          convertDateTimeFormat: (dateStr, format) => {
            // Return a placeholder for format conversion
            return `[formatted: ${format}]`;
          },
        },
      };

      const result = Velocity.render(template, context);

      // Try to parse and prettify if it looks like JSON
      try {
        const trimmed = result.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          const parsed = JSON.parse(trimmed);
          return {
            success: true,
            result: JSON.stringify(parsed, null, 2),
            error: null,
          };
        }
      } catch (_) {
        // Not valid JSON, return as-is
      }

      return {
        success: true,
        result,
        error: null,
      };
    } catch (e) {
      return {
        success: false,
        result: "",
        error: e.message,
      };
    }
  }

  /**
   * Generate mock data skeleton from extracted variables
   * @param {Array<{name: string, path: string}>} variables
   * @returns {object}
   */
  static generateMockDataSkeleton(variables) {
    const mockData = {};

    for (const variable of variables) {
      const parts = variable.path.split(".");
      let current = mockData;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;

        if (isLast) {
          // Set placeholder value based on common naming patterns
          if (part.toLowerCase().includes("date")) {
            current[part] = "2026-01-08";
          } else if (part.toLowerCase().includes("time")) {
            current[part] = "12:00:00";
          } else if (part.toLowerCase().includes("number") || part.toLowerCase().includes("id")) {
            current[part] = "12345";
          } else if (part.toLowerCase().includes("token")) {
            current[part] = "mock-token-value";
          } else if (part.toLowerCase().includes("rating")) {
            current[part] = 5;
          } else if (part.toLowerCase().includes("array") || part.toLowerCase().includes("list") || part.toLowerCase().includes("area")) {
            current[part] = [{ display: "Item 1" }, { display: "Item 2" }];
          } else {
            current[part] = `mock_${part}`;
          }
        } else {
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part];
        }
      }
    }

    return mockData;
  }

  /**
   * Format/beautify VTL template
   * @param {string} template
   * @returns {string}
   */
  static formatTemplate(template) {
    const lines = template.split("\n");
    const formatted = [];
    let indentLevel = 0;
    const indentStr = "  ";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        formatted.push("");
        continue;
      }

      // Decrease indent before #end, #else, #elseif
      if (/^#(end|else|elseif)\b/.test(trimmed)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      formatted.push(indentStr.repeat(indentLevel) + trimmed);

      // Increase indent after #if, #foreach, #macro, #else, #elseif
      if (/^#(if|foreach|macro|else|elseif)\b/.test(trimmed)) {
        indentLevel++;
      }
    }

    return formatted.join("\n");
  }

  /**
   * Lint template and return suggestions
   * @param {string} template
   * @returns {Array<{line: number, severity: 'error'|'warning'|'info', message: string}>}
   */
  static lintTemplate(template) {
    const issues = [];
    const vtlResult = this.validateVTL(template);
    const jsonResult = this.validateJSON(template);

    // Add VTL errors
    for (const error of vtlResult.errors) {
      issues.push({ line: error.line, severity: "error", message: error.message });
    }

    // Add VTL warnings
    for (const warning of vtlResult.warnings) {
      issues.push({ line: warning.line, severity: "warning", message: warning.message });
    }

    // Add JSON errors
    for (const error of jsonResult.errors) {
      issues.push({ line: error.line, severity: "error", message: `JSON: ${error.message}` });
    }

    // Add JSON warnings
    for (const warning of jsonResult.warnings) {
      issues.push({ line: warning.line, severity: "warning", message: warning.message });
    }

    // Sort by line number
    issues.sort((a, b) => a.line - b.line);

    return issues;
  }
}
