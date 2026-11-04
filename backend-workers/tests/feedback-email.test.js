// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePublicImprovementFeedbackPost } from "../src/routes/analytics.js";

function environment() {
  const run = vi.fn(async () => ({ success: true }));
  return {
    RESEND_API_KEY: "test-key", MAIL_FROM: "feedback@example.com", FEEDBACK_EMAIL: "owner@example.com",
    DB: { prepare: () => ({ bind: (...args) => ({ run: () => run(...args) }) }) },
    adtools: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
    run,
  };
}
function request(message = "Please improve this tool") {
  return new Request("https://example.com/feedback/public-improvement", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", device_id: "device", tool_id: "quick-query", message }),
  });
}
afterEach(() => vi.unstubAllGlobals());
describe("feedback email notification", () => {
  it("stores feedback and sends its contents to the configured owner", async () => {
    const env = environment();
    const fetch = vi.fn(async () => new Response('{"id":"mail-1"}', { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const response = await handlePublicImprovementFeedbackPost(request(), env);
    expect(response.status).toBe(201);
    expect((await response.json()).notification_sent).toBe(true);
    expect(env.run).toHaveBeenCalledOnce();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.text).toContain("Please improve this tool");
    expect(body.text).toContain("quick-query");
    expect(body.text).toContain("person@example.com");
  });
  it("keeps saved feedback and reports notification failure when email is unavailable", async () => {
    const env = environment();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const response = await handlePublicImprovementFeedbackPost(request(), env);
    expect(response.status).toBe(201);
    expect((await response.json()).notification_sent).toBe(false);
    expect(env.run).toHaveBeenCalledOnce();
  });
  it("never emails a rejected empty note", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await handlePublicImprovementFeedbackPost(request("   "), environment())).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
