import { BaseTool } from "../../core/BaseTool.js";
import {
  JiraDiscoveryService,
  BE_COMPONENTS,
  addDaysIso,
  buildSummary,
  createDefaultGlobalDefaults,
  formatFieldValue,
  labelsForStream,
  normalizeLabels,
  splitValues,
  todayIso,
  GLOBAL_DEFAULTS_KEY,
} from "./service.js";
import { lookupInput, TICKET_TEMPLATE_CREATE_TEMPLATE } from "./template.js";
import { TicketTemplateStorage } from "./template-storage.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";

const PEOPLE_FIELDS = [
  ["developer", "Developer Jira user *"],
  ["developer-lead", "Developer Lead Jira user *"],
  ["developer-sub-leads", "Developer Sub-Lead Jira user(s) *"],
];

const SHARED_DEFAULT_FIELDS = [
  ["priority", "global-priority", "priorityId"],
  ["ad-story-point", "global-ad-story-point", "adStoryPointId"],
  ["dev-story-point", "global-dev-story-point", "devStoryPointId"],
  ["release", "global-release", "releaseId"],
  ["squad", "global-squad", "squadId"],
  ["task-trigger", "global-task-trigger", "taskTriggerId"],
];

const PEOPLE_STREAMS = ["ios", "android", "web", "be"];
const TUTORIAL_STORAGE_KEY = "ticket-template:tutorial-seen";
const PROJECTS_STORAGE_KEY = "ticket-template:projects";
const NEW_PROJECT_VALUE = "__new_project__";
const NEW_FEATURE_VALUE = "__new_feature__";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function globalDefaultsFromStorage(value) {
  const defaults = createDefaultGlobalDefaults();
  if (!value || typeof value !== "object") return defaults;
  const merged = {
    ...defaults,
    ...value,
    labels: { ...defaults.labels, ...value.labels, be: { ...defaults.labels.be, ...value.labels?.be } },
    people: {
      ...defaults.people,
      ...value.people,
      common: { ...defaults.people.common, ...value.people?.common },
      streams: { ...defaults.people.streams },
    },
    shared: { ...defaults.shared, ...value.shared },
    dateRule: { ...defaults.dateRule, ...value.dateRule },
  };
  PEOPLE_STREAMS.forEach((stream) => {
    merged.people.streams[stream] = { ...defaults.people.streams[stream], ...(value.people?.streams?.[stream] || {}) };
  });
  return merged;
}

