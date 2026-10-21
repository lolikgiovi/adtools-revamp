import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: {
    trackEvent: vi.fn(),
    trackToolUse: vi.fn(),
  },
}));

vi.mock("../../../core/MonacoOracle.js", () => ({
  createOracleEditor: (container, options = {}) => {
    const editor = {
      value: options.value || "",
      getValue() {
        return this.value;
      },
      setValue(next) {
        this.value = next;
      },
      getScrollTop() {
        return 0;
      },
      setScrollTop() {},
      layout() {},
      dispose() {
        this.disposed = true;
      },
    };
    container.__editor = editor;
    return editor;
  },
}));

vi.mock("handsontable", () => {
  class Handsontable {
    static instances = [];

    constructor(container, settings) {
      this.container = container;
      this.settings = settings;
      this.data = settings.data || [];
      Handsontable.instances.push(this);
    }

    getData() {
      return this.data;
    }

    updateSettings(settings) {
      this.settings = { ...this.settings, ...settings };
    }

    destroy() {
      this.destroyed = true;
    }
  }

  return { default: Handsontable };
});

import { LockeyUpdate } from "../main.js";

const versions = [
  {
    LANGUAGE_PACK_VERSION_ID: "v78",
    RELEASE_ID: "2.0.28",
    LANGUAGE_PACK_VERSION: 78,
    CREATED_BY: "SYSTEM",
    CREATED_TIME: "2026-08-26T15:12:27.000Z",
    UPDATED_BY: "SYSTEM",
    UPDATED_TIME: "2026-08-26T15:12:27.000Z",
  },
  {
    LANGUAGE_PACK_VERSION_ID: "v77",
    RELEASE_ID: "2.0.28",
    LANGUAGE_PACK_VERSION: 77,
    CREATED_BY: "SYSTEM",
    CREATED_TIME: "2026-08-26T15:01:07.000Z",
    UPDATED_BY: "SYSTEM",
    UPDATED_TIME: "2026-08-26T15:01:07.000Z",
  },
];

const updates = [
  {
    LANGUAGE_PACK_UPDATE_ID: "u1",
    LANGUAGE_PACK_VERSION_ID: "v78",
    LOCALIZATION_KEY: "accountStatusLabel",
    ID_VALUE: "Penundaan Transaksi",
    EN_VALUE: "Transaction Restricted",
    CREATED_BY: "SYSTEM",
    CREATED_TIME: "2026-08-26T15:12:47.000Z",
    UPDATED_BY: "SYSTEM",
    UPDATED_TIME: "2026-08-26T15:12:47.000Z",
  },
  {
    LANGUAGE_PACK_UPDATE_ID: "u2",
    LANGUAGE_PACK_VERSION_ID: "v77",
    LOCALIZATION_KEY: "holdAmountFullLabel",
    ID_VALUE: "Penundaan transaksi sementara oleh",
    EN_VALUE: "Hold Amount",
    CREATED_BY: "SYSTEM",
    CREATED_TIME: "2026-08-26T15:01:17.000Z",
    UPDATED_BY: "SYSTEM",
    UPDATED_TIME: "2026-08-26T15:01:17.000Z",
  },
];

function mountTool() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const tool = new LockeyUpdate({ emit: vi.fn() });
  tool.mount(container);
  return { tool, container };
}

