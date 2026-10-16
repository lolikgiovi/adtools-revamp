import { extractContextPaths, renderVelocityTemplate, setNestedValue } from "../service.js";

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
});
