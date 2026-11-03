import { trackWorkflowEvent } from "../../core/WorkflowAnalytics.js";
import { mountSchemaManager } from "../../components/SchemaManager.js";
import { mountEditDialog } from "./edit-dialog.js";
import { listSharedProjects, publishProjectName, useSharedProject } from "../../core/ProjectDirectory.js";
import { createProject, getActiveProject, listProjects, renameProject } from "../../core/Projects.js";

export function renderProjectManager({ eventBus, refresh, registerDispose }) {
  const wrapper = document.createElement("div");
  wrapper.className = "setting-item project-manager";
  wrapper.dataset.setting = "config.projects";
  wrapper.dataset.searchText = "Project department name save create rename publish shared choose directory";
  wrapper.innerHTML = `
    <div class="project-controls">
      <select class="setting-input project-settings-select" aria-label="Choose project"></select>
    </div>
    <form class="project-name-form" hidden>
      <label class="integration-field">
        <span>Project name</span>
      <input class="setting-input project-name-input" aria-label="Project name" placeholder="Project name"
        required maxlength="80" autocomplete="off" />
      </label>
      <div class="project-status" role="status" aria-live="polite"></div>
      <div class="setting-actions">
        <button type="button" class="btn btn-secondary btn-sm project-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm project-name-save">Create project</button>
      </div>
    </form>`;
  const select = wrapper.querySelector("select");
  const form = wrapper.querySelector("form");
  const input = wrapper.querySelector("input");
  const status = wrapper.querySelector(".project-status");
  const saveButton = wrapper.querySelector(".project-name-save");
  let active = getActiveProject();
  let sharedProjects = [];
  let creating = false;
  let savedProject = null;
  let busy = false;
  const normalized = (name) => name.normalize("NFKC").trim().toLowerCase();
  const fillOptions = () => {
    const locals = listProjects();
    const names = new Set(locals.map((project) => normalized(project.name)));
    select.replaceChildren();
    for (const project of locals) select.add(new Option(project.name, project.id));
    for (const project of sharedProjects) {
      if (!names.has(normalized(project.name))) {
        select.add(new Option(project.name, `shared:${project.id}`));
        names.add(normalized(project.name));
      }
    }
    select.add(new Option("New project…", "__new__"));
    select.add(new Option("Rename project…", "__rename__"));
    select.value = active.id;
  };
  const setBusy = (value) => {
    busy = value;
    select.disabled = value;
    input.disabled = value;
    saveButton.disabled = value;
  };
  const closeEditor = () => {
    if (busy) return;
    modal.close();
    form.hidden = true;
    creating = false;
    savedProject = null;
    fillOptions();
  };
  const modal = mountEditDialog({
    root: wrapper,
    form,
    onCancel: closeEditor,
    isBusy: () => busy,
    fallbackFocus: () => wrapper.querySelector(".ad-searchable-dropdown-trigger") || select,
  });
  registerDispose?.(() => modal.dispose());
  wrapper.querySelector(".project-cancel").addEventListener("click", closeEditor);
  const loadDirectory = async () => {
    try {
      sharedProjects = await listSharedProjects();
      fillOptions();
    } catch {
      // Shared names are optional; keep the local project picker available offline.
    }
  };
  input.value = active.name;
  fillOptions();
  void loadDirectory();
  select.addEventListener("change", async () => {
    if (busy) return;
    status.textContent = "";
    savedProject = null;
    creating = select.value === "__new__";
    if (creating || select.value === "__rename__") {
      trackWorkflowEvent("settings", `project_${creating ? "create" : "rename"}_open`);
      input.value = creating ? "" : active.name;
      saveButton.textContent = creating ? "Create project" : "Save name";
      form.hidden = false;
      fillOptions();
      modal.open(creating ? "New project" : "Rename project");
      input.focus();
      return;
    }
    setBusy(true);
    try {
      const shared = sharedProjects.find((project) => `shared:${project.id}` === select.value);
      const project = shared ? useSharedProject(shared) : listProjects().find((project) => project.id === select.value);
      if (project.id !== active.id && !(await globalThis.app?.switchProject(project.id))) {
        eventBus?.emit?.("notification:info", { message: "Project added. Switch to it when your current work is saved." });
      }
      input.value = active.name;
      fillOptions();
      if (shared) window.dispatchEvent(new Event("adtools:projects-updated"));
    } catch (error) {
      eventBus?.emit?.("notification:error", { message: error.message });
      fillOptions();
    } finally {
      setBusy(false);
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const name = input.value.trim();
    status.textContent = "";
    status.dataset.state = "error";
    if (!name || name.length > 80) {
      trackWorkflowEvent("settings", `project_${creating ? "create" : "rename"}_result`, { outcome: "blocked", reason: "invalid_name" });
      status.textContent = "Enter a project name between 1 and 80 characters.";
      input.focus();
      return;
    }
    if (
      listProjects().some(
        (project) =>
          ((creating && !savedProject) || project.id !== (savedProject || active).id) && normalized(project.name) === normalized(name),
      )
    ) {
      trackWorkflowEvent("settings", `project_${creating ? "create" : "rename"}_result`, { outcome: "blocked", reason: "duplicate_name" });
      status.textContent = "That project name is already saved. Choose it from the project list.";
      input.focus();
      return;
    }
    setBusy(true);
    saveButton.textContent = "Saving…";
    try {
      // Persist locally first so a connection failure cannot discard a name or project data.
      const isNew = creating && !savedProject;
      const previousName = (savedProject || active).name;
      const project = isNew ? createProject(name) : renameProject((savedProject || active).id, name);
      savedProject = project;
      if (isNew || project.name !== previousName) {
        trackWorkflowEvent("settings", `project_${isNew ? "create" : "rename"}_result`, { outcome: "success" });
      }
      // Keep the saved project selected for a publication retry without creating it again.
      try {
        await publishProjectName(project.name);
        trackWorkflowEvent("settings", "project_publish_result", { outcome: "success" });
      } catch (error) {
        trackWorkflowEvent("settings", "project_publish_result", { outcome: "failure" });
        status.textContent = `Name saved on this device. Could not publish: ${error.message} Try saving again to publish it.`;
        fillOptions();
        window.dispatchEvent(new Event("adtools:projects-updated"));
        return;
      }
      creating = false;
      modal.close();
      form.hidden = true;
      if (project.id !== active.id) {
        if (await globalThis.app?.switchProject(project.id)) return;
        window.dispatchEvent(new Event("adtools:projects-updated"));
        refresh();
        eventBus?.emit?.("notification:info", { message: "Project saved. Select it when your current work is saved." });
        return;
      }
      active = project;
      input.value = project.name;
      fillOptions();
      status.dataset.state = "success";
      status.textContent = "Name saved and published.";
      await loadDirectory();
    } catch (error) {
      trackWorkflowEvent("settings", `project_${creating ? "create" : "rename"}_result`, { outcome: "failure" });
      status.textContent = error.message;
    } finally {
      setBusy(false);
      saveButton.textContent = creating ? "Create project" : "Save name";
    }
  });
  return wrapper;
}

export function renderProjectSchemaLink({ registerDispose } = {}) {
  const row = document.createElement("div");
  row.className = "setting-item project-schema";
  row.dataset.setting = "project.schema";
  row.dataset.searchText = "QQ Schema Quick Query saved schemas query tabs";
  const label = document.createElement("h4");
  label.className = "project-section-heading";
  label.textContent = "Quick Query schemas";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-secondary btn-sm project-schema-manage";
  button.textContent = "Manage schemas";
  const manager = mountSchemaManager({ root: row });
  registerDispose?.(() => manager.dispose());
  button.addEventListener("click", () => void manager.open());
  row.append(label, button);
  return row;
}
