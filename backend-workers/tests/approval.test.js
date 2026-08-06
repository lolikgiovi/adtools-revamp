// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  handleApprovalApprove,
  handleApprovalList,
  handleManualApprovalRequest,
  handleManualApprovalStatus,
} from "../src/routes/approval.js";
import { handleDashboardVerify } from "../src/routes/dashboard.js";

async function dashboardToken(env) {
  const response = await handleDashboardVerify(
    new Request("https://example.test/dashboard/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.ANALYTICS_DASHBOARD_PASSWORD }),
    }),
    env,
  );
  return (await response.json()).token;
}

function statement({ first = null, results = [], onRun } = {}) {
  return {
    bind: (...args) => ({
      first: vi.fn(async () => (typeof first === "function" ? first(args) : first)),
      run: vi.fn(async () => {
        onRun?.(args);
        return { success: true };
      }),
    }),
    all: vi.fn(async () => ({ results })),
  };
}

describe("manual approval", () => {
  it("stores a device-bound pending request with client and edge identity", async () => {
    const inserted = [];
    const env = {
      DB: {
        prepare: vi.fn((sql) => (sql.startsWith("SELECT id, status") ? statement() : statement({ onRun: (args) => inserted.push(args) }))),
      },
    };
    const response = await handleManualApprovalRequest(
      new Request("https://example.test/register/request-manual-approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Test Browser",
          "CF-Connecting-IP": "203.0.113.7",
          "CF-IPCountry": "ID",
        },
        body: JSON.stringify({
          email: "Person@Example.com",
          displayName: "Person",
          deviceId: "device-1",
          platform: "Browser",
          locale: "en-ID",
          timezone: "Asia/Jakarta",
          screenSize: "1440x900",
        }),
      }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ ok: true, status: "pending" });
    expect(body.requestId).toBeTruthy();
    expect(inserted[0]).toEqual(
      expect.arrayContaining(["person@example.com", "Person", "device-1", "Test Browser", "203.0.113.7", "ID", "Asia/Jakarta"]),
    );
  });

  it("does not reveal a request unless id, email, and device all match", async () => {
    const env = { DB: { prepare: vi.fn(() => statement()) } };
    const response = await handleManualApprovalStatus(
      new Request("https://example.test/register/manual-approval-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: "request-1", email: "person@example.com", deviceId: "wrong-device" }),
      }),
      env,
    );
    expect(response.status).toBe(404);
  });

  it("requires dashboard authentication to list and approve requests", async () => {
    const env = { DB: { prepare: vi.fn(() => statement()) } };
    const listResponse = await handleApprovalList(new Request("https://example.test/approval/requests"), env);
    const approveResponse = await handleApprovalApprove(
      new Request("https://example.test/approval/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "request-1" }),
      }),
      env,
    );
    expect(listResponse.status).toBe(401);
    expect(approveResponse.status).toBe(401);
  });

  it("rejects an unsigned dashboard expiry token", async () => {
    const env = { ANALYTICS_DASHBOARD_PASSWORD: "test-password", DB: { prepare: vi.fn(() => statement()) } };
    const forged = btoa(JSON.stringify({ exp: Date.now() + 60_000 }));
    const response = await handleApprovalList(
      new Request("https://example.test/approval/requests", { headers: { Authorization: `Bearer ${forged}` } }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("returns pending and approved requests to an authenticated dashboard", async () => {
    const requests = [
      { id: "pending-1", status: "pending" },
      { id: "approved-1", status: "approved" },
    ];
    const env = { ANALYTICS_DASHBOARD_PASSWORD: "test-password", DB: { prepare: vi.fn(() => statement({ results: requests })) } };
    const token = await dashboardToken(env);
    const response = await handleApprovalList(
      new Request("https://example.test/approval/requests", { headers: { Authorization: `Bearer ${token}` } }),
      env,
    );
    await expect(response.json()).resolves.toEqual({ ok: true, requests });
  });

  it("approves a pending request with the analytics dashboard token", async () => {
    const updates = [];
    const env = {
      ANALYTICS_DASHBOARD_PASSWORD: "test-password",
      DB: {
        prepare: vi.fn((sql) =>
          sql.startsWith("SELECT id, status")
            ? statement({ first: { id: "request-1", status: "pending" } })
            : statement({ onRun: (args) => updates.push(args) }),
        ),
      },
    };
    const token = await dashboardToken(env);
    const response = await handleApprovalApprove(
      new Request("https://example.test/approval/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: "request-1" }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: "approved" });
    expect(updates[0][1]).toBe("request-1");
  });
});
