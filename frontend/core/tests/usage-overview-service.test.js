// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTokenStore } from "../SessionTokenStore.js";
import { UsageOverviewErrorCode, UsageOverviewService } from "../UsageOverviewService.js";

describe("UsageOverviewService", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("requires the OTP session before fetching synced usage", async () => {
    await expect(UsageOverviewService.fetchOverview()).rejects.toMatchObject({
      code: UsageOverviewErrorCode.AUTH_REQUIRED,
      message: expect.stringContaining("Analytics session unavailable"),
    });
  });

  it("fetches the personal and aggregate views with the session header", async () => {
    SessionTokenStore.saveToken("session-token");
    localStorage.setItem("config.analytics.endpoint", "https://worker.example");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, user: { tools: [] }, global: { tools: [] } }),
    });

    const result = await UsageOverviewService.fetchOverview();
    const [url, options] = fetch.mock.calls[0];
    expect(result.ok).toBe(true);
    expect(url).toBe("https://worker.example/analytics/overview");
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe("Bearer session-token");
  });

  it("clears an expired session instead of retrying it against every endpoint", async () => {
    SessionTokenStore.saveToken("expired-token");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Session expired" }),
    });

    await expect(UsageOverviewService.fetchOverview()).rejects.toMatchObject({ code: UsageOverviewErrorCode.AUTH_REQUIRED });

    expect(SessionTokenStore.getToken()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("posts only the selected tool and note for improvement feedback", async () => {
    SessionTokenStore.saveToken("session-token");
    localStorage.setItem("config.analytics.endpoint", "https://worker.example");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });

    await UsageOverviewService.submitImprovement({ toolId: "quick-query", message: "Make the next step clearer." });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://worker.example/feedback/improvement");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer session-token");
    expect(JSON.parse(options.body)).toEqual({ tool_id: "quick-query", message: "Make the next step clearer." });
  });
});
