// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { AboutPage } from "../../pages/about/main.js";
import { AnalyticsDashboardPage } from "../../pages/analytics-dashboard/main.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("shell page lifecycle", () => {
  it("disposes the App-owned shell page once", () => {
    const page = { deactivate: vi.fn(), unmount: vi.fn() };
    const app = Object.assign(Object.create(App.prototype), { currentShellPage: page });

    app.clearCurrentShellPage();
    app.clearCurrentShellPage();

    expect(page.deactivate).toHaveBeenCalledOnce();
    expect(page.unmount).toHaveBeenCalledOnce();
    expect(app.currentShellPage).toBeNull();
  });

  it("mounts About with the macOS install tutorial and tolerates repeated unmounts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const eventBus = { emit: vi.fn() };
    const page = new AboutPage({ eventBus });
    const root = document.createElement("div");
    page.mount(root);

    expect(root.classList.contains("main-content-flush")).toBe(true);
    expect(root.querySelector(".about-page")).not.toBeNull();
    expect(root.querySelector("#about-install-title")?.textContent).toBe("Install the desktop app");

    root.querySelector("#about-copy-install-command").click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('curl -fsSL "https://adtools.lolik.workers.dev/install.sh?q=0" | bash');
    });
    expect(eventBus.emit).toHaveBeenCalledWith("notification:show", {
      type: "success",
      message: "Install command copied to clipboard",
    });

    page.unmount();
    page.unmount();

    expect(root.classList.contains("main-content-flush")).toBe(false);
    expect(page.container).toBeNull();
  });

  it("keeps active Analytics Escape behavior and removes it on unmount", () => {
    const page = new AnalyticsDashboardPage();
    const root = document.createElement("div");
    page.mount(root);
    const listener = page.documentKeydownListener;
    const closeRowDetail = vi.spyOn(page, "closeRowDetail").mockImplementation(() => {});

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(closeRowDetail).toHaveBeenCalledOnce();

    page.unmount();
    page.unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(listener).toEqual(expect.any(Function));
    expect(page.documentKeydownListener).toBeNull();
    expect(closeRowDetail).toHaveBeenCalledOnce();
  });
});
