// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsSender } from "../AnalyticsSender.js";
import { ErrorMonitor } from "../ErrorMonitor.js";

describe("ErrorMonitor", () => {
  beforeEach(() => {
    global.window = {
      location: { hash: "#json-tools", href: "https://app.example/#json-tools" },
      addEventListener: vi.fn(),
    };
    global.document = {
      createElement(tagName) {
        return { tagName: String(tagName).toUpperCase(), src: "", href: "" };
      },
    };
    Object.defineProperty(global, "navigator", {
      value: { userAgent: "vitest-agent" },
      configurable: true,
    });
    localStorage.clear();
    localStorage.setItem("user.email", "User@Example.com");
    localStorage.setItem("adtools.deviceId", "device-1");
    localStorage.setItem("app.version", "1.2.3");
    ErrorMonitor._initialized = false;
    ErrorMonitor._options = { getCurrentTool: () => "json_tools" };
    ErrorMonitor._recent = new Map();
    AnalyticsSender.sendError = vi.fn().mockResolvedValue(true);
  });

  it("serializes uncaught errors with route, canonical tool, and useful stack", () => {
    const error = new Error("Unexpected 123456 failure");
    error.stack = `Error: Unexpected failure\n${"at fn (app.js:1:1)\n".repeat(30)}`;

    ErrorMonitor.captureWindowError({
      target: window,
      error,
      message: error.message,
      filename: "https://app.example/assets/app.js?token=secret",
      lineno: 12,
      colno: 4,
    });

    expect(AnalyticsSender.sendError).toHaveBeenCalledTimes(1);
    const payload = AnalyticsSender.sendError.mock.calls[0][0];
    expect(payload.user_email).toBe("user@example.com");
    expect(payload.tool_id).toBe("json-tools");
    expect(payload.route).toBe("#json-tools");
    expect(payload.message).toContain("[redacted-code]");
    expect(payload.stack.length).toBeGreaterThan(40);
    expect(payload.source).toBe("https://app.example/assets/app.js");
    expect(payload.lineno).toBe(12);
  });

  it("serializes unhandled rejections", () => {
    ErrorMonitor.captureUnhandledRejection({ reason: "plain rejection" });

    expect(AnalyticsSender.sendError).toHaveBeenCalledTimes(1);
    const payload = AnalyticsSender.sendError.mock.calls[0][0];
    expect(payload.error_kind).toBe("unhandled_rejection");
    expect(payload.message).toBe("plain rejection");
    expect(payload.metadata.reason_type).toBe("string");
  });

  it("serializes resource load failures without query strings", () => {
    const script = document.createElement("script");
    script.src = "https://cdn.example/app.js?token=secret";

    ErrorMonitor.captureWindowError({ target: script });

    expect(AnalyticsSender.sendError).toHaveBeenCalledTimes(1);
    const payload = AnalyticsSender.sendError.mock.calls[0][0];
    expect(payload.error_kind).toBe("resource_error");
    expect(payload.source).toBe("https://cdn.example/app.js");
    expect(payload.metadata.tag).toBe("script");
  });
});
