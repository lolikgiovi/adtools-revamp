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

  it("requests an email OTP and completes the protected action after verification", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, token: "otp-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, value: { schema: "ready" } }) });
    vi.stubGlobal("fetch", fetchMock);

    const pending = openOtpOverlay({ email: "person@example.com", kvKey: "default-config", preferCachedToken: false });
    const overlay = document.querySelector(".otp-modal");
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("around 1 minute");
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("Contact Lolik directly");
    expect(overlay.querySelector(".otp-manual-request")).toBeNull();

    overlay.querySelector(".otp-request").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls[0][0]).toContain("/register/request-otp");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      email: "person@example.com",
    });
    expect(overlay.querySelector(".otp-email-status").textContent).toContain("Code requested");

    overlay.querySelector(".otp-code-input").value = "123456";
    overlay.querySelector(".otp-confirm").click();
    await expect(pending).resolves.toEqual({ token: "otp-token", kvValue: { schema: "ready" } });
    expect(fetchMock.mock.calls[1][0]).toContain("/register/verify");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer otp-token");
  });
});
