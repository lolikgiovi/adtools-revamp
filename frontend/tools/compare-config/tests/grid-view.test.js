// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { GridView } from "../views/GridView.js";

const observerInstances = [];

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.disconnected = false;
    observerInstances.push(this);
  }

  observe(target) {
    this.target = target;
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    this.callback([{ isIntersecting: true, target: this.target }]);
  }
}

function makeComparison(index) {
  return {
    key: { id: `row-${index}` },
    env1_data: { value: `before-${index}` },
    env2_data: { value: `after-${index}` },
    differences: ["value"],
    status: "differ",
  };
}

function mountGrid(view, comparisons) {
  const root = document.createElement("div");
  root.innerHTML = view.render(comparisons, "env-a", "env-b", { compareFields: ["value"] });
  document.body.appendChild(root);
  view.attachEventListeners(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
  observerInstances.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GridView progressive rendering", () => {
  it("renders the first batch and appends every remaining row in order", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const view = new GridView();
    const root = mountGrid(
      view,
      Array.from({ length: 250 }, (_, index) => makeComparison(index)),
    );

    expect(root.querySelectorAll("tbody tr")).toHaveLength(100);
    expect(view.renderedCount).toBe(100);
    expect(root.querySelector("#grid-load-more-sentinel")).not.toBeNull();
    expect(observerInstances[0].options.root).toBe(root.querySelector(".table-scroll-area"));

    observerInstances[0].trigger();
    observerInstances[0].trigger();
    observerInstances[0].trigger();

    const rows = [...root.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(250);
    expect(rows[0].querySelector(".index-cell").textContent).toBe("1");
    expect(rows[99].querySelector(".index-cell").textContent).toBe("100");
    expect(rows[100].querySelector(".index-cell").textContent).toBe("101");
    expect(rows[249].querySelector(".index-cell").textContent).toBe("250");
    expect(view.renderedCount).toBe(250);
    expect(root.querySelector("#grid-load-more-sentinel")).toBeNull();
    expect(observerInstances[0].disconnected).toBe(true);
  });

  it("does not create a sentinel for a single batch", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const view = new GridView();
    const root = mountGrid(
      view,
      Array.from({ length: 100 }, (_, index) => makeComparison(index)),
    );

    expect(root.querySelectorAll("tbody tr")).toHaveLength(100);
    expect(root.querySelector("#grid-load-more-sentinel")).toBeNull();
    expect(observerInstances).toHaveLength(0);
  });

  it("disconnects the previous observer when rendering a new result set", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const view = new GridView();
    const firstRoot = mountGrid(
      view,
      Array.from({ length: 150 }, (_, index) => makeComparison(index)),
    );
    const firstObserver = observerInstances[0];

    firstRoot.innerHTML = view.render([makeComparison(999)], "env-a", "env-b", { compareFields: ["value"] });
    view.attachEventListeners(firstRoot);

    expect(firstObserver.disconnected).toBe(true);
    expect(firstRoot.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(firstRoot.querySelector(".pk-cell").textContent).toContain("row-999");
  });

  it("keeps the first render progressive when IntersectionObserver is unavailable", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    const view = new GridView();
    const root = mountGrid(
      view,
      Array.from({ length: 250 }, (_, index) => makeComparison(index)),
    );

    expect(root.querySelectorAll("tbody tr")).toHaveLength(100);
    vi.runAllTimers();

    expect(root.querySelectorAll("tbody tr")).toHaveLength(250);
    expect(view.fallbackLoadTimer).toBeNull();
  });
});
