// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRegisterRequestOtp } from "../src/routes/auth.js";
import { handleManualApprovalRequest } from "../src/routes/approval.js";

const identity = { email: "person@bankmandiri.co.id", deviceId: "device-1", displayName: "Person", department: "RETAIL", role: "ENGINEER" };
const request = (path) =>
  new Request(`https://example.test/register/${path}`, {
    method: "POST",
    body: JSON.stringify(identity),
    headers: { "Content-Type": "application/json" },
  });
function environment() {
  const values = {};
  return {
    REGISTRATION_AUTH_MODE: "otp",
    RESEND_API_KEY: "key",
    MAIL_FROM: "otp-adtools@lolik.cloud",
    adtools: {
      get: vi.fn(async (key) => values[key] ?? null),
      put: vi.fn(async (key, value) => {
        values[key] = value;
      }),
    },
    DB: { prepare: vi.fn(() => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null }) })) },
  };
}
describe("OTP-first fallback routes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("enforces retry and manual deadlines without restarting the manual wait", async () => {
    vi.useFakeTimers();
    const env = environment();
    const mail = vi.fn(async () => new Response('{"id":"mail"}', { status: 200 }));
    vi.stubGlobal("fetch", mail);
    const first = await handleRegisterRequestOtp(request("request-otp"), env);
    const initial = await first.json();
    expect(first.status).toBe(200);
    expect(initial.retryAt - Date.now()).toBe(60_000);
    expect(initial.manualAvailableAt - Date.now()).toBe(180_000);
    expect((await handleRegisterRequestOtp(request("request-otp"), env)).status).toBe(429);
    expect((await handleManualApprovalRequest(request("request-manual-approval"), env)).status).toBe(409);
    vi.advanceTimersByTime(60_000);
    const retry = await handleRegisterRequestOtp(request("request-otp"), env);
    expect(retry.status).toBe(200);
    expect((await retry.json()).manualAvailableAt).toBe(initial.manualAvailableAt);
    vi.advanceTimersByTime(120_000);
    expect((await handleManualApprovalRequest(request("request-manual-approval"), env)).status).toBe(201);
    expect(mail).toHaveBeenCalledTimes(2);
  });
  it.each([201, 202, 400, 429, 500])("offers immediate manual approval for Resend %s", async (status) => {
    const env = environment();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status })),
    );
    const response = await handleRegisterRequestOtp(request("request-otp"), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, manualApprovalAvailable: true });
    expect((await handleManualApprovalRequest(request("request-manual-approval"), env)).status).toBe(201);
  });
  it("offers manual approval when the provider throws", async () => {
    const env = environment();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const response = await handleRegisterRequestOtp(request("request-otp"), env);
    expect((await response.json()).manualApprovalAvailable).toBe(true);
  });
});
