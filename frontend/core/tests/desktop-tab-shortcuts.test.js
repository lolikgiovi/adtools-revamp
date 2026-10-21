// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";

vi.mock("../Runtime.js", () => ({ isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { isTauri } from "../Runtime.js";
import { listen } from "@tauri-apps/api/event";

// Failure cases: browser shortcuts intercepted, stale/hidden tool closed, repeated
// commands change multiple tabs during a save, rejected saves escape, listener leaks.
afterEach(() => vi.resetAllMocks());

function createApp() {
  return Object.assign(Object.create(App.prototype), {
    currentTool: {
      closeActiveTab: vi.fn().mockResolvedValue(undefined),
      createNewTab: vi.fn().mockResolvedValue(undefined),
    },
    showNotification: vi.fn(),
  });
}

describe("desktop Close Tab command", () => {
  it("routes New Tab to the visible tool without closing an existing tab", async () => {
    isTauri.mockReturnValue(true);
    listen.mockResolvedValue(vi.fn());
    const app = createApp();
    await app.setupDesktopTabShortcuts();
    const command = listen.mock.calls.find(([event]) => event === "new-tab")?.[1];
    expect(command).toEqual(expect.any(Function));
    const first = app.currentTool;
    await command();
    expect(first.createNewTab).toHaveBeenCalledOnce();
    expect(first.closeActiveTab).not.toHaveBeenCalled();
    app.currentTool = { createNewTab: vi.fn() };
    await command();
    expect(app.currentTool.createNewTab).toHaveBeenCalledOnce();
    expect(first.createNewTab).toHaveBeenCalledOnce();
    app.currentTool = null;
    await expect(command()).resolves.toBeUndefined();
    app.currentTool = {};
    await expect(command()).resolves.toBeUndefined();
  });

  it("ignores new and close commands while creating a tab", async () => {
    const app = createApp();
    let finish;
    app.currentTool.createNewTab.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = app.createNewToolTab();
    await app.createNewToolTab();
    await app.closeActiveToolTab();
    expect(app.currentTool.createNewTab).toHaveBeenCalledOnce();
    expect(app.currentTool.closeActiveTab).not.toHaveBeenCalled();
    finish();
    await pending;
    await app.closeActiveToolTab();
    expect(app.currentTool.closeActiveTab).toHaveBeenCalledOnce();
  });

  it("reports a failed new tab and permits retry", async () => {
    const app = createApp();
    app.currentTool.createNewTab.mockRejectedValueOnce(new Error("Storage unavailable"));
    await app.createNewToolTab();
    expect(app.showNotification).toHaveBeenCalledWith("Could not create a new tab. Please try again.", "error");
    await app.createNewToolTab();
    expect(app.currentTool.createNewTab).toHaveBeenCalledTimes(2);
  });

  it("does not register a native listener in a browser", async () => {
    isTauri.mockReturnValue(false);
    await createApp().setupDesktopTabShortcuts();
    expect(listen).not.toHaveBeenCalled();
  });

  it("routes each native command to the currently visible tool", async () => {
    isTauri.mockReturnValue(true);
    listen.mockResolvedValue(vi.fn());
    const app = createApp();
    const first = app.currentTool;
    await app.setupDesktopTabShortcuts();
    expect(listen).toHaveBeenCalledWith("close-active-tab", expect.any(Function));
    const command = listen.mock.calls[0][1];
    await command();
    expect(first.closeActiveTab).toHaveBeenCalledOnce();
    app.currentTool = { closeActiveTab: vi.fn() };
    await command();
    expect(app.currentTool.closeActiveTab).toHaveBeenCalledOnce();
    expect(first.closeActiveTab).toHaveBeenCalledOnce();
    app.currentTool = null;
    await expect(command()).resolves.toBeUndefined();
    app.currentTool = {};
    await expect(command()).resolves.toBeUndefined();
  });

  it("ignores repeated commands while the tab is being saved and closed", async () => {
    const app = createApp();
    let finish;
    app.currentTool.closeActiveTab.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = app.closeActiveToolTab();
    await app.closeActiveToolTab();
    expect(app.currentTool.closeActiveTab).toHaveBeenCalledOnce();
    finish();
    await pending;
    await app.closeActiveToolTab();
    expect(app.currentTool.closeActiveTab).toHaveBeenCalledTimes(2);
  });

  it("reports a failed close and allows another attempt", async () => {
    const app = createApp();
    app.currentTool.closeActiveTab.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(app.closeActiveToolTab()).resolves.toBeUndefined();
    expect(app.showNotification).toHaveBeenCalledWith("Could not close the active tab. Please try again.", "error");
    await app.closeActiveToolTab();
    expect(app.currentTool.closeActiveTab).toHaveBeenCalledTimes(2);
  });

  it("removes a listener that finishes registering after App destruction", async () => {
    isTauri.mockReturnValue(true);
    let register;
    listen.mockReturnValue(
      new Promise((resolve) => {
        register = resolve;
      }),
    );
    const app = createApp();
    const pending = app.setupDesktopTabShortcuts();
    app._desktopTabShortcutsDisposed = true;
    const unlisten = vi.fn();
    register(unlisten);
    await pending;
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
