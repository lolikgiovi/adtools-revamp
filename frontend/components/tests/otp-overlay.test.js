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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, mode: "manual" }) })),
    );
    const pending = openOtpOverlay({ email: "person@example.com", preferCachedToken: false });
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
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, mode: "otp" }) })),
    );
    localStorage.setItem("otp.lastRequest.usage-overview", String(Date.now()));
    const pending = openOtpOverlay({ email: "person@example.com", storageScope: "usage-overview", preferCachedToken: false });
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, mode: "otp" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, token: "otp-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, value: { schema: "ready" } }) });
    vi.stubGlobal("fetch", fetchMock);

    const pending = openOtpOverlay({ email: "person@example.com", kvKey: "default-config", preferCachedToken: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector(".otp-modal");
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("around 1 minute");
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("Contact Lolik directly");
    expect(overlay.querySelector(".otp-manual-request")).toBeNull();

    overlay.querySelector(".otp-request").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls[1][0]).toContain("/register/request-otp");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      email: "person@example.com",
    });
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("Code requested");

    overlay.querySelector(".otp-code-input").value = "123456";
    overlay.querySelector(".otp-confirm").click();
    await expect(pending).resolves.toEqual({ token: "otp-token", kvValue: { schema: "ready" } });
    expect(fetchMock.mock.calls[2][0]).toContain("/register/verify");
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer otp-token");
  });

  it("requests and completes manual approval when manual mode is active", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, mode: "manual" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, requestId: "request-1", status: "pending" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: "approved", token: "manual-token" }) });
    vi.stubGlobal("fetch", fetchMock);

    const pending = openOtpOverlay({ email: "person@example.com", preferCachedToken: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector(".otp-modal");
    expect(overlay.querySelector(".otp-request")).toBeNull();
    expect(overlay.textContent).toContain("contact Lolik");

    overlay.querySelector(".otp-manual-request").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls[1][0]).toContain("/register/request-manual-approval");
    expect(overlay.querySelector(".otp-manual-check").hidden).toBe(false);

    overlay.querySelector(".otp-manual-check").click();
    await expect(pending).resolves.toEqual({ token: "manual-token", kvValue: undefined });
  });
});
