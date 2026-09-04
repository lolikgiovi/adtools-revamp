// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createAppHarness() {
  let navigationId = 1;
  let route = "tool-a";
  const eventBus = { emit: vi.fn() };
  const app = Object.assign(Object.create(App.prototype), {
    router: {
      defaultRoute: "home",
      getCurrentNavigationId: () => navigationId,
      getCurrentRoute: () => route,
    },
    eventBus,
    currentTool: null,
    currentShellPage: null,
    mainContent: document.createElement("main"),
    warmHeavyTools: new Map(),
    toolDomRoots: new Map(),
    pageComponents: new Map(),
  });
  window.location.hash = route;

  app.setNavigation = (nextRoute, nextNavigationId) => {
    route = nextRoute;
    navigationId = nextNavigationId;
    window.location.hash = nextRoute;
  };
  app.getToolDefinition = (id) => ({ id, name: id, requiresTauri: false });
  app.clearCurrentShellPage = vi.fn();
  app.clearCurrentTool = vi.fn();
  app.setMainContentFlush = vi.fn();
  app.renderLoadingState = vi.fn();
  app.cancelWarmToolDisposal = vi.fn();
  app.clearAssetRecoveryState = vi.fn();
  app.updateBreadcrumb = vi.fn();
  app.ensureToolRoot = (id) => {
    const root = document.createElement("div");
    root.dataset.tool = id;
    app.toolDomRoots.set(id, root);
    return root;
  };
  app.loadPageComponent = async (pageId, loader) => {
    if (!app.pageComponents.has(pageId)) app.pageComponents.set(pageId, await loader());
    return app.pageComponents.get(pageId);
  };
  return { app, eventBus };
}

function createTool(id) {
  return {
    id,
    container: null,
    isActive: false,
    mount: vi.fn(function mount(root) {
      this.container = root;
    }),
    activate: vi.fn(function activate() {
      this.isActive = true;
    }),
    onWarmResume: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("App navigation race guards", () => {
  it("allows only the latest tool navigation to mount and emit", async () => {
    localStorage.setItem("user.registered", "true");
    const { app, eventBus } = createAppHarness();
    const loadA = deferred();
    const loadB = deferred();
    const toolA = createTool("tool-a");
    const toolB = createTool("tool-b");
    app.ensureToolLoaded = vi.fn((id) => (id === "tool-a" ? loadA.promise : loadB.promise));

    const firstNavigation = app.showTool("tool-a", null, 1);
    app.setNavigation("tool-b", 2);
    const secondNavigation = app.showTool("tool-b", null, 2);

    loadB.resolve(toolB);
    await secondNavigation;
    loadA.resolve(toolA);
    await firstNavigation;

    expect(toolA.mount).not.toHaveBeenCalled();
    expect(toolA.activate).not.toHaveBeenCalled();
    expect(toolB.mount).toHaveBeenCalledOnce();
    expect(toolB.activate).toHaveBeenCalledOnce();
    expect(app.currentTool).toBe(toolB);
    expect(eventBus.emit).toHaveBeenCalledWith("page:changed", { page: "tool", toolId: "tool-b", title: "tool-b" });
    expect(eventBus.emit.mock.calls.filter(([event]) => event === "page:changed")).toHaveLength(1);
  });

  it("cleans up a shell page that becomes stale while mounting", async () => {
    const { app, eventBus } = createAppHarness();
    app.setNavigation("page-a", 1);
    const pageAReady = deferred();
    const pageBReady = deferred();
    const pageAMountStarted = deferred();
    const pageAMountRelease = deferred();
    const pageA = {
      mount: vi.fn(() => {
        pageAMountStarted.resolve();
        return pageAMountRelease.promise;
      }),
      deactivate: vi.fn(),
      unmount: vi.fn(),
    };
    const pageB = { mount: vi.fn() };
    class PageA {
      constructor() {
        return pageA;
      }
    }
    class PageB {
      constructor() {
        return pageB;
      }
    }

    const firstNavigation = app.showShellPage({
      pageId: "page-a",
      title: "Page A",
      eventName: "page-a",
      navigationId: 1,
      loader: () => pageAReady.promise,
    });
    pageAReady.resolve(PageA);
    await pageAMountStarted.promise;
    app.setNavigation("page-b", 2);
    const secondNavigation = app.showShellPage({
      pageId: "page-b",
      title: "Page B",
      eventName: "page-b",
      navigationId: 2,
      loader: () => pageBReady.promise,
    });

    pageBReady.resolve(PageB);
    await secondNavigation;
    pageAMountRelease.resolve();
    await firstNavigation;

    expect(pageB.mount).toHaveBeenCalledOnce();
    expect(pageA.deactivate).toHaveBeenCalledOnce();
    expect(pageA.unmount).toHaveBeenCalledOnce();
    expect(eventBus.emit).toHaveBeenCalledWith("page:changed", { page: "page-b", title: "Page B" });
    expect(eventBus.emit.mock.calls.filter(([event]) => event === "page:changed")).toHaveLength(1);
  });
});
