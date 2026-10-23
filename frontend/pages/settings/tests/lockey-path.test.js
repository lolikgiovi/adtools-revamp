// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsPage } from "../main.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountLockeyPath() {
  const page = new SettingsPage();
  const item = page.renderItem({
    key: "config.lockeyPath",
    storageKey: "config.lockeyPath",
    label: "Lockey Path",
    type: "string",
    default: "",
    validation: { pattern: "^(?!.*(?:://|#))\\S*$" },
  });
  document.body.appendChild(item);
  return item;
}

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe("Lockey Path setting", () => {
  it("normalizes a typed path to one leading slash and no trailing slash", async () => {
    const item = mountLockeyPath();
    item.querySelector(".setting-edit").click();
    item.querySelector(".setting-input").value = "localization/v1/lockey/";
    item.querySelector(".setting-confirm").click();
    await settle();

    expect(localStorage.getItem("config.lockeyPath")).toBe("/localization/v1/lockey");
    expect(item.querySelector("[data-value]").textContent).toBe("/localization/v1/lockey");
  });

  it("rejects a full URL instead of a path", async () => {
    const item = mountLockeyPath();
    item.querySelector(".setting-edit").click();
    item.querySelector(".setting-input").value = "https://host.example/localization/v1";
    item.querySelector(".setting-confirm").click();
    await settle();

    expect(item.querySelector(".setting-error").textContent).toBe("Invalid format");
    expect(localStorage.getItem("config.lockeyPath")).toBeNull();
  });
});
