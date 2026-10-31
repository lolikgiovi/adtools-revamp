import { publishedSettingsSync, SETTINGS_API_BASE } from "./PublishedSettings.js";
import { UsageTracker } from "./UsageTracker.js";
import { createProject, listProjects } from "./Projects.js";

const key = "settings.sync.credential";
function credential() {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value?.email?.toLowerCase() === localStorage.getItem("user.email")?.trim().toLowerCase() &&
      value.deviceId === UsageTracker.getDeviceId() &&
      value.expiresAt > Date.now()
      ? value.credential
      : null;
  } catch {
    return null;
  }
}

async function request(body, after = "", retry = true) {
  if (!credential()) await publishedSettingsSync.check();
  const token = credential();
  if (!token) throw new Error("Connect with your registered account to use shared projects.");
  const response = await fetch(`${SETTINGS_API_BASE}/api/settings/projects?after=${encodeURIComponent(after)}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401 && retry) {
    localStorage.removeItem(key);
    return request(body, after, false);
  }
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Could not load shared projects. Try again.");
  return data;
}

export async function listSharedProjects() {
  const projects = [];
  let after = "";
  do {
    const page = await request(undefined, after);
    if (!Array.isArray(page.projects)) throw new Error("Could not load shared projects. Try again.");
    projects.push(...page.projects);
    if (page.next && page.next === after) throw new Error("Could not load shared projects. Try again.");
    after = page.next || "";
  } while (after);
  return projects;
}

export async function publishProjectName(name) {
  const { project } = await request({ name });
  window.dispatchEvent(new Event("adtools:project-directory-updated"));
  return project;
}

/** Choosing a shared name never imports another user's tool data. */
export function useSharedProject(project) {
  const normalized = (name) => name.normalize("NFKC").trim().toLowerCase();
  return listProjects().find((local) => normalized(local.name) === normalized(project.name)) || createProject(project.name);
}
