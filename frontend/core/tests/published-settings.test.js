import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPublication, PublishedSettingsSync } from "../PublishedSettings.js";

// Failure matrix is documented before implementation in docs/settings-publishing.md.
describe("published settings client", () => {
  beforeEach(() => localStorage.clear());
  const publication = { id: 1, title: "Retail", settings: { "config.redis.port": 6380 } };
  it("changes selected keys once and preserves personal settings and subsequent edits", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("update.autoCheck", "false");
    localStorage.setItem("secure.redis.password", "set");
    localStorage.setItem("config.jira.projectKey", "PERSONAL");
    expect(applyPublication(publication, "one")).toBe(true);
    expect(localStorage.getItem("config.redis.port")).toBe("6380");
    localStorage.setItem("config.redis.port", "6390");
    expect(applyPublication(publication, "one")).toBe(false);
    expect(localStorage.getItem("config.redis.port")).toBe("6390");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("update.autoCheck")).toBe("false");
    expect(localStorage.getItem("secure.redis.password")).toBe("set");
    expect(localStorage.getItem("config.jira.projectKey")).toBe("PERSONAL");
  });
  it("validates the complete publication before making changes", () => {
    expect(() => applyPublication({ ...publication, settings: { ...publication.settings, theme: "light" } }, "one")).toThrow();
    expect(localStorage.getItem("config.redis.port")).toBeNull();
  });
  it("keeps environment legacy data in sync without touching credentials", () => {
    applyPublication(
      {
        ...publication,
        settings: {
          "config.environments": [{ id: "uat", name: "UAT", cdnPublicUrl: "https://cdn.test", criticalConnection: "UAT" }],
          "config.oracle.connections": [{ name: "UAT", connect_string: "db/service" }],
        },
      },
      "one",
    );
    expect(JSON.parse(localStorage.getItem("config.baseUrls"))).toEqual([{ key: "UAT", value: "https://cdn.test" }]);
    expect(JSON.parse(localStorage.getItem("config.oracle.connections"))[0].name).toBe("UAT");
  });
  it("rolls back on storage failure and does not mark the publication applied", () => {
    localStorage.setItem("config.redis.port", "6379");
    const set = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Quota");
    });
    expect(() => applyPublication(publication, "one")).toThrow();
    spy.mockRestore();
    expect(localStorage.getItem("config.redis.port")).toBe("6379");
    set("config.redis.port", "6379");
    expect(applyPublication(publication, "one")).toBe(true);
  });
  it("discards in-flight responses after the signed-in identity changes", async () => {
    localStorage.setItem("user.email", "one@bankmandiri.co.id");
    localStorage.setItem("settings.sync.credential", JSON.stringify({ credential: "test", email: "one@bankmandiri.co.id", userId: "one" }));
    let resolve;
    const fetcher = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const sync = new PublishedSettingsSync({ fetcher, apiBase: "http://localhost" });
    const pending = sync.check();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    localStorage.setItem("user.email", "two@bankmandiri.co.id");
    resolve(new Response(JSON.stringify({ ok: true, publications: [publication], cursor: 1 })));
    await pending;
    expect(localStorage.getItem("config.redis.port")).toBeNull();
  });
});
