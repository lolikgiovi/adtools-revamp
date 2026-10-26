// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import worker from "../worker.js";

// Failure matrix and delivery contract: docs/settings-publishing.md.
describe("settings publishing API", () => {
  let sqlite, env, admin;
  const session = { email: "one@bankmandiri.co.id", userId: "one", deviceId: "d-one" };
  const payload = {
    title: "Retail setup",
    target: { type: "departments", values: ["RETAIL"] },
    settings: { "config.redis.port": 6380, "config.jira.projectKeys": ["RETAIL"] },
  };
  async function call(path, body, token = admin) {
    return worker.fetch(
      new Request(`http://localhost/api/settings/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
  }
  async function publish(data = payload) {
    const preview = await (await call("admin/preview", data)).json();
    const response = await call("admin/publications", { ...data, audienceHash: preview.audienceHash, requestId: crypto.randomUUID() });
    expect(response.status).toBe(200);
    return response.json();
  }
  async function enroll(identity = session) {
    env.identity = identity;
    const response = await call("enroll", {}, "session");
    expect(response.status).toBe(200);
    return (await response.json()).credential;
  }
  beforeEach(async () => {
    sqlite = new DatabaseSync(":memory:");
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
    }
    const DB = {
      prepare(sql) {
        const bound = (args) => ({
          sql,
          args,
          all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
          first: async () => sqlite.prepare(sql).get(...args) || null,
          run: async () => ({ meta: { ...sqlite.prepare(sql).run(...args) } }),
        });
        return { ...bound([]), bind: (...args) => bound(args) };
      },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
    env = {
      DB,
      identity: session,
      ANALYTICS_DASHBOARD_PASSWORD: "publishing-test-password",
      adtools: {
        get: async (key) => (key === "session:session" ? JSON.stringify(env.identity) : null),
        put: async () => {},
        delete: async () => {},
      },
    };
    sqlite.exec(`INSERT INTO users (id,email,department,created_time,last_seen) VALUES
      ('one','one@bankmandiri.co.id','RETAIL','2026-10-23','2026-10-23'),
      ('two','two@bankmandiri.co.id','SME','2026-10-23','2026-10-23'),
      ('three','three@bankmandiri.co.id','RETAIL','2026-10-23','2026-10-23');
      INSERT INTO device (device_id,user_id,created_time,last_seen) VALUES
      ('d-one','one','2026-10-23','2026-10-23'),('d-two','two','2026-10-23','2026-10-23'),
      ('d-three','three','2026-10-23','2026-10-23');`);
    const auth = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: env.ANALYTICS_DASHBOARD_PASSWORD }),
      }),
      env,
    );
    admin = (await auth.json()).token;
  });
  afterEach(() => sqlite.close());

  it("requires real admin authentication and rejects device IDs as credentials", async () => {
    expect((await call("admin/preview", payload, null)).status).toBe(401);
    expect((await call("admin/publications", payload, "session")).status).toBe(401);
    expect((await call("enroll", {}, "d-one")).status).toBe(401);
    expect((await call("sync", undefined, "d-one")).status).toBe(401);
  });
  it("automatically enrolls an old registered device without a session", async () => {
    await publish();
    env.identity = null;
    const response = await call("enroll", { email: " ONE@bankmandiri.co.id ", deviceId: "d-one" }, null);
    expect(response.status).toBe(200);
    const identity = await response.json();
    expect(identity.userId).toBe("one");
    expect((await (await call("sync", undefined, identity.credential)).json()).publications).toHaveLength(1);
  });
  it("marks a registered development device without restricting settings or clearing the mark on normal enrollment", async () => {
    await publish();
    const body = { email: session.email, deviceId: session.deviceId, isDevelopment: true };
    const response = await call("enroll", body, null);
    expect(response.status).toBe(200);
    const identity = await response.json();
    expect(identity.isDevelopment).toBe(true);
    expect(sqlite.prepare("SELECT is_development FROM device WHERE device_id=?").get(session.deviceId).is_development).toBe(1);
    expect((await (await call("sync", undefined, identity.credential)).json()).publications).toHaveLength(1);
    expect((await call("ack", { ids: [1] }, identity.credential)).status).toBe(200);
    const renewed = await (await call("enroll", { ...body, isDevelopment: false }, null)).json();
    expect(renewed.isDevelopment).toBe(true);
    expect((await call("enroll", { ...body, deviceId: "unknown" }, null)).status).toBe(401);
    expect((await call("enroll", { ...body, email: "two@bankmandiri.co.id" }, null)).status).toBe(401);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM device").get().count).toBe(3);
  });
  it.each([
    { email: "one@bankmandiri.co.id" },
    { email: "one@bankmandiri.co.id", deviceId: "unknown" },
    { email: "two@bankmandiri.co.id", deviceId: "d-one" },
    { deviceId: "d-one" },
  ])("rejects unregistered email/device pairs %j", async (body) => {
    expect((await call("enroll", body, null)).status).toBe(401);
  });
  it("denies publishing when the dashboard password has not been configured", async () => {
    delete env.ANALYTICS_DASHBOARD_PASSWORD;
    const exp = Date.now() + 60000;
    const nonce = crypto.randomUUID();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(":"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${exp}.${nonce}`));
    const signature = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const forged = btoa(JSON.stringify({ exp, nonce, signature }));
    expect((await call("admin/preview", payload, forged)).status).toBe(401);
  });
  it("previews exact recipients and rejects a changed audience", async () => {
    const preview = await (await call("admin/preview", payload)).json();
    expect(preview.recipients.map((row) => row.email)).toEqual([session.email, "three@bankmandiri.co.id"]);
    sqlite.exec("UPDATE users SET department='RETAIL' WHERE id='two'");
    expect((await call("admin/publications", { ...payload, audienceHash: preview.audienceHash })).status).toBe(409);
  });
  it("delivers only to the frozen audience, even when a client spoofs target fields", async () => {
    const publication = await publish();
    const one = await enroll();
    const two = await enroll({ email: "two@bankmandiri.co.id", userId: "two", deviceId: "d-two" });
    const mine = await (await call("sync?email=two@bankmandiri.co.id", undefined, one)).json();
    expect(mine.publications.map((row) => row.id)).toEqual([publication.id]);
    expect((await (await call("sync?department=RETAIL", undefined, two)).json()).publications).toEqual([]);
    expect((await call("ack", { ids: [publication.id] }, two)).status).toBe(403);
    sqlite.exec("UPDATE users SET department='RETAIL' WHERE id='two'");
    expect((await (await call("sync", undefined, two)).json()).publications).toEqual([]);
  });
  it("normalizes email targeting without targeting other users", async () => {
    await publish({ ...payload, target: { type: "emails", values: [" ONE@bankmandiri.co.id "] } });
    const token = await enroll({ email: "three@bankmandiri.co.id", userId: "three", deviceId: "d-three" });
    expect((await (await call("sync", undefined, token)).json()).publications).toEqual([]);
  });
  it.each([
    "theme",
    "update.autoCheck",
    "secure.jira.pat",
    "config.jenkins.username",
    "config.confluence.username",
    "config.redis.username",
    "user.email",
    "config.analytics.endpoint",
  ])("rejects excluded key %s", async (key) => {
    expect((await call("admin/preview", { ...payload, settings: { [key]: "secret" } })).status).toBe(400);
  });
  it("rejects invalid values, embedded credentials, unknown and empty audiences", async () => {
    for (const settings of [
      {},
      { "config.redis.port": 0 },
      { "config.redis.tls": "true" },
      { "config.oracle.connections": [{ name: "UAT", connect_string: "db/service", password: "hidden" }] },
      { "config.jenkins.url": "https://user:password@host" },
      { "config.environments": [{ name: "UAT", cdnPublicUrl: "javascript:alert(1)" }] },
    ])
      expect((await call("admin/preview", { ...payload, settings })).status).toBe(400);
    for (const target of [
      { type: "emails", values: [] },
      { type: "emails", values: ["missing@bankmandiri.co.id"] },
      { type: "departments", values: ["UNKNOWN"] },
    ]) {
      expect((await call("admin/preview", { ...payload, target })).status).toBe(400);
    }
    expect((await call("admin/preview", { ...payload, title: "a".repeat(150000) })).status).toBe(413);
  });
  it("orders publications, supports replay-safe acknowledgements, and revokes undelivered versions", async () => {
    const first = await publish();
    const second = await publish({ ...payload, settings: { "config.redis.port": 6381 } });
    const token = await enroll();
    expect((await (await call("sync", undefined, token)).json()).publications.map((row) => row.id)).toEqual([first.id, second.id]);
    expect((await call("ack", { ids: [first.id] }, token)).status).toBe(200);
    expect((await call("ack", { ids: [first.id] }, token)).status).toBe(200);
    await call("admin/revoke", { id: second.id });
    const data = await (await call(`sync?after=${first.id}`, undefined, token)).json();
    expect(data.publications).toEqual([]);
    const history = await (await call("admin/publications")).json();
    expect(history.publications.find((row) => row.id === first.id).appliedDevices).toBe(1);
  });
  it("rejects expired credentials and device reassignment", async () => {
    const token = await enroll();
    sqlite.exec("UPDATE settings_devices SET expires_at=0");
    expect((await call("sync", undefined, token)).status).toBe(401);
    const next = await enroll();
    sqlite.exec("UPDATE device SET user_id='two' WHERE device_id='d-one'");
    expect((await call("sync", undefined, next)).status).toBe(401);
  });
  it("retries the same publication without creating duplicate deliveries", async () => {
    const preview = await (await call("admin/preview", payload)).json();
    const body = { ...payload, audienceHash: preview.audienceHash, requestId: crypto.randomUUID() };
    const first = await (await call("admin/publications", body)).json();
    const second = await (await call("admin/publications", body)).json();
    expect(second.id).toBe(first.id);
    expect((await (await call("admin/publications")).json()).publications).toHaveLength(1);
  });
});
