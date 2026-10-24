// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mountIntegration } from "../integration.js";
import { SettingsService } from "../service.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Failure cases: failed keychain writes commit unrelated fields; blank tokens erase saved
// credentials; tokens leak into localStorage; Web exposes secure controls; invalid domains save.
const category = {
  id: "jenkins",
  label: "Jenkins",
  integration: true,
  items: [
    { key: "config.jenkins.url", label: "Jenkins URL", type: "string", default: "", validation: { required: true } },
    { key: "config.jenkins.username", label: "Jenkins Username", type: "string", default: "", requiresTauri: true },
    {
      key: "secure.jenkins.token",
      label: "Jenkins Token",
      type: "secret",
      default: "",
      requiresTauri: true,
      validation: { required: true, minLength: 8 },
    },
  ],
};
let service;
function mount(desktop = true) {
  service = new SettingsService();
  service.shouldShowItem = (item) => desktop || !item.requiresTauri;
  const result = mountIntegration(category, service);
  document.body.append(result.element);
  result.element.querySelector(".setting-edit").focus();
  result.element.querySelector(".setting-edit").click();
  return result.element;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const type = (selector, value) => {
  document.querySelector(selector).value = value;
};
beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  localStorage.setItem("config.jenkins.url", "https://old.example");
  localStorage.setItem("config.jenkins.username", "old-user");
  localStorage.setItem("secure.jenkins.token", "set");
});

it("saves domain and username together while keeping a blank token unchanged", async () => {
  const root = mount();
  expect(root.querySelectorAll("dialog input")).toHaveLength(3);
  type('[name="domain"]', "https://new.example");
  type('[name="username"]', "new-user");
  root.querySelector('[type="submit"]').click();
  await settle();
  expect(invoke).not.toHaveBeenCalled();
  expect(localStorage.getItem("config.jenkins.url")).toBe("https://new.example");
  expect(localStorage.getItem("config.jenkins.username")).toBe("new-user");
  expect(localStorage.getItem("secure.jenkins.token")).toBe("set");
  expect(root.querySelector("dialog").open).toBe(false);
});

it("stores replacement tokens only through native IPC, and clears the draft", async () => {
  invoke.mockResolvedValue(undefined);
  const root = mount();
  type('[name="token"]', "fixture-token");
  root.querySelector('[type="submit"]').click();
  await settle();
  expect(invoke).toHaveBeenCalledWith("set_jenkins_token", { username: "old-user", token: "fixture-token" });
  expect(localStorage.getItem("secure.jenkins.token")).toBe("set");
  expect(root.querySelector('[name="token"]').value).toBe("");
});

it("keeps config unchanged and the modal open if the keychain write fails", async () => {
  invoke.mockRejectedValue(new Error("Keychain unavailable"));
  const root = mount();
  type('[name="domain"]', "https://new.example");
  type('[name="token"]', "fixture-token");
  root.querySelector('[type="submit"]').click();
  await settle();
  expect(localStorage.getItem("config.jenkins.url")).toBe("https://old.example");
  expect(root.querySelector("dialog").open).toBe(true);
  expect(root.querySelector('[role="status"]').textContent).toContain("Keychain unavailable");
});

it("rejects embedded URL credentials and keeps Web credential controls hidden", async () => {
  const root = mount(false);
  expect(root.querySelectorAll("dialog input")).toHaveLength(1);
  type('[name="domain"]', "https://user:password@example.test");
  root.querySelector('[type="submit"]').click();
  await settle();
  expect(localStorage.getItem("config.jenkins.url")).toBe("https://old.example");
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps multiple project keys inside the Jira row and saves them in the same modal", async () => {
  const jira = {
    id: "jira",
    label: "Jira",
    integration: true,
    items: [
      { key: "config.jira.url", label: "Jira URL", type: "string", default: "https://jira.example.test" },
      { key: "config.jira.username", label: "Jira Username", type: "string", default: "fixture-user" },
      { key: "secure.jira.pat", label: "Jira PAT", type: "secret", default: "set" },
      {
        key: "config.jira.projectKeys",
        label: "Jira Project Keys",
        type: "string-list",
        default: ["EVDEV"],
        validation: { required: true, itemPattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
      },
    ],
  };
  service = new SettingsService();
  service.shouldShowItem = () => true;
  const { element } = mountIntegration(jira, service);
  document.body.append(element);
  expect(element.querySelectorAll(".setting-row")).toHaveLength(1);
  expect(element.querySelector(".string-list-chip").textContent).toBe("EVDEV");
  element.querySelector(".setting-edit").click();
  type('[name="projectKeys"]', "EVDEV\nPAYMENTS");
  element.querySelector('[type="submit"]').click();
  await settle();
  expect(JSON.parse(localStorage.getItem("config.jira.projectKeys"))).toEqual(["EVDEV", "PAYMENTS"]);
  expect(element.querySelectorAll(".string-list-chip")).toHaveLength(2);
  expect(element.querySelector("dialog").open).toBe(false);
});
