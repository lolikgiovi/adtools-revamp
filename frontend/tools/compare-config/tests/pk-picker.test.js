// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareConfigTool } from "../main.js";
import { CompareConfigTemplate } from "../template.js";

const documentCleanups = [];
afterEach(() => {
  documentCleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
});

describe("Compare Config PK picker", () => {
  it("keeps results clickable through a WebKit focusout and adds multiple fields", () => {
    document.body.innerHTML = CompareConfigTemplate;
    const tool = Object.assign(Object.create(CompareConfigTool.prototype), {
      unified: {
        fields: { common: ["PARAMETER_KEY", "PARAMETER_VALUE", "ENVIRONMENT"] },
        selectedPkFields: [],
        selectedCompareFields: ["PARAMETER_VALUE"],
        _pkAutoAddedFields: [],
        options: { rowMatching: "key" },
      },
      _documentListenerCleanups: documentCleanups,
      saveUnifiedTablePrefsToIndexedDB: vi.fn(),
    });
    tool.bindUnifiedFieldSelectionEvents();
    tool.renderUnifiedFieldSelection();

    const search = document.getElementById("unified-pk-search");
    const dropdown = document.getElementById("unified-pk-field-list");
    search.dispatchEvent(new Event("focus"));
    search.value = "para";
    search.dispatchEvent(new Event("input"));
    const keyOption = [...dropdown.querySelectorAll(".pk-option")].find((option) => option.textContent.includes("PARAMETER_KEY"));
    keyOption.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(dropdown.classList.contains("open")).toBe(true);
    keyOption.click();
    expect(tool.unified.selectedPkFields).toEqual(["PARAMETER_KEY"]);
    expect(dropdown.classList.contains("open")).toBe(true);
    expect(search.value).toBe("");

    search.value = "env";
    search.dispatchEvent(new Event("input"));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(dropdown.querySelector(".pk-option").classList.contains("highlighted")).toBe(true);
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(tool.unified.selectedPkFields).toEqual(["PARAMETER_KEY", "ENVIRONMENT"]);
    const shell = document.querySelector(".pk-input-shell");
    const clear = document.getElementById("btn-unified-deselect-all-pk");
    expect(shell.contains(search)).toBe(true);
    expect(shell.contains(clear)).toBe(true);
    expect(shell.querySelectorAll(".pk-selected-chip")).toHaveLength(2);
    expect(shell.querySelector(".pk-selected-chip").compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tool.saveUnifiedTablePrefsToIndexedDB).toHaveBeenCalledTimes(2);
    expect(search.getAttribute("autocorrect")).toBe("off");
    expect(search.getAttribute("spellcheck")).toBe("false");

    shell.querySelector(".pk-selected-chip").click();
    expect(tool.unified.selectedPkFields).toEqual(["ENVIRONMENT"]);
    clear.click();
    expect(tool.unified.selectedPkFields).toEqual([]);
  });
});
