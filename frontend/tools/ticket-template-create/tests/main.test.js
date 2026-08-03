import { describe, expect, it, vi } from "vitest";
import { TicketTemplateCreateTool } from "../main.js";

function createButton() {
  return document.createElement("button");
}

function createLookupHarness() {
  const container = document.createElement("div");
  const userInput = document.createElement("input");
  userInput.dataset.field = "sa-ad-lead";
  userInput.setAttribute("data-user-lookup", "");
  container.append(userInput);

  const tool = Object.create(TicketTemplateCreateTool.prototype);
  tool.container = container;
  tool.elements = {
    discover: createButton(),
    resolveParent: createButton(),
    create: createButton(),
    featureNew: createButton(),
    featureSave: createButton(),
    featureDuplicate: createButton(),
    featureDelete: createButton(),
    globalSave: createButton(),
    openSettings: createButton(),
  };
  tool.scheduleUserLookup = vi.fn();
  tool.scheduleLabelLookup = vi.fn();
  tool.lookupTimers = new Map();
  tool.lookupActiveIndexes = new Map();
  tool.updateDateHint = vi.fn();
  tool.renderCreatePreview = vi.fn();
  tool.renderOverrideNotice = vi.fn();
  return { tool, userInput };
}

describe("Ticket Template Create lookup controls", () => {
  it("schedules Jira user lookup for boolean data-user-lookup attributes", () => {
    const { tool, userInput } = createLookupHarness();
    tool.bindActions();

    userInput.value = "fasha";
    userInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(tool.scheduleUserLookup).toHaveBeenCalledWith(userInput);
    expect(tool.scheduleLabelLookup).not.toHaveBeenCalled();
  });

  it("extracts the active comma-separated sub-lead query", () => {
    const { tool } = createLookupHarness();
    const input = document.createElement("input");
    input.dataset.field = "ios-developer-sub-leads";
    input.setAttribute("data-user-lookup", "");
    input.value = "alice, fasha";

    expect(tool.lookupQuery(input)).toBe("fasha");
  });

  it("commits a selected Jira user without dispatching another lookup", () => {
    const { tool } = createLookupHarness();
    const field = document.createElement("label");
    field.className = "ttc-lookup-field";
    const input = document.createElement("input");
    input.dataset.field = "sa-ad-lead";
    input.setAttribute("data-user-lookup", "");
    const menu = document.createElement("div");
    menu.dataset.lookupMenu = "";
    const option = document.createElement("button");
    option.dataset.lookupOption = "";
    option.dataset.lookupValue = "2399783232";
    field.append(input, menu);
    menu.append(option);
    tool.container.append(field);
    tool.lookupTimers = new Map();

    tool.chooseLookupOption(option);

    expect(input.value).toBe("2399783232");
    expect(menu.hidden).toBe(true);
    expect(tool.updateDateHint).toHaveBeenCalled();
    expect(tool.renderCreatePreview).toHaveBeenCalled();
    expect(tool.renderOverrideNotice).toHaveBeenCalled();
  });

  it("navigates Jira lookup suggestions with arrow keys and commits with Enter", () => {
    const { tool, userInput } = createLookupHarness();
    const field = document.createElement("label");
    field.className = "ttc-lookup-field";
    const menu = document.createElement("div");
    menu.dataset.lookupMenu = "";
    menu.hidden = false;
    menu.innerHTML = `
      <button data-lookup-option data-lookup-value="2399783232" type="button" role="option" aria-selected="false">Fashali</button>
      <button data-lookup-option data-lookup-value="2399783233" type="button" role="option" aria-selected="false">Another user</button>
    `;
    field.append(userInput, menu);
    tool.container.append(field);
    tool.lookupActiveIndexes = new Map();

    const preventDefault = vi.fn();
    tool.handleComboboxKeydown({ target: userInput, key: "ArrowDown", preventDefault });
    expect(menu.querySelectorAll("[data-lookup-option]")[0].classList.contains("is-active")).toBe(true);

    tool.handleComboboxKeydown({ target: userInput, key: "ArrowDown", preventDefault });
    expect(menu.querySelectorAll("[data-lookup-option]")[1].classList.contains("is-active")).toBe(true);

    tool.handleComboboxKeydown({ target: userInput, key: "Enter", preventDefault });
    expect(userInput.value).toBe("2399783233");
    expect(menu.hidden).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
  });

  it("navigates local Jira option menus with arrow keys and commits with Enter", () => {
    const { tool } = createLookupHarness();
    const wrapper = document.createElement("div");
    wrapper.dataset.combobox = "";
    wrapper.dataset.comboboxField = "priority";
    wrapper.dataset.comboboxHeading = "Priority";
    wrapper.innerHTML = `
      <input data-combobox-search type="text" />
      <button data-combobox-trigger type="button">▼</button>
      <div data-combobox-menu><div data-combobox-options></div></div>
      <input data-combobox-value type="hidden" value="" />
    `;
    tool.container.append(wrapper);
    tool.comboboxStates = new Map([
      ["priority", { options: [{ value: "low", label: "Low" }, { value: "high", label: "High" }], filtered: [], activeIndex: -1 }],
    ]);
    tool.filterCombobox(wrapper, "");
    const search = wrapper.querySelector("[data-combobox-search]");
    const menu = wrapper.querySelector("[data-combobox-menu]");
    menu.hidden = false;

    const preventDefault = vi.fn();
    tool.handleComboboxKeydown({ target: search, key: "ArrowDown", preventDefault });
    expect(wrapper.querySelectorAll("[data-combobox-option]")[0].classList.contains("is-active")).toBe(true);

    tool.handleComboboxKeydown({ target: search, key: "ArrowDown", preventDefault });
    tool.handleComboboxKeydown({ target: search, key: "Enter", preventDefault });

    expect(wrapper.querySelector("[data-combobox-value]").value).toBe("high");
    expect(menu.hidden).toBe(true);
  });

  it("closes an open Jira lookup menu with Escape", () => {
    const { tool, userInput } = createLookupHarness();
    const field = document.createElement("label");
    field.className = "ttc-lookup-field";
    const menu = document.createElement("div");
    menu.dataset.lookupMenu = "";
    menu.hidden = false;
    menu.innerHTML = '<button data-lookup-option data-lookup-value="alice" type="button">Alice</button>';
    field.append(userInput, menu);
    tool.container.append(field);
    tool.lookupActiveIndexes = new Map();

    const preventDefault = vi.fn();
    tool.handleComboboxKeydown({ target: userInput, key: "Escape", preventDefault });

    expect(menu.hidden).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
