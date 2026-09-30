// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const editors = [];
vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(() => {
    const editor = {
      value: "",
      setValue(value) {
        this.value = value;
      },
      getValue() {
        return this.value;
      },
      layout: vi.fn(),
      onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    };
    editors.push(editor);
    return editor;
  }),
}));
vi.mock("../../../core/KeychainMigration.js", () => ({ ensureUnifiedKeychain: vi.fn() }));

import { JenkinsRunner } from "../main.js";

afterEach(() => {
  editors.length = 0;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Run Query template modal", () => {
  it("lays out the saved query after opening View/Edit", async () => {
    const template = { name: "Saved query", env: "UAT", sql: "select * from example_table" };
    const runner = new JenkinsRunner();
    runner.container = document.createElement("div");
    runner.container.innerHTML = runner.render();
    document.body.append(runner.container);
    runner.isActive = true;
    runner.storageService = {
      init: vi.fn(),
      getEnv: vi.fn().mockResolvedValue(""),
      getLastState: vi.fn().mockResolvedValue({}),
      saveLastState: vi.fn(),
      loadTemplates: vi.fn().mockResolvedValue([template]),
      findTemplateByName: vi.fn().mockResolvedValue(template),
      loadHistory: vi.fn().mockResolvedValue([]),
    };
    runner.service = {
      hasToken: vi.fn().mockResolvedValue(false),
      loadJenkinsUrl: vi.fn().mockReturnValue(""),
      getEnvChoices: vi.fn().mockResolvedValue(["UAT"]),
    };

    await runner.onMount();
    await vi.waitFor(() => expect(runner.container.querySelector(".jr-template-edit")).not.toBeNull());
    const templateEditor = runner.templateEditor;
    templateEditor.layout.mockClear();

    runner.container.querySelector(".jr-template-edit").click();
    await vi.waitFor(() => expect(templateEditor.getValue()).toBe(template.sql));
    await vi.waitFor(() => expect(templateEditor.layout).toHaveBeenCalled());
    expect(runner.container.querySelector("#jr-template-modal").style.display).toBe("flex");

    runner.onUnmount();
  });
});
