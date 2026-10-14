// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleManualApprovalRequest } from "../src/routes/approval.js";
import { sendRegistrationNotification } from "../src/utils/registrationNotification.js";

const env = { REGISTRATION_ADMIN_EMAIL: "admin@example.com", RESEND_API_KEY: "test-key", MAIL_FROM: "otp@example.com" };
const identity = { email: "user@bankmandiri.co.id", displayName: "Person", department: "SME", role: "ENGINEER", deviceId: "device-1" };
function db(existing = null) {
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: async () => existing, run: async () => ({ success: true }) })) })) };
}
function request() {
  return new Request("https://example.test/register/request-manual-approval", { method: "POST", body: JSON.stringify(identity) });
}
afterEach(() => vi.unstubAllGlobals());
describe("admin registration notifications", () => {
  it("alerts only for a newly stored manual request", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleManualApprovalRequest(request(), { ...env, DB: db() });
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.to).toEqual(["admin@example.com"]);
    expect(payload.text).toContain("SME");
    expect(payload.text).toContain("ENGINEER");
    expect(payload.text).toContain("https://example.test/#approval");
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBeTruthy();
    const repeat = await handleManualApprovalRequest(request(), { ...env, DB: db({ id: "request-1", status: "pending" }) });
    expect(repeat.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([{ department: "" }, { role: "" }])("rejects missing required metadata %j before storing a request", async (metadata) => {
    const database = db();
    const response = await handleManualApprovalRequest(
      new Request("https://example.test/register/request-manual-approval", {
        method: "POST",
        body: JSON.stringify({ ...identity, ...metadata }),
      }),
      { DB: database },
    );
    expect(response.status).toBe(400);
    expect(database.prepare).not.toHaveBeenCalled();
  });
  it.each(["person@gmail.com", "person@sub.bankmandiri.co.id", "person@bankmandiri.co.id.evil.test"])(
    "rejects manual registration from %s",
    async (email) => {
      const database = db();
      const response = await handleManualApprovalRequest(
        new Request("https://example.test/register/request-manual-approval", {
          method: "POST",
          body: JSON.stringify({ ...identity, email }),
        }),
        { DB: database },
      );
      expect(response.status).toBe(403);
      expect(database.prepare).not.toHaveBeenCalled();
    },
  );
  it("keeps a saved registration successful when the provider fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network failure");
      }),
    );
    const response = await handleManualApprovalRequest(request(), { ...env, DB: db() });
    expect(response.status).toBe(201);
  });
  it("sends nothing without an admin recipient", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await sendRegistrationNotification({ RESEND_API_KEY: "test-key" }, { ...identity, requestId: "request-1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends only explicit profile fields and no OTP or session secrets", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendRegistrationNotification(env, { ...identity, requestId: "request-1", code: "123456", token: "secret-token" });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).not.toContain("123456");
    expect(body).not.toContain("secret-token");
  });
});
