import { buildVtlValuesExport, extractVtlVariables, getVtlValue, renderVtlTemplate, setVtlValue } from "../service.js";

describe("HTML editor VTL support", () => {
  it("detects references in output, directives, paths, and formatter arguments", () => {
    const template = `
      #set($heading = $title)
      <h1>$heading</h1>
      #if($customer.active && $!subtitle)<p>${"${customer.name}"}</p>#end
      #foreach($item in $items)<span>$item.label: $account.number</span>#end
      $format.amount($amount)
    `;

    expect(extractVtlVariables(template)).toEqual([
      "account.number",
      "amount",
      "customer.active",
      "customer.name",
      "items",
      "subtitle",
      "title",
    ]);
  });

  it("ignores comments, the formatter helper, local variables, and baseUrl", () => {
    const template = `## $commented
#* $alsoCommented *#
#set($local = $source)
$local $format.currency($price) $baseUrl`;

    expect(extractVtlVariables(template)).toEqual(["price", "source"]);
  });

  it("keeps local variable scope separate from external references", () => {
    const template = `$item #foreach($item in $items)$item.name#end $item $value #set($value = $source) $value`;

    expect(extractVtlVariables(template)).toEqual(["item", "items", "source", "value"]);
  });

  it("renders nested JSON, conditionals, loops, quiet references, and set values", () => {
    const template = `#set($greeting = "Hello")$greeting ${"${user.name}"}!#if($user.active)#foreach($item in $items) [$item]#end#end$!missing`;
    const rendered = renderVtlTemplate(template, {
      user: { name: "Dewi", active: true },
      items: ["one", "two"],
    });

    expect(rendered).toBe("Hello Dewi! [one] [two]");
  });

  it("supports flat dotted values as well as nested JSON", () => {
    expect(renderVtlTemplate("$user.name / $account.id", { "user.name": "Ayu", account: { id: 42 } })).toBe("Ayu / 42");
  });

  it("implements the supplied TemplateFormatter methods", () => {
    const rendered = renderVtlTemplate(
      "$format.amount($amount)|$format.currency($amount)|$format.mask($card)|$format.dateShort($date, 'id-ID')|$format.add($a, $b)|$format.encrypt('abc', '')",
      { amount: "1234.5", card: "1234567890123456", date: "2026-09-12 13:14:15", a: "2.5", b: 3 },
    );

    expect(rendered).toBe("1,234.50|1.234,50|****3456|12/9/2026|5.5|ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("builds nested export JSON containing only detected inputs", () => {
    const values = { user: { name: "Sari", ignored: true }, amount: 25, extra: "unused" };
    expect(buildVtlValuesExport("$user.name $amount $missing", values)).toEqual({
      amount: 25,
      missing: "",
      user: { name: "Sari" },
    });
  });

  it("gets and sets nested values", () => {
    const values = {};
    setVtlValue(values, "customer.address.city", "Jakarta");
    expect(getVtlValue(values, "customer.address.city")).toBe("Jakarta");
  });

  it("updates values saved by the previous flat-path format", () => {
    const values = { "customer.name": "Old" };
    setVtlValue(values, "customer.name", "New");
    expect(getVtlValue(values, "customer.name")).toBe("New");
    expect(renderVtlTemplate("$customer.name", values)).toBe("New");
  });
});
