// @vitest-environment jsdom
// Failure cases: switching before draft persistence, save failure, background jobs, and concurrent switches.
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createProject, getActiveProject } from "../Projects.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
function harness(ui = null) {
  return Object.assign(Object.create(App.prototype), {
    tools: new Map(ui ? [["quick-query", { ui }]] : []),
    currentTool: null,
    eventBus: { emit: vi.fn() },
    reloadForProjectChange: vi.fn(),
  });
}
it("flushes drafts before changing identity and reloading", async () => {
  const first = getActiveProject();
  const next = createProject("Second");
  const ui = {
    ready: Promise.resolve(),
    flushPendingDataAutosave: vi.fn(async () => {
      expect(getActiveProject().id).toBe(first.id);
    }),
    saveActiveTabDraft: vi.fn(async () => true),
  };
  const app = harness(ui);
  expect(await app.switchProject(next.id)).toBe(true);
  expect(ui.saveActiveTabDraft).toHaveBeenCalledOnce();
  expect(app.reloadForProjectChange).toHaveBeenCalledOnce();
  expect(getActiveProject().id).toBe(next.id);
});
it("keeps the current project on save failure", async () => {
  const first = getActiveProject();
  const next = createProject("Second");
  const app = harness({ ready: Promise.resolve(), flushPendingDataAutosave: async () => {}, saveActiveTabDraft: async () => false });
  expect(await app.switchProject(next.id)).toBe(false);
  expect(getActiveProject().id).toBe(first.id);
  expect(app.reloadForProjectChange).not.toHaveBeenCalled();
});
it("blocks switching during background work", async () => {
  const first = getActiveProject();
  const next = createProject("Second");
  const app = harness();
  app.tools.set("run-batch", { hasActiveBackgroundWork: () => true });
  expect(await app.switchProject(next.id)).toBe(false);
  expect(getActiveProject().id).toBe(first.id);
});

it("keeps QQ work in its current project while generation is running", async () => {
  const first = getActiveProject();
  const next = createProject("Second");
  const app = harness({ ready: Promise.resolve(), isGenerating: true });
  expect(await app.switchProject(next.id)).toBe(false);
  expect(getActiveProject().id).toBe(first.id);
  expect(app.reloadForProjectChange).not.toHaveBeenCalled();
});