export class TicketTemplateCreateTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "ticket-template-create",
      name: "Ticket Template",
      description: "Create consistent Jira FE and BE subtasks from reusable templates",
      icon: "ticket-template",
      category: "jira",
      eventBus,
    });
    this.service = new JiraDiscoveryService();
    this.templateStorage = new TicketTemplateStorage();
    this.elements = {};
    this.discovery = null;
    this.parentResolution = null;
    this.projects = [];
    this.selectedProject = null;
    this.features = [];
    this.allFeatures = [];
    this.currentFeature = null;
    this.patConfigured = false;
    this.ticketType = "ad-task";
    this.globalDefaults = createDefaultGlobalDefaults();
    this.lookupTimers = new Map();
    this.lookupActiveIndexes = new Map();
    this.lookupDisplayValues = new Map();
    this.comboboxStates = new Map();
    this.tutorialStep = 0;
    this.tutorialSteps = [
      {
        target: "pat",
        kicker: "QUICK GUIDE · 1 OF 5",
        title: "Set up your Jira PAT",
        copy: "Save the PAT once in Settings. Ticket Template uses it to read metadata and create tickets.",
      },
      {
        target: "project",
        kicker: "QUICK GUIDE · 2 OF 5",
        title: "Load the project metadata",
        copy: "Enter the Jira project key, then load its live fields. This is a read-only Jira request.",
      },
      {
        target: "global",
        kicker: "QUICK GUIDE · 3 OF 5",
        title: "Set defaults for every ticket",
        copy: "Global config prefills every new ticket. Feature-level config can override it when needed.",
      },
      {
        target: "parent",
        kicker: "QUICK GUIDE · 4 OF 5",
        title: "Resolve the parent",
        copy: "Enter an Epic, Story, Improvement, or Bug. Epic children are merged into one searchable parent list.",
      },
      {
        target: "ticket",
        kicker: "QUICK GUIDE · 5 OF 5",
        title: "Configure this feature",
        copy: "Set feature-level people, labels, Jira fields, and dates. Then choose a parent and review the bundle before writing.",
      },
    ];
    this.oracleStatusElement = null;
    this.oracleStatusPreviousDisplay = "";
    this.busy = false;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return TICKET_TEMPLATE_CREATE_TEMPLATE;
  }

  onMount() {
    this.hideOracleShellStatus();
    this.bindElements();
    this.renderPeopleFields();
    this.initializeComboboxes();
    this.loadConnection();
    this.bindActions();
    this.initializeDates();
    void this.initializeEntryFlow();
    void this.initializeFeatureStorage();
  }

  onActivate() {
    this.hideOracleShellStatus();
  }

  onDeactivate() {
    this.restoreOracleShellStatus();
  }

  onUnmount() {
    this.restoreOracleShellStatus();
  }

  hideOracleShellStatus() {
    const indicator = document.getElementById("sidecar-status-indicator");
    if (!indicator || this.oracleStatusElement === indicator) return;
    this.oracleStatusElement = indicator;
    this.oracleStatusPreviousDisplay = indicator.style.display;
    indicator.style.display = "none";
  }

  restoreOracleShellStatus() {
    if (!this.oracleStatusElement) return;
    this.oracleStatusElement.style.display = this.oracleStatusPreviousDisplay;
    this.oracleStatusElement = null;
    this.oracleStatusPreviousDisplay = "";
  }

  bindElements() {
    const query = (selector) => this.container.querySelector(selector);
    this.elements = {
      baseUrl: query("#ttc-base-url"),
      projectKey: query('[data-field="project-key"]'),
      allowInvalidTls: query("#ttc-allow-invalid-tls"),
      patStatus: query("#ttc-pat-status"),
      jiraSyncStatus: query("#ttc-jira-sync-status"),
      jiraSyncDetail: query("#ttc-jira-sync-detail"),
      patSetup: query("#ttc-pat-setup"),
      projectStatus: query("#ttc-project-status"),
      featureStatus: query("#ttc-feature-status"),
      workbench: query("#ttc-workbench-shell"),
      discover: query("#ttc-project-reload"),
      projectReload: query("#ttc-project-reload"),
      projectDialog: query("#ttc-project-dialog"),
      projectForm: query("#ttc-project-form"),
      projectKeyEntry: query("#ttc-project-key-entry"),
      projectSave: query("#ttc-project-save"),
      workspaceEmpty: query("#ttc-workspace-empty"),
      workspaceEmptyTitle: query("#ttc-workspace-empty-title"),
      workspaceEmptyCopy: query("#ttc-workspace-empty-copy"),
      openSettings: query("#ttc-open-settings"),
      error: query("#ttc-error"),
      workflow: query("#ttc-create-workflow"),
      parentInput: query("#ttc-parent-input"),
      resolveParent: query("#ttc-resolve-parent"),
      parentResult: query("#ttc-parent-result"),
      parentSource: query("#ttc-parent-source"),
      parentSelect: query("#ttc-parent-select"),
      ticketForm: query("#ttc-ticket-form"),
      preview: query("#ttc-create-preview"),
      create: query("#ttc-create"),
      createStatus: query("#ttc-create-status"),
      dateHint: query("#ttc-date-hint"),
      contractDetails: query("#ttc-contract-details"),
      globalStatus: query("#ttc-global-status"),
      globalPanel: query("#ttc-global-panel"),
      configStack: query("#ttc-config-stack"),
      configClose: query("[data-config-close]"),
      globalConfigOpen: query("#ttc-global-config-open"),
      featureConfigOpen: query("#ttc-feature-config-open"),
      globalSave: query("#ttc-global-save"),
      featureConfig: query("#ttc-feature-config"),
      featureConfigStatus: query("#ttc-feature-config-status"),
      featureConfigSave: query("#ttc-feature-config-save"),
      featureSelect: query("#ttc-feature-select"),
      featureEdit: query("#ttc-feature-edit"),
      featureDialog: query("#ttc-feature-dialog"),
      featureForm: query("#ttc-feature-form"),
      featureName: query("#ttc-feature-name"),
      featureEpic: query("#ttc-feature-epic"),
      featureParentSources: query("#ttc-feature-parent-sources"),
      featureBugSources: query("#ttc-feature-bug-sources"),
      featureSave: query("#ttc-feature-save"),
      featureDuplicate: query("#ttc-feature-duplicate"),
      featureDelete: query("#ttc-feature-delete"),
      ticketType: query("#ttc-ticket-type"),
      results: query("#ttc-results"),
      resultTime: query("#ttc-result-time"),
      summary: query("#ttc-summary"),
      issueTypes: query("#ttc-issue-types"),
      overrideNotice: query("#ttc-override-notice"),
      prefillSource: query("#ttc-prefill-source"),
      featureContextName: query("[data-feature-context-name]"),
      featureContextKey: query("#ttc-feature-context-key"),
      featureContextPrefill: query("#ttc-feature-context-prefill"),
      projectPatState: query("#ttc-project-pat-state"),
    };
  }

  renderPeopleFields() {
    this.container.querySelectorAll("[data-people-stream]").forEach((container) => {
      const stream = container.dataset.peopleStream;
      const scope = container.dataset.peopleScope || "feature";
      const fields =
        stream === "common"
          ? [
              ["sa-ad-lead", "AD / SA Lead Jira user *"],
              ["sa-ad-sub-leads", "AD / SA Sub-Lead Jira user(s) *"],
            ]
          : PEOPLE_FIELDS;
      const prefix = scope === "global" ? "global-" : "";
      container.innerHTML = fields
        .map(([field, label]) => {
          const fieldName = stream === "common" ? `${prefix}${field}` : `${prefix}${stream}-${field}`;
          return lookupInput({
            field: fieldName,
            label,
            lookup: "user",
            multiple: field.endsWith("sub-leads"),
            placeholder: field.endsWith("sub-leads") ? "Add people…" : "Find a Jira user…",
          });
        })
        .join("");
    });
  }

  initializeComboboxes() {
    this.container.querySelectorAll("[data-combobox]").forEach((wrapper) => {
      const field = wrapper.dataset.comboboxField;
      this.comboboxStates.set(field, { options: [], filtered: [], activeIndex: -1, placeholder: "Choose an option", disabled: false });
    });
    this.setComboboxOptions(
      "project-key",
      [
        { value: "", label: "Choose a project" },
        { value: NEW_PROJECT_VALUE, label: "+ Create new project" },
      ],
      { selectedValue: "", placeholder: "Choose a project" },
    );
    this.setComboboxOptions(
      "feature-select",
      [
        { value: "", label: "Choose a feature" },
        { value: NEW_FEATURE_VALUE, label: "+ Create new feature" },
      ],
      { selectedValue: "", placeholder: "Choose a feature" },
    );
    this.setComboboxOptions(
      "ticket-type",
      [
        { value: "ad-task", label: "AD task" },
        { value: "bug-fixing", label: "Bug fixing task" },
      ],
      { selectedValue: "ad-task", placeholder: "AD task" },
    );
    this.setComboboxOptions("parent-select", [], { placeholder: "Find eligible parents first", disabled: true });
    this.setComboboxOptions(
      "be-component",
      Object.keys(BE_COMPONENTS).map((component) => ({ value: component, label: component })),
      { selectedValue: "API", placeholder: "API" },
    );
    [
      "ad-story-point",
      "dev-story-point",
      "priority",
      "release",
      "squad",
      "task-trigger",
      "global-ad-story-point",
      "global-dev-story-point",
      "global-priority",
      "global-release",
      "global-squad",
      "global-task-trigger",
    ].forEach((field) => {
      this.setComboboxOptions(field, [], { placeholder: "Load Jira metadata first", disabled: true });
    });
  }

  combobox(field) {
    return this.container.querySelector(`[data-combobox-field="${field}"]`);
  }

  setComboboxOptions(field, options = [], { selectedValue, placeholder = "Choose an option", disabled = false, emptyMessage } = {}) {
    const wrapper = this.combobox(field);
    if (!wrapper) return;
    const state = this.comboboxStates.get(field) || { activeIndex: -1 };
    const valueElement = wrapper.querySelector("[data-combobox-value]");
    const currentValue = selectedValue !== undefined ? String(selectedValue ?? "") : valueElement?.value || "";
    state.options = options.map((option) => ({ value: String(option.value ?? ""), label: String(option.label ?? option.value ?? "") }));
    state.placeholder = placeholder;
    state.disabled = disabled;
    state.fallbackLabel = disabled && currentValue ? "Saved Jira value · load metadata to verify" : "";
    state.emptyMessage = emptyMessage || (disabled ? "Load Jira metadata to enable options." : "No matching options");
    this.comboboxStates.set(field, state);
    if (valueElement) valueElement.value = currentValue;
    const selected = state.options.find((option) => option.value === currentValue);
    wrapper.querySelector("[data-combobox-search]").value = selected?.label || (currentValue ? state.fallbackLabel || currentValue : "");
    const trigger = wrapper.querySelector("[data-combobox-trigger]");
    trigger.disabled = disabled;
    trigger.setAttribute("aria-disabled", String(disabled));
    const search = wrapper.querySelector("[data-combobox-search]");
    search.disabled = disabled;
    search.setAttribute("aria-disabled", String(disabled));
    wrapper.classList.toggle("is-disabled", disabled);
    this.filterCombobox(wrapper, "");
  }

  syncComboboxValue(field) {
    const wrapper = this.combobox(field);
    const state = this.comboboxStates.get(field);
    const valueElement = wrapper?.querySelector("[data-combobox-value]");
    if (!wrapper || !state || !valueElement) return;
    const selected = state.options.find((option) => option.value === valueElement.value);
    const fallback =
      state.fallbackLabel || (state.disabled && valueElement.value ? "Saved Jira value · load metadata to verify" : valueElement.value);
    wrapper.querySelector("[data-combobox-search]").value = selected?.label || (valueElement.value ? fallback : "");
  }

  filterCombobox(wrapper, query = "") {
    if (!wrapper) return;
    const field = wrapper.dataset.comboboxField;
    const state = this.comboboxStates.get(field);
    if (!state) return;
    const normalizedQuery = String(query || "")
      .trim()
      .toLocaleLowerCase();
    state.filtered = state.options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery));
    state.activeIndex = -1;
    const options = wrapper.querySelector("[data-combobox-options]");
    const heading = `<div class="ttc-combobox-options-header" aria-hidden="true">${this.escapeHtml(wrapper.dataset.comboboxHeading || "Options")}</div>`;
    options.innerHTML =
      heading +
      (state.filtered.length
        ? state.filtered
            .map(
              (option, index) =>
                `<button class="ttc-combobox-option${index === state.activeIndex ? " is-active" : ""}" data-combobox-option data-value="${this.escapeHtml(option.value)}" type="button" role="option" aria-selected="${String(option.value === wrapper.querySelector("[data-combobox-value]").value)}"><span>${this.escapeHtml(option.label)}</span></button>`,
            )
            .join("")
        : `<div class="ttc-combobox-empty">${this.escapeHtml(state.emptyMessage)}</div>`);
  }

  openCombobox(wrapper, { clearQuery = false } = {}) {
    if (!wrapper || wrapper.classList.contains("is-disabled")) return;
    const menu = wrapper.querySelector("[data-combobox-menu]");
    this.closeComboboxes(wrapper);
    menu.hidden = false;
    const search = wrapper.querySelector("[data-combobox-search]");
    const valueElement = wrapper.querySelector("[data-combobox-value]");
    const state = this.comboboxStates.get(wrapper.dataset.comboboxField);
    const selected = state?.options.find((option) => option.value === valueElement.value);
    const showingSelection = selected?.label === search.value;
    if (clearQuery || showingSelection) search.value = "";
    this.filterCombobox(wrapper, search.value);
    search.setAttribute("aria-expanded", "true");
    wrapper.querySelector("[data-combobox-trigger]").setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => search.focus());
  }

  toggleCombobox(wrapper) {
    if (!wrapper || wrapper.classList.contains("is-disabled")) return;
    const menu = wrapper.querySelector("[data-combobox-menu]");
    if (!menu.hidden) {
      this.closeCombobox(wrapper);
      return;
    }
    this.openCombobox(wrapper, { clearQuery: true });
  }

  closeCombobox(wrapper) {
    if (!wrapper) return;
    const menu = wrapper.querySelector("[data-combobox-menu]");
    menu.hidden = true;
    const search = wrapper.querySelector("[data-combobox-search]");
    if (search) this.syncComboboxValue(wrapper.dataset.comboboxField);
    if (search) search.setAttribute("aria-expanded", "false");
    wrapper.querySelector("[data-combobox-trigger]").setAttribute("aria-expanded", "false");
  }

  closeComboboxes(except = null) {
    this.container.querySelectorAll("[data-combobox]").forEach((wrapper) => {
      if (wrapper !== except) this.closeCombobox(wrapper);
    });
  }

  chooseComboboxOption(option) {
    const wrapper = option.closest("[data-combobox]");
    const field = wrapper?.dataset.comboboxField;
    if (!wrapper || !field) return;
    const valueElement = wrapper.querySelector("[data-combobox-value]");
    valueElement.value = option.dataset.value || "";
    wrapper.querySelector("[data-combobox-search]").value = option.textContent.trim() || "";
    this.closeCombobox(wrapper);
    if (field === "project-key") {
      if (valueElement.value === NEW_PROJECT_VALUE) {
        valueElement.value = "";
        this.syncComboboxValue("project-key");
        this.openProjectDialog();
        return;
      }
      void this.selectProject(valueElement.value);
      return;
    }
    if (field === "feature-select") {
      if (valueElement.value === NEW_FEATURE_VALUE) {
        valueElement.value = "";
        this.syncComboboxValue("feature-select");
        this.newFeature();
        return;
      }
      void this.selectFeature(valueElement.value);
      return;
    }
    if (field === "ticket-type") {
      this.setTicketType(valueElement.value);
      return;
    }
    if (field === "be-component") {
      const prefix = this.container.querySelector("[data-be-prefix]");
      if (prefix) prefix.textContent = `[${valueElement.value || "API"}]`;
    }
    this.updateDateHint();
    this.renderCreatePreview();
    this.renderOverrideNotice();
  }

  handleComboboxKeydown(event) {
    const tutorial = this.container.querySelector("[data-tutorial]");
    if (event.key === "Escape" && tutorial && !tutorial.hidden) {
      event.preventDefault();
      this.closeTutorial();
      return;
    }
    const lookupInput = event.target.closest?.("[data-user-lookup], [data-label-lookup]");
    if (lookupInput) {
      const menu = this.lookupMenu(lookupInput);
      const options = this.lookupOptions(lookupInput);
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeLookupMenus();
        lookupInput.focus();
        return;
      }
      if (!menu || menu.hidden || !options.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = this.lookupActiveIndexes?.get(lookupInput) ?? -1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.min(Math.max(currentIndex + delta, -1), options.length - 1);
        this.setLookupActiveOption(lookupInput, nextIndex);
        return;
      }
      if (event.key === "Enter") {
        const activeIndex = this.lookupActiveIndexes?.get(lookupInput) ?? -1;
        const selected = activeIndex >= 0 ? options[activeIndex] : null;
        if (selected) {
          event.preventDefault();
          this.chooseLookupOption(selected);
        }
      }
      return;
    }

    const trigger = event.target.closest("[data-combobox-trigger]");
    if (trigger && ["Enter", " ", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      this.toggleCombobox(trigger.closest("[data-combobox]"));
      return;
    }
    const search = event.target.closest("[data-combobox-search]");
    if (!search) return;
    const wrapper = search.closest("[data-combobox]");
    const state = this.comboboxStates.get(wrapper.dataset.comboboxField);
    if (!state) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const wasHidden = wrapper.querySelector("[data-combobox-menu]").hidden;
      if (wasHidden) {
        this.openCombobox(wrapper);
        state.activeIndex = event.key === "ArrowDown" && state.filtered.length ? 0 : -1;
        this.setComboboxActiveOption(wrapper, state.activeIndex);
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = state.filtered.length ? Math.min(Math.max(state.activeIndex + delta, -1), state.filtered.length - 1) : -1;
      state.activeIndex = nextIndex;
      this.setComboboxActiveOption(wrapper, state.activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeCombobox(wrapper);
      search.focus();
      return;
    }
    if (event.key === "Enter" && state.activeIndex >= 0 && state.filtered[state.activeIndex]) {
      event.preventDefault();
      const selected = wrapper.querySelectorAll("[data-combobox-option]")[state.activeIndex];
      if (selected) this.chooseComboboxOption(selected);
    }
  }

  setComboboxActiveOption(wrapper, activeIndex) {
    wrapper?.querySelectorAll("[data-combobox-option]").forEach((candidate, index) => {
      const isActive = index === activeIndex;
      candidate.classList.toggle("is-active", isActive);
      if (isActive) candidate.scrollIntoView?.({ block: "nearest" });
    });
  }

  loadConnection() {
    const connection = this.service.loadConnection();
    if (this.elements.baseUrl) this.elements.baseUrl.value = connection.baseUrl;
    if (this.elements.projectKey) this.elements.projectKey.value = "";
    if (this.elements.allowInvalidTls) this.elements.allowInvalidTls.checked = connection.allowInvalidTls;
    this.legacyConnection = connection;
  }

  bindActions() {
    this.elements.discover?.addEventListener("click", () => void this.runDiscovery());
    this.elements.resolveParent?.addEventListener("click", () => void this.resolveParent());
    this.elements.create?.addEventListener("click", () => void this.createTickets());
    this.elements.featureEdit?.addEventListener("click", () => this.openFeatureDialog());
    this.elements.projectForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveProjectFromDialog();
    });
    this.elements.featureForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveFeature();
    });
    this.elements.globalConfigOpen?.addEventListener("click", () => this.openConfigPanel("global"));
    this.elements.featureConfigOpen?.addEventListener("click", () => this.openConfigPanel("feature"));
    this.elements.featureConfigSave?.addEventListener("click", () => void this.saveFeatureConfig());
    this.elements.featureDuplicate?.addEventListener("click", () => void this.duplicateFeature());
    this.elements.featureDelete?.addEventListener("click", () => void this.deleteFeature());
    this.elements.globalSave?.addEventListener("click", () => void this.saveGlobalDefaults());
    this.container.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.addEventListener("click", () => this.closeDialog(button.closest("dialog")));
    });
    this.container.querySelectorAll("[data-config-close]").forEach((button) => {
      button.addEventListener("click", () => this.closeConfigPanel());
    });
    this.container.querySelector("[data-tutorial-trigger]")?.addEventListener("click", () => this.openTutorial());
    this.container.querySelector("[data-tutorial-close]")?.addEventListener("click", () => this.closeTutorial());
    this.container.querySelector("[data-tutorial-back]")?.addEventListener("click", () => this.moveTutorial(-1));
    this.container.querySelector("[data-tutorial-next]")?.addEventListener("click", () => this.moveTutorial(1));
    this.elements.openSettings?.addEventListener("click", () => {
      if (window.app?.router?.navigate) window.app.router.navigate("settings");
      else window.location.hash = "#settings";
    });
    this.container.querySelectorAll("[data-feature-config-link]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        this.openConfigPanel("feature");
      });
    });
    this.container.addEventListener("click", (event) => {
      if (!event.target.closest("[data-tutorial], [data-tutorial-trigger]")) this.closeTutorial();
      const featureChoice = event.target.closest("[data-feature-choice]");
      if (featureChoice) {
        void this.selectFeature(featureChoice.dataset.featureChoice);
        return;
      }
      const remove = event.target.closest("[data-lookup-remove]");
      if (remove) {
        const input = remove.closest(".ttc-lookup-field")?.querySelector("[data-lookup-input]");
        if (input) {
          this.removeLookupValue(input, remove.dataset.lookupValue || "");
          this.updateDateHint();
          this.renderCreatePreview();
          this.renderOverrideNotice();
          input.focus();
        }
        return;
      }
      const option = event.target.closest("[data-combobox-option], [data-lookup-option]");
      if (option) {
        if (option.matches("[data-combobox-option]")) this.chooseComboboxOption(option);
        else this.chooseLookupOption(option);
        return;
      }
      const searchInput = event.target.closest("[data-combobox-search]");
      if (searchInput) {
        this.openCombobox(searchInput.closest("[data-combobox]"));
        return;
      }
      const trigger = event.target.closest("[data-combobox-trigger]");
      if (trigger) {
        this.toggleCombobox(trigger.closest("[data-combobox]"));
        return;
      }
      if (!event.target.closest("[data-combobox], [data-lookup-control], [data-lookup-menu], [data-user-lookup], [data-label-lookup]")) {
        this.closeComboboxes();
        this.closeLookupMenus();
      }
    });
    this.container.addEventListener("keydown", (event) => this.handleComboboxKeydown(event));
    this.container.addEventListener("change", (event) => {
      const stream = event.target?.dataset?.streamToggle;
      if (stream) this.toggleStream(stream, event.target.checked);
      this.updateDateHint();
      this.renderCreatePreview();
      this.renderOverrideNotice();
    });
    this.container.addEventListener("input", (event) => {
      if (event.target?.dataset?.comboboxSearch !== undefined) {
        const wrapper = event.target.closest("[data-combobox]");
        this.openCombobox(wrapper);
        this.filterCombobox(wrapper, event.target.value);
        return;
      }
      if (event.target?.dataset?.lookupInput !== undefined) {
        this.syncLookupField(event.target);
        if (["start-offset-days", "deadline-offset-days"].includes(event.target?.dataset?.field)) this.applyDateRule();
        this.updateDateHint();
        this.renderCreatePreview();
        this.renderOverrideNotice();
        if (event.target.hasAttribute("data-user-lookup")) this.scheduleUserLookup(event.target);
        if (event.target.hasAttribute("data-label-lookup")) this.scheduleLabelLookup(event.target);
        return;
      }
      if (event.target?.dataset?.field === "parent-sources") this.resetParentResolution();
      if (["start-offset-days", "deadline-offset-days"].includes(event.target?.dataset?.field)) this.applyDateRule();
      this.updateDateHint();
      this.renderCreatePreview();
      this.renderOverrideNotice();
      if (event.target?.hasAttribute?.("data-user-lookup")) this.scheduleUserLookup(event.target);
      if (event.target?.hasAttribute?.("data-label-lookup")) this.scheduleLabelLookup(event.target);
    });
  }

  initializeTutorial() {
    try {
      if (localStorage.getItem(TUTORIAL_STORAGE_KEY) === "true") return;
    } catch (_) {
      // Private browsing or a restricted webview may deny local storage; help remains available manually.
    }
    this.openTutorial(0, true);
  }

  async initializeEntryFlow() {
    this.patConfigured = await this.refreshPatStatus();
    this.loadProjects();
    this.renderProjectOptions();
    const lastProject = this.projects[0] || null;
    if (lastProject && this.patConfigured) {
      await this.selectProject(lastProject.key, { discover: false, project: lastProject });
    } else {
      this.updateWorkspaceVisibility();
    }
  }

  setTemplateStage(stage) {
    this.updateWorkspaceVisibility(stage);
  }

  updateWorkspaceVisibility() {
    const root = this.templateRoot();
    if (!root) return;
    const hasProject = Boolean(this.elements.projectKey?.value?.trim());
    const hasFeature = Boolean(this.currentFeature);
    const ready = this.patConfigured && hasProject && hasFeature && Boolean(this.discovery);
    root.dataset.templateStage = !this.patConfigured ? "pat" : ready ? "ready" : hasProject ? "project" : "select";
    root.dataset.templateState = ready ? "ready" : "locked";
    if (this.elements.patSetup) this.elements.patSetup.hidden = this.patConfigured;
    if (this.elements.workbench) this.elements.workbench.hidden = !ready;
    if (this.elements.workflow) this.elements.workflow.hidden = !ready;
    if (this.elements.workspaceEmpty) this.elements.workspaceEmpty.hidden = !this.patConfigured || ready;
    if (this.elements.featureEdit) this.elements.featureEdit.disabled = !hasFeature;
    if (this.elements.featureConfigOpen) this.elements.featureConfigOpen.disabled = !hasFeature;
    if (this.elements.projectStatus) {
      this.elements.projectStatus.dataset.state = !this.patConfigured
        ? "missing"
        : hasProject
          ? this.discovery
            ? "ready"
            : "idle"
          : "idle";
      this.elements.projectStatus.textContent = !this.patConfigured
        ? "PAT required"
        : hasProject
          ? this.discovery
            ? "Metadata ready"
            : "Reload Jira metadata"
          : "Choose a project";
    }
    if (this.elements.featureStatus && hasProject) {
      this.elements.featureStatus.dataset.state = hasFeature ? "ready" : this.features.length ? "idle" : "missing";
      this.elements.featureStatus.textContent = hasFeature
        ? "Selected"
        : this.features.length
          ? `${this.features.length} saved`
          : "No saved features";
    }
    if (this.elements.workspaceEmptyTitle && this.elements.workspaceEmptyCopy) {
      if (!hasProject) {
        this.elements.workspaceEmptyTitle.textContent = "Choose a project to load Jira metadata";
        this.elements.workspaceEmptyCopy.textContent =
          "Use the Project dropdown above to add a project or select a saved one. Then use ↻ to refresh its Jira fields.";
      } else if (!this.discovery) {
        this.elements.workspaceEmptyTitle.textContent = "Load Jira metadata for this project";
        this.elements.workspaceEmptyCopy.textContent =
          "Use ↻ to validate the project key and load the Jira fields used by the ticket form.";
      } else if (!hasFeature) {
        this.elements.workspaceEmptyTitle.textContent = this.features.length ? "Choose a feature to begin" : "Create your first feature";
        this.elements.workspaceEmptyCopy.textContent = this.features.length
          ? "Select a saved feature from the header, or create a new one to capture its Epic, Stories, Improvements, and known bugs."
          : "Open the Feature dropdown and choose Create new feature. The feature details will be saved locally for the next ticket run.";
      }
    }
  }

  showFeatureLibrary() {
    if (!this.discovery) return;
    this.renderFeatureOptions(this.currentFeature?.id || "");
  }

  openConfigPanel(scope = "feature") {
    if (!this.elements.configStack) return;
    if (this.elements.workbench?.hidden) this.elements.workbench.hidden = false;
    this.elements.configStack.hidden = false;
    this.elements.configStack.dataset.open = "true";
    const panel = scope === "global" ? this.elements.globalPanel : this.elements.featureConfig;
    const other = scope === "global" ? this.elements.featureConfig : this.elements.globalPanel;
    other?.removeAttribute("open");
    if (panel) panel.open = true;
    panel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  closeConfigPanel() {
    if (!this.elements.configStack) return;
    this.elements.configStack.hidden = true;
    delete this.elements.configStack.dataset.open;
    this.elements.globalPanel?.removeAttribute("open");
    this.elements.featureConfig?.removeAttribute("open");
    this.updateWorkspaceVisibility();
  }

  openDialog(dialog) {
    if (!dialog) return;
    const main = this.container?.closest(".main");
    const mainBounds = main?.getBoundingClientRect?.();
    if (mainBounds?.width && mainBounds?.height) {
      dialog.style.setProperty("--ttc-dialog-center-x", `${mainBounds.left + mainBounds.width / 2}px`);
      dialog.style.setProperty("--ttc-dialog-center-y", `${mainBounds.top + mainBounds.height / 2}px`);
      dialog.style.setProperty("--ttc-dialog-max-height", `${Math.max(280, mainBounds.height - 32)}px`);
    }
    try {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } catch (_) {
      dialog.setAttribute("open", "");
    }
    dialog.hidden = false;
  }

  closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    dialog.removeAttribute("open");
    dialog.hidden = true;
  }

  openTutorial(step = 0, firstUse = false) {
    const panel = this.container.querySelector("[data-tutorial]");
    if (!panel) return;
    this.tutorialStep = Math.min(Math.max(Number(step) || 0, 0), this.tutorialSteps.length - 1);
    if (firstUse) {
      try {
        localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
      } catch (_) {
        // The tutorial still works for this session when persistence is unavailable.
      }
    }
    panel.hidden = false;
    this.renderTutorialStep();
  }

  closeTutorial() {
    const panel = this.container.querySelector("[data-tutorial]");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    this.container.querySelectorAll(".ttc-tutorial-target").forEach((target) => target.classList.remove("ttc-tutorial-target"));
    if (panel.contains(document.activeElement)) this.container.querySelector("[data-tutorial-trigger]")?.focus();
  }

  moveTutorial(delta) {
    const nextStep = this.tutorialStep + delta;
    if (nextStep < 0) return;
    if (nextStep >= this.tutorialSteps.length) {
      this.closeTutorial();
      return;
    }
    this.openTutorial(nextStep);
  }

  renderTutorialStep() {
    const panel = this.container.querySelector("[data-tutorial]");
    const step = this.tutorialSteps[this.tutorialStep];
    if (!panel || !step) return;
    panel.querySelector("[data-tutorial-kicker]").textContent = step.kicker;
    panel.querySelector("[data-tutorial-title]").textContent = step.title;
    panel.querySelector("[data-tutorial-copy]").textContent = step.copy;
    const back = panel.querySelector("[data-tutorial-back]");
    const next = panel.querySelector("[data-tutorial-next]");
    back.disabled = this.tutorialStep === 0;
    next.textContent = this.tutorialStep === this.tutorialSteps.length - 1 ? "Done" : "Next";
    this.container.querySelectorAll(".ttc-tutorial-target").forEach((target) => target.classList.remove("ttc-tutorial-target"));
    const target = this.container.querySelector(`[data-tutorial-target="${step.target}"]`);
    const targetDeferred = target?.hasAttribute("data-post-discovery") && this.templateRoot()?.dataset.templateState !== "ready";
    if (target && !targetDeferred && !target.closest("[hidden]")) {
      target.classList.add("ttc-tutorial-target");
      target.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
  }

  initializeDates() {
    this.applyDateRule();
    this.updateDateHint();
  }

  applyDateRule() {
    const startOffset = Number(this.field("start-offset-days")?.value || 0);
    const deadlineOffset = Number(this.field("deadline-offset-days")?.value || 3);
    const start = addDaysIso(todayIso(), Number.isFinite(startOffset) ? startOffset : 0);
    this.field("start-date").value = start;
    this.field("deadline").value = addDaysIso(start, Number.isFinite(deadlineOffset) ? deadlineOffset : 3);
  }

  field(name) {
    return this.container.querySelector(`[data-field="${name}"]`);
  }

  templateRoot() {
    if (this.container?.matches?.(".ticket-template-create")) return this.container;
    return this.container?.querySelector?.(".ticket-template-create") || null;
  }

  lookupInputForField(fieldName) {
    return this.field(fieldName)?.closest(".ttc-lookup-field")?.querySelector("[data-lookup-input]") || null;
  }

  setLookupValue(fieldName, value) {
    const hidden = this.field(fieldName);
    const input = this.lookupInputForField(fieldName);
    if (!hidden?.hasAttribute("data-lookup-value") || !input) return;
    const values = splitValues(Array.isArray(value) ? value.join(", ") : value);
    const field = input.closest(".ttc-lookup-field");
    const committed = field?.querySelector("[data-lookup-committed]");
    if (committed) committed.value = values.join(", ");
    hidden.value = values.join(", ");
    input.value = "";
    this.renderLookupChips(input);
  }

  syncLookupField(input) {
    const field = input.closest(".ttc-lookup-field");
    const hidden = field?.querySelector("[data-lookup-value][data-field]");
    const committed = field?.querySelector("[data-lookup-committed]");
    if (!field || !hidden || !committed) return;
    hidden.value = [...splitValues(committed.value), ...splitValues(input.value)].join(", ");
    this.renderLookupChips(input);
  }

  renderLookupChips(input) {
    const field = input.closest(".ttc-lookup-field");
    const chips = field?.querySelector("[data-lookup-chips]");
    const committed = field?.querySelector("[data-lookup-committed]");
    if (!chips || !committed) return;
    const displayValues = this.lookupDisplayValues.get(input) || new Map();
    const isUser = input.hasAttribute("data-user-lookup");
    chips.innerHTML = splitValues(committed.value)
      .map((value) => {
        const display = displayValues.get(value) || { label: isUser ? "Jira user" : value, detail: isUser ? value : "" };
        return `<span class="ttc-lookup-chip" data-lookup-chip><span class="ttc-lookup-chip-copy"><strong>${this.escapeHtml(display.label)}</strong>${display.detail ? `<small>(${this.escapeHtml(display.detail)})</small>` : ""}</span><button type="button" data-lookup-remove data-lookup-value="${this.escapeHtml(value)}" aria-label="Remove ${this.escapeHtml(display.label)}">×</button></span>`;
      })
      .join("");
  }

  removeLookupValue(input, value) {
    const field = input.closest(".ttc-lookup-field");
    const hidden = field?.querySelector("[data-lookup-value][data-field]");
    const committed = field?.querySelector("[data-lookup-committed]");
    if (!hidden || !committed) return;
    const values = splitValues(committed.value).filter((candidate) => candidate !== value);
    committed.value = values.join(", ");
    hidden.value = [...values, ...splitValues(input.value)].join(", ");
    this.lookupDisplayValues.get(input)?.delete(value);
    this.renderLookupChips(input);
  }

  selectedStreams() {
    return [...this.container.querySelectorAll("[data-stream-toggle]:checked")].map((input) => input.dataset.streamToggle);
  }

  connection() {
    return this.service.saveConnection(this.elements.baseUrl.value, this.elements.projectKey.value, this.elements.allowInvalidTls.checked);
  }

  loadProjects() {
    try {
      const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this.projects = Array.isArray(parsed) ? parsed.filter((project) => project && project.key) : [];
    } catch (_) {
      this.projects = [];
    }
    let hasStoredConnection = false;
    try {
      hasStoredConnection = Boolean(localStorage.getItem("config.jira.projectKey"));
    } catch (_) {
      hasStoredConnection = false;
    }
    const legacy = hasStoredConnection ? this.legacyConnection?.projectKey : "";
    if (legacy && !this.projects.some((project) => project.key === legacy)) {
      this.projects.push({
        key: legacy,
        name: legacy,
        baseUrl: this.legacyConnection.baseUrl,
        allowInvalidTls: this.legacyConnection.allowInvalidTls,
        lastUsedAt: "",
      });
    }
    this.projects.sort((left, right) => String(right.lastUsedAt || "").localeCompare(String(left.lastUsedAt || "")));
  }

  saveProjects() {
    try {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(this.projects));
    } catch (_) {
      // Local project history is a convenience; the Jira connection remains in the service settings.
    }
  }

  renderProjectOptions(selectedKey = this.elements.projectKey?.value || "") {
    const options = [
      { value: "", label: "Choose a project" },
      ...this.projects.map((project) => ({
        value: project.key,
        label: project.name && project.name !== project.key ? `${project.name} · ${project.key}` : project.key,
      })),
      { value: NEW_PROJECT_VALUE, label: "+ Create new project" },
    ];
    this.setComboboxOptions("project-key", options, {
      selectedValue: selectedKey,
      placeholder: "Choose a project",
      disabled: !this.patConfigured,
    });
  }

  rememberProject(project) {
    if (!project?.key) return;
    const now = new Date().toISOString();
    const record = {
      key: project.key,
      name: project.name || project.projectName || project.key,
      baseUrl: project.baseUrl || this.elements.baseUrl.value,
      allowInvalidTls: project.allowInvalidTls ?? this.elements.allowInvalidTls.checked,
      lastUsedAt: now,
    };
    this.projects = [record, ...this.projects.filter((candidate) => candidate.key !== record.key)];
    this.selectedProject = record;
    this.saveProjects();
    this.renderProjectOptions(record.key);
  }

  async selectProject(key, { discover = false, project = null } = {}) {
    if (!key) {
      this.elements.projectKey.value = "";
      this.selectedProject = null;
      this.discovery = null;
      this.currentFeature = null;
      this.features = [];
      this.renderProjectOptions("");
      this.renderFeatureOptions("");
      this.updateWorkspaceVisibility();
      return;
    }
    const record = project || this.projects.find((candidate) => candidate.key === key);
    this.elements.baseUrl.value = record?.baseUrl || this.legacyConnection?.baseUrl || this.service.loadConnection().baseUrl;
    this.elements.allowInvalidTls.checked = Boolean(record?.allowInvalidTls ?? this.legacyConnection?.allowInvalidTls);
    const connection = this.service.saveConnection(this.elements.baseUrl.value, key, this.elements.allowInvalidTls.checked);
    this.elements.projectKey.value = connection.projectKey;
    this.selectedProject = record || { key: connection.projectKey, name: connection.projectKey };
    this.rememberProject({ ...(record || {}), ...connection, name: record?.name || connection.projectKey });
    this.discovery = null;
    this.currentFeature = null;
    this.resetParentResolution();
    this.refreshFeatureScope();
    this.renderProjectOptions(connection.projectKey);
    this.renderFeatureOptions("");
    this.updateWorkspaceVisibility();
    if (discover) await this.runDiscovery();
  }

  openProjectDialog() {
    if (!this.patConfigured) {
      this.showInlineError("Add your Jira PAT in Settings before adding a project.");
      return;
    }
    if (this.elements.projectKeyEntry) this.elements.projectKeyEntry.value = this.elements.projectKey.value || "";
    this.openDialog(this.elements.projectDialog);
    requestAnimationFrame(() => this.elements.projectKeyEntry?.focus());
  }

  async saveProjectFromDialog() {
    if (this.busy) return;
    const key = this.elements.projectKeyEntry?.value.trim();
    if (!key) {
      this.showInlineError("Project key is required.");
      return;
    }
    try {
      const normalized = this.service.saveConnection(this.elements.baseUrl.value, key, this.elements.allowInvalidTls.checked);
      this.elements.projectKey.value = normalized.projectKey;
      await this.runDiscovery();
      if (this.discovery) this.closeDialog(this.elements.projectDialog);
    } catch (error) {
      this.showInlineError(String(error || "Unable to save project."));
    }
  }

  async refreshPatStatus() {
    try {
      const configured = await this.service.hasPat();
      this.patConfigured = configured;
      this.elements.patStatus.dataset.state = configured ? "ready" : "missing";
      this.elements.patStatus.textContent = configured ? "PAT configured" : "PAT required";
      if (this.elements.projectPatState) this.elements.projectPatState.textContent = configured ? "PAT configured" : "PAT required";
      this.renderProjectOptions(this.elements.projectKey?.value || "");
      this.updateWorkspaceVisibility();
      return configured;
    } catch (_) {
      this.patConfigured = false;
      this.elements.patStatus.dataset.state = "missing";
      this.elements.patStatus.textContent = "PAT unavailable";
      if (this.elements.projectPatState) this.elements.projectPatState.textContent = "PAT unavailable";
      this.renderProjectOptions("");
      this.updateWorkspaceVisibility();
      return false;
    }
  }

  async runDiscovery() {
    if (this.busy) return;
    this.clearError();
    if (!(await this.refreshPatStatus())) {
      this.showInlineError("Add your Jira PAT in Settings before loading the form.");
      return;
    }
    if (!this.elements.projectKey.value.trim()) {
      this.openProjectDialog();
      return;
    }
    this.setBusy(true, "Loading Jira metadata…");
    this.setJiraSyncStatus("checking", "Fetching Jira metadata", "Reading create fields, allowed values, and the PAT owner…");
    try {
      this.discovery = await this.service.discover({
        ...this.connection(),
      });
      const connection = this.connection();
      this.rememberProject({ ...connection, name: this.discovery.project_name || this.discovery.project_key || connection.projectKey });
      this.populateCreateOptions();
      this.renderDiscovery(this.discovery);
      this.applyGlobalDefaults();
      if (this.currentFeature) this.applyFeature(this.currentFeature);
      this.renderFeatureOptions();
      this.refreshFeatureScope();
      this.updateWorkspaceVisibility();
      this.elements.contractDetails.hidden = false;
      this.setJiraSyncStatus(
        "ready",
        "Jira metadata loaded",
        `Fetched ${new Date().toLocaleString()}. Option filtering is local; user and label lookup fetches on typing.`,
      );
      this.showSuccess(`Jira metadata loaded for ${connection.projectKey}. Choose a feature to continue.`);
      this.elements.featureSelect?.focus?.();
    } catch (error) {
      this.setJiraSyncStatus("missing", "Jira metadata unavailable", "Fix the connection or PAT, then try again.");
      this.showInlineError(String(error || "Jira discovery failed."));
    } finally {
      this.setBusy(false);
    }
  }

  setJiraSyncStatus(state, label, detail) {
    if (this.elements.jiraSyncStatus) {
      this.elements.jiraSyncStatus.dataset.state = state;
      this.elements.jiraSyncStatus.textContent = label;
    }
    if (this.elements.jiraSyncDetail) this.elements.jiraSyncDetail.textContent = detail;
  }

  populateCreateOptions() {
    const mappings = [
      ["ad-story-point", "global-ad-story-point", "customfield_15313"],
      ["dev-story-point", "global-dev-story-point", "customfield_15309"],
      ["priority", "global-priority", "priority"],
      ["release", "global-release", "customfield_11802"],
      ["squad", "global-squad", "customfield_14903"],
      ["task-trigger", "global-task-trigger", "customfield_14304"],
    ];
    mappings.forEach(([elementName, globalElementName, fieldId]) => {
      const keepEmpty = elementName === "dev-story-point";
      const metadata = this.findField(fieldId);
      const options = (metadata?.allowed_values || []).filter((option) => option.disabled !== true);
      const comboboxOptions = [
        { value: "", label: keepEmpty ? "Use Jira default (0)" : "Choose…" },
        ...options.map((option) => ({ value: option.id, label: formatFieldValue(option) })),
      ];
      [elementName, globalElementName].forEach((name) => {
        this.setComboboxOptions(name, comboboxOptions, {
          placeholder: keepEmpty ? "Use Jira default (0)" : "Choose an option",
          disabled: !metadata,
        });
      });
      if (elementName === "priority" && !this.globalDefaults.shared.priorityId) {
        const low = options.find((option) => option.id === "4" || option.name === "Low" || option.value === "Low");
        if (low) this.globalDefaults.shared.priorityId = low.id;
      }
      if (elementName === "task-trigger" && !this.globalDefaults.shared.taskTriggerId) {
        const design = options.find((option) => option.value === "Design" || option.name === "Design");
        if (design) this.globalDefaults.shared.taskTriggerId = design.id;
      }
    });
    this.applyGlobalDefaults();
    if (this.currentFeature) this.applyFeature(this.currentFeature);
  }

  findField(fieldId) {
    return (this.discovery?.issue_types || []).flatMap((issueType) => issueType.fields || []).find((field) => field.id === fieldId);
  }

  issueTypeId(stream) {
    const target = stream === "be" ? "be-sub-task" : "fe-sub-task";
    return (this.discovery?.issue_types || []).find((issueType) => issueType.name.toLowerCase() === target)?.id || "";
  }

  async resolveParent() {
    if (!this.discovery || this.busy) return;
    this.clearError();
    const issueKeys = splitValues(this.field("parent-sources")?.value);
    if (!issueKeys.length) {
      this.showInlineError("Enter at least one Epic, Story, Improvement, or Bug.");
      return;
    }
    this.setBusy(true, "Looking up parent…");
    try {
      this.parentResolution = await this.service.resolveParents({
        ...this.connection(),
        issueKeys,
      });
      const { inputs, candidates } = this.parentResolution;
      this.elements.parentSource.textContent = `${inputs.map((input) => `${input.key} · ${input.issue_type}`).join(" + ")} → ${candidates.length} eligible parent${candidates.length === 1 ? "" : "s"}`;
      this.setComboboxOptions(
        "parent-select",
        candidates.map((candidate) => ({
          value: candidate.key,
          label: `${candidate.key} · ${candidate.issue_type} · ${candidate.summary}${candidate.source_epic_key ? ` · From ${candidate.source_epic_key}` : ""} (${candidate.status})`,
        })),
        { placeholder: candidates.length ? "Choose an eligible parent" : "No eligible parent found", disabled: candidates.length === 0 },
      );
      this.elements.parentResult.hidden = false;
      this.elements.ticketForm.hidden = false;
      this.renderCreatePreview();
    } catch (error) {
      this.showInlineError(String(error || "Parent lookup failed."));
    } finally {
      this.setBusy(false);
    }
  }

  resetParentResolution() {
    this.parentResolution = null;
    if (this.elements.parentResult) this.elements.parentResult.hidden = true;
    if (this.elements.ticketForm) this.elements.ticketForm.hidden = false;
    this.setComboboxOptions("parent-select", [], { placeholder: "Find eligible parents first", disabled: true });
  }

  toggleStream(stream, enabled) {
    if (enabled) {
      if (stream === "be") {
        ["ios", "android", "web"].forEach((other) => this.setStreamChecked(other, false));
      } else {
        this.setStreamChecked("be", false);
        if (stream === "web") {
          ["ios", "android"].forEach((other) => this.setStreamChecked(other, false));
        } else {
          this.setStreamChecked("web", false);
        }
      }
    }
    this.refreshStreamCards();
  }

  refreshStreamCards() {
    const mobileSummary = this.container.querySelector("[data-mobile-summary]");
    if (mobileSummary) mobileSummary.hidden = !this.selectedStreams().some((selected) => selected === "ios" || selected === "android");
    const modeNote = this.container.querySelector("#ttc-mode-note");
    if (modeNote)
      modeNote.textContent = this.selectedStreams().includes("be")
        ? "BE mode creates one backend ticket."
        : "FE mode supports iOS, Android, iOS + Android, or Web alone.";
    ["ios", "android", "web", "be"].forEach((name) => {
      const current = this.container.querySelector(`[data-stream-toggle="${name}"]`)?.checked;
      const streamCard = this.container.querySelector(`[data-stream-card="${name}"]`);
      if (streamCard) streamCard.hidden = !current;
    });
  }

  setStreamChecked(stream, checked) {
    const toggle = this.container.querySelector(`[data-stream-toggle="${stream}"]`);
    if (toggle) toggle.checked = checked;
  }

  collectTickets() {
    const streams = this.selectedStreams();
    if (!streams.length) throw new Error("Select at least one ticket to create.");
    if (streams.includes("be") && streams.length > 1) throw new Error("Choose either FE or BE mode, not both.");
    if (streams.includes("web") && streams.length > 1) throw new Error("Web is a standalone FE mode. Deselect iOS and Android.");
    const shared = {
      priorityId: this.field("priority").value || null,
      adStoryPointId: this.requiredValue("ad-story-point", "AD Story Point"),
      devStoryPointId: this.field("dev-story-point").value || null,
      squadId: this.requiredValue("squad", "Squad"),
      releaseId: this.requiredValue("release", "Release Number"),
      startDate: this.requiredValue("start-date", "Start Development On"),
      deadline: this.requiredValue("deadline", "Deadline"),
      saAdLead: this.requiredValue("sa-ad-lead", "SA/AD Lead"),
      saAdSubLeads: splitValues(this.requiredValue("sa-ad-sub-leads", "SA/AD Sub-Lead")),
      taskTriggerId: this.requiredValue("task-trigger", "Task Trigger By"),
      description: this.field("description").value.trim(),
      confluencePage: this.field("confluence-page").value.trim(),
    };
    const featureLabels = normalizeLabels(this.field("feature-labels").value);
    return streams.map((stream) => {
      const component = this.field("be-component").value;
      const summaryField = stream === "ios" || stream === "android" ? "summary-mobile" : `summary-${stream}`;
      const summary = buildSummary(stream, this.field(summaryField).value, component);
      const labels = labelsForStream(this.globalDefaults, stream, component, featureLabels);
      if (!labels.length) throw new Error("At least one label is required.");
      return {
        issueTypeId: this.issueTypeId(stream),
        stream,
        summary,
        labels,
        ...shared,
        developer: this.requiredValue(`${stream}-developer`, `${stream} Developer`),
        developerLead: this.requiredValue(`${stream}-developer-lead`, `${stream} Developer Lead`),
        developerSubLeads: splitValues(this.requiredValue(`${stream}-developer-sub-leads`, `${stream} Developer Sub-Lead`)),
      };
    });
  }

  requiredValue(fieldName, label) {
    const value = this.field(fieldName)?.value?.trim();
    if (!value) throw new Error(`${label} is required.`);
    return value;
  }

  renderCreatePreview() {
    if (!this.elements.preview || this.elements.ticketForm.hidden) return;
    const parent = this.elements.parentSelect.value;
    const streams = this.selectedStreams();
    const component = this.field("be-component").value;
    this.elements.preview.innerHTML = streams.length
      ? streams
          .map((stream) => {
            const summaryField = stream === "ios" || stream === "android" ? "summary-mobile" : `summary-${stream}`;
            const body = this.field(summaryField).value.trim() || "Summary required";
            const summary = body === "Summary required" ? body : buildSummary(stream, body, component);
            const labels = labelsForStream(this.globalDefaults, stream, component, this.field("feature-labels").value);
            return `<article><strong>${this.escapeHtml(summary)}</strong><span>Parent ${this.escapeHtml(parent || "not selected")}</span><small>${this.escapeHtml(labels.join(" · "))}</small></article>`;
          })
          .join("")
      : '<div class="ttc-empty">Select at least one ticket.</div>';
  }

  updateDateHint() {
    const start = this.field("start-date")?.value;
    const deadline = this.field("deadline")?.value;
    if (!start || !deadline) {
      this.elements.dateHint.textContent = "";
      return;
    }
    const startDate = new Date(`${start}T00:00:00`);
    const deadlineDate = new Date(`${deadline}T00:00:00`);
    const days = Math.round((deadlineDate - startDate) / 86_400_000);
    const formatted = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(deadlineDate);
    this.elements.dateHint.textContent = `${formatted} · ${days >= 0 ? `${days} more days` : `${Math.abs(days)} days before start`}`;
  }

  initializeGlobalDefaults() {
    try {
      const raw = localStorage.getItem(GLOBAL_DEFAULTS_KEY);
      this.globalDefaults = globalDefaultsFromStorage(raw ? JSON.parse(raw) : null);
      this.elements.globalStatus.dataset.state = "ready";
      this.elements.globalStatus.textContent = "Local defaults ready";
    } catch (error) {
      this.globalDefaults = createDefaultGlobalDefaults();
      this.elements.globalStatus.dataset.state = "missing";
      this.elements.globalStatus.textContent = "Defaults unavailable";
      this.showInlineError(String(error || "Unable to load global defaults."));
    }
    this.applyGlobalDefaults();
  }

  async initializeFeatureStorage() {
    this.initializeGlobalDefaults();
    try {
      await this.templateStorage.init();
      this.allFeatures = await this.templateStorage.list();
      this.refreshFeatureScope();
    } catch (error) {
      if (this.elements.featureStatus) {
        this.elements.featureStatus.dataset.state = "missing";
        this.elements.featureStatus.textContent = "Storage unavailable";
      }
      this.showInlineError(String(error || "Unable to initialize feature storage."));
    }
  }

  refreshFeatureScope() {
    const projectKey = this.elements.projectKey?.value?.trim();
    this.features = this.allFeatures.filter((feature) => !projectKey || !feature.projectKey || feature.projectKey === projectKey);
    if (this.elements.featureStatus) {
      this.elements.featureStatus.dataset.state = this.features.length ? "ready" : "missing";
      this.elements.featureStatus.textContent = this.features.length ? `${this.features.length} saved` : "No saved features";
    }
    this.renderFeatureOptions(this.currentFeature?.id || "");
  }

  collectGlobalDefaults() {
    const defaults = clone(this.globalDefaults);
    const labels = (name) => normalizeLabels(this.field(name)?.value);
    defaults.labels.common = labels("global-label-common");
    defaults.labels.ios = labels("global-label-ios");
    defaults.labels.android = labels("global-label-android");
    defaults.labels.web = labels("global-label-web");
    Object.keys(BE_COMPONENTS).forEach((component) => {
      defaults.labels.be[component] = labels(`global-label-be-${component}`);
    });
    defaults.people.common = {
      saAdLead: this.field("global-sa-ad-lead")?.value.trim() || "",
      saAdSubLeads: splitValues(this.field("global-sa-ad-sub-leads")?.value),
    };
    PEOPLE_STREAMS.forEach((stream) => {
      defaults.people.streams[stream] = {
        developer: this.field(`global-${stream}-developer`)?.value.trim() || "",
        developerLead: this.field(`global-${stream}-developer-lead`)?.value.trim() || "",
        developerSubLeads: splitValues(this.field(`global-${stream}-developer-sub-leads`)?.value),
      };
    });
    SHARED_DEFAULT_FIELDS.forEach(([, globalField, key]) => {
      defaults.shared[key] = this.field(globalField)?.value || "";
    });
    defaults.dateRule = {
      startOffsetDays: Number(this.field("global-start-offset-days")?.value || 0),
      deadlineOffsetDays: Number(this.field("global-deadline-offset-days")?.value || 3),
    };
    return defaults;
  }

  async saveGlobalDefaults() {
    this.clearError();
    try {
      this.globalDefaults = globalDefaultsFromStorage(this.collectGlobalDefaults());
      localStorage.setItem(GLOBAL_DEFAULTS_KEY, JSON.stringify(this.globalDefaults));
      this.applyGlobalDefaults();
      if (this.currentFeature) this.applyFeature(this.currentFeature);
      this.showSuccess(this.discovery ? "Saved global defaults." : "Saved locally. Load Jira metadata to verify Jira-backed defaults.");
    } catch (error) {
      this.showInlineError(String(error || "Unable to save global defaults."));
    }
  }

  renderFeatureOptions(selectedId = this.currentFeature?.id || "") {
    this.setComboboxOptions(
      "feature-select",
      [
        { value: "", label: "Choose a feature" },
        ...this.features.map((feature) => ({ value: feature.id, label: feature.name })),
        { value: NEW_FEATURE_VALUE, label: "+ Create new feature" },
      ],
      { selectedValue: selectedId, placeholder: "Choose a feature", disabled: !this.discovery },
    );
  }

  formatFeatureDate(value) {
    if (!value) return "recently";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "recently";
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  async selectFeature(id) {
    if (!id) {
      this.currentFeature = null;
      this.renderFeatureOptions("");
      this.updateWorkspaceVisibility();
      return;
    }
    this.resetParentResolution();
    this.resetCreationDraft();
    this.currentFeature = id ? await this.templateStorage.get(id) : null;
    this.applyFeatureMetadata(this.currentFeature);
    this.renderFeatureOptions(id);
    this.applyGlobalDefaults();
    if (this.currentFeature) this.applyFeature(this.currentFeature);
    this.setTicketType(this.ticketType);
    this.renderFeatureContext();
    this.updateWorkspaceVisibility();
  }

  newFeature() {
    this.resetParentResolution();
    this.resetCreationDraft();
    this.currentFeature = null;
    this.applyFeatureMetadata(null);
    this.renderFeatureOptions("");
    this.setLookupValue("feature-labels", []);
    this.applyGlobalDefaults();
    this.refreshStreamCards();
    this.renderOverrideNotice();
    this.renderCreatePreview();
    this.updateWorkspaceVisibility();
    this.openFeatureDialog({ isNew: true });
  }

  openFeatureDialog({ isNew = false } = {}) {
    if (!isNew && !this.currentFeature) {
      this.newFeature();
      return;
    }
    if (isNew) this.applyFeatureMetadata(null);
    else this.applyFeatureMetadata(this.currentFeature);
    const title = this.elements.featureDialog?.querySelector("#ttc-feature-dialog-title");
    if (title) title.textContent = isNew ? "Create a feature" : "Edit feature";
    if (this.elements.featureSave) this.elements.featureSave.textContent = isNew ? "Create feature" : "Save feature";
    this.openDialog(this.elements.featureDialog);
    requestAnimationFrame(() => this.elements.featureName?.focus());
  }

  applyFeatureMetadata(feature) {
    if (this.elements.featureName) this.elements.featureName.value = feature?.name || "";
    if (this.elements.featureEpic) this.elements.featureEpic.value = feature?.featureEpic || "";
    if (this.elements.featureParentSources) this.elements.featureParentSources.value = feature?.parentSources || "";
    if (this.elements.featureBugSources) this.elements.featureBugSources.value = feature?.bugSources || "";
    const scopeName = this.container.querySelector("[data-feature-scope-name]");
    if (scopeName) scopeName.textContent = feature?.name || "New feature";
  }

  resetCreationDraft() {
    ["parent-sources", "summary-mobile", "summary-web", "summary-be", "description", "confluence-page"].forEach((name) => {
      const field = this.field(name);
      if (field) field.value = "";
    });
    const component = this.field("be-component");
    if (component) {
      component.value = "API";
      this.syncComboboxValue("be-component");
    }
    ["ios", "android", "web", "be"].forEach((stream) => this.setStreamChecked(stream, stream === "ios" || stream === "android"));
    this.refreshStreamCards();
    this.setTicketType(this.ticketType, { preserveParent: true });
  }

  setTicketType(type, { preserveParent = false } = {}) {
    this.ticketType = type === "bug-fixing" ? "bug-fixing" : "ad-task";
    const isBug = this.ticketType === "bug-fixing";
    const copy = this.container.querySelector("[data-parent-mode-copy]");
    const label = this.container.querySelector("[data-parent-mode-label]");
    const input = this.elements.parentInput;
    const resolve = this.elements.resolveParent;
    if (copy)
      copy.textContent = isBug
        ? "Paste the bug key or Jira link. Bug-fixing tickets are created under that bug."
        : "Choose a Story or Improvement saved in this feature, or add another Jira key or link.";
    if (label) label.textContent = isBug ? "Bug key or link" : "Story or Improvement";
    if (input) {
      input.placeholder = isBug ? "Paste a bug key or URL\nEVDEV-350436" : "Paste one key or URL\nEVDEV-350436";
      if (!preserveParent) {
        const saved = isBug ? this.currentFeature?.bugSources : this.currentFeature?.parentSources;
        input.value = saved || "";
      }
    }
    if (resolve) resolve.textContent = isBug ? "Find bug" : "Find parent";
    this.resetParentResolution();
    this.renderCreatePreview();
  }

  collectPeopleOverrides() {
    const overrides = { common: {}, streams: {} };
    const global = this.globalDefaults.people;
    const currentCommonLead = this.field("sa-ad-lead").value.trim();
    const currentCommonSubLeads = splitValues(this.field("sa-ad-sub-leads").value);
    if (currentCommonLead && currentCommonLead !== global.common.saAdLead) overrides.common.saAdLead = currentCommonLead;
    if (currentCommonSubLeads.length && JSON.stringify(currentCommonSubLeads) !== JSON.stringify(global.common.saAdSubLeads))
      overrides.common.saAdSubLeads = currentCommonSubLeads;
    PEOPLE_STREAMS.forEach((stream) => {
      const current = {
        developer: this.field(`${stream}-developer`).value.trim(),
        developerLead: this.field(`${stream}-developer-lead`).value.trim(),
        developerSubLeads: splitValues(this.field(`${stream}-developer-sub-leads`).value),
      };
      const source = global.streams[stream];
      const override = {};
      if (current.developer && current.developer !== source.developer) override.developer = current.developer;
      if (current.developerLead && current.developerLead !== source.developerLead) override.developerLead = current.developerLead;
      if (current.developerSubLeads.length && JSON.stringify(current.developerSubLeads) !== JSON.stringify(source.developerSubLeads))
        override.developerSubLeads = current.developerSubLeads;
      overrides.streams[stream] = override;
    });
    return overrides;
  }

  collectFeature() {
    const name = this.elements.featureName.value.trim();
    if (!name) throw new Error("Feature name is required.");
    const overrides = { shared: {}, people: this.collectPeopleOverrides(), dateRule: {} };
    SHARED_DEFAULT_FIELDS.forEach(([featureField, , key]) => {
      const value = this.field(featureField).value;
      if (value && value !== this.globalDefaults.shared[key]) overrides.shared[key] = value;
    });
    const startOffset = Number(this.field("start-offset-days").value || 0);
    const deadlineOffset = Number(this.field("deadline-offset-days").value || 3);
    if (startOffset !== this.globalDefaults.dateRule.startOffsetDays) overrides.dateRule.startOffsetDays = startOffset;
    if (deadlineOffset !== this.globalDefaults.dateRule.deadlineOffsetDays) overrides.dateRule.deadlineOffsetDays = deadlineOffset;
    return {
      id: this.currentFeature?.id,
      createdAt: this.currentFeature?.createdAt,
      name,
      projectKey: this.elements.projectKey?.value?.trim() || "",
      featureEpic: this.elements.featureEpic?.value?.trim() || "",
      parentSources: this.elements.featureParentSources?.value?.trim() || "",
      bugSources: this.elements.featureBugSources?.value?.trim() || "",
      featureLabels: normalizeLabels(this.field("feature-labels").value),
      overrides,
    };
  }

  async saveFeature() {
    this.clearError();
    try {
      const wasExisting = Boolean(this.currentFeature?.id);
      const feature = this.collectFeature();
      const duplicate = this.features.find(
        (candidate) => candidate.id !== feature.id && candidate.name.toLowerCase() === feature.name.toLowerCase(),
      );
      if (duplicate) throw new Error(`A feature named “${duplicate.name}” already exists.`);
      this.currentFeature = await this.templateStorage.save(feature);
      this.allFeatures = await this.templateStorage.list();
      this.refreshFeatureScope();
      this.renderFeatureOptions(this.currentFeature.id);
      this.applyFeatureMetadata(this.currentFeature);
      this.closeDialog(this.elements.featureDialog);
      this.renderFeatureContext();
      this.renderOverrideNotice();
      this.showSuccess(`${wasExisting ? "Saved" : "Created"} feature “${this.currentFeature.name}”. Choose a Jira parent to continue.`);
      this.updateWorkspaceVisibility();
    } catch (error) {
      this.showInlineError(String(error || "Unable to save feature."));
    }
  }

  async duplicateFeature() {
    if (!this.currentFeature) {
      this.showInlineError("Choose a saved feature to duplicate.");
      return;
    }
    try {
      this.currentFeature = await this.templateStorage.duplicate(this.currentFeature.id);
      this.allFeatures = await this.templateStorage.list();
      this.refreshFeatureScope();
      this.applyFeatureMetadata(this.currentFeature);
      this.renderFeatureOptions(this.currentFeature.id);
      this.renderFeatureContext();
      this.showSuccess(`Duplicated as “${this.currentFeature.name}”.`);
    } catch (error) {
      this.showInlineError(String(error || "Unable to duplicate feature."));
    }
  }

  async deleteFeature() {
    if (!this.currentFeature) {
      this.showInlineError("Choose a saved feature to delete.");
      return;
    }
    const name = this.currentFeature.name;
    if (!window.confirm(`Delete feature “${name}”? Jira tickets are not affected.`)) return;
    await this.templateStorage.delete(this.currentFeature.id);
    this.allFeatures = await this.templateStorage.list();
    this.currentFeature = null;
    this.refreshFeatureScope();
    this.renderFeatureOptions("");
    this.updateWorkspaceVisibility();
    this.showSuccess(`Deleted feature “${name}”.`);
  }

  applyGlobalDefaults() {
    const set = (name, value) => {
      const element = this.field(name);
      if (element && value !== undefined && value !== null) {
        if (element.dataset.lookupValue !== undefined) {
          this.setLookupValue(name, value);
          return;
        }
        element.value = Array.isArray(value) ? value.join(", ") : value;
        if (element.dataset.comboboxValue !== undefined) this.syncComboboxValue(name);
      }
    };
    set("global-label-common", this.globalDefaults.labels.common);
    set("global-label-ios", this.globalDefaults.labels.ios);
    set("global-label-android", this.globalDefaults.labels.android);
    set("global-label-web", this.globalDefaults.labels.web);
    Object.keys(BE_COMPONENTS).forEach((component) => set(`global-label-be-${component}`, this.globalDefaults.labels.be[component]));
    set("global-sa-ad-lead", this.globalDefaults.people.common.saAdLead);
    set("global-sa-ad-sub-leads", this.globalDefaults.people.common.saAdSubLeads);
    PEOPLE_STREAMS.forEach((stream) => {
      const people = this.globalDefaults.people.streams[stream];
      set(`global-${stream}-developer`, people.developer);
      set(`global-${stream}-developer-lead`, people.developerLead);
      set(`global-${stream}-developer-sub-leads`, people.developerSubLeads);
      set(`${stream}-developer`, people.developer);
      set(`${stream}-developer-lead`, people.developerLead);
      set(`${stream}-developer-sub-leads`, people.developerSubLeads);
    });
    set("sa-ad-lead", this.globalDefaults.people.common.saAdLead);
    set("sa-ad-sub-leads", this.globalDefaults.people.common.saAdSubLeads);
    SHARED_DEFAULT_FIELDS.forEach(([featureField, globalField, key]) => {
      set(globalField, this.globalDefaults.shared[key]);
      set(featureField, this.globalDefaults.shared[key]);
    });
    set("global-start-offset-days", this.globalDefaults.dateRule.startOffsetDays);
    set("global-deadline-offset-days", this.globalDefaults.dateRule.deadlineOffsetDays);
    set("start-offset-days", this.globalDefaults.dateRule.startOffsetDays);
    set("deadline-offset-days", this.globalDefaults.dateRule.deadlineOffsetDays);
    if (this.discovery?.user) set("assignee-display", this.discovery.user.display_name || this.discovery.user.username);
    const prefix = this.container.querySelector("[data-be-prefix]");
    if (prefix) prefix.textContent = `[${this.field("be-component")?.value || "API"}]`;
    this.applyDateRule();
    this.updateDateHint();
    this.renderCreatePreview();
    this.renderOverrideNotice();
  }

  applyFeature(feature) {
    const set = (name, value) => {
      const element = this.field(name);
      if (element && value !== undefined && value !== null) {
        if (element.dataset.lookupValue !== undefined) {
          this.setLookupValue(name, value);
          return;
        }
        element.value = Array.isArray(value) ? value.join(", ") : value;
        if (element.dataset.comboboxValue !== undefined) this.syncComboboxValue(name);
      }
    };
    set("feature-labels", feature.featureLabels || feature.shared?.extraLabels || []);
    const overrides = feature.overrides || {
      shared: feature.shared || {},
      people: { common: {}, streams: feature.people || {} },
      dateRule: feature.dateRule || {},
    };
    SHARED_DEFAULT_FIELDS.forEach(([featureField, , key]) => set(featureField, overrides.shared?.[key] ?? this.globalDefaults.shared[key]));
    set("start-offset-days", overrides.dateRule?.startOffsetDays ?? this.globalDefaults.dateRule.startOffsetDays);
    set("deadline-offset-days", overrides.dateRule?.deadlineOffsetDays ?? this.globalDefaults.dateRule.deadlineOffsetDays);
    const common = overrides.people?.common || {};
    set("sa-ad-lead", common.saAdLead ?? this.globalDefaults.people.common.saAdLead);
    set("sa-ad-sub-leads", common.saAdSubLeads ?? this.globalDefaults.people.common.saAdSubLeads);
    PEOPLE_STREAMS.forEach((stream) => {
      const people = overrides.people?.streams?.[stream] || overrides.people?.[stream] || {};
      const globalPeople = this.globalDefaults.people.streams[stream];
      set(`${stream}-developer`, people.developer ?? globalPeople.developer);
      set(`${stream}-developer-lead`, people.developerLead ?? globalPeople.developerLead);
      set(`${stream}-developer-sub-leads`, people.developerSubLeads ?? globalPeople.developerSubLeads);
    });
    this.applyDateRule();
    this.updateDateHint();
    this.renderOverrideNotice();
    this.renderCreatePreview();
  }

  async saveFeatureConfig() {
    if (!this.currentFeature) {
      this.showInlineError("Choose or create a feature before saving feature config.");
      return;
    }
    await this.saveFeature();
    this.closeConfigPanel();
  }

  renderOverrideNotice() {
    if (!this.elements.overrideNotice) return;
    const messages = [];
    const feature = this.currentFeature;
    const overrides = feature?.overrides;
    if (overrides?.shared && Object.keys(overrides.shared).length)
      messages.push(`Feature overrides: ${Object.keys(overrides.shared).join(", ")}.`);
    if (overrides?.people?.common && Object.keys(overrides.people.common).length) messages.push("Feature overrides AD / SA people.");
    const streamOverrides = PEOPLE_STREAMS.filter((stream) => Object.keys(overrides?.people?.streams?.[stream] || {}).length);
    if (streamOverrides.length) messages.push(`Feature overrides people for ${streamOverrides.join(", ")}.`);
    if (overrides?.dateRule && Object.keys(overrides.dateRule).length) messages.push("Feature overrides the global date rule.");
    const hasFeatureValues = this.renderConfigSources();
    if (hasFeatureValues && !messages.length) messages.push("Feature values differ from Global config. Save feature config to reuse them.");
    this.elements.overrideNotice.hidden = messages.length === 0;
    this.elements.overrideNotice.textContent = messages.join(" ");
    this.renderConfigSummary(hasFeatureValues);
  }

  renderConfigSources() {
    const origin = (key, text) => {
      const element = this.container.querySelector(`[data-config-origin="${key}"]`);
      if (element) element.textContent = text;
    };
    const sharedChanged = (fieldName, key) => {
      const value = this.field(fieldName)?.value || "";
      return value !== (this.globalDefaults.shared[key] || "");
    };
    const peopleChanged = (stream) => {
      const source = stream === "common" ? this.globalDefaults.people.common : this.globalDefaults.people.streams[stream];
      const names =
        stream === "common"
          ? ["sa-ad-lead", "sa-ad-sub-leads"]
          : [`${stream}-developer`, `${stream}-developer-lead`, `${stream}-developer-sub-leads`];
      const expected =
        stream === "common" ? [source.saAdLead, source.saAdSubLeads] : [source.developer, source.developerLead, source.developerSubLeads];
      return names.some((name, index) => {
        const actual = this.field(name)?.value || "";
        const expectedValue = Array.isArray(expected[index]) ? expected[index].join(", ") : expected[index] || "";
        return actual !== expectedValue;
      });
    };
    const featureLabelCount = normalizeLabels(this.field("feature-labels")?.value).length;
    origin(
      "feature-labels",
      featureLabelCount ? "Feature labels · Global labels still apply" : "No feature labels · Global labels still apply",
    );

    const peopleKeys = ["common", ...PEOPLE_STREAMS];
    const peopleOverride = peopleKeys.some((stream) => {
      const changed = peopleChanged(stream);
      origin(`people-${stream}`, changed ? "Feature override · Global fallback" : "Inherited from Global config");
      return changed;
    });

    const sharedOverride = SHARED_DEFAULT_FIELDS.some(([fieldName, , key]) => {
      const changed = sharedChanged(fieldName, key);
      origin(fieldName, changed ? "Feature override" : "Inherited from Global config");
      return changed;
    });

    const dateOverride = [
      ["start-offset-days", this.globalDefaults.dateRule.startOffsetDays],
      ["deadline-offset-days", this.globalDefaults.dateRule.deadlineOffsetDays],
    ].some(([fieldName, expected]) => (this.field(fieldName)?.value || "") !== String(expected));
    origin("start-offset-days", dateOverride ? "Feature override" : "Inherited from Global config");
    origin("deadline-offset-days", dateOverride ? "Feature override" : "Inherited from Global config");

    const hasFeatureValues = Boolean(featureLabelCount || peopleOverride || sharedOverride || dateOverride);
    if (this.elements.featureConfigStatus) {
      this.elements.featureConfigStatus.dataset.state = hasFeatureValues ? "ready" : "idle";
      this.elements.featureConfigStatus.textContent = hasFeatureValues ? "Feature overrides active" : "Inherited from Global";
    }
    const scopeName = this.container.querySelector("[data-feature-scope-name]");
    if (scopeName) scopeName.textContent = this.elements.featureName?.value.trim() || "New feature";
    return hasFeatureValues;
  }

  renderConfigSummary(hasFeatureValues = false) {
    if (!this.elements.prefillSource) return;
    this.elements.prefillSource.textContent = hasFeatureValues
      ? "Global config + Feature-level overrides"
      : "Global config · feature uses inherited values";
    this.renderPrefillSources();
    this.renderFeatureContext(hasFeatureValues);
  }

  renderPrefillSources() {
    const featureOverrides = this.currentFeature?.overrides || {};
    const hasFeatureOverride = (group, key) => Boolean(featureOverrides?.[group]?.[key] !== undefined);
    const mark = (selector, source) => {
      const element = this.container.querySelector(selector);
      if (element) element.dataset.prefillSource = source;
    };
    SHARED_DEFAULT_FIELDS.forEach(([featureField, , key]) => {
      mark(`[data-combobox-field="${featureField}"]`, hasFeatureOverride("shared", key) ? "feature" : "global");
    });
    ["start-offset-days", "deadline-offset-days"].forEach((field) => {
      mark(
        `[data-field="${field}"]`,
        hasFeatureOverride("dateRule", field === "start-offset-days" ? "startOffsetDays" : "deadlineOffsetDays") ? "feature" : "global",
      );
    });
    ["summary-mobile", "summary-web", "summary-be", "description", "confluence-page", "parent-sources"].forEach((field) => {
      const element = this.field(field);
      const wrapper = element?.closest(".ttc-field") || element;
      if (wrapper) wrapper.dataset.prefillSource = "user";
    });
  }

  renderFeatureContext(
    hasFeatureValues = this.currentFeature
      ? Boolean(
          this.currentFeature.overrides &&
          Object.keys(this.currentFeature.overrides).some((key) => Object.keys(this.currentFeature.overrides[key] || {}).length),
        )
      : false,
  ) {
    if (this.elements.featureContextName) this.elements.featureContextName.textContent = this.currentFeature?.name || "New feature";
    if (this.elements.featureContextKey)
      this.elements.featureContextKey.textContent = this.elements.projectKey?.value?.trim()?.toUpperCase() || "—";
    if (this.elements.featureContextPrefill)
      this.elements.featureContextPrefill.textContent = hasFeatureValues ? "Global + feature" : "Global defaults";
  }

  lookupQuery(input) {
    const value = input.value || "";
    const fieldName = input.dataset.lookupField || input.dataset.field || "";
    if (input.hasAttribute("data-user-lookup") && fieldName.endsWith("sub-leads")) return value.split(/[\n,]/).pop().trim();
    return value.split(/[\n,]/).pop().trim();
  }

  scheduleUserLookup(input) {
    const key = `user:${input.dataset.lookupField || input.dataset.field}`;
    clearTimeout(this.lookupTimers.get(key));
    const timer = setTimeout(async () => {
      const query = this.lookupQuery(input);
      if (query.replaceAll("*", "").trim().length < 2) {
        this.clearLookupSuggestions(input);
        return;
      }
      this.renderLookupLoading(input, "Searching Jira users…");
      try {
        const users = await this.service.searchUsers({ ...this.connection(), query });
        if (this.lookupQuery(input) === query) this.renderUserSuggestions(input, users);
      } catch {
        if (this.lookupQuery(input) === query)
          this.renderLookupError(input, "Unable to fetch Jira users. Check the PAT or Jira connection.");
      }
    }, 250);
    this.lookupTimers.set(key, timer);
  }

  scheduleLabelLookup(input) {
    const key = `label:${input.dataset.lookupField || input.dataset.field}`;
    clearTimeout(this.lookupTimers.get(key));
    const timer = setTimeout(async () => {
      const query = this.lookupQuery(input);
      if (query.replaceAll("*", "").trim().length < 2) {
        this.clearLookupSuggestions(input);
        return;
      }
      this.renderLookupLoading(input, "Searching Jira labels…");
      try {
        const labels = await this.service.searchLabels({ ...this.connection(), query });
        if (this.lookupQuery(input) === query) this.renderLabelSuggestions(input, labels);
      } catch {
        if (this.lookupQuery(input) === query)
          this.renderLookupError(input, "Unable to fetch Jira labels. Check the PAT or Jira connection.");
      }
    }, 250);
    this.lookupTimers.set(key, timer);
  }

  renderUserSuggestions(input, users) {
    const menu = this.lookupMenu(input);
    if (!menu) return;
    menu.innerHTML = `<div class="ttc-lookup-header" aria-hidden="true">Jira users</div>${
      users.length
        ? users
            .map(
              (user) =>
                `<button data-lookup-option data-lookup-value="${this.escapeHtml(user.username)}" type="button" role="option" aria-selected="false"><strong>${this.escapeHtml(user.display_name)}</strong><small>${this.escapeHtml(user.username)}</small></button>`,
            )
            .join("")
        : '<div class="ttc-lookup-empty">No Jira users found.</div>'
    }`;
    this.resetLookupActiveOption(input);
    menu.hidden = false;
  }

  clearLookupSuggestions(input) {
    const menu = this.lookupMenu(input);
    if (!menu) return;
    menu.innerHTML = "";
    this.resetLookupActiveOption(input);
    menu.hidden = true;
  }

  renderLabelSuggestions(input, labels) {
    const menu = this.lookupMenu(input);
    if (!menu) return;
    menu.innerHTML = `<div class="ttc-lookup-header" aria-hidden="true">Jira labels</div>${
      labels.length
        ? labels
            .map(
              (label) =>
                `<button data-lookup-option data-lookup-value="${this.escapeHtml(label)}" type="button" role="option" aria-selected="false"><strong>${this.escapeHtml(label)}</strong></button>`,
            )
            .join("")
        : '<div class="ttc-lookup-empty">No Jira labels found.</div>'
    }`;
    this.resetLookupActiveOption(input);
    menu.hidden = false;
  }

  renderLookupLoading(input, message) {
    const menu = this.lookupMenu(input);
    if (!menu) return;
    const heading = input.hasAttribute("data-user-lookup") ? "Jira users" : "Jira labels";
    menu.innerHTML = `<div class="ttc-lookup-header" aria-hidden="true">${heading}</div><div class="ttc-lookup-loading">${this.escapeHtml(message)}</div>`;
    this.resetLookupActiveOption(input);
    menu.hidden = false;
  }

  renderLookupError(input, message) {
    const menu = this.lookupMenu(input);
    if (!menu) return;
    const heading = input.hasAttribute("data-user-lookup") ? "Jira users" : "Jira labels";
    menu.innerHTML = `<div class="ttc-lookup-header" aria-hidden="true">${heading}</div><div class="ttc-lookup-error">${this.escapeHtml(message)}</div>`;
    this.resetLookupActiveOption(input);
    menu.hidden = false;
  }

  lookupMenu(input) {
    return input?.closest?.("[data-lookup-menu]") || input?.parentElement?.querySelector("[data-lookup-menu]");
  }

  lookupOptions(input) {
    return [...(this.lookupMenu(input)?.querySelectorAll("[data-lookup-option]") || [])];
  }

  resetLookupActiveOption(input) {
    this.lookupActiveIndexes ||= new Map();
    this.lookupActiveIndexes.delete(input);
    this.lookupOptions(input).forEach((option) => {
      option.classList.remove("is-active");
      option.setAttribute("aria-selected", "false");
    });
  }

  setLookupActiveOption(input, activeIndex) {
    this.lookupActiveIndexes ||= new Map();
    const options = this.lookupOptions(input);
    const nextIndex = activeIndex >= 0 && activeIndex < options.length ? activeIndex : -1;
    this.lookupActiveIndexes.set(input, nextIndex);
    options.forEach((option, index) => {
      const isActive = index === nextIndex;
      option.classList.toggle("is-active", isActive);
      option.setAttribute("aria-selected", String(isActive));
      if (isActive) option.scrollIntoView?.({ block: "nearest" });
    });
  }

  chooseLookupOption(option) {
    const field = option.closest(".ttc-lookup-field");
    const input = field?.querySelector("[data-lookup-input], [data-user-lookup], [data-label-lookup]");
    if (!input) return;
    const lookupType = input.hasAttribute("data-user-lookup") ? "user" : "label";
    const fieldName = input.dataset.lookupField || input.dataset.field || field?.querySelector("[data-field]")?.dataset.field || "";
    const lookupKey = `${lookupType}:${fieldName}`;
    clearTimeout(this.lookupTimers.get(lookupKey));
    this.lookupTimers.delete(lookupKey);
    const value = option.dataset.lookupValue || "";
    const lookupValue = field?.querySelector("[data-lookup-value][data-field]");
    const committed = field?.querySelector("[data-lookup-committed]");
    if (lookupValue && committed) {
      const isMultiple = field.dataset.lookupMultiple === "true";
      const typedValues = splitValues(input.value);
      const typedBeforeActive = isMultiple ? typedValues.slice(0, -1) : [];
      const values = isMultiple ? [...splitValues(committed.value), ...typedBeforeActive, value] : [value];
      committed.value = splitValues(values).join(", ");
      lookupValue.value = committed.value;
      input.value = "";
      const displayValues = this.lookupDisplayValues.get(input) || new Map();
      displayValues.set(value, {
        label: option.querySelector("strong")?.textContent?.trim() || option.textContent.trim() || value,
        detail: input.hasAttribute("data-user-lookup") ? option.querySelector("small")?.textContent?.trim() || value : "",
      });
      this.lookupDisplayValues.set(input, displayValues);
      this.renderLookupChips(input);
    } else {
      const current = input.value || "";
      const separatorIndex = Math.max(current.lastIndexOf(","), current.lastIndexOf("\n"));
      input.value = separatorIndex >= 0 ? `${current.slice(0, separatorIndex + 1)} ${value}` : value;
    }
    this.closeLookupMenus();
    this.updateDateHint();
    this.renderCreatePreview();
    this.renderOverrideNotice();
    input.focus();
  }

  closeLookupMenus() {
    this.container.querySelectorAll("[data-user-lookup], [data-label-lookup]").forEach((input) => this.resetLookupActiveOption(input));
    this.container.querySelectorAll("[data-lookup-menu]").forEach((menu) => {
      menu.hidden = true;
    });
  }

  async createTickets() {
    if (this.busy) return;
    this.clearError();
    try {
      const parentKey = this.elements.parentSelect.value;
      if (!parentKey) throw new Error("Choose an eligible parent.");
      const tickets = this.collectTickets();
      const summaries = tickets.map((ticket) => `• ${ticket.summary}`).join("\n");
      const confirmed = window.confirm(
        `Create ${tickets.length} Jira subtask${tickets.length === 1 ? "" : "s"} under ${parentKey}?\n\n${summaries}\n\nThis action writes to Jira and cannot be undone here.`,
      );
      if (!confirmed) return;

      this.setBusy(true, "Creating tickets…");
      const result = await this.service.createSubtasks({
        ...this.connection(),
        parentKey,
        tickets,
      });
      const baseUrl = this.connection().baseUrl;
      this.elements.createStatus.innerHTML = (result.issues || [])
        .map(
          (issue) =>
            `<a href="${this.escapeHtml(baseUrl)}/browse/${this.escapeHtml(issue.key)}" target="_blank" rel="noreferrer">${this.escapeHtml(issue.key)}</a>`,
        )
        .join(" · ");
      this.showSuccess(`Created ${result.issues.length} Jira ticket${result.issues.length === 1 ? "" : "s"}.`);
    } catch (error) {
      this.showInlineError(String(error || "Jira ticket creation failed."));
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(busy, label = "") {
    this.busy = busy;
    [this.elements.discover, this.elements.resolveParent, this.elements.create].forEach((button) => {
      if (button) button.disabled = busy;
    });
    if (this.elements.projectStatus && busy && label) this.elements.projectStatus.textContent = label;
    if (!busy) this.updateWorkspaceVisibility();
  }

  showInlineError(message) {
    this.elements.error.hidden = false;
    this.elements.error.textContent = message.replace(/^Error:\s*/, "");
    this.elements.error.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  clearError() {
    this.elements.error.hidden = true;
    this.elements.error.textContent = "";
  }

  renderDiscovery(result) {
    this.elements.resultTime.textContent = `Fetched ${new Date().toLocaleString()}`;
    this.elements.summary.innerHTML = [
      ["Server", result.server?.server_title || "Jira"],
      ["Version", result.server?.version || "Unknown"],
      ["Authenticated as", result.user?.display_name || result.user?.username || "Unknown"],
      ["Project", result.project_name ? `${result.project_name} · ${result.project_key}` : result.project_key || "Unknown"],
    ]
      .map(
        ([label, value]) =>
          `<article class="ttc-summary-card"><span>${this.escapeHtml(label)}</span><strong>${this.escapeHtml(value)}</strong></article>`,
      )
      .join("");
    this.elements.issueTypes.innerHTML = (result.issue_types || []).map((issueType) => this.renderIssueType(issueType)).join("");
  }

  renderIssueType(issueType) {
    const required = (issueType.fields || []).filter((field) => field.required).length;
    return `
      <article class="ttc-issue-type-card">
        <header>
          <div><span class="ttc-type-id">Issue type ${this.escapeHtml(issueType.id)}</span><h3>${this.escapeHtml(issueType.name)}</h3></div>
          <div class="ttc-field-counts"><span>${required} required</span><span>${issueType.fields?.length || 0} total fields</span></div>
        </header>
        <div class="ttc-table-wrap"><table>
          <thead><tr><th>Field</th><th>ID</th><th>Type</th><th>Required</th><th>Allowed/default</th></tr></thead>
          <tbody>${(issueType.fields || []).map((field) => this.renderFieldRow(field)).join("")}</tbody>
        </table></div>
      </article>`;
  }

  renderFieldRow(field) {
    const allowed = (field.allowed_values || []).slice(0, 4).map(formatFieldValue).filter(Boolean);
    const detail = allowed.length
      ? `${allowed.join(", ")}${field.allowed_values.length > allowed.length ? ` +${field.allowed_values.length - allowed.length}` : ""}`
      : field.has_default_value
        ? `Default: ${formatFieldValue(field.default_value)}`
        : "—";
    return `<tr class="${field.required ? "is-required" : ""}">
      <td><strong>${this.escapeHtml(field.name)}</strong></td><td><code>${this.escapeHtml(field.id)}</code></td>
      <td>${this.escapeHtml(field.schema_items ? `${field.schema_type}<${field.schema_items}>` : field.schema_type)}</td>
      <td>${field.required ? '<span class="ttc-required">Required</span>' : "Optional"}</td><td>${this.escapeHtml(detail)}</td>
    </tr>`;
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}
