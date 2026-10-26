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
  it.each([false, true])("enrolls automatically without a session (expired credential: %s)", async (expired) => {
    localStorage.setItem("user.email", "one@bankmandiri.co.id");
    localStorage.setItem("adtools.deviceId", "d-one");
    if (expired)
      localStorage.setItem(
        "settings.sync.credential",
        JSON.stringify({
          credential: "expired",
          email: "one@bankmandiri.co.id",
          userId: "one",
          expiresAt: 1,
        }),
      );
    const fetcher = vi.fn(async (url, options) => {
      if (url.endsWith("enroll")) {
        expect(JSON.parse(options.body)).toEqual({ email: "one@bankmandiri.co.id", deviceId: "d-one" });
        return new Response(
          JSON.stringify({
            ok: true,
            credential: "renewed",
            email: "one@bankmandiri.co.id",
            userId: "one",
            deviceId: "d-one",
            expiresAt: Date.now() + 60000,
          }),
        );
      }
      return new Response(JSON.stringify({ ok: true, publications: [publication] }));
    });
    const sync = new PublishedSettingsSync({ fetcher, apiBase: "http://localhost" });
    await sync.check();
    expect(sync.status).toBe("synced");
    expect(localStorage.getItem("config.redis.port")).toBe("6380");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("renews a server-rejected credential in the same background check", async () => {
    localStorage.setItem("user.email", "one@bankmandiri.co.id");
    localStorage.setItem("adtools.deviceId", "d-one");
    localStorage.setItem(
      "settings.sync.credential",
      JSON.stringify({
        credential: "stale",
        email: "one@bankmandiri.co.id",
        userId: "one",
        deviceId: "d-one",
        expiresAt: Date.now() + 60000,
      }),
    );
    const fetcher = vi.fn(async (url, options) => {
      if (options.headers.Authorization === "Bearer stale") return new Response(JSON.stringify({ ok: false }), { status: 401 });
      if (url.endsWith("enroll"))
        return new Response(
          JSON.stringify({
            ok: true,
            credential: "renewed",
            email: "one@bankmandiri.co.id",
            userId: "one",
            deviceId: "d-one",
            expiresAt: Date.now() + 60000,
          }),
        );
      return new Response(JSON.stringify({ ok: true, publications: [publication] }));
    });
    const sync = new PublishedSettingsSync({ fetcher, apiBase: "http://localhost" });
    await sync.check();
    expect(sync.status).toBe("synced");
    expect(localStorage.getItem("config.redis.port")).toBe("6380");
  });
  it("discards in-flight responses after the signed-in identity changes", async () => {
    localStorage.setItem("user.email", "one@bankmandiri.co.id");
    localStorage.setItem("settings.sync.credential", JSON.stringify({ credential: "test", email: "one@bankmandiri.co.id", userId: "one" }));
    localStorage.setItem("adtools.deviceId", "d-one");
    const identity = JSON.parse(localStorage.getItem("settings.sync.credential"));
    identity.deviceId = "d-one";
    localStorage.setItem("settings.sync.credential", JSON.stringify(identity));
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
