// @vitest-environment jsdom
// Failure cases: the picker is offered where the Oracle sidecar cannot work (web), or with
// nothing to pick (desktop, no saved connections); a stale saved connection stays selectable;
// rebuilding the picker drops the user's selection; the Settings shortcut lands on the wrong
// setting; the picker stays live in the middle of a run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckImageTool } from "../main.js";
import { isTauri } from "../../../core/Runtime.js";

vi.mock("../../../core/Runtime.js", () => ({ isTauri: vi.fn() }));

const CONNECTIONS_KEY = "config.oracle.connections";
const SETTINGS_FOCUS_KEY = "settings.focus";

function saveConnections(names) {
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(names.map((name) => ({ name, connect_string: name.toLowerCase() }))));
}

/** Mount the real tool template, skipping the storage-backed bookkeeping the picker does not touch. */
function mountTool() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const tool = new CheckImageTool();
  tool.saveValues = tool.clearSavedValues = tool.recordReferenceHistory = () => {};
  tool.loadSavedValues = () => {};
  tool.loadReferenceData = () => {};
  tool.mount(host);
  return tool;
}

beforeEach(() => {
  localStorage.clear();
  isTauri.mockReturnValue(true);
  window.app = { router: { navigate: vi.fn() } };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.app;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("Oracle connection picker", () => {
  it("hides the picker in the web app, where the sidecar cannot answer", () => {
    isTauri.mockReturnValue(false);
    saveConnections(["UAT"]);
    const tool = mountTool();
    expect(tool.elements.imageOracleControl.hidden).toBe(true);
  });

  it("picks saved connections on desktop and points at Settings only when there are none", () => {
    const tool = mountTool();
    expect(tool.elements.imageOracleControl.hidden).toBe(false);
    expect(tool.elements.imageOracleConnection.hidden).toBe(true);
    expect(tool.elements.configureOracleButton.hidden).toBe(false);
    expect(tool.elements.imageOracleHint.textContent).toContain("Settings");

    saveConnections(["UAT", "PROD"]);
    tool.populateOracleConnections();
    tool.updateOracleControl();
    expect(tool.elements.imageOracleConnection.hidden).toBe(false);
    expect(tool.elements.configureOracleButton.hidden).toBe(true);
    expect([...tool.elements.imageOracleConnection.options].map((option) => option.value)).toEqual(["", "UAT", "PROD"]);
    expect(tool.elements.imageOracleHint.textContent).toContain("CONTENT.IMAGE");
  });

  it("keeps the current selection when the picker is rebuilt and drops one that no longer exists", () => {
    saveConnections(["UAT", "PROD"]);
    const tool = mountTool();
    tool.elements.imageOracleConnection.value = "PROD";

    tool.populateOracleConnections();
    expect(tool.elements.imageOracleConnection.value).toBe("PROD");

    saveConnections(["UAT"]);
    tool.populateOracleConnections();
    expect(tool.elements.imageOracleConnection.value).toBe("");
  });

  it("deep-links to the Oracle connections setting", () => {
    const tool = mountTool();
    tool.elements.configureOracleButton.click();
    expect(localStorage.getItem(SETTINGS_FOCUS_KEY)).toBe("config.oracle.connections");
    expect(window.app.router.navigate).toHaveBeenCalledWith("settings");
  });

  it("disables the picker while a check is running", () => {
    saveConnections(["UAT"]);
    const tool = mountTool();
    tool.setCheckingState(true);
    expect(tool.elements.imageOracleConnection.disabled).toBe(true);
    tool.setCheckingState(false);
    expect(tool.elements.imageOracleConnection.disabled).toBe(false);
  });
});
