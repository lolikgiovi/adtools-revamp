// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";

function setHeight(element, height) {
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
}

describe("Quick Query upper layout", () => {
  it("does not grow from the stretched left scroll viewport during tab hydration", () => {
    const ui = Object.create(QuickQueryUI.prototype);
    const contentA = document.createElement("div");
    contentA.style.minHeight = "460px";
    contentA.style.maxHeight = "600px";
    contentA.getBoundingClientRect = () => ({ height: 460 });

    const leftPanel = document.createElement("div");
    leftPanel.style.paddingBottom = "8px";
    const search = document.createElement("div");
    search.style.marginBottom = "8px";
    setHeight(search, 28);
    const controls = document.createElement("div");
    controls.style.marginBottom = "8px";
    setHeight(controls, 29);
    const leftScroll = document.createElement("div");
    leftScroll.className = "quick-query-left-scroll";
    setHeight(leftScroll, 406);
    const schemaContainer = document.createElement("div");
    setHeight(schemaContainer, 42);
    const filesContainer = document.createElement("div");
    filesContainer.style.marginTop = "295px";
    setHeight(filesContainer, 56);
    leftScroll.append(schemaContainer, filesContainer);
    leftPanel.append(search, controls, leftScroll);

    const rightPanel = document.createElement("div");
    const rightControls = document.createElement("div");
    rightControls.style.marginBottom = "8px";
    setHeight(rightControls, 31);
    const queryEditor = document.createElement("div");
    ui.elements = { contentA, leftPanel, leftScroll, schemaContainer, filesContainer, rightPanel, rightControls, queryEditor };
    ui.schemaTable = { getSettings: () => ({ height: 42 }) };
    ui.getSchemaTableContentMetrics = () => ({ contentHeight: 42 });
    ui.editor = { layout: vi.fn() };
    ui._layoutState = { baseUpperHeight: null, upperHeight: null };

    ui.syncUpperLayoutHeight();
    expect(ui._layoutState.upperHeight).toBe(460);
    setHeight(leftScroll, 415);
    ui.syncUpperLayoutHeight();
    expect(ui._layoutState.upperHeight).toBe(460);
  });
});
