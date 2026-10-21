import {
  extractContextPaths,
  suggestMissingContextFields,
  buildVelocityQuickQueryDraft,
  getTemplateImportIdentity,
  extractVelocityVariables,
  formatRenderedResult,
  normalizeImportedTemplateValue,
  parseVelocityContext,
  parseTemplateImportQuery,
  renderVelocityTemplate,
  setNestedValue,
} from "../service.js";

describe("Velocity template service", () => {
  it("infers external input shapes through aliases, loops, methods, and interpolated strings", () => {
    const template = [
      "#set($orders = $response.data.custodyOrders)",
      '#set($fullname = "$!profile.fullname")',
      "#set($local = {})",
      "#foreach($order in $orders)$order.orderId#end",
      '#if(!$orders.isEmpty())$local.containsKey("x")#end',
      "#if(!$errorVariables.isEmpty())#foreach($entry in $errorVariables.entrySet())$entry.key#end#end",
      '$fn.now("yyyy") $requestBody.goldAccountNumber',
    ].join("\n");
    const fields = suggestMissingContextFields(template, {});
    expect(Object.fromEntries(fields.map(({ path, value }) => [path, value]))).toEqual({
      "response.data.custodyOrders": [],
      "profile.fullname": "sample-fullname",
      errorVariables: {},
      fn: {},
      "requestBody.goldAccountNumber": "sample-goldaccountnumber",
    });
    expect(fields.find(({ path }) => path === "fn").note).toContain("cannot define functions");
  });

  it("preserves existing context values and excludes macro arguments and branch locals", () => {
    const template =
      '#if($active)#set($label="yes")#else#set($label="no")#end $label ' + "#macro(card $person)$person.name#end $customer.name $amount";
    expect(suggestMissingContextFields(template, { active: false, customer: { name: "Existing" }, amount: 0 })).toEqual([]);
  });

  it("offers reviewed shape repairs for previously generated primitives without replacing valid data", () => {
    const template =
      "#set($orders=$response.orders)#foreach($order in $orders)$order.id#end " +
      '$landing.productCode $errorVariables.entrySet() $fn.now("yyyy")';
    const context = { response: { orders: "sample-orders" }, landing: 1, errorVariables: "sample-map", fn: "sample-fn" };
    const fields = suggestMissingContextFields(template, context);
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "response.orders", value: [], note: "Replace string with array." }),
        expect.objectContaining({ path: "landing", value: { productCode: "sample-productcode" }, note: "Replace number with object." }),
        expect.objectContaining({ path: "errorVariables", value: {} }),
        expect.objectContaining({ path: "fn", value: {} }),
      ]),
    );
    expect(context.response.orders).toBe("sample-orders");
  });

  it("does not treat method results as aliases of their helper object", () => {
    const template = "#set($items=$fn.convertStringToList($config.value))#foreach($item in $items)$item.name#end";
    expect(suggestMissingContextFields(template, {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "fn", value: {} }),
        expect.objectContaining({ path: "config.value", value: "sample-value" }),
      ]),
    );
  });

  it("preserves both lists and maps when the template only uses ambiguous collection methods", () => {
    expect(suggestMissingContextFields("$items.size() $map.isEmpty()", { items: [1], map: { a: 1 } })).toEqual([]);
  });

  it("locates the failing method use rather than an earlier reference to its receiver", () => {
    const template = "## comment\n#set($orders = $response.orders)\n$orders\n#if($orders && !$orders.isEmpty())yes#end";
    expect(() => renderVelocityTemplate(template, { response: { orders: "sample-orders" } })).toThrow(
      expect.objectContaining({
        kind: "runtime",
        line: 4,
        column: 17,
        reference: "$orders.isEmpty()",
        message: expect.stringMatching(/\$orders\.isEmpty\(\).*string.*Context Data/),
      }),
    );
  });

  it("locates runtime failures inside interpolated strings without exposing the input value", () => {
    expect(() => renderVelocityTemplate('## comment\n#set($label = "$!data.isEmpty()")', { data: "private-value" })).toThrow(
      expect.objectContaining({
        line: 2,
        column: 16,
        reference: "$!data.isEmpty()",
        message: expect.not.stringContaining("private-value"),
      }),
    );
  });

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

  it("extracts variables declared by set, foreach, and macro directives", () => {
    const template = [
      "#set($label = $customer.name)",
      "#set($summary.title = 'Hello')",
      "#foreach($item in $items)$item.name#end",
      "#macro(renderCard $card $position)$card.title#end",
    ].join("\n");

    expect(extractVelocityVariables(template)).toEqual(["card", "item", "label", "position", "summary", "summary.title"]);
  });

  it("creates nested context values", () => {
    const target = {};

    expect(setNestedValue(target, "customer.profile.name", "sample")).toEqual({
      customer: { profile: { name: "sample" } },
    });
  });

  it("parses commented context JSON without altering comment-like text in strings", () => {
    const context = `{
      // Toggle the rendered branch
      "success": false,
      "url": "https://example.com/a/*literal*/",
      /* Keep this value available for the template. */
      "amount": 10
    }`;

    expect(parseVelocityContext(context)).toEqual({
      success: false,
      url: "https://example.com/a/*literal*/",
      amount: 10,
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

  it("locates an unresolved Velocity reference in rendered JSON and its template source", () => {
    const template = ["{", '  "amount": $transaction.amount,', '  "success": $transaction.success', "}"].join("\n");

    expect(() => formatRenderedResult(template, "json", template)).toThrow(
      expect.objectContaining({
        name: "VelocityResultError",
        kind: "output",
        line: 2,
        column: 13,
        templateLine: 2,
        templateColumn: 13,
        reference: "$transaction.amount",
      }),
    );
  });

  it("maps an empty rendered JSON field back to its quiet Velocity reference", () => {
    const template = ["{", '  "amount": $!transaction.amount,', '  "success": $transaction.success', "}"].join("\n");
    const rendered = ["{", '  "amount": ,', '  "success": false', "}"].join("\n");

    expect(() => formatRenderedResult(rendered, "json", template)).toThrow(
      expect.objectContaining({
        name: "VelocityResultError",
        kind: "output",
        line: 2,
        column: 13,
        templateLine: 2,
        templateColumn: 13,
        reference: "$!transaction.amount",
        message: expect.stringContaining('Quiet reference $!transaction.amount rendered an empty value for "amount"'),
      }),
    );
  });

  it("accepts one read-only SELECT for template import", () => {
    expect(parseTemplateImportQuery("  SELECT * FROM APP.MESSAGE_TEMPLATE WHERE ID = 7;  ")).toBe(
      "SELECT * FROM APP.MESSAGE_TEMPLATE WHERE ID = 7",
    );
    expect(() => parseTemplateImportQuery("DELETE FROM APP.MESSAGE_TEMPLATE")).toThrow("one read-only SELECT");
    expect(() => parseTemplateImportQuery("SELECT * FROM APP.ONE; SELECT * FROM APP.TWO")).toThrow("one read-only SELECT");
    expect(() => parseTemplateImportQuery("SELECT * FROM APP.MESSAGE_TEMPLATE FOR UPDATE")).toThrow("read-only");
  });

  it("builds a database identity from the source table and row identifiers", () => {
    expect(
      getTemplateImportIdentity(
        'SELECT * FROM "APP"."MESSAGE_TEMPLATE" WHERE SERVICE_CODE = :service',
        ["ID", "SERVICE_CODE", "ENVIRONMENT", "TEMPLATE_BODY"],
        [17, "PAYMENT", "DEV", "Hello $name"],
        "TEMPLATE_BODY",
      ),
    ).toEqual({
      schema: "APP",
      table: "MESSAGE_TEMPLATE",
      identifiers: { SERVICE_CODE: "PAYMENT", ENVIRONMENT: "DEV" },
      label: "APP - TEMPLATE_BODY - PAYMENT",
    });
  });

  it("falls back to a primary identifier and handles an unqualified table", () => {
    expect(getTemplateImportIdentity("SELECT BODY FROM VELOCITY_TEMPLATE", ["TEMPLATE_ID", "BODY"], [42, "content"])).toEqual({
      schema: "",
      table: "VELOCITY_TEMPLATE",
      identifiers: { TEMPLATE_ID: "42" },
      label: "VELOCITY_TEMPLATE - 42",
    });
  });

  it("builds a Quick Query update draft from imported source identity", () => {
    const draft = buildVelocityQuickQueryDraft(
      {
        schema: "APP",
        table: "MESSAGE_TEMPLATE",
        templateColumn: "TEMPLATE_BODY",
        identifiers: { SERVICE_CODE: "PAYMENT", ENVIRONMENT: "DEV" },
      },
      "Hello $customer.name\nIt's ready 👋",
    );

    expect(draft).toEqual({
      title: "Velocity template",
      tableName: "APP.MESSAGE_TEMPLATE",
      queryType: "update",
      schemaData: [
        ["SERVICE_CODE", "VARCHAR2", "No", "", "", "Yes"],
        ["ENVIRONMENT", "VARCHAR2", "No", "", "", "Yes"],
        ["TEMPLATE_BODY", "CLOB", "Yes", "", "", "No"],
      ],
      inputData: [
        ["SERVICE_CODE", "ENVIRONMENT", "TEMPLATE_BODY"],
        ["PAYMENT", "DEV", "Hello $customer.name\nIt's ready 👋"],
      ],
      source: "velocity-template",
    });
  });

  it("rejects Quick Query drafts without a table, template field, or row identifier", () => {
    expect(() => buildVelocityQuickQueryDraft({ schema: "APP", table: "MESSAGE_TEMPLATE", identifiers: {} }, "content")).toThrow(
      "template column",
    );
    expect(() =>
      buildVelocityQuickQueryDraft({ schema: "APP", table: "MESSAGE_TEMPLATE", templateColumn: "BODY", identifiers: {} }, "content"),
    ).toThrow("row identifier");
  });

  it("normalizes text and byte-backed Oracle template values", () => {
    expect(normalizeImportedTemplateValue("Hello $customer.name")).toBe("Hello $customer.name");
    expect(normalizeImportedTemplateValue(17)).toBe("17");
    expect(normalizeImportedTemplateValue(null)).toBe("");
    expect(normalizeImportedTemplateValue({ __adtools_type: "oracle_clob", data: "#if($active)Yes#end" })).toBe("#if($active)Yes#end");
    expect(() => normalizeImportedTemplateValue({ unsupported: true })).toThrow("cannot be imported as template text");
  });
});
