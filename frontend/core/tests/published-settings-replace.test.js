import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPublication, PublishedSettingsSync } from "../PublishedSettings.js";
import { validateSettings } from "../../../shared/published-settings.js";

// Failure cases are listed in docs/settings-publishing.md under "Replacing the Default project".
const LEGACY = "legacy-id";
const DUP = "dup-id";
const catalog = (rows) => ({ version: 1, connections: rows });
const row = { id: "c1", environmentId: "uat", name: "UAT DB", connect_string: "db.uat:1521/svc" };
const settings = (extra = {}) => ({
  "project.name": "Livin",
  "project.replaceDefault": true,
  "config.environments": [{ id: "uat", name: "UAT", criticalConnection: "c1" }],
  "config.oracle.environment.catalog": [{ ...row, username: "app_user", password: "s3cret" }],
  ...extra,
});
const projects = () => JSON.parse(localStorage.getItem("config.projects")).projects;

function seed({ legacyName = "Default project" } = {}) {
  localStorage.setItem("user.department", "RETAIL");
  localStorage.setItem(
    "config.projects",
    JSON.stringify({
      version: 1,
      legacyProjectId: LEGACY,
      projects: [
        { id: LEGACY, name: legacyName, department: "RETAIL" },
        { id: DUP, name: "Livin", department: "RETAIL" },
      ],
    }),
  );
  localStorage.setItem("config.environments", JSON.stringify([{ id: "old", name: "Old" }]));
  localStorage.setItem(`project:${DUP}:config.environments`, JSON.stringify([{ id: "uat", name: "UAT" }]));
  localStorage.setItem(`project:${DUP}:config.oracle.environment.catalog`, JSON.stringify(catalog([row])));
  localStorage.setItem("config.project.active", DUP);
  sessionStorage.setItem("config.project.active", DUP);
}

describe("replace Default project publication", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("renames Default project in place, removes the duplicate, activates it and keeps logins out of storage", () => {
    seed();
    expect(applyPublication({ id: 1, title: "Livin", settings: settings() }, "one")).toBe(true);
    expect(projects()).toEqual([{ id: LEGACY, name: "Livin", department: "RETAIL" }]);
    expect(Object.keys(localStorage).filter((key) => key.startsWith(`project:${DUP}:`))).toEqual([]);
    expect(localStorage.getItem("config.project.active")).toBe(LEGACY);
    expect(sessionStorage.getItem("config.project.active")).toBe(LEGACY);
    expect(JSON.parse(localStorage.getItem("config.environments"))[0].id).toBe("uat");
    const stored = localStorage.getItem("config.oracle.environment.catalog");
    expect(JSON.parse(stored)).toEqual(catalog([row]));
    expect(JSON.stringify(localStorage)).not.toContain("s3cret");
  });

  it("keeps a renamed original project and targets the named project instead", () => {
    seed({ legacyName: "Retail tools" });
    applyPublication({ id: 1, title: "Livin", settings: settings() }, "one");
    expect(projects().map((project) => project.name)).toEqual(["Retail tools", "Livin"]);
    expect(localStorage.getItem("config.environments")).toContain("Old");
    expect(localStorage.getItem(`project:${DUP}:config.oracle.environment.catalog`)).not.toContain("s3cret");
    expect(localStorage.getItem("config.project.active")).toBe(DUP);
  });

  it("restores the registry, duplicate project and active project when a write fails", () => {
    seed();
    const before = { ...localStorage };
    const set = localStorage.setItem.bind(localStorage);
    const methods = Object.hasOwn(localStorage, "setItem") ? localStorage : Object.getPrototypeOf(localStorage);
    const spy = vi.spyOn(methods, "setItem").mockImplementation((key, value) => {
      if (key === "config.oracle.environment.catalog") throw new Error("Quota");
      return set(key, value);
    });
    try {
      expect(() => applyPublication({ id: 1, title: "Livin", settings: settings() }, "one")).toThrow("Quota");
    } finally {
      spy.mockRestore();
    }
    expect({ ...localStorage }).toEqual(before);
    expect(sessionStorage.getItem("config.project.active")).toBe(DUP);
  });

  it("validates replace and login fields", () => {
    expect(() => validateSettings({ "project.replaceDefault": true, "config.redis.port": 6380 })).toThrow(/project name/);
    const only = (fields) => ({ "project.name": "Livin", "config.oracle.environment.catalog": [{ ...row, ...fields }] });
    expect(() => validateSettings(only({ username: "a", password: "b" }))).not.toThrow();
    expect(() => validateSettings(only({ password: "b" }))).toThrow(/username and password/);
    expect(() => validateSettings(only({ username: "a" }))).toThrow(/username and password/);
    expect(() => validateSettings(only({ token: "x" }))).toThrow(/unsupported fields/);
    expect(() =>
      validateSettings({ "config.oracle.connections": [{ name: "UAT", connect_string: "db/service", password: "hidden" }] }),
    ).toThrow(/unsupported fields/);
  });
});

describe("published Oracle logins", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("user.email", "one@bankmandiri.co.id");
    localStorage.setItem("adtools.deviceId", "d-one");
    localStorage.setItem(
      "settings.sync.credential",
      JSON.stringify({
        credential: "c",
        email: "one@bankmandiri.co.id",
        userId: "one",
        deviceId: "d-one",
        isDevelopment: true,
        expiresAt: Date.now() + 60000,
      }),
    );
  });
  const fetcher = (publications) => vi.fn(async () => new Response(JSON.stringify({ ok: true, publications })));

  it("writes each login to the Keychain identity of the destination project once", async () => {
    seed();
    const saveLogin = vi.fn(async () => {});
    const sync = new PublishedSettingsSync({
      fetcher: fetcher([{ id: 1, title: "Livin", settings: settings() }]),
      apiBase: "http://x",
      saveLogin,
    });
    await sync.check();
    expect(sync.status).toBe("synced");
    expect(saveLogin).toHaveBeenCalledOnce();
    expect(saveLogin).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", projectId: LEGACY }), "app_user", "s3cret");
    await sync.check();
    expect(saveLogin).toHaveBeenCalledOnce();
  });

  it("keeps settings applied and asks for logins when the Keychain write fails", async () => {
    seed();
    const saveLogin = vi.fn(async () => {
      throw new Error("Keychain unavailable");
    });
    const emit = vi.fn();
    const sync = new PublishedSettingsSync({
      fetcher: fetcher([{ id: 1, title: "Livin", settings: settings() }]),
      apiBase: "http://x",
      saveLogin,
    });
    sync.eventBus = { emit };
    await sync.check();
    expect(projects()).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith("notification:error", expect.objectContaining({ message: expect.stringMatching(/Settings/) }));
  });
});
