import { listSharedProjects, publishProjectName, useSharedProject } from "../../core/ProjectDirectory.js";
import { createProject, getActiveProject, listProjects, renameProject } from "../../core/Projects.js";

export function renderProjectManager({ eventBus, refresh }) {
  const wrapper = document.createElement("div");
  wrapper.className = "setting-item project-manager";
  wrapper.dataset.setting = "config.projects";
  wrapper.dataset.searchText = "Project department add create rename publish shared choose directory";
  wrapper.innerHTML = `
    <p class="project-scope-intro">Projects keep testing environments, Quick Query schemas, and query tabs together. Switch projects from the header.</p>
    <div class="project-controls">
      <select class="setting-input project-settings-select" aria-label="Project"></select>
      <button type="button" class="btn btn-secondary btn-sm project-add">Add project</button>
      <button type="button" class="btn btn-secondary btn-sm project-rename">Rename</button>
      <button type="button" class="btn btn-secondary btn-sm project-publish">Publish name</button>
    </div>
    <div class="project-directory">
      <label for="shared-project-select">Shared projects</label>
      <div class="project-directory-controls">
        <select id="shared-project-select" class="setting-input project-directory-select" aria-label="Shared projects" disabled>
          <option value="">Loading shared projects…</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm project-use-shared" disabled>Use project</button>
        <button type="button" class="btn btn-secondary btn-sm project-directory-retry" hidden>Retry</button>
      </div>
      <p class="project-sharing-note">Only names are shared. Environments, schemas, and query tabs stay on your device.</p>
      <div class="project-directory-status" role="status" aria-live="polite"></div>
    </div>
    <form class="project-name-form" hidden>
      <label for="project-name">Project name</label>
      <input id="project-name" class="setting-input project-name-input" required maxlength="80" autocomplete="off" />
      <div class="project-form-actions">
        <button type="button" class="btn btn-secondary btn-sm project-name-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm project-name-save">Save project</button>
      </div>
    </form>
    <div class="project-status" role="status" aria-live="polite"></div>`;
  const select = wrapper.querySelector("select");
  const form = wrapper.querySelector("form");
  const input = wrapper.querySelector("input");
  const status = wrapper.querySelector(".project-status");
  const active = getActiveProject();
  let editing = false;
  for (const project of listProjects()) select.add(new Option(project.name, project.id, false, project.id === active.id));
  select.addEventListener("change", async () => {
    select.disabled = true;
    const changed = await globalThis.app?.switchProject(select.value);
    if (!changed) {
      select.value = active.id;
      select.disabled = false;
    }
  });
  const directory = wrapper.querySelector(".project-directory-select");
  const directoryStatus = wrapper.querySelector(".project-directory-status");
  const useButton = wrapper.querySelector(".project-use-shared");
  const retryButton = wrapper.querySelector(".project-directory-retry");
  let sharedProjects = [];
  const loadDirectory = async () => {
    retryButton.hidden = true;
    directoryStatus.textContent = "";
    try {
      sharedProjects = await listSharedProjects();
      directory.replaceChildren(new Option(sharedProjects.length ? "Choose a project…" : "No shared projects yet", ""));
      for (const project of sharedProjects) directory.add(new Option(project.name, project.id));
      directory.disabled = !sharedProjects.length;
    } catch (error) {
      directory.replaceChildren(new Option("Shared projects unavailable", ""));
      directory.disabled = true;
      directoryStatus.textContent = error.message;
      retryButton.hidden = false;
    }
    useButton.disabled = true;
  };
  retryButton.addEventListener("click", loadDirectory);
  directory.addEventListener("change", () => {
    useButton.disabled = !directory.value;
  });
  useButton.addEventListener("click", async () => {
    useButton.disabled = true;
    try {
      const project = useSharedProject(sharedProjects.find((item) => item.id === directory.value));
      if (project.id === active.id) directoryStatus.textContent = "You’re already using this project.";
      else if (!(await globalThis.app?.switchProject(project.id))) {
        eventBus?.emit?.("notification:info", { message: "Project added. Switch to it when your current work is saved." });
        window.dispatchEvent(new Event("adtools:projects-updated"));
        refresh();
      }
    } catch (error) {
      directoryStatus.textContent = error.message;
    } finally {
      useButton.disabled = !directory.value;
    }
  });
  wrapper.querySelector(".project-publish").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await publishProjectName(active.name);
      await loadDirectory();
      directoryStatus.textContent = `“${active.name}” is available for everyone to choose.`;
    } catch (error) {
      directoryStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  void loadDirectory();
  const open = (rename) => {
    editing = rename;
    form.hidden = false;
    input.value = rename ? active.name : "";
    status.textContent = "";
    input.focus();
  };
  wrapper.querySelector(".project-add").addEventListener("click", () => open(false));
  wrapper.querySelector(".project-rename").addEventListener("click", () => open(true));
  wrapper.querySelector(".project-name-cancel").addEventListener("click", () => {
    form.hidden = true;
    wrapper.querySelector(editing ? ".project-rename" : ".project-add").focus();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      if (editing) {
        renameProject(active.id, input.value);
        refresh();
        return;
      }
      const project = createProject(input.value);
      if (!(await globalThis.app?.switchProject(project.id))) {
        refresh();
        eventBus?.emit?.("notification:info", { message: "Project created. Select it when your current work is saved." });
      }
    } catch (error) {
      status.textContent = error.message;
      input.focus();
    } finally {
      button.disabled = false;
    }
  });
  return wrapper;
}

export function renderProjectSchemaLink({ router } = {}) {
  const row = document.createElement("div");
  row.className = "setting-item project-schema";
  row.dataset.setting = "project.schema";
  row.dataset.searchText = "QQ Schema Quick Query saved schemas query tabs";
  const label = document.createElement("span");
  label.className = "project-schema-label";
  label.textContent = "Quick Query schemas";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-secondary btn-sm project-schema-manage";
  button.textContent = "Manage schemas";
  button.addEventListener("click", () => router?.navigate("quick-query", { manageSchemas: true }));
  row.append(label, button);
  return row;
}
