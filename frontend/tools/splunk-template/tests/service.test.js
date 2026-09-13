import {
  dateFormatter,
  extractFieldsFromTemplate,
  extractParameterPaths,
  renderSplunkTemplate,
  setNestedValue,
  templateFormatter,
} from "../service.js";

describe("Splunk template consumer preview", () => {
  it("exposes parameters directly and through context and clears invalid references", () => {
    const template = "$event|$context.event|$!missing|$unknown|\\$escaped";

    expect(renderSplunkTemplate(template, { event: "login" })).toBe("login|login|||$escaped");
  });

  it("renders Velocity directives and Java-style string method calls", () => {
    const template = "#if($context.success)[$context.event.toUpperCase()]#else[FAILED]#end";

    expect(renderSplunkTemplate(template, { success: true, event: "login" })).toBe("[LOGIN]");
  });

  it("implements TemplateFormatter number and string helpers", () => {
    const rendered = renderSplunkTemplate(
      "$format.amount($amount)|$format.smsCurrency($amount)|$format.currency($amount)|$format.mask($card)|" +
        "$format.trimLeft10($text)|$format.trimLeft11($text)|$format.trimLeft25($text)",
      { amount: "1234.5", card: "1234567890123456", text: "  12345678901234567890123456789  " },
    );

    expect(rendered).toBe("1,234.50|1234.50|1.234,50|****3456|  12345678|  123456789|12345678901234567890123");
    expect(templateFormatter.mask("12")).toBe("****");
    expect(templateFormatter.amount("not-a-number")).toBe("not-a-number");
    expect(templateFormatter.amount("1,234")).toBe("1,234");
  });

  it("matches DecimalFormat precision, grouping, and HALF_EVEN rounding", () => {
    expect(templateFormatter.amount("1.005")).toBe("1.00");
    expect(templateFormatter.amount("1.015")).toBe("1.02");
    expect(templateFormatter.amount("12345678901234567890.125")).toBe("12,345,678,901,234,567,890.12");
    expect(templateFormatter.smsCurrency("1234.5")).toBe("1234.50");
    expect(templateFormatter.currency("1234.5")).toBe("1.234,50");
  });

  it("uses BigDecimal-like precision and scale for add", () => {
    expect(templateFormatter.add("0.10", "0.20")).toBe("0.30");
    expect(templateFormatter.add("2.50", 3, "")).toBe("5.50");
  });

  it("implements date, hashing, and regex helpers", () => {
    const rendered = renderSplunkTemplate(
      "$format.dateShort($input, 'id-ID')|$format.time24($input, 'id-ID')|$format.encrypt('abc', '')|" +
        "$format.replaceByRegex('ab12cd', '\\d+', '-')|$date.convertDate($input, 'dd/MM/yyyy')",
      { input: "2026-09-12 13:14:15" },
    );

    expect(rendered).toBe("12/9/2026|13:14:15|ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad|ab-cd|12/09/2026");
    expect(dateFormatter.get("yyyy")).toMatch(/^\d{4}$/);
    expect(templateFormatter.time24("2026-09-12T13:14:15.999Z", "id-ID")).toBe("13:14:15");
    expect(dateFormatter.convertDate("2026-09-12T13:14.15.123+0700", "HH:mm:ss")).toBe("00:00:00");
    expect(templateFormatter.dateShort("2026-09-12", "")).toBe("12/9/2026");
  });

  it("matches the Java date parser order and prefix behavior", () => {
    expect(templateFormatter.time24("2026-09-12T13:14:15.999Z", "id-ID")).toBe("13:14:15");
    expect(templateFormatter.formatDate("20260912", "dd/MM/yyyy", "id-ID")).toBe("12/09/2026");
    expect(dateFormatter.convertDate("2026-09-12 13:14:15.123", "HH:mm:ss.SSS")).toBe("13:14:15.123");
    expect(dateFormatter.convertDate("2026-09-12T13:14.15.123+0700", "HH:mm:ss")).toBe("00:00:00");
    expect(dateFormatter.convertDate("not-a-date", "yyyy")).toBe("not-a-date");
  });

  it("matches helper fallback behavior", () => {
    expect(templateFormatter.formatDate("not-a-date", "dd/MM/yyyy", "id-ID")).toBe("not-a-date");
    expect(templateFormatter.add("2", "invalid")).toBe("[2, invalid]");
    expect(templateFormatter.add("2", null)).toBe("[2, null]");
    expect(templateFormatter.replaceByRegex(null, ".", "-")).toBeNull();
    expect(templateFormatter.encrypt("abc", "")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("extracts the consumer parameter shape and creates nested values", () => {
    const template =
      "#set($label = $context.customer.name)#foreach($item in $context.items)$item.name#end" +
      "$label|$customer.name|$format.amount($context.amount)|$date.get('yyyy')";
    const target = {};
    setNestedValue(target, "customer.name", "sample");

    expect(extractParameterPaths(template)).toEqual(["amount", "customer.name", "items"]);
    expect(target).toEqual({ customer: { name: "sample" } });
  });
});

describe("Splunk field extraction", () => {
  it("keeps the original expression so table refreshes do not lose formatter calls", () => {
    expect(extractFieldsFromTemplate("amount=$format.currency($!context.amount)")).toMatchObject([
      {
        field: "amount",
        source: "context",
        value: "amount",
        functions: "currency",
        expression: "$format.currency($!context.amount)",
      },
    ]);
  });
});
