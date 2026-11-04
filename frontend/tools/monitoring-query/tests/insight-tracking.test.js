// Monitoring Query reports failed core operations, labelled by the Oracle connection name when it is a plain label.
// Ways it could go wrong: a failed load, generate, apply or history read goes unreported; UI-only actions (select,
// edit) report as failures; an apply that Oracle rejects with a conflict or failure reports nothing; the connect
// string, username or error text leaks; a connection name that looks like a host is used as a label.
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { MonitoringQuery } from "../main.js";

afterEach(() => vi.restoreAllMocks());

function tool(connection = { name: "SIT_MONITORING", connect_string: "db.secret-host:1521/SVC" }) {
  const failures = [];
  vi.spyOn(UsageTracker, "trackFailure").mockImplementation((id, action, error, meta) => failures.push({ id, action, error, meta }));
  const instance = Object.assign(Object.create(MonitoringQuery.prototype), {
    connection,
    identity: { username: "secret_user", database: "DB", service: "SVC" },
    status: vi.fn(),
    showError: vi.fn(),
    renderAll: vi.fn(),
    persist: vi.fn(),
  });
  return { instance, failures };
}

describe("Monitoring Query insight", () => {
  it("reports a failed core action with the connection label and not UI-only actions", () => {
    const { instance, failures } = tool();
    const error = new Error("ORA-12541: TNS:no listener at db.secret-host");
    instance.fail(error, "load");
    instance.fail(new Error("x"), "select");
    instance.fail(new Error("x"));
    expect(failures).toEqual([{ id: "monitoring-query", action: "load", error, meta: { connection_label: "SIT_MONITORING" } }]);
  });

  it("leaves out a connection name that looks like a host or address", () => {
    const { instance, failures } = tool({ name: "db.secret-host:1521", connect_string: "x" });
    instance.fail(new Error("x"), "history");
    expect(failures[0].meta).toEqual({});
  });

  it("reports an apply that Oracle rejected or whose outcome was lost", async () => {
    for (const [result, category, state] of [
      [{ state: "Conflict", conflicts: [] }, "rejected", "Conflict"],
      [{ state: "Failed" }, "server", "Failed"],
      [{ state: "Outcome Unknown" }, "network", "Outcome Unknown"],
    ]) {
      const { instance, failures } = tool();
      Object.assign(instance, {
        view: "review",
        metadata: {},
        tables: {},
        preflight: vi.fn().mockResolvedValue(true),
        service: { apply: vi.fn().mockResolvedValue(result) },
        acceptCommitted: vi.fn(),
      });
      // operations is a derived getter on the tool; pin it for this apply.
      Object.defineProperty(instance, "operations", { value: [{ table: "DSH_MENU", action: "UPDATE", desired: {}, baseline: {} }] });
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("id");
      await instance.apply();
      expect(failures).toEqual([
        {
          id: "monitoring-query",
          action: "apply",
          error: category,
          meta: { connection_label: "SIT_MONITORING", state, operation_count: 1 },
        },
      ]);
      vi.restoreAllMocks();
    }
  });
});
