// @vitest-environment jsdom
// The Oracle picker is a multi-select combobox: hidden in the web app where the sidecar
// cannot answer; offered on desktop once a connection exists; selects several connections
// at once; keeps the selection across rebuilds and drops connections that disappear;
// persists the selection (including the legacy single-connection value); deep-links to the
// Oracle connections setting; and locks while a check is running.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckImageTool } from "../main.js";
import { isTauri } from "../../../core/Runtime.js";

vi.mock("../../../core/Runtime.js", () => ({ isTauri: vi.fn() }));

const CONNECTIONS_KEY = "config.oracle.connections";
const SETTINGS_FOCUS_KEY = "settings.focus";
const LAST_VALUE_KEY = "image_checker_last_value";

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

/** Mount with the real persistence so saved selections round-trip. */
function mountToolWithPersistence() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const tool = new CheckImageTool();
  tool.recordReferenceHistory = () => {};
  tool.loadReferenceData = () => {};
  tool.mount(host);
  return tool;
}

function optionValues(tool) {
  return [...tool.elements.oracleSelectorMenu.querySelectorAll("input[data-oracle-option]")].map((input) => input.value);
}

function selectedNames(tool) {
  return tool.getSelectedOracleConnections().map((connection) => connection.name);
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
    expect(tool.elements.oracleSelector.hidden).toBe(true);
    expect(tool.elements.configureOracleButton.hidden).toBe(false);
    expect(tool.elements.imageOracleHint.textContent).toContain("Settings");

    saveConnections(["UAT", "PROD"]);
    tool.populateOracleSelector();
    tool.updateOracleControl();
    expect(tool.elements.oracleSelector.hidden).toBe(false);
    expect(tool.elements.configureOracleButton.hidden).toBe(true);
    expect(optionValues(tool)).toEqual(["UAT", "PROD"]);
    expect(tool.elements.oracleSelectorValue.textContent).toBe("No Oracle DB");
    expect(tool.elements.imageOracleHint.textContent).toContain("CONTENT.IMAGE");
  });

  it("selects several connections and summarises them on the trigger", () => {
    saveConnections(["UAT", "PROD", "DR"]);
    const tool = mountTool();
    const menu = tool.elements.oracleSelectorMenu;

    menu.querySelector('input[data-oracle-option="UAT"]').click();
    expect(selectedNames(tool)).toEqual(["UAT"]);
    expect(tool.elements.oracleSelectorValue.textContent).toBe("UAT");

    menu.querySelector('input[data-oracle-option="DR"]').click();
    expect(selectedNames(tool)).toEqual(["UAT", "DR"]);
    expect(tool.elements.oracleSelectorValue.textContent).toBe("2 Oracle DBs");

    menu.querySelector('input[data-oracle-option="UAT"]').click();
    expect(selectedNames(tool)).toEqual(["DR"]);
    expect(tool.elements.oracleSelectorValue.textContent).toBe("DR");
  });

  it("keeps the selection when the picker is rebuilt and drops connections that no longer exist", () => {
    saveConnections(["UAT", "PROD"]);
    const tool = mountTool();
    tool.setOracleSelection(["UAT", "PROD"]);
    expect(selectedNames(tool)).toEqual(["UAT", "PROD"]);

    tool.populateOracleSelector();
    expect(selectedNames(tool)).toEqual(["UAT", "PROD"]);

    saveConnections(["UAT"]);
    tool.populateOracleSelector();
    expect(selectedNames(tool)).toEqual(["UAT"]);
    expect(optionValues(tool)).toEqual(["UAT"]);
  });

  it("ignores selection names that are not saved connections", () => {
    saveConnections(["UAT"]);
    const tool = mountTool();
    tool.setOracleSelection(["UAT", "GHOST"]);
    expect(selectedNames(tool)).toEqual(["UAT"]);
  });

  it("persists the selected connections and restores them, including the legacy single value", () => {
    saveConnections(["UAT", "PROD"]);
    const tool = mountToolWithPersistence();

    tool.setOracleSelection(["UAT", "PROD"]);
    tool.saveValues();
    expect(JSON.parse(localStorage.getItem(LAST_VALUE_KEY)).oracleConnections).toEqual(["UAT", "PROD"]);

    tool.setOracleSelection([]);
    tool.loadSavedValues();
    expect(selectedNames(tool)).toEqual(["UAT", "PROD"]);

    localStorage.setItem(LAST_VALUE_KEY, JSON.stringify({ batchImagePaths: "", oracleConnection: "PROD" }));
    tool.setOracleSelection([]);
    tool.loadSavedValues();
    expect(selectedNames(tool)).toEqual(["PROD"]);
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
    expect(tool.elements.oracleSelector.disabled).toBe(true);
    tool.setCheckingState(false);
    expect(tool.elements.oracleSelector.disabled).toBe(false);
  });
});
