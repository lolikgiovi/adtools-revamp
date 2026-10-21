import { vi } from "vitest";
import { requestVelocityValidation, readVelocityValidatorSettings } from "../validator.js";

vi.mock("../../../core/Runtime.js", () => ({ isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { isTauri } from "../../../core/Runtime.js";
import { invoke } from "@tauri-apps/api/core";

// Failure cases: incorrect JSON/form encoding, lost whitespace or special characters,
// missing/invalid settings, network failure, timeout, HTTP errors hidden as success,
// response bodies discarded, or desktop requests ignoring the user's hosts mapping.
describe("Velocity API validator transport", () => {
  const url = "http://localhost:4321/velocity";
  const template = '{\n "value": "$fn.getTellerIdDynamic() & + ="\n}';
  const context = { value: "a&b+c=✓", enabled: true };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    isTauri.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, text: async () => '{"value":"123"}' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requires configuration and sends an explicit JSON POST preserving raw template text", async () => {
    expect(readVelocityValidatorSettings().url).toBe("");
    await expect(requestVelocityValidation({ url: "", template, context })).rejects.toThrow(/Settings/);
    expect(fetch).not.toHaveBeenCalled();
    const result = await requestVelocityValidation({ url, template, context, format: "json" });
    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, template }),
        redirect: "error",
        credentials: "omit",
      }),
    );
    expect(result).toEqual({ status: 200, body: '{"value":"123"}' });
  });

  it("reads the saved endpoint and request format", () => {
    localStorage.setItem("config.velocityValidator.url", url);
    localStorage.setItem("config.velocityValidator.format", "form");
    expect(readVelocityValidatorSettings()).toEqual({ url, format: "form" });
  });

  it("encodes context and template as separate form fields", async () => {
    await requestVelocityValidation({ url, template, context, format: "form" });
    const options = fetch.mock.calls[0][1];
    expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(options.body).get("context")).toBe(JSON.stringify(context));
    expect(new URLSearchParams(options.body).get("template")).toBe(template);
  });

  it.each([400, 422, 503])("preserves HTTP %i and the API error body without claiming template validity", async (status) => {
    fetch.mockResolvedValue({ status, text: async () => "API diagnostic" });
    expect(await requestVelocityValidation({ url, template, context })).toEqual({ status, body: "API diagnostic" });
  });

  it.each(["file:///etc/hosts", "ftp://localhost/test", "https://user:pass@example.com", "bad url"])(
    "rejects unsupported URLs: %s",
    async (url) => {
      await expect(requestVelocityValidation({ url, template, context })).rejects.toThrow(/URL/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("uses native desktop HTTP with the same serialized payload", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue({ status: 503, body: "Unavailable" });
    expect(await requestVelocityValidation({ url, template, context })).toEqual({ status: 503, body: "Unavailable" });
    expect(invoke).toHaveBeenCalledWith("validate_velocity_template", {
      url,
      body: JSON.stringify({ context, template }),
      contentType: "application/json",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports network failures as unavailable validation", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(requestVelocityValidation({ url, template, context })).rejects.toThrow(/unavailable/i);
  });

  it("aborts a hanging web request after 30 seconds", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const assertion = expect(requestVelocityValidation({ url, template, context })).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
    vi.useRealTimers();
  });
});
