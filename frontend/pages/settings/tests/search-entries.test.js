import { describe, expect, it } from "vitest";
import { buildSettingsSearchEntries } from "../search-entries.js";

const config = {
  categories: [
    {
      id: "appearance",
      label: "Appearance",
      items: [{ key: "theme", label: "Theme", description: "Choose the color theme for the app." }],
    },
    {
      id: "database",
      label: "Database",
      requiresTauri: true,
      categories: [
        {
          id: "oracle",
          label: "Oracle",
          items: [{ key: "config.oracle.connections", label: "Database Connections", description: "Manage connections." }],
        },
        {
          id: "redis",
          label: "Redis",
          items: [{ key: "config.redis.host", label: "Redis Host", description: "Redis hostname." }],
        },
      ],
    },
    {
      id: "admin",
      label: "Admin",
      roles: ["admin"],
      items: [{ key: "admin.token", label: "Admin Token" }],
    },
  ],
};

describe("Settings search entries", () => {
  it("flattens nested categories into Settings-prefixed results", () => {
    const entries = buildSettingsSearchEntries(config, { runtime: "tauri", userRole: "admin" });
    const theme = entries.find((entry) => entry.data.setting === "theme");
    const oracle = entries.find((entry) => entry.data.setting === "config.oracle.connections");

    expect(theme).toMatchObject({
      name: "Settings: Theme",
      description: "Appearance · Choose the color theme for the app.",
      route: "settings",
      type: "setting",
      icon: "settings",
      interactionKey: "setting:theme",
      data: { setting: "theme" },
    });
    expect(oracle).toMatchObject({
      name: "Settings: Database Connections",
      description: "Database › Oracle · Manage connections.",
    });
  });

  it("hides desktop-only settings in the web runtime", () => {
    const entries = buildSettingsSearchEntries(config, { runtime: "web", userRole: "user" });
    expect(entries.map((entry) => entry.data.setting)).toEqual(["theme"]);
  });

  it("hides role-restricted settings for other roles", () => {
    const entries = buildSettingsSearchEntries(config, { runtime: "tauri", userRole: "user" });
    expect(entries.some((entry) => entry.data.setting === "admin.token")).toBe(false);

    const adminEntries = buildSettingsSearchEntries(config, { runtime: "tauri", userRole: "admin" });
    expect(adminEntries.some((entry) => entry.data.setting === "admin.token")).toBe(true);
  });

  it("omits an empty description cleanly", () => {
    const entries = buildSettingsSearchEntries(config, { runtime: "tauri", userRole: "admin" });
    const admin = entries.find((entry) => entry.data.setting === "admin.token");
    expect(admin.description).toBe("Admin");
  });
});