function typeInto(element, value) {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setGridRows(tool, rows) {
  tool.grid.data = rows.map((row) => [row.key, row.enValue, row.idValue]);
  tool.grid.settings.afterChange([], "edit");
}

describe("LockeyUpdate UI", () => {
  let tool;
  let container;

  beforeEach(() => {
    localStorage.clear();
    ({ tool, container } = mountTool());
  });

  afterEach(() => {
    tool.unmount();
    container.remove();
  });

  it("switches between the create and history tabs", () => {
    const createPanel = container.querySelector("#lu-create-panel");
    const historyPanel = container.querySelector("#lu-history-panel");

    expect(createPanel.hidden).toBe(false);
    expect(historyPanel.hidden).toBe(true);

    container.querySelector('[data-tab="history"]').click();
    expect(createPanel.hidden).toBe(true);
    expect(historyPanel.hidden).toBe(false);

    container.querySelector('[data-tab="create"]').click();
    expect(createPanel.hidden).toBe(false);
    expect(historyPanel.hidden).toBe(true);
  });

  it("loads both tables from the selected environment and allocates the next version", async () => {
    localStorage.setItem("config.oracle.connections", JSON.stringify([{ name: "SIT", connect_string: "sit-db/service" }]));
    tool.loadConnections();
    tool.oracleService = {
      ensureSidecarStarted: async () => true,
      queryAsDictViaSidecar: async (_name, _config, sql) => {
        const rows = sql.includes("FROM LOCALIZATION.LANGUAGE_PACK_UPDATE") ? updates : versions;
        return { rows, row_count: rows.length };
      },
    };

    container.querySelector("#lu-fetch-oracle").click();

    await vi.waitFor(() => expect(tool.ledgerLoaded).toBe(true));
    expect(container.querySelector("#lu-history-summary").textContent).toContain("2 versions");
    expect(container.querySelector("#lu-history-summary").textContent).toContain("highest v78");
    expect(container.querySelectorAll("#lu-history-body tr")).toHaveLength(2);

    const releases = Array.from(container.querySelectorAll("#lu-release-options option")).map((option) => option.value);
    expect(releases).toEqual(["2.0.28"]);
  });

  it("generates the combined script without loading the ledger", () => {
    typeInto(container.querySelector("#lu-release-id"), "2.0.29");
    setGridRows(tool, [{ key: "accountStatusLabel", enValue: "Transaction Restricted", idValue: "Penundaan Transaksi" }]);

    const sql = tool.sqlEditor.getValue();
    expect(sql.startsWith("SET DEFINE OFF;")).toBe(true);
    expect(sql).toContain("INSERT INTO LOCALIZATION.LANGUAGE_PACK_VERSION");
    expect(sql).toContain("INSERT INTO LOCALIZATION.LANGUAGE_PACK_UPDATE");
    expect(sql).toContain("(SELECT NVL(MAX(LANGUAGE_PACK_VERSION)+1, 1) FROM LOCALIZATION.LANGUAGE_PACK_VERSION)");
    expect(sql).toContain("------ SELECT Statement --------");
    expect(sql).toContain("FETCH FIRST 20 ROWS ONLY;");

    const versionId = sql.match(/VALUES \('([0-9a-fA-F-]{36})', '2\.0\.29'/)?.[1];
    expect(versionId).toBeTruthy();
    expect(sql.split(versionId)).toHaveLength(3);
    expect(container.querySelector("#lu-copy-sql").disabled).toBe(false);
  });

  it("uses the audit trail preference shared with Quick Query", () => {
    tool.unmount();
    container.remove();
    localStorage.removeItem("tool:lockey-update:draft");
    localStorage.setItem("tool:quick-query:audit-user", JSON.stringify({ mode: "custom", customAuditUser: "rxx_squad" }));
    ({ tool, container } = mountTool());

    expect(container.querySelector("#lu-audit-user").value).toBe("RXX_SQUAD");
  });

  it("blocks SQL for an invalid release id", () => {
    typeInto(container.querySelector("#lu-release-id"), "2.0");
    setGridRows(tool, [{ key: "k", enValue: "E", idValue: "I" }]);

    expect(container.querySelector("#lu-validation").textContent).toMatch(/x\.x\.x/);
    expect(container.querySelector("#lu-copy-sql").disabled).toBe(true);
    expect(tool.sqlEditor.getValue()).toContain("Fix the validation issues");
  });

  it("filters the joined history by key", () => {
    tool.applyLedger(versions, updates);
    container.querySelector('[data-tab="history"]').click();

    typeInto(container.querySelector("#lu-search"), "holdAmount");

    expect(container.querySelectorAll("#lu-history-body tr")).toHaveLength(1);
    expect(container.querySelector("#lu-history-body").textContent).toContain("holdAmountFullLabel");
  });

  it("shows an empty history state before data is loaded", () => {
    container.querySelector('[data-tab="history"]').click();

    expect(container.querySelector("#lu-history-summary").textContent).toBe("No localization data loaded.");
    expect(container.querySelector("#lu-history-empty").hidden).toBe(false);
  });
});
