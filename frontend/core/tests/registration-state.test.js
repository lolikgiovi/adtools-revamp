// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { initializeLocalRegistrationDefaults, isUserRegistered } from "../RegistrationState.js";

afterEach(() => {
  localStorage.clear();
});

describe("registration state", () => {
  it("defaults a new local installation to the development identity without registering it", () => {
    initializeLocalRegistrationDefaults();

    expect(localStorage.getItem("user.username")).toBe("Dev User");
    expect(localStorage.getItem("user.email")).toBe("dev@localhost");
    expect(localStorage.getItem("user.registered")).toBe("false");
    expect(isUserRegistered()).toBe(false);
  });

  it("forces legacy development identities to register again", () => {
    localStorage.setItem("user.registered", "true");
    localStorage.setItem("user.username", "Dev User");
    localStorage.setItem("user.email", " DEV@LOCALHOST ");

    initializeLocalRegistrationDefaults();

    expect(localStorage.getItem("user.registered")).toBe("false");
    expect(isUserRegistered()).toBe(false);
  });

  it("preserves a completed registration with a real email", () => {
    localStorage.setItem("user.registered", "true");
    localStorage.setItem("user.username", "Real User");
    localStorage.setItem("user.email", "user@example.com");

    initializeLocalRegistrationDefaults();

    expect(localStorage.getItem("user.registered")).toBe("true");
    expect(isUserRegistered()).toBe(true);
  });
});
