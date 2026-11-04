// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { IndexedDBStorageService } from "../services/IndexedDBStorageService.js";

describe("Run Query history storage", () => {
  it("preserves the IndexedDB key when updating a loaded history entry", async () => {
    const service = new IndexedDBStorageService();
    service._putRecord = vi.fn(async () => true);

    await service.addHistoryEntry({ _id: 7, timestamp: "2026-01-01T00:00:00.000Z", buildNumber: 42 });

    expect(service._putRecord).toHaveBeenCalledWith("history", {
      id: 7,
      timestamp: "2026-01-01T00:00:00.000Z",
      buildNumber: 42,
    });
  });
});

// Failure cases: switching project reuses another project's environment; a project with no saved
// environment loses the user's existing (pre-project) choice; saving writes only the global key.
describe("Run Query environment memory", () => {
  function serviceWithSettings(initial = {}) {
    const settings = new Map(Object.entries(initial));
    const service = new IndexedDBStorageService();
    service.getSetting = vi.fn(async (key) => settings.get(key) ?? null);
    service.setSetting = vi.fn(async (key, value) => settings.set(key, value));
    return { service, settings };
  }

  it("remembers the last environment per project", async () => {
    const { service, settings } = serviceWithSettings();
    await service.setEnv("uat1-com", "project-a");
    await service.setEnv("uat3", "project-b");
    expect(await service.getEnv("project-a")).toBe("uat1-com");
    expect(await service.getEnv("project-b")).toBe("uat3");
    expect(settings.get("env")).toBe("uat3");
  });

  it("falls back to the last environment used anywhere for a new project", async () => {
    const { service } = serviceWithSettings({ env: "uat1" });
    expect(await service.getEnv("new-project")).toBe("uat1");
    expect(await service.getEnv()).toBe("uat1");
  });
});
