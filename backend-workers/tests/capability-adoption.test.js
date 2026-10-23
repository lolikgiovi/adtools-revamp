// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildCapabilityAdoptionQuery } from "../src/utils/capabilityAdoption.js";

// Failure modes: historic uninstrumented visits imply non-use; clicks imply success;
// two devices inflate people; disabled controls imply opportunity; outside-range usage leaks in;
// malformed JSON breaks reporting; desktop-only controls look undiscovered for web users.
let db;
afterEach(() => db?.close());
it("reports adoption and discovery evidence per capability and person", () => {
  db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE events(device_id TEXT, feature_id TEXT, action TEXT, properties TEXT, created_time TEXT);
    CREATE TABLE device(device_id TEXT, user_id INTEGER); CREATE TABLE users(id INTEGER, email TEXT);
    INSERT INTO users VALUES (1, 'user@example.com'), (2, 'other@example.com');
    INSERT INTO device VALUES ('a', 1), ('b', 1), ('c', 2);`);
  const insert = db.prepare("INSERT INTO events VALUES (?, 'quick-query', ?, ?, ?)");
  const add = (device, action, props, time = "2026-10-23 10:00:00") =>
    insert.run(device, action, JSON.stringify({ schema_version: 1, runtime: "web", ...props }), time);
  add("a", "capability_visit", {});
  add("b", "capability_visit", {});
  add("c", "capability_visit", {});
  add("a", "capability_exposed", { capability: "import_excel", available: true });
  add("b", "capability_exposed", { capability: "import_excel", available: true });
  add("a", "capability_opened", { capability: "import_excel" });
  add("c", "capability_exposed", { capability: "import_excel", available: false });
  add("c", "capability_succeeded", { capability: "import_excel" }, "2026-01-01 10:00:00");
  insert.run("c", "control_click", "malformed", "2026-10-23 10:00:00");
  const range = { where: (column) => `AND ${column} >= '2026-10-01'` };
  let rows = db.prepare(buildCapabilityAdoptionQuery(range)).all();
  let excel = rows.find((row) => row.capability === "import_excel");
  expect(excel).toMatchObject({ tool_users: 2, exposed_users: 1, explored_users: 1, successful_users: 0, explored_without_success: 1 });
  expect(rows.some((row) => row.capability === "import_oracle_rows")).toBe(false);
  const people = db.prepare(buildCapabilityAdoptionQuery(range, true)).all();
  expect(people.find((row) => row.user === "user@example.com" && row.capability === "import_excel")).toMatchObject({
    signal: "explored_without_success",
  });
  expect(people.find((row) => row.user === "other@example.com" && row.capability === "import_excel")).toMatchObject({
    signal: "unavailable_when_exposed",
  });
  add("a", "capability_succeeded", { capability: "import_excel" });
  rows = db.prepare(buildCapabilityAdoptionQuery(range)).all();
  excel = rows.find((row) => row.capability === "import_excel");
  expect(excel).toMatchObject({ successful_users: 1, explored_without_success: 0 });
  add("a", "capability_succeeded", { capability: "import_excel", actor_email: "original@example.com" });
  const attributed = db.prepare(buildCapabilityAdoptionQuery(range, true)).all();
  expect(attributed.find((row) => row.user === "original@example.com" && row.capability === "import_excel")).toMatchObject({
    signal: "used",
  });
  const kafka = db.prepare("INSERT INTO events VALUES ('a', 'kafka', ?, ?, '2026-10-23 10:00:00')");
  kafka.run("capability_visit", JSON.stringify({ schema_version: 1, runtime: "tauri" }));
  kafka.run("capability_opened", JSON.stringify({ schema_version: 1, runtime: "tauri", capability: "saved_requests" }));
  const exploration = db.prepare(buildCapabilityAdoptionQuery(range, true)).all();
  expect(exploration.find((row) => row.capability === "saved_requests")).toMatchObject({ signal: "explored", completion_measured: "no" });
});
