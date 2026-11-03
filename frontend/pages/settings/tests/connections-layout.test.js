// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import config from "../config.json";
import { SettingsPage } from "../main.js";

// Failure cases: grouping hides Kafka on Web, duplicates services, disconnects Oracle
// action handlers, or opens a dialog inside a collapsed subsection.
beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
function mount(desktop) {
  const page = new SettingsPage();
  page.categoriesRoot = document.createElement("div");
  document.body.append(page.categoriesRoot);
  page.service.shouldShowCategory = (category) => desktop || !category.requiresTauri;
  page.service.shouldShowItem = (item) => desktop || !item.requiresTauri;
  page.runtime = desktop ? "tauri" : "web";
  localStorage.setItem("config.environments", JSON.stringify([{ id: "uat", name: "UAT" }]));
  page.renderCategories([config.categories.find((category) => category.id === "project-settings")]);
  return page;
}
it("nests Oracle under environments and keeps Redis and Kafka under Project", () => {
  const page = mount(true);
  const content = document.querySelector("#settings-category-project-settings");
  expect(document.querySelector("#settings-category-connections")).toBeNull();
  const oracle = content.querySelector(".environment-connections");
  expect(oracle.querySelector(".oracle-add-btn")).not.toBeNull();
  expect(oracle.querySelector(".settings-bulk-edit")).not.toBeNull();
  oracle.open = true;
  oracle.querySelector(".oracle-add-btn").click();
  expect(oracle.querySelector("dialog[open] h2").textContent).toBe("Add Connection");
  oracle.querySelector(".oracle-cancel-btn").click();
  const kafka = content.querySelector("#settings-category-kafka").closest(".settings-category");
  const kafkaHeading = kafka.querySelector(".settings-category-heading");
  expect(kafkaHeading.querySelector(".kafka-broker-add")).not.toBeNull();
  expect(kafkaHeading.querySelector(".settings-bulk-edit")).not.toBeNull();
  expect(kafka.querySelector(".kafka-brokers-header")).toBeNull();
  kafkaHeading.querySelector(".settings-category-header").click();
  kafkaHeading.querySelector(".kafka-broker-add").click();
  expect(kafka.getAttribute("aria-expanded")).toBe("true");
  expect(kafka.querySelector("dialog[open] h2").textContent).toBe("Add broker");
  kafka.querySelector(".kafka-broker-cancel").click();
  page.focusRequestedSetting("kafka.brokers");
  expect(document.activeElement).toBe(kafkaHeading.querySelector(".kafka-broker-add"));
});
it("keeps Kafka available on Web while Oracle and Redis remain desktop-only", () => {
  mount(false);
  const content = document.querySelector("#settings-category-project-settings");
  expect(content.querySelector("#settings-category-redis")).toBeNull();
  expect(content.querySelector(".oracle-add-btn")).toBeNull();
  expect(content.textContent).toContain("Kafka");
  expect(content.querySelector(".kafka-broker-add")).not.toBeNull();
});
