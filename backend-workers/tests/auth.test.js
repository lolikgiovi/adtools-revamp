// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleKvGet,
  handleRegisterRequestOtp,
  handleRegisterVerify,
  handleRegistrationAuthMode,
  completeRegistration,
} from "../src/routes/auth.js";

function createKvMock(values = {}) {
  return {
    get: vi.fn(async (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null)),
    put: vi.fn(async (key, value) => {
      values[key] = value;
    }),
    delete: vi.fn(async (key) => {
      delete values[key];
    }),
  };
}

function createVerifyDbMock() {
  const executed = [];
  return {
    executed,
    prepare: vi.fn((sql) => ({
      bind: (...args) => ({
        run: vi.fn(async () => {
          executed.push({ sql, args });
          return { success: true, meta: { changes: 1 } };
        }),
        first: vi.fn(async () => {
          executed.push({ sql, args });
          if (sql.includes("FROM otp")) {
            return { id: 1, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), consumed_at: null };
          }
          if (sql.includes("SELECT id FROM users")) {
            return sql.includes("WHERE email") && executed.filter((item) => item.sql.includes("SELECT id FROM users")).length > 1
              ? { id: "user-1" }
              : null;
          }
          return null;
        }),
      }),
    })),
  };
}

describe("registration and config access", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows Bank Mandiri email to request registration OTP", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "message-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      ALLOWED_EMAIL_DOMAINS: "bankmandiri.co.id",
      DEV_MODE: "false",
      MAIL_FROM: "otp-adtools@example.com",
      RESEND_API_KEY: "test-key",
      REGISTRATION_AUTH_MODE: "otp",
      adtools: createKvMock(),
      DB: {
        prepare: vi.fn(() => ({
          bind: () => ({ run: vi.fn(async () => ({ success: true })) }),
        })),
      },
    };

    const response = await handleRegisterRequestOtp(
      new Request("http://localhost/register/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "person@bankmandiri.co.id", department: "RETAIL", role: "ANALYST" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, requestOptions] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe("https://api.resend.com/emails");
    expect(requestOptions.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
      "User-Agent": "AD-Tools-OTP/1.0",
    });
    const emailPayload = JSON.parse(requestOptions.body);
    expect(emailPayload).toMatchObject({
      from: "AD Tools <otp-adtools@example.com>",
      to: ["person@bankmandiri.co.id"],
      subject: "[AD Tools] OTP for AD Tools",
      tags: [{ name: "category", value: "otp" }],
    });
    expect(emailPayload.html).toContain("Here’s your OTP.");
    const sentCode = emailPayload.text.match(/verification code is (\d{6})/)[1];
    expect(emailPayload.html).toContain(sentCode);
    expect(emailPayload.html).toContain("30 minutes.");
    expect(emailPayload.html).toContain("Select the code to copy it.");
    expect(emailPayload.html).toContain('name="color-scheme" content="light dark"');
    expect(emailPayload.html).toContain("@media (prefers-color-scheme: dark)");
    for (const className of ["ground", "sheet", "panel", "ink", "muted", "accent", "digits"]) {
      expect(emailPayload.html).toContain(`[data-ogsb] .${className}`);
    }
    expect(emailPayload.html).toContain('.sheet:not([class^="x_"])');
    expect(emailPayload.html).toContain("data-email-theme-wrapper");
    expect(emailPayload.html).toContain("user-select: all");
    expect(emailPayload.html).not.toContain("<script");
    expect(emailPayload.text).toMatch(/verification code is \d{6}/);
    expect(emailPayload.text).toContain("30 minutes");
  });

  it("uses the KV registration mode override and disables OTP requests in manual mode", async () => {
    const env = {
      REGISTRATION_AUTH_MODE: "otp",
      adtools: createKvMock({ "config:registration-auth-mode": "manual" }),
    };

    const configResponse = await handleRegistrationAuthMode(env);
    await expect(configResponse.json()).resolves.toEqual({ ok: true, mode: "manual" });

    const requestResponse = await handleRegisterRequestOtp(
      new Request("http://localhost/register/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "person@bankmandiri.co.id", department: "RETAIL", role: "ANALYST" }),
      }),
      env,
    );
    expect(requestResponse.status).toBe(409);
    await expect(requestResponse.json()).resolves.toMatchObject({ ok: false, mode: "manual" });
  });

  it("allows Bank Mandiri email to verify registration OTP", async () => {
    const env = {
      ALLOWED_EMAIL_DOMAINS: "bankmandiri.co.id",
      DB: createVerifyDbMock(),
      adtools: createKvMock(),
    };

    const response = await handleRegisterVerify(
      new Request("http://localhost/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "person@bankmandiri.co.id",
          department: "RETAIL",
          role: "ANALYST",
          code: "123456",
          deviceId: "device-1",
        }),
      }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
  });

  it.each(["person@gmail.com", "person@sub.bankmandiri.co.id", "person@bankmandiri.co.id.evil.test", "person@@bankmandiri.co.id"])(
    "rejects OTP registration from %s before storing or consuming a code",
    async (email) => {
      const env = { REGISTRATION_AUTH_MODE: "otp", ALLOWED_EMAIL_DOMAINS: "gmail.com", DB: createVerifyDbMock(), adtools: createKvMock() };
      const payload = { email, department: "RETAIL", role: "ANALYST", code: "123456" };
      for (const handler of [handleRegisterRequestOtp, handleRegisterVerify]) {
        const response = await handler(
          new Request("https://example.test/register/verify", { method: "POST", body: JSON.stringify(payload) }),
          env,
        );
        expect(response.status).toBe(403);
      }
      expect(env.DB.executed).toHaveLength(0);
    },
  );

  it("persists department and preserves it when an older client omits it", async () => {
    const env = { DB: createVerifyDbMock(), adtools: createKvMock() };
    const request = new Request("http://localhost/register/verify");
    await completeRegistration({ email: "person@bankmandiri.co.id", department: "WHOLESALE", role: "ANALYST" }, request, env);
    const insert = env.DB.executed.find(({ sql }) => sql.startsWith("INSERT INTO users"));
    expect(insert.sql).toContain("department");
    expect(insert.sql).toContain("COALESCE");
    expect(insert.args).toContain("WHOLESALE");
    expect(insert.args).toContain("ANALYST");
    expect(insert.sql).toContain("role = COALESCE");
    await completeRegistration({ email: "person@bankmandiri.co.id" }, request, env);
    const inserts = env.DB.executed.filter(({ sql }) => sql.startsWith("INSERT INTO users"));
    expect(inserts[1].args).toContain(null);
  });

  it.each([{ department: "UNKNOWN" }, { role: "ADMIN" }, { role: 5 }, { department: "" }, { role: "" }])(
    "rejects invalid metadata %j before consuming the OTP",
    async (metadata) => {
      const env = { DB: createVerifyDbMock(), adtools: createKvMock() };
      const response = await handleRegisterVerify(
        new Request("http://localhost/register/verify", {
          method: "POST",
          body: JSON.stringify({ email: "person@bankmandiri.co.id", department: "RETAIL", role: "ANALYST", code: "123456", ...metadata }),
        }),
        env,
      );
      expect(response.status).toBe(400);
      expect(env.DB.executed).toHaveLength(0);
    },
  );

  it("alerts the admin after a new user verifies OTP, without leaking the code", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: createVerifyDbMock(),
      adtools: createKvMock(),
      REGISTRATION_ADMIN_EMAIL: "admin@example.com",
      RESEND_API_KEY: "test-key",
    };
    const response = await handleRegisterVerify(
      new Request("https://example.test/register/verify", {
        method: "POST",
        body: JSON.stringify({ email: "person@bankmandiri.co.id", department: "RETAIL", role: "ANALYST", code: "123456" }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain("ANALYST");
    expect(body.text).not.toContain("123456");
    await handleRegisterVerify(
      new Request("https://example.test/register/verify", {
        method: "POST",
        body: JSON.stringify({ email: "person@bankmandiri.co.id", department: "RETAIL", role: "ANALYST", code: "123456" }),
      }),
      env,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows Bank Mandiri session token to read protected config content", async () => {
    const env = {
      ALLOWED_EMAIL_DOMAINS: "bankmandiri.co.id",
      adtools: createKvMock({
        "session:token-1": JSON.stringify({ email: "user@bankmandiri.co.id", userId: "user-1" }),
        "quick-query-default-schema": JSON.stringify({ tables: [] }),
      }),
    };

    const response = await handleKvGet(
      new Request("http://localhost/api/kv/get?key=quick-query-default-schema", {
        headers: { Authorization: "Bearer token-1" },
      }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, key: "quick-query-default-schema", value: { tables: [] } });
  });

  it("denies non-Bank Mandiri session token from reading protected config content", async () => {
    const env = {
      ALLOWED_EMAIL_DOMAINS: "bankmandiri.co.id",
      adtools: createKvMock({
        "session:token-1": JSON.stringify({ email: "person@example.com", userId: "user-1" }),
        "quick-query-default-schema": JSON.stringify({ tables: [] }),
      }),
    };

    const response = await handleKvGet(
      new Request("http://localhost/api/kv/get?key=quick-query-default-schema", {
        headers: { Authorization: "Bearer token-1" },
      }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: "Config access restricted to @bankmandiri.co.id email" });
  });

  it("denies protected config content when allowed domains are not configured", async () => {
    const env = {
      ALLOWED_EMAIL_DOMAINS: "",
      adtools: createKvMock({
        "session:token-1": JSON.stringify({ email: "user@bankmandiri.co.id", userId: "user-1" }),
        "quick-query-default-schema": JSON.stringify({ tables: [] }),
      }),
    };

    const response = await handleKvGet(
      new Request("http://localhost/api/kv/get?key=quick-query-default-schema", {
        headers: { Authorization: "Bearer token-1" },
      }),
      env,
    );

    expect(response.status).toBe(403);
  });
});
