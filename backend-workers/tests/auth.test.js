// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { handleKvGet, handleRegisterRequestOtp, handleRegisterVerify } from "../src/routes/auth.js";

function createKvMock(values = {}) {
  return {
    get: vi.fn(async (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null)),
    put: vi.fn(async (key, value) => {
      values[key] = value;
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
          return { success: true };
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

  it("allows non-Bank Mandiri email to request registration OTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const env = {
      ALLOWED_EMAIL_DOMAINS: "bankmandiri.co.id",
      DEV_MODE: "false",
      RESEND_API_KEY: "test",
      adtools: createKvMock(),
    };

    const response = await handleRegisterRequestOtp(
      new Request("http://localhost/register/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "person@example.com" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("allows non-Bank Mandiri email to verify registration OTP", async () => {
    const env = {
      ALLOWED_EMAIL_DOMAINS: "bankmandiri.co.id",
      DB: createVerifyDbMock(),
      adtools: createKvMock(),
    };

    const response = await handleRegisterVerify(
      new Request("http://localhost/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "person@example.com", code: "123456", deviceId: "device-1" }),
      }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
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
