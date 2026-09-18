// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterPage } from "../main.js";

describe("registration email verification", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="register-root"></div>';
    localStorage.clear();
    location.hash = "#register";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests an OTP, explains delivery time, and verifies the code", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, userId: "user-1", token: "otp-token" }) });
    vi.stubGlobal("fetch", fetchMock);
    const eventBus = { emit: vi.fn() };
    const root = document.querySelector("#register-root");
    new RegisterPage({ eventBus }).mount(root);

    const submitButton = root.querySelector('[data-role="submit-btn"]');
    expect(submitButton.disabled).toBe(false);
    expect(submitButton.textContent).toBe("Request OTP");
    expect(root.textContent).toContain("Delivery takes around 1 minute");
    expect(root.textContent).toContain("Contact Lolik directly for faster access");
    expect(root.querySelector('[data-role="manual-approval-btn"]')).toBeNull();

    root.querySelector("#reg-username").value = "Test User";
    root.querySelector("#reg-email").value = "person@bankmandiri.co.id";
    root.querySelector(".register-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock.mock.calls[0][0]).toBe("/register/request-otp");
    expect(root.querySelector(".otp-field").style.display).toBe("block");
    expect(root.querySelector(".register-error").classList.contains("is-info")).toBe(true);
    expect(submitButton.textContent).toBe("Verify & Continue");

    root.querySelector("#reg-otp").value = "123456";
    root.querySelector(".register-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock.mock.calls[1][0]).toBe("/register/verify");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ email: "person@bankmandiri.co.id", code: "123456" });
    expect(localStorage.getItem("user.registered")).toBe("true");
    expect(eventBus.emit).toHaveBeenCalledWith("user:registered", expect.objectContaining({ email: "person@bankmandiri.co.id" }));
    expect(location.hash).toBe("#home");
  });
});
