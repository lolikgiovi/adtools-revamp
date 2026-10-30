// @vitest-environment jsdom
// Failure cases: legacy data assigned twice, duplicate names, invalid selection, department
// changes leaking configuration, environments copied to new projects, and QQ stores sharing drafts.
import { beforeEach, describe, expect, it } from "vitest";
import { createProject, getActiveProject, getProjectStorageKey, listProjects, renameProject, selectProject } from "../Projects.js";
import { readEnvironments, writeEnvironments, updateConnectionReference } from "../Environments.js";
import { IndexedDBStorageService } from "../../tools/quick-query/services/IndexedDBStorageService.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("user.department", "RETAIL");
});

describe("shared projects", () => {
  it("keeps legacy environments and QQ database with the initial project only", () => {
    localStorage.setItem("config.environments", JSON.stringify([{ name: "UAT", criticalConnection: "CORE" }]));
    const initial = getActiveProject();
    expect(initial.department).toBe("RETAIL");
    expect(getProjectStorageKey("config.environments")).toBe("config.environments");
    expect(new IndexedDBStorageService().databaseName).toBe("QuickQueryDatabase");
    expect(readEnvironments()[0].name).toBe("UAT");
    const next = createProject("Second");
    selectProject(next.id);
    expect(readEnvironments()).toEqual([]);
    expect(new IndexedDBStorageService().databaseName).not.toBe("QuickQueryDatabase");
    selectProject(initial.id);
    expect(readEnvironments()[0].criticalConnection).toBe("CORE");
    expect(listProjects()).toHaveLength(2);
  });

  it("keeps environment edits independent and updates shared connection references in all projects", () => {
    const initial = getActiveProject();
    writeEnvironments([{ name: "UAT", criticalConnection: "CORE", cdnPublicUrl: "https://first.example" }]);
    const next = createProject("Second");
    selectProject(next.id);
    writeEnvironments([{ name: "UAT", criticalConnection: "CORE", cdnPublicUrl: "https://second.example" }]);
    updateConnectionReference("CORE", "RENAMED");
    expect(readEnvironments()[0]).toMatchObject({ criticalConnection: "RENAMED", cdnPublicUrl: "https://second.example" });
    selectProject(initial.id);
    expect(readEnvironments()[0]).toMatchObject({ criticalConnection: "RENAMED", cdnPublicUrl: "https://first.example" });
  });

  it("rejects missing, duplicate and unknown projects without changing selection", () => {
    const initial = getActiveProject();
    expect(() => createProject(" ")).toThrow();
    createProject("Payments");
    expect(() => createProject("payments")).toThrow();
    expect(() => selectProject("missing")).toThrow();
    expect(getActiveProject().id).toBe(initial.id);
    renameProject(initial.id, "Retail App");
    expect(getActiveProject().name).toBe("Retail App");
  });

  it("separates department projects and never reassigns legacy storage", () => {
    const retail = getActiveProject();
    writeEnvironments([{ name: "RETAIL UAT" }]);
    localStorage.setItem("user.department", "SME");
    const sme = getActiveProject();
    expect(sme.id).not.toBe(retail.id);
    expect(sme.department).toBe("SME");
    expect(readEnvironments()).toEqual([]);
    expect(() => selectProject(retail.id)).toThrow();
    localStorage.setItem("user.department", "RETAIL");
    selectProject(retail.id);
    expect(readEnvironments()[0].name).toBe("RETAIL UAT");
  });

  it("pins QQ storage identity even when selection changes during an async save", () => {
    const service = new IndexedDBStorageService();
    const databaseName = service.databaseName;
    selectProject(createProject("Second").id);
    expect(service.databaseName).toBe(databaseName);
    expect(new IndexedDBStorageService().databaseName).not.toBe(databaseName);
  });
});

it("rolls back environment publications without changing another project when a later write fails", async () => {
  const { applyPublication } = await import("../PublishedSettings.js");
  const { vi } = await import("vitest");
  const initial = getActiveProject();
  writeEnvironments([{ name: "Legacy" }]);
  selectProject(createProject("Second").id);
  writeEnvironments([{ name: "Personal", cdnPublicUrl: "https://personal.example" }]);
  const original = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
    if (key === "config.redis.host" && value === "published.example") throw new Error("Quota");
    return original.call(this, key, value);
  });
  try {
    expect(() =>
      applyPublication(
        {
          id: 88,
          settings: {
            "config.environments": [{ id: "pub", name: "Published", cdnPublicUrl: "https://published.example" }],
            "config.redis.host": "published.example",
          },
        },
        "fixture",
      ),
    ).toThrow("Quota");
  } finally {
    spy.mockRestore();
  }
  expect(readEnvironments()[0].name).toBe("Personal");
  selectProject(initial.id);
  expect(readEnvironments()[0].name).toBe("Legacy");
});

it("pins the initial project in this tab when another tab changes the saved preference", () => {
  const initial = getActiveProject();
  const next = createProject("Second");
  localStorage.setItem("config.project.active", next.id);
  expect(getActiveProject().id).toBe(initial.id);
});

it("applies existing environment publications to the original project, regardless of selected project", async () => {
  const { applyPublication } = await import("../PublishedSettings.js");
  const initial = getActiveProject();
  writeEnvironments([{ name: "Legacy" }]);
  selectProject(createProject("Second").id);
  writeEnvironments([{ name: "Personal" }]);
  applyPublication({ id: 89, settings: { "config.environments": [{ name: "Published" }] } }, "fixture");
  expect(readEnvironments()[0].name).toBe("Personal");
  selectProject(initial.id);
  expect(readEnvironments()[0].name).toBe("Published");
});
