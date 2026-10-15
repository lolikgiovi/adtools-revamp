// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UsageTracker } from "../../core/UsageTracker.js";
import { openOtpOverlay } from "../OtpOverlay.js";

const globalStyles = readFileSync(resolve(process.cwd(), "frontend/styles/components.css"), "utf8");

import { manualApprovalMonitor } from "../../core/ManualApprovalMonitor.js";

describe("OTP overlay", () => {
  beforeEach(() => {
    document.head.innerHTML = `<style>${globalStyles}</style>`;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  afterEach(() => {
    manualApprovalMonitor.stop();
    document.querySelector(".otp-modal")?.remove();
    vi.unstubAllGlobals();
  });

  it("renders as a visible fixed modal when opened outside Settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, mode: "manual" }) })),
    );
    const pending = openOtpOverlay({ email: "person@bankmandiri.co.id", preferCachedToken: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector(".otp-modal");

    expect(overlay).not.toBeNull();
    expect(getComputedStyle(overlay).position).toBe("fixed");
    expect(getComputedStyle(overlay).display).toBe("flex");

    overlay.querySelector(".otp-close").click();
    await expect(pending).rejects.toThrow("Closed");
  });

  it("still opens while the request button is rate-limited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, mode: "otp" }) })),
    );
    localStorage.setItem(
      `otp.flow:person@bankmandiri.co.id:${UsageTracker.getDeviceId()}`,
      JSON.stringify({
        savedAt: Date.now(),
        retryAt: Date.now() + 60_000,
        manualAvailableAt: Date.now() + 180_000,
        sent: true,
      }),
    );
    const pending = openOtpOverlay({ email: "person@bankmandiri.co.id", storageScope: "usage-overview", preferCachedToken: false });
    pending.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector(".otp-modal");

    expect(overlay).not.toBeNull();
    expect(overlay.querySelector(".otp-request").disabled).toBe(true);

    overlay.querySelector(".otp-close").click();
    await expect(pending).rejects.toThrow("Closed");
  });

  it("requests an email OTP and completes the protected action after verification", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, mode: "otp" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, token: "otp-token" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, value: { schema: "ready" } }) });
    vi.stubGlobal("fetch", fetchMock);

    const pending = openOtpOverlay({ email: "person@bankmandiri.co.id", kvKey: "default-config", preferCachedToken: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector(".otp-modal");
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("1–3 minutes");
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("check your spam folder");
    expect(overlay.querySelector(".otp-manual-request").hidden).toBe(true);

    overlay.querySelector(".otp-department").value = "WHOLESALE";
    overlay.querySelector(".otp-role").value = "ENGINEER";
    overlay.querySelector(".otp-request").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls[1][0]).toContain("/register/request-otp");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      email: "person@bankmandiri.co.id",
    });
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("Code requested");

    overlay.querySelector(".otp-code-input").value = "123456";
    overlay.querySelector(".otp-confirm").click();
    await expect(pending).resolves.toEqual({ token: "otp-token", kvValue: { schema: "ready" } });
    expect(fetchMock.mock.calls[2][0]).toContain("/register/verify");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ department: "WHOLESALE", role: "ENGINEER" });
    expect(localStorage.getItem("user.department")).toBe("WHOLESALE");
    expect(localStorage.getItem("user.role")).toBe("ENGINEER");
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer otp-token");
  });

  it("blocks non-Bank Mandiri email before requesting access", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, mode: "manual" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = openOtpOverlay({ email: "person@gmail.com", preferCachedToken: false });
    pending.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector(".otp-modal");
    overlay.querySelector(".otp-department").value = "SME";
    overlay.querySelector(".otp-role").value = "ANALYST";
    overlay.querySelector(".otp-manual-request").click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector(".otp-error").textContent).toContain("@bankmandiri.co.id");
    overlay.querySelector(".otp-close").click();
    await expect(pending).rejects.toThrow("Closed");
  });

  it("requires both profile fields before requesting access", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, mode: "manual" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = openOtpOverlay({ email: "person@bankmandiri.co.id", preferCachedToken: false });
    pending.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector(".otp-modal");
    overlay.querySelector(".otp-manual-request").click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector(".otp-error").textContent).toContain("department");
    overlay.querySelector(".otp-department").value = "SME";
    overlay.querySelector(".otp-manual-request").click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector(".otp-error").textContent).toContain("role");
    overlay.querySelector(".otp-close").click();
    await expect(pending).rejects.toThrow("Closed");
  });

  it("automatically completes manual approval when manual mode is active", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, mode: "manual" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, requestId: "request-1", status: "pending" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, status: "approved", token: "manual-token" }) });
    vi.stubGlobal("fetch", fetchMock);

    const pending = openOtpOverlay({ email: "person@bankmandiri.co.id", preferCachedToken: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector(".otp-modal");
    expect(overlay.querySelector(".otp-request").hidden).toBe(true);
    expect(overlay.textContent).toContain("contact Lolik");

    overlay.querySelector(".otp-department").value = "WHOLESALE";
    overlay.querySelector(".otp-role").value = "ENGINEER";
    overlay.querySelector(".otp-manual-request").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls[1][0]).toContain("/register/request-manual-approval");
    expect(overlay.querySelector(".otp-manual-check").hidden).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ department: "WHOLESALE", role: "ENGINEER" });

    await expect(pending).resolves.toEqual({ token: "manual-token", kvValue: undefined });
  });
});
