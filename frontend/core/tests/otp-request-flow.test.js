// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { OtpRequestFlow } from "../OtpRequestFlow.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("restores deadlines, enables retry at one minute and manual at three minutes", async () => {
  vi.useFakeTimers();
  const payload = { email: "person@bankmandiri.co.id", deviceId: "device" };
  const retry = document.createElement("button");
  const manual = document.createElement("button");
  const hint = document.createElement("p");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true, retryAt: Date.now() + 60_000, manualAvailableAt: Date.now() + 180_000 }),
    })),
  );
  const options = { identity: () => payload, retry, manual, hint };
  const flow = new OtpRequestFlow(options);
  await flow.request();
  expect(retry.disabled).toBe(true);
  expect(manual.disabled).toBe(true);
  vi.advanceTimersByTime(60_000);
  expect(retry.disabled).toBe(false);
  expect(manual.disabled).toBe(true);
  flow.destroy();
  const restored = new OtpRequestFlow(options);
  expect(manual.disabled).toBe(true);
  vi.advanceTimersByTime(120_000);
  expect(manual.disabled).toBe(false);
  restored.destroy();
});
it("offers manual approval immediately on a failed OTP response and prevents duplicate sends", async () => {
  const manual = document.createElement("button");
  let finish;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const flow = new OtpRequestFlow({
    identity: () => ({ email: "person@bankmandiri.co.id", deviceId: "d" }),
    retry: document.createElement("button"),
    manual,
    hint: document.createElement("p"),
  });
  const first = flow.request();
  await flow.request();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish({ status: 502, json: async () => ({ ok: false, manualApprovalAvailable: true }) });
  await expect(first).rejects.toThrow();
  expect(manual.hidden).toBe(false);
  expect(manual.disabled).toBe(false);
  flow.destroy();
});
