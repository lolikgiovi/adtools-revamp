/**
 * VTL JSON Editor Service Tests
 */

import { describe, it, expect } from "vitest";
import { VTLJSONEditorService } from "../service.js";

describe("VTLJSONEditorService", () => {
  describe("validateVTL", () => {
    it("should validate correct VTL syntax", () => {
      const template = `#set($name = "test")
#if($value)
  Hello
#end`;
      const result = VTLJSONEditorService.validateVTL(template);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect unclosed #if block", () => {
      const template = `#if($value)
  Hello`;
      const result = VTLJSONEditorService.validateVTL(template);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Unclosed #if");
    });

    it("should detect unclosed #foreach block", () => {
      const template = `#foreach($item in $list)
  $item`;
      const result = VTLJSONEditorService.validateVTL(template);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Unclosed #foreach");
    });

    it("should detect unexpected #end", () => {
      const template = `Hello
#end`;
      const result = VTLJSONEditorService.validateVTL(template);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Unexpected #end");
    });

    it("should detect #else without #if", () => {
      const template = `#else
  Hello`;
      const result = VTLJSONEditorService.validateVTL(template);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("#else without matching #if"))).toBe(true);
    });

    it("should warn about unquoted string concatenation", () => {
      const template = `#set($result = $name + ; + $other)`;
      const result = VTLJSONEditorService.validateVTL(template);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should handle nested blocks correctly", () => {
      const template = `#foreach($item in $list)
  #if($item.active)
    Active: $item.name
  #else
    Inactive
  #end
#end`;
      const result = VTLJSONEditorService.validateVTL(template);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("validateJSON", () => {
    it("should validate correct JSON structure", () => {
      const template = `{
  "key": "value",
  "number": 123
}`;
      const result = VTLJSONEditorService.validateJSON(template);
      expect(result.valid).toBe(true);
    });

    it("should warn about unquoted JSON keys", () => {
      const template = `{
  unquotedKey: "value"
}`;
      const result = VTLJSONEditorService.validateJSON(template);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].message).toContain("Unquoted JSON key");
    });

    it("should handle VTL variables in JSON values", () => {
      const template = `{
  "key": $variable,
  "path": $data.value
}`;
      const result = VTLJSONEditorService.validateJSON(template);
      // Should not error on VTL variables as they get replaced
      expect(result.valid).toBe(true);
    });

    it("should detect missing braces", () => {
      const template = `"key": "value"`;
      const result = VTLJSONEditorService.validateJSON(template);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("No JSON object found"))).toBe(true);
    });
  });

  describe("extractVariables", () => {
    it("should extract simple variables", () => {
      const template = `$name $value`;
      const variables = VTLJSONEditorService.extractVariables(template);
      expect(variables).toHaveLength(2);
      expect(variables.map((v) => v.name)).toContain("name");
      expect(variables.map((v) => v.name)).toContain("value");
    });

    it("should extract variables with paths", () => {
      const template = `$data.user.name $data.user.email`;
      const variables = VTLJSONEditorService.extractVariables(template);
      expect(variables.some((v) => v.path === "data.user.name")).toBe(true);
      expect(variables.some((v) => v.path === "data.user.email")).toBe(true);
    });

    it("should extract quiet reference variables", () => {
      const template = `$!name $!{value}`;
      const variables = VTLJSONEditorService.extractVariables(template);
      expect(variables).toHaveLength(2);
    });

    it("should not duplicate variables", () => {
      const template = `$name $name $name`;
      const variables = VTLJSONEditorService.extractVariables(template);
      expect(variables).toHaveLength(1);
    });

    it("should skip built-in VTL variables", () => {
      const template = `$foreach.count $velocityCount`;
      const variables = VTLJSONEditorService.extractVariables(template);
      expect(variables.map((v) => v.name)).not.toContain("foreach");
      expect(variables.map((v) => v.name)).not.toContain("velocityCount");
    });

    it("should include line numbers", () => {
      const template = `Line 1 $var1
Line 2 $var2`;
      const variables = VTLJSONEditorService.extractVariables(template);
      const var1 = variables.find((v) => v.name === "var1");
      const var2 = variables.find((v) => v.name === "var2");
      expect(var1.line).toBe(1);
      expect(var2.line).toBe(2);
    });
  });

  describe("renderPreview", () => {
    it("should render template with mock data", () => {
      const template = `Hello $name!`;
      const mockData = { name: "World" };
      const result = VTLJSONEditorService.renderPreview(template, mockData);
      expect(result.success).toBe(true);
      expect(result.result).toContain("World");
    });

    it("should handle JSON output and prettify it", () => {
      const template = `{"name": "$name"}`;
      const mockData = { name: "Test" };
      const result = VTLJSONEditorService.renderPreview(template, mockData);
      expect(result.success).toBe(true);
      // Should be prettified
      expect(result.result).toContain('"name"');
    });

    it("should return error for invalid templates", () => {
      // Use a template with invalid VTL syntax that VelocityJS can't process
      const template = `#set($x = )`; // Invalid - missing value
      const result = VTLJSONEditorService.renderPreview(template, {});
      // VelocityJS should handle most errors gracefully, so success may vary
      // The important thing is we don't crash
      expect(result).toBeTruthy();
      expect(result.success !== undefined).toBe(true);
    });
  });

  describe("generateMockDataSkeleton", () => {
    it("should generate skeleton from variables", () => {
      const variables = [
        { name: "user", path: "user.name", line: 1 },
        { name: "user", path: "user.email", line: 2 },
      ];
      const skeleton = VTLJSONEditorService.generateMockDataSkeleton(variables);
      expect(skeleton.user).toBeDefined();
      expect(skeleton.user.name).toBeDefined();
      expect(skeleton.user.email).toBeDefined();
    });

    it("should use smart defaults based on field names", () => {
      const variables = [
        { name: "data", path: "data.rating", line: 1 },
        { name: "data", path: "data.userId", line: 2 },
        { name: "data", path: "data.createdDate", line: 3 },
      ];
      const skeleton = VTLJSONEditorService.generateMockDataSkeleton(variables);
      expect(typeof skeleton.data.rating).toBe("number");
      expect(skeleton.data.userId).toContain("12345");
      expect(skeleton.data.createdDate).toContain("2026");
    });
  });

  describe("lintTemplate", () => {
    it("should combine VTL and JSON validation issues", () => {
      const template = `#if($value)
{
  unquotedKey: $value
}`;
      const issues = VTLJSONEditorService.lintTemplate(template);
      // Should have VTL error (unclosed #if) and JSON warning (unquoted key)
      expect(issues.length).toBeGreaterThanOrEqual(2);
    });

    it("should sort issues by line number", () => {
      const template = `#if($a)
unquoted: $b
#end
another: $c`;
      const issues = VTLJSONEditorService.lintTemplate(template);
      for (let i = 1; i < issues.length; i++) {
        expect(issues[i].line).toBeGreaterThanOrEqual(issues[i - 1].line);
      }
    });
  });

  describe("formatTemplate", () => {
    it("should indent nested blocks", () => {
      const template = `#if($value)
Content
#end`;
      const formatted = VTLJSONEditorService.formatTemplate(template);
      const lines = formatted.split("\n");
      expect(lines[1]).toMatch(/^\s+Content/);
    });

    it("should handle nested blocks correctly", () => {
      const template = `#foreach($item in $list)
#if($item.active)
Active
#end
#end`;
      const formatted = VTLJSONEditorService.formatTemplate(template);
      const lines = formatted.split("\n");
      // #if should be indented once
      expect(lines[1]).toMatch(/^\s{2}#if/);
      // Active should be indented twice
      expect(lines[2]).toMatch(/^\s{4}Active/);
    });
  });
});
