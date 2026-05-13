// @vitest-environment node

import {
  buildRequestBody,
  classifyResult,
  extractTemplateFromResponse,
  formatVelocityParseError,
  getRenderedOutputFromError,
  parseHeaderSettings,
  parseJsonObject,
  requestVelocityTemplate,
  validateVelocitySyntax,
} from "../service.js";
import { LIVIN_FN_COMPLETIONS, LIVIN_REGISTRY_FUNCTION_NAMES } from "../functionCatalog.js";

describe("VelocityTemplateService", () => {
  it("validates correct Velocity syntax", () => {
    const result = validateVelocitySyntax('#set($name = "World")\nHello $!{name}');

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("reports invalid Velocity syntax", () => {
    const result = validateVelocitySyntax("#if($enabled)\nHello");

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("validates payload JSON objects", () => {
    const result = parseJsonObject('{"environment":"beta"}', "Payload");

    expect(result.error).toBeNull();
    expect(result.value).toEqual({ environment: "beta" });
  });

  it("rejects payload JSON arrays", () => {
    const result = parseJsonObject("[1,2]", "Payload");

    expect(result.value).toBeNull();
    expect(result.error).toContain("must be a JSON object");
  });

  it("parses header settings and preserves content-type", () => {
    const result = parseHeaderSettings('{"accept-language":"id-ID","x-device-id":"abc"}');

    expect(result.error).toBeNull();
    expect(result.headers).toEqual({
      "accept-language": "id-ID",
      "x-device-id": "abc",
      "content-type": "application/json",
    });
  });

  it("reports invalid header JSON", () => {
    const result = parseHeaderSettings("{bad");

    expect(result.headers).toBeNull();
    expect(result.error).toContain("Headers syntax error");
  });

  it("builds the endpoint request body", () => {
    const body = buildRequestBody("Hello $!{environment}", { environment: "beta" });

    expect(body).toEqual({
      context: { environment: "beta" },
      template: "Hello $!{environment}",
    });
  });

  it("extracts template from endpoint response", () => {
    const result = extractTemplateFromResponse({ template: '{"ok":true}' });

    expect(result.error).toBeNull();
    expect(result.template).toBe('{"ok":true}');
  });

  it("extracts template from wrapped endpoint response", () => {
    const result = extractTemplateFromResponse({ responseCode: "00", data: { template: "wrapped parsed output" } });

    expect(result.error).toBeNull();
    expect(result.template).toBe("wrapped parsed output");
    expect(result.path).toBe("data.template");
  });

  it("accepts string data envelopes as parsed output", () => {
    const result = extractTemplateFromResponse({ status: "success", data: "parsed from data field" });

    expect(result.error).toBeNull();
    expect(result.template).toBe("parsed from data field");
    expect(result.path).toBe("data");
  });

  it("accepts bare rendered JSON objects as parsed output", () => {
    const result = extractTemplateFromResponse({ coba: "beta" });

    expect(result.error).toBeNull();
    expect(result.template).toBe('{"coba":"beta"}');
    expect(result.path).toBe("$");
  });

  it("accepts bare rendered JSON arrays as parsed output", () => {
    const result = extractTemplateFromResponse([{ coba: "beta" }]);

    expect(result.error).toBeNull();
    expect(result.template).toBe('[{"coba":"beta"}]');
    expect(result.path).toBe("$");
  });

  it("requires template response field", () => {
    const result = extractTemplateFromResponse({ result: "missing" });

    expect(result.error).toBeNull();
    expect(result.template).toBe("missing");
    expect(result.path).toBe("result");
  });

  it("reports available keys when no rendered output field is found", () => {
    const result = extractTemplateFromResponse({ meta: { requestId: "abc" }, code: "00" });

    expect(result.template).toBeNull();
    expect(result.error).toContain('"template"');
    expect(result.error).toContain("meta.requestId");
  });

  it("requests the configured endpoint and returns parsed template field", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ template: "parsed" }),
    }));

    const result = await requestVelocityTemplate({
      endpoint: "https://example.test/velocity",
      headers: { "content-type": "application/json" },
      template: "Hello",
      payload: { name: "Ada" },
      fetchImpl,
    });

    expect(result).toBe("parsed");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/velocity",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: { name: "Ada" }, template: "Hello" }),
      }),
    );
  });

  it("formats rendered JSON parser errors with template guidance", () => {
    const result = formatVelocityParseError(
      new Error("Unexpected character (',' (code 44)): expected a valid value at [Source: { ApplicationID: , WhiteListID: EVREMASUAT2605NRNW00000355 }]; line: 1, column: 18]"),
    );

    expect(result).toContain("Velocity parse failed");
    expect(result).toContain("not valid JSON");
    expect(result).toContain("Quote JSON object keys");
    expect(result).toContain("render `null` or an empty string");
    expect(result).toContain("Quote string values");
    expect(result).not.toContain("CORS");
  });

  it("extracts rendered output from endpoint JSON parser errors", () => {
    const result = getRenderedOutputFromError(
      new Error("Unexpected character (',' (code 44)): expected a valid value at [Source: (String)  {  requestTemplate:  {    ApplicationID: ,    WhiteListID: EVREMASUAT2605NRNW00000355  }}; line: 341, column: 21]"),
    );

    expect(result).toBe("{  requestTemplate:  {    ApplicationID: ,    WhiteListID: EVREMASUAT2605NRNW00000355  }}");
  });

  it("attaches rendered output to failed endpoint responses when available", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      statusText: "Bad Request",
      text: async () =>
        JSON.stringify({
          message:
            "Unexpected character (',' (code 44)): expected a valid value at [Source: (String)  {  ApplicationID: ,  }; line: 1, column: 21]",
        }),
    }));

    await expect(
      requestVelocityTemplate({
        endpoint: "https://example.test/velocity",
        headers: { "content-type": "application/json" },
        template: "Hello",
        payload: {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      renderedOutput: "{  ApplicationID: ,  }",
    });
  });

  it("keeps the CORS hint for likely connection failures", () => {
    const result = formatVelocityParseError(new Error("Failed to fetch"));

    expect(result).toContain("CORS");
  });

  it("classifies valid JSON results", () => {
    const result = classifyResult('{"a":1}');

    expect(result.type).toBe("json");
    expect(result.valid).toBe(true);
    expect(result.display).toBe('{\n  "a": 1\n}');
  });

  it("classifies invalid JSON-looking results as JSON errors", () => {
    const result = classifyResult('{"a":');

    expect(result.type).toBe("json");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("classifies HTML results", () => {
    const result = classifyResult("<html><body><h1>Hello</h1></body></html>");

    expect(result.type).toBe("html");
    expect(result.valid).toBe(true);
  });

  it("classifies plain text results", () => {
    const result = classifyResult("plain output");

    expect(result.type).toBe("text");
    expect(result.display).toBe("plain output");
  });

  it("includes Livin $fn wrapper completions", () => {
    const labels = LIVIN_FN_COMPLETIONS.map((item) => item.label);

    expect(labels).toContain("$fn.now()");
    expect(labels).toContain("$fn.getTrackingId()");
    expect(labels).toContain("$fn.listHelper().sortBy(list, prop, asc)");
    expect(labels).toContain("$fn.mapHelper().listToMapSingleKey(list, keyProp)");
    expect(labels).toContain("$fn.epochTimeHelper().formatEpoch(epochSecond, pattern)");
  });

  it("includes backing registry names as searchable metadata", () => {
    expect(LIVIN_REGISTRY_FUNCTION_NAMES).toContain("currentDate");
    expect(LIVIN_REGISTRY_FUNCTION_NAMES).toContain("trackingId");
    expect(LIVIN_REGISTRY_FUNCTION_NAMES).toContain("sortingListFunction");
    expect(LIVIN_REGISTRY_FUNCTION_NAMES).toContain("convertListToMapSingleKey");
    expect(LIVIN_REGISTRY_FUNCTION_NAMES).toContain("epochSecondConverter");
  });
});
