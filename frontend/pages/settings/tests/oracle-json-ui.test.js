import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../main.js";
import { OracleConnectionService } from "../../../core/OracleConnectionService.js";

// UI failures: password accidentally prefilled or persisted; Apply remains available after
// editing a preview; cancelling retains secrets; duplicate apply submits twice; native failures
// lose the editor or falsely report success. These checks use no native IPC or real credentials.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let page;
let connections;
let credentials;
vi.mock("../json-editor.js", () => ({
  createSettingsJsonEditor: (container, { onChange }) => {
    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", "Connections JSON");
    container.appendChild(textarea);
    textarea.addEventListener("input", onChange);
    return {
      getValue: () => textarea.value,
      setValue: (value) => {
        textarea.value = value;
        onChange();
      },
      focus: () => textarea.focus(),
      updateOptions: ({ readOnly }) => {
        textarea.readOnly = readOnly;
      },
      format: vi.fn(),
      dispose: () => {
        textarea.value = "";
        textarea.remove();
      },
    };
  },
}));
const input = () => document.querySelector(".settings-bulk-input textarea");
const click = (selector) => document.querySelector(selector).click();
const type = (value) => {
  input().value = JSON.stringify(value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.open = false;
    },
  });
  localStorage.clear();
  document.body.replaceChildren();
  connections = [{ name: "DEV", connect_string: "db:1521/DEV" }];
  vi.restoreAllMocks();
  vi.spyOn(OracleConnectionService, "getOracleUsername").mockResolvedValue("app");
  credentials = vi.spyOn(OracleConnectionService, "setOracleCredentials").mockResolvedValue(undefined);
  page = new SettingsPage();
  page.service.getValue = () => structuredClone(connections);
  page.service.setValue = (_key, _type, value) => {
    connections = structuredClone(value);
    return value;
  };
  document.body.appendChild(
    page.renderItem({ key: "config.oracle.connections", type: "oracle-connections", label: "Database Connections" }),
  );
});

describe("Oracle JSON editor", () => {
  it("opens a labelled modal and clears its editor on close", async () => {
    click(".settings-bulk-edit");
    await settle();
    const dialog = document.querySelector(".settings-bulk-dialog");
    expect(dialog.open).toBe(true);
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")).textContent).toContain("Bulk Edit");
    click(".settings-bulk-close");
    expect(dialog.open).toBe(false);
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(".settings-bulk-edit"));
  });
  it("loads address and username without retrieving or prefilling passwords", async () => {
    click(".settings-bulk-edit");
    await settle();
    expect(JSON.parse(input().value)).toEqual([{ name: "DEV", address: "db:1521/DEV", username: "app" }]);
    expect(document.querySelector(".settings-bulk-form").hidden).toBe(false);
  });

  it("previews and applies changes without storing passwords in profiles", async () => {
    click(".settings-bulk-edit");
    await settle();
    type([{ name: "DEV", address: "other:1521/DEV", password: "fake-test-secret" }]);
    click(".settings-bulk-preview");
    expect(document.querySelector(".settings-bulk-review").textContent).toContain("1 updated");
    expect(document.querySelector(".settings-bulk-apply").hidden).toBe(false);
    click(".settings-bulk-apply");
    await settle();
    expect(credentials).toHaveBeenCalledWith("DEV", "app", "fake-test-secret");
    expect(connections).toEqual([{ name: "DEV", connect_string: "other:1521/DEV" }]);
    expect(input()).toBeNull();
    expect(document.querySelector(".settings-bulk-form").hidden).toBe(true);
  });

  it("invalidates the preview on input and clears secrets on cancel", async () => {
    click(".settings-bulk-edit");
    await settle();
    type({ name: "DEV", address: "other", password: "fake-test-secret" });
    click(".settings-bulk-preview");
    type({ name: "DEV", address: "newer", password: "fake-test-secret" });
    expect(document.querySelector(".settings-bulk-apply").hidden).toBe(true);
    click(".settings-bulk-cancel");
    expect(input()).toBeNull();
    expect(credentials).not.toHaveBeenCalled();
  });

  it("keeps the editor available on credential failure without echoing secrets", async () => {
    credentials.mockRejectedValue(new Error("fake-test-secret native failure"));
    click(".settings-bulk-edit");
    await settle();
    type({ name: "DEV", address: "other", password: "fake-test-secret" });
    click(".settings-bulk-preview");
    click(".settings-bulk-apply");
    await settle();
    expect(document.querySelector(".settings-bulk-form").hidden).toBe(false);
    expect(document.querySelector(".settings-bulk-status").textContent).not.toContain("fake-test-secret");
    expect(connections[0].connect_string).toBe("db:1521/DEV");
  });
});
