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

  it("keeps pagination at the bottom of the results container", () => {
    const service = { scan: vi.fn(), deleteKeys: vi.fn(), testConnection: vi.fn() };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));
    tool.keys = Array.from({ length: 10 }, (_, index) => `session:${index + 1}`);
    tool.resultPages = [tool.keys.slice()];
    tool.activePattern = "*session*";
    tool.cursor = 44;
    tool.scanComplete = false;
    tool.renderResults();

    const pagination = document.querySelector("#redisPagination");
    expect(document.querySelector("#redisLoadMore")).toBeNull();
    expect(pagination.hidden).toBe(false);
    expect(document.querySelector("#redisResults").nextElementSibling).toBe(pagination);
    expect(pagination.querySelector('[data-redis-page="1"]').getAttribute("aria-current")).toBe("page");
    expect(pagination.querySelector('[data-redis-page="previous"]').disabled).toBe(true);
    expect(document.querySelector("#redisResults").getAttribute("role")).toBe("region");
  });

  it("opens destructive confirmation as a modal dialog", () => {
    const service = { scan: vi.fn(), deleteKeys: vi.fn(), testConnection: vi.fn() };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));
    tool.keys = ["session:1"];
    tool.resultPages = [tool.keys.slice()];
    tool.activePattern = "*session*";
    tool.scanComplete = true;
    tool.renderResults();

    document.querySelector('[data-action="clear"]').click();

    const confirmation = document.querySelector("#redisDeleteConfirmation");
    expect(confirmation.hidden).toBe(false);
    expect(confirmation.getAttribute("role")).toBe("alertdialog");
    expect(confirmation.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(document.querySelector("#redisConfirmDelete"));
  });

  it("searches with SCAN, supports selection, and clears only after confirmation", async () => {
    const pageKeys = Array.from({ length: 10 }, (_, index) => `session:${index + 1}`);
    const nextPageKeys = Array.from({ length: 10 }, (_, index) => `session:${index + 11}`);
    const service = {
      scan: vi.fn().mockResolvedValueOnce({ cursor: 44, keys: pageKeys }).mockResolvedValueOnce({ cursor: 0, keys: nextPageKeys }),
      deleteKeys: vi.fn().mockResolvedValue({ deleted: nextPageKeys.length, command: "UNLINK" }),
      testConnection: vi.fn(),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    const input = document.querySelector("#redisPatternInput");
    input.value = "session";
    document.querySelector("#redisKeySearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(service.scan).toHaveBeenCalledWith(expect.objectContaining({ database: 2 }), "*session*", 0, 100);
    expect(document.querySelectorAll(".redis-key-table tbody tr")).toHaveLength(10);
    expect(document.querySelector("#redisPagination").hidden).toBe(false);

    document.querySelector('[data-redis-page="next"]').click();
    await settle();
    expect(service.scan).toHaveBeenNthCalledWith(2, expect.objectContaining({ database: 2 }), "*session*", 44, 100);
    expect(document.querySelector('[data-redis-page="2"]').getAttribute("aria-current")).toBe("page");

    document.querySelector('[data-redis-page="1"]').click();
    await settle();
    expect(document.querySelector(".redis-key-table tbody tr code").textContent).toBe("session:1");
    document.querySelector('[data-redis-page="2"]').click();
    await settle();

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

    expect(service.deleteKeys).toHaveBeenCalledWith(expect.objectContaining({ host: "cache.internal" }), nextPageKeys);
    expect(document.querySelectorAll(".redis-key-table tbody tr")).toHaveLength(0);
    expect(document.querySelector("#redisSearchMessage").textContent).toContain("10 keys cleared with UNLINK");
  });

  it("auto-scans until a sparse page has ten unique matches", async () => {
    const firstScanKeys = ["session:1"];
    const remainingKeys = Array.from({ length: 9 }, (_, index) => `session:${index + 2}`);
    const service = {
      scan: vi.fn().mockResolvedValueOnce({ cursor: 44, keys: firstScanKeys }).mockResolvedValueOnce({ cursor: 0, keys: remainingKeys }),
      deleteKeys: vi.fn(),
      testConnection: vi.fn(),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    const input = document.querySelector("#redisPatternInput");
    input.value = "session";
    document.querySelector("#redisKeySearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(service.scan).toHaveBeenNthCalledWith(1, expect.objectContaining({ database: 2 }), "*session*", 0, 100);
    expect(service.scan).toHaveBeenNthCalledWith(2, expect.objectContaining({ database: 2 }), "*session*", 44, 100);
    expect(document.querySelectorAll(".redis-key-table tbody tr")).toHaveLength(10);
    expect(document.querySelector("#redisPagination").hidden).toBe(true);
    expect(document.querySelector("#redisSearchMessage").textContent).toContain("Scan complete.");
  });

  it("opens formatted JSON in a searchable modal and restores focus on close", async () => {
    const service = {
      scan: vi.fn(),
      getValue: vi.fn().mockResolvedValue({
        key: "session:1",
        kind: "string",
        ttl_seconds: 120,
        memory_bytes: 64,
        value: '{"customer":"42","repeat":"42","active":true}',
        supported: true,
        truncated: false,
      }),
      deleteKeys: vi.fn(),
      testConnection: vi.fn(),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));
    tool.keys = ["session:1"];
    tool.resultPages = [tool.keys.slice()];
    tool.activePattern = "*session*";
    tool.scanComplete = true;
    tool.renderResults();

    const view = document.querySelector('[data-action="view"]');
    view.focus();
    view.click();
    await settle();

    expect(service.getValue).toHaveBeenCalledWith(expect.objectContaining({ host: "cache.internal" }), "session:1");
    const inspector = document.querySelector("#redisValueInspector");
    expect(inspector.hidden).toBe(false);
    expect(inspector.getAttribute("role")).toBe("dialog");
    expect(inspector.parentElement).toBe(document.querySelector(".redis-cache-tool"));
    expect(document.querySelector("#redisValueInspectorKey").textContent).toBe("session:1");
    expect(document.querySelector("#redisValueInspectorMeta").textContent).toContain("string");
    expect(document.querySelector("#redisValueContent").textContent).toContain('"customer"');
    expect(document.querySelector(".redis-json-key").textContent).toBe('"customer"');
    expect(document.querySelector(".redis-json-boolean").textContent).toBe("true");
    expect(document.querySelector("#redisValueContent").innerHTML).not.toContain("<script");
    const search = document.querySelector("#redisValueSearch");
    expect(document.activeElement).toBe(search);
    search.value = "42";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#redisValueSearchCount").textContent).toBe("1 of 2");
    expect(document.querySelectorAll(".redis-value-match")).toHaveLength(2);
    expect(document.querySelector(".redis-json-key").textContent).toBe('"customer"');
    document.querySelector("#redisValueNextMatch").click();
    expect(document.querySelector("#redisValueSearchCount").textContent).toBe("2 of 2");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(inspector.hidden).toBe(true);
    expect(document.activeElement).toBe(view);
  });

  it("keeps buffered scan matches available across numbered pages", async () => {
    const allKeys = Array.from({ length: 25 }, (_, index) => `session:${index + 1}`);
    const service = {
      scan: vi.fn().mockResolvedValue({ cursor: 0, keys: allKeys }),
      deleteKeys: vi.fn(),
      testConnection: vi.fn(),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    const input = document.querySelector("#redisPatternInput");
    input.value = "session";
    document.querySelector("#redisKeySearchForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(service.scan).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#redisPaginationSummary").textContent).toBe("Page 1 of 1+");
    expect(document.querySelector(".redis-key-table tbody tr code").textContent).toBe("session:1");

    document.querySelector('[data-redis-page="next"]').click();
    await settle();
    expect(document.querySelector(".redis-key-table tbody tr code").textContent).toBe("session:11");

    document.querySelector('[data-redis-page="next"]').click();
    await settle();
    expect(document.querySelector(".redis-key-table tbody tr code").textContent).toBe("session:21");
    expect(document.querySelector('[data-redis-page="next"]').disabled).toBe(true);
    expect(document.querySelector("#redisPaginationSummary").textContent).toBe("Page 3 of 3");
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

    document.querySelector('[data-favorite-action="delete"]').click();
    document.querySelector("#redisConfirmDelete").click();
    await settle();

    expect(service.deleteKeys).toHaveBeenCalledWith(expect.any(Object), ["feature:flags"]);
    expect(document.querySelector(".redis-favorite-item code").textContent).toBe("feature:flags");
    expect(document.querySelector("#redisSearchMessage").textContent).toContain("DEL");
  });

  it("shows View and Delete on the left and confirms Unfavorite without deleting the Redis key", () => {
    const service = { scan: vi.fn(), deleteKeys: vi.fn(), getValue: vi.fn(), testConnection: vi.fn() };
    localStorage.setItem("tool:redis-cache:favorites", JSON.stringify(["feature:flags"]));
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));

    const actions = document.querySelector(".redis-favorite-item > div");
    expect([...actions.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["View", "Delete", "Unfavorite"]);
    expect(actions.firstElementChild.querySelectorAll("button")).toHaveLength(2);
    actions.querySelector('[data-favorite-action="unfavorite"]').click();

    expect(document.querySelector("#redisDeleteConfirmation").hidden).toBe(false);
    expect(document.querySelector("#redisDeleteTitle").textContent).toContain("Unfavorite");
    expect(document.querySelector("#redisConfirmDelete").textContent).toBe("Unfavorite");
    expect(document.querySelector(".redis-favorite-item")).not.toBeNull();
    expect(service.deleteKeys).not.toHaveBeenCalled();

    document.querySelector("#redisCancelDelete").click();
    expect(document.querySelector(".redis-favorite-item")).not.toBeNull();

    document.querySelector('[data-favorite-action="unfavorite"]').click();
    document.querySelector("#redisConfirmDelete").click();
    expect(document.querySelector("#redisDeleteConfirmation").hidden).toBe(true);
    expect(document.querySelector(".redis-favorite-item")).toBeNull();
    expect(localStorage.getItem("tool:redis-cache:favorites")).toBe("[]");
    expect(service.deleteKeys).not.toHaveBeenCalled();
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
    expect(document.querySelector("#redisConnectionDiagnostics").hidden).toBe(true);
    expect(document.querySelector("#redisConnectionDiagnostics").dataset.state).toBe("success");
    expect(document.querySelector("#redisDiagnosticStatus").textContent).toBe("Connection successful");
    expect(document.querySelector("#redisSearchMessage").textContent).toBe("");
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
