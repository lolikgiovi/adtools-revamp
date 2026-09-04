// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
