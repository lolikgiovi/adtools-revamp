import { describe, expect, it, vi } from "vitest";
import { buildOracleJsonPlan, applyOracleJsonPlan } from "../oracle-json.js";

// Boundary failures: malformed documents leak secrets; unknown fields or wrong types are
// silently dropped; duplicate names overwrite credentials; new profiles lack credentials;
// omitted passwords clear existing credentials; missing rows delete profiles; stale previews
// overwrite newer state; partial native failures are presented as success; passwords persist.
const existing = [
  { name: "DEV", connect_string: "db:1521/DEV" },
  { name: "KEEP", connect_string: "db:1521/KEEP" },
];
const users = new Map([
  ["DEV", "app"],
  ["KEEP", "reader"],
]);
const plan = (value) => buildOracleJsonPlan(JSON.stringify(value), existing, users);

describe("Oracle JSON boundary", () => {
  it("supports address and preserves omitted profiles/passwords", async () => {
    const review = plan([{ name: "DEV", address: "other:1521/DEV" }]);
    expect(review.summary).toEqual({ added: 0, updated: 1, unchanged: 1 });
    let saved = structuredClone(existing);
    const credentials = vi.fn();
    await applyOracleJsonPlan(review, {
      getConnections: () => saved,
      setConnections: (value) => {
        saved = value;
      },
      setCredentials: credentials,
    });
    expect(saved).toEqual([{ name: "DEV", connect_string: "other:1521/DEV" }, existing[1]]);
    expect(credentials).not.toHaveBeenCalled();
  });

  it("stores passwords only through the credential adapter", async () => {
    const review = plan([
      { name: "DEV", address: "db:1521/DEV", username: "other", password: "replacement" },
      { name: "NEW", address: "db:1521/NEW", username: "new", password: "new-secret" },
    ]);
    let saved = structuredClone(existing);
    const credentials = vi.fn();
    await applyOracleJsonPlan(review, {
      getConnections: () => saved,
      setConnections: (value) => {
        saved = value;
      },
      setCredentials: credentials,
    });
    expect(credentials.mock.calls).toEqual([
      ["DEV", "other", "replacement"],
      ["NEW", "new", "new-secret"],
    ]);
    expect(JSON.stringify(saved)).not.toMatch(/password|username|replacement|new-secret/);
    expect(review.summary).toEqual({ added: 1, updated: 1, unchanged: 1 });
  });

  it("retains the password when only the username changes", async () => {
    const review = plan({ name: "DEV", address: "db:1521/DEV", username: "changed" });
    const credentials = vi.fn();
    let saved = structuredClone(existing);
    await applyOracleJsonPlan(review, {
      getConnections: () => saved,
      setConnections: (value) => {
        saved = value;
      },
      setCredentials: credentials,
    });
    expect(credentials).toHaveBeenCalledWith("DEV", "changed", "");
  });

  it.each([
    null,
    2,
    "text",
    [null],
    [{ name: "DEV", address: "" }],
    [{ name: "DEV", address: "db", password: "" }],
    [{ name: "NEW", address: "db", username: "user" }],
    [{ name: "NEW", address: "db", password: "secret" }],
    [{ name: "DEV", address: "db", password: 1 }],
    [{ name: "DEV", address: "db", connect_string: "legacy" }],
    [
      { name: "DEV", address: "db" },
      { name: "DEV", address: "other" },
    ],
  ])("rejects invalid input before any write (%j)", (value) => {
    expect(() => plan(value)).toThrow();
  });

  it("does not echo malformed JSON containing a password", () => {
    expect(() => buildOracleJsonPlan('[{"password":"sensitive-secret",oops}]', existing, users)).toThrow(
      "Invalid JSON. Check commas, quotes, and brackets.",
    );
  });

  it("blocks stale plans before any credential write", async () => {
    const credentials = vi.fn();
    await expect(
      applyOracleJsonPlan(plan({ name: "DEV", address: "other" }), {
        getConnections: () => [],
        setConnections: vi.fn(),
        setCredentials: credentials,
      }),
    ).rejects.toThrow(/changed.*preview/i);
    expect(credentials).not.toHaveBeenCalled();
  });

  it("reports partial failure and preserves already applied profiles", async () => {
    const review = plan([
      { name: "NEW1", address: "db:1521/A", username: "app", password: "a" },
      { name: "NEW2", address: "db:1521/B", username: "app", password: "b" },
    ]);
    let saved = structuredClone(existing);
    const credentials = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("native error"));
    await expect(
      applyOracleJsonPlan(review, {
        getConnections: () => saved,
        setConnections: (value) => {
          saved = value;
        },
        setCredentials: credentials,
      }),
    ).rejects.toThrow(/1 connection applied/);
    expect(saved.map((connection) => connection.name)).toEqual(["DEV", "KEEP", "NEW1"]);
  });
});
