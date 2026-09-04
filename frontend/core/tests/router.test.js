// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { Router } from "../Router.js";

it("handles route data when navigating to the current route", () => {
  window.location.hash = "quick-query";
  const eventBus = { emit: vi.fn() };
  const router = new Router(eventBus);
  router.handleRouteChange = vi.fn();

  router.navigate("quick-query", { tableName: "CONFIG.APP_CONFIG" });

  expect(router.handleRouteChange).toHaveBeenCalledOnce();
  expect(eventBus.emit).toHaveBeenCalledWith("route:change", {
    path: "quick-query",
    data: { tableName: "CONFIG.APP_CONFIG" },
  });
});

it("assigns a new navigation identity to every route invocation", () => {
  window.location.hash = "home";
  const eventBus = { emit: vi.fn() };
  const router = new Router(eventBus);
  const contexts = [];
  router.register("home", (context) => contexts.push(context));

  router.handleRouteChange();
  router.handleRouteChange();

  expect(contexts.map(({ navigationId }) => navigationId)).toEqual([1, 2]);
  expect(router.getCurrentNavigationId()).toBe(2);
  expect(contexts[0]).toMatchObject({ path: "home", params: [], query: {} });
});
