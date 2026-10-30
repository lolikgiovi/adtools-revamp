import { createProject, getActiveProject, listProjects, renameProject } from "../../core/Projects.js";

export function renderProjectManager({ eventBus, refresh }) {
  const wrapper = document.createElement("div");
  wrapper.className = "setting-item project-manager";
  wrapper.dataset.setting = "config.projects";
  wrapper.dataset.searchText = "Project department add rename";
  wrapper.innerHTML = `
    <div class="project-controls">
      <select class="setting-input project-settings-select" aria-label="Project"></select>
      <button type="button" class="btn btn-secondary btn-sm project-add">Add project</button>
      <button type="button" class="btn btn-secondary btn-sm project-rename">Rename</button>
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

export function renderProjectSchemaLink() {
  const row = document.createElement("div");
  row.className = "setting-item project-schema";
  row.dataset.setting = "project.schema";
  row.dataset.searchText = "QQ Schema Quick Query";
  const link = document.createElement("a");
  link.className = "project-schema-link";
  link.href = "#quick-query";
  link.textContent = "QQ Schema";
  row.append(link);
  return row;
}
