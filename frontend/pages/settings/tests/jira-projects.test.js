// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { SettingsService } from "../service.js";

// Failure cases: a previously saved single key disappears; malformed keys are accepted;
// later reads ignore an explicitly saved list in favor of the legacy scalar.
beforeEach(() => localStorage.clear());
it("uses the existing single project key until a project list is saved", () => {
  const service = new SettingsService();
  localStorage.setItem("config.jira.projectKey", "CUSTOM");
  expect(service.getValue("config.jira.projectKeys", "string-list", ["EVDEV"])).toEqual(["CUSTOM"]);
  service.setValue("config.jira.projectKeys", "string-list", ["CUSTOM", "SECOND"]);
  expect(service.getValue("config.jira.projectKeys", "string-list", ["EVDEV"])).toEqual(["CUSTOM", "SECOND"]);
});
it("validates every project key", () => {
  const service = new SettingsService();
  const rules = { required: true, itemPattern: "^[A-Za-z][A-Za-z0-9_-]*$" };
  expect(service.validate(["EVDEV", "OTHER_2"], "string-list", rules).valid).toBe(true);
  expect(service.validate(["EVDEV", "not a key"], "string-list", rules).valid).toBe(false);
  expect(service.validate([], "string-list", rules).valid).toBe(false);
});
