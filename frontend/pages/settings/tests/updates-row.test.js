// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import config from "../config.json";
import { SettingsPage } from "../main.js";

// Failure cases: grouping drops an update preference, reverses persisted values,
// duplicates the action, or exposes desktop update controls in Web.
beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});
function mount(desktop) {
  const page = new SettingsPage();
  page.categoriesRoot = document.createElement("div");
  document.body.append(page.categoriesRoot);
  page.service.shouldShowItem = (item) => desktop || !item.requiresTauri;
  page.handleManualCheckUpdate = vi.fn();
  page.renderCategories([config.categories.find((category) => category.id === "app-settings")]);
  return page;
}
it("combines the action and persisted switches into one Update row", () => {
  localStorage.setItem("update.autoCheck", "false");
  localStorage.setItem("update.allowBeta", "true");
  const page = mount(true);
  const row = document.querySelector('[data-setting="update.check"]');
  expect(document.querySelectorAll(".setting-item")).toHaveLength(2);
  expect(row.querySelectorAll('[role="switch"]')).toHaveLength(2);
  const switches = row.querySelectorAll('[role="switch"]');
  expect(switches[0].getAttribute("aria-checked")).toBe("false");
  expect(switches[1].getAttribute("aria-checked")).toBe("true");
  switches[0].click();
  switches[1].click();
  expect(localStorage.getItem("update.autoCheck")).toBe("true");
  expect(localStorage.getItem("update.allowBeta")).toBe("false");
  row.querySelector(".settings-check-update").click();
  expect(page.handleManualCheckUpdate).toHaveBeenCalledOnce();
});
it("keeps Theme available and hides the combined Update row on Web", () => {
  mount(false);
  expect(document.querySelector('[data-setting="theme"]')).not.toBeNull();
  expect(document.querySelector('[data-setting="update.check"]')).toBeNull();
});
