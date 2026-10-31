import { listSharedProjects, publishProjectName, useSharedProject } from "../../core/ProjectDirectory.js";
import { createProject, getActiveProject, listProjects, renameProject } from "../../core/Projects.js";

export function renderProjectManager({ eventBus, refresh }) {
  const wrapper = document.createElement("div");
  wrapper.className = "setting-item project-manager";
  wrapper.dataset.setting = "config.projects";
  wrapper.dataset.searchText = "Project department name save create rename publish shared choose directory";
  wrapper.innerHTML = `
    <form class="project-name-form project-controls">
      <select class="setting-input project-settings-select" aria-label="Choose project"></select>
      <input class="setting-input project-name-input" aria-label="Project name" placeholder="Project name"
        required maxlength="80" autocomplete="off" />
      <button type="submit" class="btn btn-primary btn-sm project-name-save">Save name</button>
    </form>
    <div class="project-directory-feedback">
      <div class="project-directory-status" role="status" aria-live="polite"></div>
      <button type="button" class="btn btn-secondary btn-sm project-directory-retry" hidden>Retry</button>
    </div>
    <div class="project-status" role="status" aria-live="polite"></div>`;
  const select = wrapper.querySelector("select");
  const form = wrapper.querySelector("form");
  const input = wrapper.querySelector("input");
  const status = wrapper.querySelector(".project-status");
  const directoryStatus = wrapper.querySelector(".project-directory-status");
  const retryButton = wrapper.querySelector(".project-directory-retry");
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
    select.value = creating ? "__new__" : active.id;
  };
  const setBusy = (value) => {
    busy = value;
    select.disabled = value;
    input.disabled = value;
    saveButton.disabled = value;
  };
  const loadDirectory = async () => {
    retryButton.hidden = true;
    directoryStatus.textContent = "";
    try {
      sharedProjects = await listSharedProjects();
      fillOptions();
    } catch (error) {
      directoryStatus.textContent = error.message;
      retryButton.hidden = false;
    }
  };
  input.value = active.name;
  fillOptions();
  retryButton.addEventListener("click", loadDirectory);
  void loadDirectory();
  select.addEventListener("change", async () => {
    if (busy) return;
    status.textContent = "";
    savedProject = null;
    creating = select.value === "__new__";
    if (creating) {
      input.value = "";
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
      status.textContent = error.message;
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
      status.textContent = "That project name is already saved. Choose it from the project list.";
      input.focus();
      return;
    }
    setBusy(true);
    saveButton.textContent = "Saving…";
    try {
      // Persist locally first so a connection failure cannot discard a name or project data.
      const project = creating && !savedProject ? createProject(name) : renameProject((savedProject || active).id, name);
      savedProject = project;
      // Keep the saved project selected for a publication retry without creating it again.
      try {
        await publishProjectName(project.name);
      } catch (error) {
        status.textContent = `Name saved on this device. Could not publish: ${error.message} Select Save name to retry.`;
        fillOptions();
        window.dispatchEvent(new Event("adtools:projects-updated"));
        return;
      }
      creating = false;
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
      status.textContent = error.message;
    } finally {
      setBusy(false);
      saveButton.textContent = "Save name";
    }
  });
  return wrapper;
}

export function renderProjectSchemaLink({ router } = {}) {
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
  button.addEventListener("click", () => router?.navigate("quick-query", { manageSchemas: true }));
  row.append(label, button);
  return row;
}
