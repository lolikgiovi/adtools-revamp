// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openOtpOverlay } from "../OtpOverlay.js";

const globalStyles = readFileSync(resolve(process.cwd(), "frontend/styles/components.css"), "utf8");

describe("OTP overlay", () => {
  beforeEach(() => {
    document.head.innerHTML = `<style>${globalStyles}</style>`;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  afterEach(() => {
    document.querySelector(".otp-modal")?.remove();
    vi.unstubAllGlobals();
  });

  it("renders as a visible fixed modal when opened outside Settings", async () => {
    const pending = openOtpOverlay({ email: "person@example.com", preferCachedToken: false });
    const overlay = document.querySelector(".otp-modal");

    expect(overlay).not.toBeNull();
    expect(getComputedStyle(overlay).position).toBe("fixed");
    expect(getComputedStyle(overlay).display).toBe("flex");

    overlay.querySelector(".otp-close").click();
    await expect(pending).rejects.toThrow("Closed");
  });

  it("still opens while the request button is rate-limited", async () => {
    localStorage.setItem("otp.lastRequest.usage-overview", String(Date.now()));
    const pending = openOtpOverlay({ email: "person@example.com", storageScope: "usage-overview", preferCachedToken: false });
    pending.catch(() => {});
    const overlay = document.querySelector(".otp-modal");

    expect(overlay).not.toBeNull();
    expect(overlay.querySelector(".otp-request").disabled).toBe(true);

    overlay.querySelector(".otp-close").click();
    await expect(pending).rejects.toThrow("Closed");
  });

  it("offers manual approval and completes the protected action after approval", async () => {
    localStorage.setItem("user.username", "Test User");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, requestId: "request-1", status: "pending" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: "pending" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: "approved", token: "approved-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, value: { schema: "ready" } }) });
    vi.stubGlobal("fetch", fetchMock);

    const pending = openOtpOverlay({ email: "person@example.com", kvKey: "default-config", preferCachedToken: false });
    const overlay = document.querySelector(".otp-modal");
    expect(overlay.querySelector(".otp-manual-request")).not.toBeNull();

    overlay.querySelector(".otp-manual-request").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls[0][0]).toContain("/register/request-manual-approval");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      email: "person@example.com", displayName: "Test User",
    });
    expect(overlay.querySelector(".otp-manual-check").hidden).toBe(false);

    overlay.querySelector(".otp-manual-check").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(overlay.querySelector(".otp-manual-status").textContent).toContain("Still pending");

    overlay.querySelector(".otp-manual-check").click();
    await expect(pending).resolves.toEqual({ token: "approved-token", kvValue: { schema: "ready" } });
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer approved-token");
    expect(localStorage.getItem("manual.approval.request")).toBeNull();
  });
});
