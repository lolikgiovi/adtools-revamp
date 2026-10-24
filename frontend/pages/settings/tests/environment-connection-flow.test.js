// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPage } from "../main.js";
import config from "../config.json";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Failure cases: opening Oracle loses the draft or the other DB slot; cancel binds
// a phantom connection; failed keychain writes close the editor; teardown reopens stale dialogs.
let page;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const find = (selector) => document.querySelector(selector);
function openFlow(slot) {
  find(".environment-add-btn").click();
  find(".environment-name").value = "Draft environment";
  find(".environment-public-url").value = "https://public.example.test/env/";
  find(".environment-direct-url").value = "https://direct.example.test/env/";
  const select = find(`.environment-${slot}`);
  const option = [...select.options].find((entry) => entry.dataset.action === "add-connection");
  expect(option).toBeDefined();
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return select;
}
function fillConnection() {
  find(".oracle-name").value = "NEW_DB";
  find(".oracle-connect-string").value = "db.example.test:1521/NEW";
  find(".oracle-username").value = "fixture-user";
  find(".oracle-password").value = "fixture-password";
}
beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  vi.resetAllMocks();
  invoke.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  localStorage.setItem("config.oracle.connections", JSON.stringify([{ name: "EXISTING", connect_string: "db:1521/OLD" }]));
  localStorage.setItem("config.environments", "[]");
  page = new SettingsPage();
  page.runtime = "tauri";
  page.categoriesRoot = document.createElement("div");
  document.body.append(page.categoriesRoot);
  page.service.shouldShowCategory = () => true;
  page.service.shouldShowItem = () => true;
  page.renderCategories(config.categories.filter((category) => ["environments", "connections"].includes(category.id)));
});
it.each(["critical", "complementary"])("creates a reusable connection for the %s slot and resumes the intact draft", async (slot) => {
  const select = openFlow(slot);
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  expect(find("dialog[open] h2").textContent).toBe("Add Connection");
  fillConnection();
  find(".oracle-save-btn").click();
  await settle();
  expect(find("dialog[open] h2").textContent).toBe("Add Environment");
  expect(select.value).toBe("NEW_DB");
  expect(find(".environment-name").value).toBe("Draft environment");
  expect(find(".environment-public-url").value).toBe("https://public.example.test/env/");
  expect(find(".environment-direct-url").value).toBe("https://direct.example.test/env/");
  expect(find(`.environment-${slot === "critical" ? "complementary" : "critical"}`).value).toBe("");
  expect(localStorage.getItem("config.environments")).toBe("[]");
  expect(JSON.parse(localStorage.getItem("config.oracle.connections")).map((entry) => entry.name)).toEqual(["EXISTING", "NEW_DB"]);
  expect(localStorage.getItem("config.oracle.connections")).not.toContain("fixture-password");
  expect(invoke).toHaveBeenCalledWith("set_oracle_credentials", { name: "NEW_DB", username: "fixture-user", password: "fixture-password" });
  find(".environment-save").click();
  expect(JSON.parse(localStorage.getItem("config.environments"))[0][`${slot}Connection`]).toBe("NEW_DB");
});
it("returns on cancel without changing the selected connection or saving the environment", () => {
  find(".environment-add-btn").click();
  const select = find(".environment-critical");
  select.value = "EXISTING";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  const option = [...select.options].find((entry) => entry.dataset.action === "add-connection");
  expect(option).toBeDefined();
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  find(".oracle-cancel-btn").click();
  expect(find("dialog[open] h2").textContent).toBe("Add Environment");
  expect(select.value).toBe("EXISTING");
  expect(localStorage.getItem("config.environments")).toBe("[]");
  expect(invoke).not.toHaveBeenCalled();
});
it("keeps Oracle open on a failed keychain write and lets the user retry", async () => {
  invoke.mockRejectedValueOnce(new Error("Keychain unavailable"));
  const select = openFlow("critical");
  fillConnection();
  find(".oracle-save-btn").click();
  await settle();
  expect(find("dialog[open] h2").textContent).toBe("Add Connection");
  expect(select.value).toBe("");
  expect(find(".oracle-form-status").textContent).toContain("Keychain unavailable");
  find(".oracle-save-btn").click();
  await settle();
  expect(select.value).toBe("NEW_DB");
  expect(find("dialog[open] h2").textContent).toBe("Add Environment");
});
it("does not restore either dialog after the page is deactivated during saving", async () => {
  let finish;
  invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  openFlow("complementary");
  fillConnection();
  find(".oracle-save-btn").click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
  page.deactivate();
  finish();
  await settle();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(0);
});
