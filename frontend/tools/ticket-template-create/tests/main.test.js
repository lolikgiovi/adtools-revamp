import { describe, expect, it, vi } from "vitest";
import { TicketTemplateCreateTool } from "../main.js";
import { TICKET_TEMPLATE_CREATE_TEMPLATE } from "../template.js";

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
  tool.lookupDisplayValues = new Map();
  tool.updateDateHint = vi.fn();
  tool.renderCreatePreview = vi.fn();
  tool.renderOverrideNotice = vi.fn();
  return { tool, userInput };
}

describe("Ticket Template lookup controls", () => {
  it("starts with PAT setup and defers project, feature, and ticket work", () => {
    const host = document.createElement("div");
    host.innerHTML = TICKET_TEMPLATE_CREATE_TEMPLATE;
    const root = host.querySelector(".ticket-template-create");

    expect(root.dataset.templateState).toBe("locked");
    expect(host.querySelectorAll("#ttc-discover")).toHaveLength(1);
    expect(host.querySelectorAll("[data-empty-discover]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-post-discovery]")).toHaveLength(2);
    expect(host.querySelector("#ttc-pat-setup").hidden).toBe(false);
    expect(host.querySelector("#ttc-project-setup").hidden).toBe(true);
    expect(host.querySelector("#ttc-feature-setup").hidden).toBe(true);
    expect(host.querySelector("#ttc-workbench-shell").hidden).toBe(true);
    expect(host.querySelector("#ttc-create-workflow").hidden).toBe(true);
    expect(host.querySelector("#ttc-ticket-form").hidden).toBe(false);
    expect(host.querySelector("#ttc-feature-config").textContent).toContain("Feature-level config");
    expect(host.querySelector("[data-feature-config-link]")?.getAttribute("href")).toBe("#ttc-feature-config");
    expect(host.querySelector("#ttc-feature-config").open).toBe(false);
    expect(host.querySelector("#ttc-feature-config").textContent).toContain("Summary, description, Confluence Page");
  });

  it("finds the template root when mounted inside the app tool container", () => {
    const mount = document.createElement("div");
    mount.innerHTML = TICKET_TEMPLATE_CREATE_TEMPLATE;
    const tool = Object.create(TicketTemplateCreateTool.prototype);
    tool.container = mount;

    expect(tool.templateRoot()).toBe(mount.querySelector(".ticket-template-create"));
    tool.templateRoot().dataset.templateState = "ready";
    expect(mount.querySelector(".ticket-template-create").dataset.templateState).toBe("ready");
  });

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

  it("renders selected Jira users as removable name and ID chips", () => {
    const { tool } = createLookupHarness();
    const field = document.createElement("label");
    field.className = "ttc-lookup-field";
    field.dataset.lookupMultiple = "true";
    field.innerHTML = `
      <div data-lookup-control>
        <div data-lookup-chips></div>
        <input data-lookup-input data-lookup-field="reviewers" data-user-lookup type="text" />
        <div data-lookup-menu hidden></div>
      </div>
      <input data-lookup-committed type="hidden" />
      <input data-field="reviewers" data-lookup-value type="hidden" />
    `;
    const input = field.querySelector("[data-lookup-input]");
    const option = document.createElement("button");
    option.type = "button";
    option.dataset.lookupOption = "";
    option.dataset.lookupValue = "2399783232";
    option.innerHTML = "<strong>FASHALLI GIOVI BILHAQ</strong><small>2399783232</small>";
    field.querySelector("[data-lookup-menu]").append(option);
    tool.container.append(field);

    tool.chooseLookupOption(option);

    const chip = field.querySelector("[data-lookup-chip]");
    expect(chip.textContent).toContain("FASHALLI GIOVI BILHAQ");
    expect(chip.textContent).toContain("(2399783232)");
    expect(field.querySelector('[data-field="reviewers"]').value).toBe("2399783232");

    tool.removeLookupValue(input, "2399783232");
    expect(field.querySelector('[data-field="reviewers"]').value).toBe("");
    expect(field.querySelector("[data-lookup-chip]")).toBeNull();
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

  it("shows a first-use tutorial and advances through its steps", () => {
    const { tool } = createLookupHarness();
    tool.tutorialSteps = [
      { target: "connection", kicker: "QUICK GUIDE · 1 OF 2", title: "Connect", copy: "Load Jira metadata." },
      { target: "feature", kicker: "QUICK GUIDE · 2 OF 2", title: "Save a feature", copy: "Reuse feature settings." },
    ];
    tool.tutorialStep = 0;
    tool.container.innerHTML = `
      <section data-tutorial-target="connection"></section>
      <section data-tutorial-target="feature"></section>
      <aside data-tutorial hidden>
        <span data-tutorial-kicker></span>
        <h3 data-tutorial-title></h3>
        <p data-tutorial-copy></p>
        <button data-tutorial-back></button>
        <button data-tutorial-next></button>
      </aside>
      <button data-tutorial-trigger></button>
    `;

    tool.openTutorial(0, true);

    const panel = tool.container.querySelector("[data-tutorial]");
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector("[data-tutorial-title]").textContent).toBe("Connect");
    expect(tool.container.querySelector('[data-tutorial-target="connection"]').classList.contains("ttc-tutorial-target")).toBe(true);

    tool.moveTutorial(1);
    expect(panel.querySelector("[data-tutorial-title]").textContent).toBe("Save a feature");
    expect(panel.querySelector("[data-tutorial-next]").textContent).toBe("Done");

    tool.moveTutorial(1);
    expect(panel.hidden).toBe(true);
  });
});
