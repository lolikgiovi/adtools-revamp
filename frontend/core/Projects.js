/** Project identity is shared by tools; active selection is pinned per browser tab. */
const REGISTRY_KEY = "config.projects";
const ACTIVE_KEY = "config.project.active";
const SCOPED_KEYS = new Set(["config.environments", "config.baseUrls"]);

function department(target) {
  return target.getItem("user.department")?.trim() || "UNASSIGNED";
}

function registry(target = localStorage) {
  const raw = target.getItem(REGISTRY_KEY);
  let state;
  if (raw) {
    state = JSON.parse(raw);
    if (state.version !== 1 || !Array.isArray(state.projects) || !state.projects.length) {
      throw new Error("Project configuration is invalid. Restore your settings before continuing.");
    }
  } else {
    const initial = { id: crypto.randomUUID(), name: "Default project", department: department(target) };
    state = { version: 1, legacyProjectId: initial.id, projects: [initial] };
    target.setItem(REGISTRY_KEY, JSON.stringify(state));
  }
  // Registration can complete after the shell first renders.
  const initial = state.projects.find((project) => project.id === state.legacyProjectId);
  if (initial?.department === "UNASSIGNED" && department(target) !== "UNASSIGNED") {
    initial.department = department(target);
    target.setItem(REGISTRY_KEY, JSON.stringify(state));
  }
  return state;
}

function tabStorage(target) {
  return target === globalThis.localStorage ? globalThis.sessionStorage : target;
}

export function listProjects(target = localStorage) {
  return registry(target).projects.filter((project) => project.department === department(target));
}

export function getActiveProject(target = localStorage) {
  const state = registry(target);
  let projects = state.projects.filter((project) => project.department === department(target));
  if (!projects.length) {
    const project = createProject("Default project", target);
    projects = [project];
  }
  const activeId = tabStorage(target)?.getItem(ACTIVE_KEY) || target.getItem(ACTIVE_KEY);
  const active = projects.find((project) => project.id === activeId) || projects[0];
  tabStorage(target)?.setItem(ACTIVE_KEY, active.id);
  return active;
}

function validName(name, projects, exceptId) {
  const value = String(name ?? "").trim();
  if (!value || value.length > 80) throw new Error("Enter a project name between 1 and 80 characters.");
  if (projects.some((project) => project.id !== exceptId && project.name.toLowerCase() === value.toLowerCase())) {
    throw new Error("That project name is already in use in this department.");
  }
  return value;
}

export function createProject(name, target = localStorage) {
  const state = registry(target);
  const project = {
    id: crypto.randomUUID(),
    name: validName(
      name,
      state.projects.filter((item) => item.department === department(target)),
    ),
    department: department(target),
  };
  // Empty explicit settings prevent legacy auto-discovery from copying another project's connections.
  target.setItem(`project:${project.id}:config.environments`, "[]");
  state.projects.push(project);
  target.setItem(REGISTRY_KEY, JSON.stringify(state));
  return project;
}

export function renameProject(id, name, target = localStorage) {
  const state = registry(target);
  const project = state.projects.find((item) => item.id === id && item.department === department(target));
  if (!project) throw new Error("Project not found in your department.");
  project.name = validName(name, listProjects(target), id);
  target.setItem(REGISTRY_KEY, JSON.stringify(state));
  globalThis.dispatchEvent?.(new Event("adtools:projects-updated"));
  return project;
}

export function selectProject(id, target = localStorage) {
  if (!listProjects(target).some((project) => project.id === id)) throw new Error("Project not found in your department.");
  tabStorage(target)?.setItem(ACTIVE_KEY, id);
  target.setItem(ACTIVE_KEY, id);
}

export function getProjectStorageKey(key, target = localStorage, projectId = getActiveProject(target).id) {
  return projectId === registry(target).legacyProjectId ? key : `project:${projectId}:${key}`;
}

export function getLegacyProjectId(target = localStorage) {
  return registry(target).legacyProjectId;
}

export function getQuickQueryDatabaseName(target = localStorage) {
  const id = getActiveProject(target).id;
  return id === registry(target).legacyProjectId ? "QuickQueryDatabase" : `QuickQueryDatabase-project-${id}`;
}

/** Capture project identity once so asynchronous work cannot follow a later selection. */
export function projectEnvironmentStorage(target = localStorage, projectId = getActiveProject(target).id) {
  const keyFor = (key) => (SCOPED_KEYS.has(key) ? getProjectStorageKey(key, target, projectId) : key);
  return {
    getItem: (key) => target.getItem(keyFor(key)),
    setItem: (key, value) => target.setItem(keyFor(key), value),
  };
}

export function allProjectEnvironmentStores(target = localStorage) {
  return registry(target).projects.map((project) => projectEnvironmentStorage(target, project.id));
}
