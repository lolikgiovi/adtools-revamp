import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedisCacheTool } from "../main.js";

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: { trackToolUse: vi.fn() },
}));

vi.mock("../../../core/AnalyticsMeta.js", () => ({
  cleanAnalyticsMeta: (value) => value,
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RedisCacheTool interactions", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
    localStorage.setItem("config.redis.host", "cache.internal");
    localStorage.setItem("config.redis.port", "6379");
    localStorage.setItem("config.redis.database", "2");
  });

  it("searches with SCAN, supports selection, and clears only after confirmation", async () => {
    const pageKeys = Array.from({ length: 10 }, (_, index) => `session:${index + 1}`);
    const service = {
      scan: vi.fn().mockResolvedValue({ cursor: 44, keys: pageKeys }),
      deleteKeys: vi.fn().mockResolvedValue({ deleted: pageKeys.length, command: "UNLINK" }),
      testConnection: vi.fn(),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    const input = document.querySelector("#redisPatternInput");
    input.value = "session";
    document.querySelector("#redisSearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(service.scan).toHaveBeenCalledWith(expect.objectContaining({ database: 2 }), "*session*", 0, 100);
    expect(document.querySelectorAll(".redis-key-table tbody tr")).toHaveLength(10);
    expect(document.querySelector("#redisLoadMore").hidden).toBe(false);

    for (const checkbox of document.querySelectorAll(".redis-key-select")) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.querySelector("#redisClearSelected").click();
    expect(service.deleteKeys).not.toHaveBeenCalled();
    expect(document.querySelector("#redisDeleteConfirmation").hidden).toBe(false);
    expect(document.querySelector("#redisDeleteDescription").textContent).toContain("database 2");

    document.querySelector("#redisConfirmDelete").click();
    await settle();

    expect(service.deleteKeys).toHaveBeenCalledWith(expect.objectContaining({ host: "cache.internal" }), pageKeys);
    expect(document.querySelectorAll(".redis-key-table tbody tr")).toHaveLength(0);
    expect(document.querySelector("#redisSearchMessage").textContent).toContain("10 keys cleared with UNLINK");
  });

  it("auto-scans until a sparse page has ten unique matches", async () => {
    const firstScanKeys = ["session:1"];
    const remainingKeys = Array.from({ length: 9 }, (_, index) => `session:${index + 2}`);
    const service = {
      scan: vi
        .fn()
        .mockResolvedValueOnce({ cursor: 44, keys: firstScanKeys })
        .mockResolvedValueOnce({ cursor: 0, keys: remainingKeys }),
      deleteKeys: vi.fn(),
      testConnection: vi.fn(),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    const input = document.querySelector("#redisPatternInput");
    input.value = "session";
    document.querySelector("#redisSearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(service.scan).toHaveBeenNthCalledWith(1, expect.objectContaining({ database: 2 }), "*session*", 0, 100);
    expect(service.scan).toHaveBeenNthCalledWith(2, expect.objectContaining({ database: 2 }), "*session*", 44, 100);
    expect(document.querySelectorAll(".redis-key-table tbody tr")).toHaveLength(10);
    expect(document.querySelector("#redisLoadMore").hidden).toBe(true);
    expect(document.querySelector("#redisSearchMessage").textContent).toContain("Scan complete.");
  });

  it("keeps a favorite after clearing it so recurring cache keys remain reusable", async () => {
    const service = {
      scan: vi.fn(),
      deleteKeys: vi.fn().mockResolvedValue({ deleted: 1, command: "DEL" }),
      testConnection: vi.fn(),
    };
    localStorage.setItem("tool:redis-cache:favorites", JSON.stringify(["feature:flags"]));
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    document.querySelector('[data-favorite-action="clear"]').click();
    document.querySelector("#redisConfirmDelete").click();
    await settle();

    expect(service.deleteKeys).toHaveBeenCalledWith(expect.any(Object), ["feature:flags"]);
    expect(document.querySelector(".redis-favorite-item code").textContent).toBe("feature:flags");
    expect(document.querySelector("#redisSearchMessage").textContent).toContain("DEL");
  });

  it("locks other Redis operations during a connection test", async () => {
    let finishTest;
    const service = {
      scan: vi.fn(),
      deleteKeys: vi.fn(),
      testConnection: vi.fn(() => new Promise((resolve) => (finishTest = resolve))),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    document.querySelector("#redisTestConnection").click();
    expect(document.querySelector("#redisSearchButton").disabled).toBe(true);
    expect(document.querySelector("#redisTestConnection").disabled).toBe(true);

    finishTest({ ok: true, message: "Connection successful" });
    await settle();
    expect(document.querySelector("#redisSearchButton").disabled).toBe(false);
    expect(document.querySelector("#redisTestConnection").disabled).toBe(false);
    expect(document.querySelector("#redisConnectionDiagnostics").hidden).toBe(false);
    expect(document.querySelector("#redisDiagnosticStatus").textContent).toBe("Connection successful");
  });

  it("shows actionable diagnostics when the Redis endpoint refuses the connection", async () => {
    const service = {
      scan: vi.fn(),
      deleteKeys: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({
        ok: false,
        message: "The Redis endpoint refused the TCP connection",
        stage: "network",
        endpoint: "cache.internal:6379",
        detail: "Connection refused (os error 61)",
        hint: "Verify Redis is running and listening on the configured host and port.",
      }),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    document.querySelector("#redisTestConnection").click();
    await settle();

    const diagnostics = document.querySelector("#redisConnectionDiagnostics");
    expect(diagnostics.hidden).toBe(false);
    expect(diagnostics.dataset.state).toBe("error");
    expect(document.querySelector("#redisDiagnosticStage").textContent).toBe("Network");
    expect(document.querySelector("#redisDiagnosticDetail").textContent).toContain("os error 61");
    expect(document.querySelector("#redisDiagnosticHint").textContent).toContain("listening");
    expect(document.querySelector("#redisSearchMessage").textContent).toContain("refused");

    document.querySelector("#redisDismissDiagnostics").click();
    expect(diagnostics.hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector("#redisTestConnection"));
  });

  it("focuses the database setting after a database-selection failure", async () => {
    const service = {
      scan: vi.fn(),
      deleteKeys: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({
        ok: false,
        message: "Redis rejected the configured database",
        stage: "database",
        endpoint: "cache.internal:6379",
        detail: "DB index is out of range",
        hint: "Set Redis Database to a valid index, commonly 0.",
      }),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    document.querySelector("#redisTestConnection").click();
    await settle();
    document.querySelector("#redisOpenSettings").click();

    expect(localStorage.getItem("settings.focus")).toBe("config.redis.database");
  });

  it("closes delete confirmation with Escape and restores focus to its trigger", async () => {
    const service = { scan: vi.fn(), deleteKeys: vi.fn(), testConnection: vi.fn() };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));
    tool.keys = ["session:1"];
    tool.renderResults();
    const clearButton = document.querySelector('[data-action="clear"]');
    clearButton.focus();
    clearButton.click();

    const confirmation = document.querySelector("#redisDeleteConfirmation");
    confirmation.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(confirmation.hidden).toBe(true);
    expect(document.activeElement).toBe(clearButton);
  });
});
