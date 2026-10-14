// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualApprovalMonitor } from "../ManualApprovalMonitor.js";
import { SessionTokenStore } from "../SessionTokenStore.js";

const identity = {
  requestId: "request-1",
  email: "person@bankmandiri.co.id",
  deviceId: "device-1",
  displayName: "Person",
  department: "SME",
  role: "ANALYST",
};
const response = (body) => ({ ok: true, json: async () => ({ ok: true, ...body }) });
let monitor;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  location.hash = "#register";
  monitor = new ManualApprovalMonitor();
});
afterEach(() => {
  monitor.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function save(value = identity) {
  localStorage.setItem("manual.approval.request", JSON.stringify(value));
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("pending manual approval monitor", () => {
  it("does nothing without a valid stored pending request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const value of [null, { requestId: "missing-identity" }]) {
      save(value);
      monitor.start();
      await vi.advanceTimersByTimeAsync(120000);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("checks on startup and exactly every minute while pending", async () => {
    save();
    const fetchMock = vi.fn(async () => response({ status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);
    monitor.start();
    monitor.start();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/register/manual-approval-status");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject(identity);
    await vi.advanceTimersByTimeAsync(59999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("finishes registration and stops checks as soon as approved", async () => {
    save();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ status: "pending" }))
      .mockResolvedValueOnce(response({ status: "approved", token: "session-1", userId: "user-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const eventBus = { emit: vi.fn() };
    monitor.start({ eventBus });
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(SessionTokenStore.getToken()).toBe("session-1");
    expect(localStorage.getItem("user.registered")).toBe("true");
    expect(localStorage.getItem("user.department")).toBe("SME");
    expect(localStorage.getItem("user.role")).toBe("ANALYST");
    expect(localStorage.getItem("manual.approval.request")).toBeNull();
    expect(eventBus.emit).toHaveBeenCalledWith("user:registered", expect.objectContaining({ username: "Person", userId: "user-1" }));
    expect(location.hash).toBe("#home");
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("coalesces manual and automatic checks while a response is outstanding", async () => {
    save();
    let resolve;
    const fetchMock = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    monitor.start();
    const first = monitor.check();
    const second = monitor.check();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(response({ status: "pending" }));
    await first;
  });
  it("retries network failure on the next minute", async () => {
    save();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(response({ status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);
    monitor.start();
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("manual.approval.request")).not.toBeNull();
  });
  it.each(["stop", "replace", "remove"])("ignores an approved response after %s", async (action) => {
    save();
    let resolve;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    monitor.start();
    if (action === "stop") monitor.stop();
    if (action === "replace") save({ ...identity, requestId: "request-2" });
    if (action === "remove") localStorage.removeItem("manual.approval.request");
    resolve(response({ status: "approved", token: "stale-token" }));
    await flush();
    expect(SessionTokenStore.getToken()).toBeNull();
    expect(localStorage.getItem("user.registered")).toBeNull();
  });
  it("stops polling when the stored request is removed", async () => {
    save();
    const fetchMock = vi.fn(async () => response({ status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);
    monitor.start();
    await flush();
    localStorage.removeItem("manual.approval.request");
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
