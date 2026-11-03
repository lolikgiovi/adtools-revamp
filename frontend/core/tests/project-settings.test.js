// @vitest-environment jsdom
// Failure scenarios: docs/verification/project-settings/failure-scenarios.md
import { beforeEach, expect, it } from "vitest";
import { createProject, getActiveProject, projectSettingsStorage, selectProject, readJiraProjectKey } from "../Projects.js";
import { readEnvironments, writeEnvironments, readEnvironmentConnections, saveEnvironmentConnections } from "../Environments.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it("isolates project fields and pins an asynchronous writer while reusing integration credentials", () => {
  localStorage.setItem("config.redis.host", "legacy");
  localStorage.setItem("config.jira.username", "shared");
  const first = getActiveProject();
  const pending = projectSettingsStorage();
  selectProject(createProject("Second").id);
  const second = projectSettingsStorage();
  expect(second.getItem("config.redis.host")).toBeNull();
  expect(second.getItem("config.jira.username")).toBe("shared");
  pending.setItem("config.redis.host", "first-save");
  second.setItem("config.redis.host", "second-save");
  expect(second.getItem("config.redis.host")).toBe("second-save");
  selectProject(first.id);
  expect(projectSettingsStorage().getItem("config.redis.host")).toBe("first-save");
});

it("requires an explicit Jira choice for multiple legacy keys and preserves the list", () => {
  localStorage.setItem("config.jira.projectKeys", '["ONE","TWO"]');
  expect(readJiraProjectKey()).toBe("");
  projectSettingsStorage().setItem("config.jira.projectKey", "TWO");
  expect(readJiraProjectKey()).toBe("TWO");
  expect(localStorage.getItem("config.jira.projectKeys")).toBe('["ONE","TWO"]');
  selectProject(createProject("Second").id);
  expect(readJiraProjectKey()).toBe("");
});

it("retains the single legacy Jira key", () => {
  localStorage.setItem("config.jira.projectKeys", '["ONE"]');
  expect(readJiraProjectKey()).toBe("ONE");
});

it("migrates shared Oracle bindings into independent stable environment identities without dropping unbound records", () => {
  localStorage.setItem(
    "config.oracle.connections",
    JSON.stringify([
      { name: "CORE", connect_string: "db:1521/svc" },
      { name: "UNBOUND", connect_string: "db:1521/other" },
    ]),
  );
  writeEnvironments([
    { id: "uat", name: "UAT", criticalConnection: "CORE" },
    { id: "sit", name: "SIT", criticalConnection: "CORE" },
  ]);
  const uat = readEnvironmentConnections("uat");
  const sit = readEnvironmentConnections("sit");
  expect(uat[0].id).not.toBe(sit[0].id);
  expect(uat[0].legacyCredentialName).toBe("CORE");
  expect(readEnvironmentConnections("uat")[0].id).toBe(uat[0].id);
  saveEnvironmentConnections("uat", [{ ...uat[0], name: "RENAMED" }]);
  expect(readEnvironmentConnections("sit")[0].name).toBe("CORE");
  expect(readEnvironmentConnections("").some((entry) => entry.name === "UNBOUND")).toBe(true);
  expect(readEnvironments()[0].criticalConnection).toBe(uat[0].id);
});
