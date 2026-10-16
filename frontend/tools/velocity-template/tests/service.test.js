import { extractContextPaths, formatRenderedResult, renderVelocityTemplate, setNestedValue } from "../service.js";

describe("Velocity template service", () => {
  it("renders standard Velocity variables, directives, collections, and methods", () => {
    const template = [
      "Hello $customer.name!",
      "#if($customer.active)",
      "#foreach($item in $items)$item.toUpperCase()#if($foreach.hasNext), #end#end",
      "#else",
      "Inactive",
      "#end",
    ].join("\n");

    expect(
      renderVelocityTemplate(template, {
        customer: { name: "Maya", active: true },
        items: ["one", "two"],
      }),
    ).toContain("Hello Maya!");
    expect(renderVelocityTemplate(template, { customer: { name: "Maya", active: true }, items: ["one", "two"] })).toContain("ONE, TWO");
  });

  it("uses normal Velocity behavior for unresolved and quiet references", () => {
    expect(renderVelocityTemplate("$known|$missing|$!missing", { known: "yes" })).toBe("yes|$missing|");
  });

  it("extracts external context paths but excludes local variables", () => {
    const template = "#set($label = $customer.name)#foreach($item in $items)$item.title $label#end $account.id";

    expect(extractContextPaths(template)).toEqual(["account.id", "customer.name", "items"]);
  });

  it("creates nested context values", () => {
    const target = {};

    expect(setNestedValue(target, "customer.profile.name", "sample")).toEqual({
      customer: { profile: { name: "sample" } },
    });
  });

  it("reports unmatched branch directives with a useful source location", () => {
    const template = "#if($customer.active)\n#end\n#else\n#end";

    expect(() => renderVelocityTemplate(template, {})).toThrow(
      expect.objectContaining({
        name: "VelocityTemplateError",
        kind: "syntax",
        line: 3,
        column: 1,
        message: "Unexpected #else: there is no open #if block. Move #else before the matching #end.",
      }),
    );
  });

  it("normalizes Velocity parser errors with their source location", () => {
    expect(() => renderVelocityTemplate("#set($value = )", {})).toThrow(
      expect.objectContaining({
        name: "VelocityTemplateError",
        kind: "syntax",
        line: 1,
        column: 13,
      }),
    );
  });

  it("does not treat directives in comments or quoted strings as template structure", () => {
    expect(renderVelocityTemplate("## #else\n#set($label = '#end')\n$label", {})).toContain("#end");
    expect(renderVelocityTemplate("#* #if($value) *#\nDone", {})).toContain("Done");
  });

  it("keeps text output unchanged and pretty-prints JSON output", () => {
    const rendered = '{"name":"Maya","active":true}';

    expect(formatRenderedResult(rendered, "text")).toBe(rendered);
    expect(formatRenderedResult(rendered, "json")).toBe('{\n  "name": "Maya",\n  "active": true\n}');
  });

  it("reports invalid rendered JSON as an output error", () => {
    expect(() => formatRenderedResult("Hello, Maya!", "json")).toThrow(
      expect.objectContaining({
        name: "VelocityResultError",
        kind: "output",
        message: expect.stringContaining("Rendered output is not valid JSON"),
      }),
    );
  });
});
