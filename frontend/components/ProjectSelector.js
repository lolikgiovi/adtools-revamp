import { listSharedProjects, useSharedProject } from "../core/ProjectDirectory.js";
import { getActiveProject, listProjects } from "../core/Projects.js";

/** Global project scope belongs to the sidebar, independent of navigation. */
export class ProjectSelector {
  constructor({ eventBus, router, onProjectChange }) {
    this.router = router;
    this.eventBus = eventBus;
    this.onProjectChange = onProjectChange;
    this.render = this.render.bind(this);
    window.addEventListener("adtools:projects-updated", this.render);
    eventBus?.on?.("user:registered", this.render);
    this.sharedProjects = [];
    this.render();
    this.refreshDirectory = () =>
      void listSharedProjects()
        .then((projects) => {
          this.sharedProjects = projects;
          this.render();
        })
        .catch(() => {});
    window.addEventListener("adtools:project-directory-updated", this.refreshDirectory);
    window.addEventListener("online", this.refreshDirectory);
    eventBus?.on?.("user:registered", this.refreshDirectory);
    this.refreshDirectory();
  }

  updatePlacement() {
    const host = document.querySelector(".sidebar-header");
    if (host && this.element && this.element.parentElement !== host) host.append(this.element);
  }

  render() {
    const sidebar = document.querySelector(".sidebar-header");
    if (!sidebar) return;
    this.element?.remove();
    const wrapper = document.createElement("div");
    wrapper.className = "sidebar-project";
    const select = document.createElement("select");
    select.className = "sidebar-project-select";
    select.setAttribute("aria-label", "Project");
    const active = getActiveProject();
    select.title = active.name;
    const group = document.createElement("optgroup");
    group.label = active.department === "UNASSIGNED" ? "Projects" : active.department;
    for (const project of listProjects()) group.append(new Option(project.name, project.id, false, project.id === active.id));
    select.append(group);
    const shared = document.createElement("optgroup");
    shared.label = "Shared projects";
    const localNames = new Set(listProjects().map((project) => project.name.normalize("NFKC").toLowerCase()));
    for (const project of this.sharedProjects) {
      if (!localNames.has(project.name.normalize("NFKC").toLowerCase())) {
        shared.append(new Option(project.name, `shared:${project.id}`));
      }
    }
    if (shared.children.length) select.append(shared);
    select.append(new Option("Create or manage projects…", "__manage__"));
    select.addEventListener("change", async () => {
      if (select.value === "__manage__") {
        select.value = active.id;
        localStorage.setItem("settings.focus", "config.projects");
        this.router?.navigate("settings", { setting: "config.projects" });
        return;
      }
      select.disabled = true;
      try {
        const sharedProject = this.sharedProjects.find((project) => `shared:${project.id}` === select.value);
        const id = sharedProject ? useSharedProject(sharedProject).id : select.value;
        const changed = await this.onProjectChange?.(id);
        if (!changed) {
          select.value = active.id;
          if (sharedProject) window.dispatchEvent(new Event("adtools:projects-updated"));
        }
      } catch (error) {
        select.value = active.id;
        this.eventBus?.emit?.("notification:error", { message: error.message });
      } finally {
        select.disabled = false;
      }
    });
    wrapper.append(select);
    wrapper.insertAdjacentHTML(
      "beforeend",
      `
      <svg class="sidebar-project-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m12 3 10 5-10 5L2 8Z" />
        <path d="m2 12 10 5 10-5M2 16l10 5 10-5" />
      </svg>
    `,
    );
    this.element = wrapper;
    this.updatePlacement();
  }
}
