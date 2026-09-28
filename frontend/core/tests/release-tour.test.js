// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import releaseContent from "../../config/release-content.json";
import {
  ReleaseTips,
  ReleaseTour,
  markPendingRelease,
  normalizeReleasePayload,
  takePendingRelease,
} from "../ReleaseTour.js";

afterEach(() => {
  document.body.innerHTML = "";
  document.body.classList.remove("release-tour-open");
  localStorage.clear();
});

describe("release tour", () => {
  it("normalizes release metadata from a desktop manifest", () => {
    const release = normalizeReleasePayload({
      surface: "desktop",
      channel: "beta",
      manifest: {
        version: "1.4.0",
        title: "A better release",
        notes: "- Faster startup\n- More reliable updates",
      },
    });

    expect(release).toMatchObject({
      surface: "desktop",
      channel: "beta",
      version: "1.4.0",
      title: "A better release",
    });
    expect(release.notes).toContain("Faster startup");
    expect(release.releaseId).toBe("desktop:beta:1.4.0");
  });

  it("starts feature tips from the final announcement step", () => {
    let finishResult = null;
    const tour = new ReleaseTour({
      preview: true,
      release: {
        releaseId: "release-guided-start",
        tour: [],
        tips: [
          {
            id: "search",
            route: "home",
            target: ".header-search",
            title: "Search",
            body: "Press Command K.",
          },
        ],
      },
      onFinish: (result) => {
        finishResult = result;
      },
    });

    expect(tour.open()).toBe(true);
    tour.slideIndex = tour.model.slides.length - 1;
    tour.renderSlide();
    document.querySelector(".release-tour-next").click();
    expect(finishResult).toEqual({ startTips: true });
  });

  it("persists a pending release exactly once", () => {
    expect(markPendingRelease({ surface: "web", build: "20260905120000" })).toBe(true);

    expect(takePendingRelease()).toMatchObject({
      surface: "web",
      build: "20260905120000",
      expectedBuild: "20260905120000",
    });
    expect(takePendingRelease()).toBeNull();
  });

  it("supports safe media, documentation links, and in-app actions", () => {
    const release = normalizeReleasePayload({
      releaseId: "web:media-links",
      slides: [
        {
          title: "See the new workflow",
          body: "A focused preview can explain where to start.",
          image: { src: "/release-assets/search.png", alt: "Search preview", caption: "Search reaches saved work." },
          links: [
            { label: "Open the guide", href: "https://example.com/guide" },
            { label: "Try it in the app", route: "home", focus: "header-search" },
            { label: "Unsafe", href: "javascript:alert(1)" },
          ],
          action: { label: "Open search", route: "home", focus: "header-search" },
        },
      ],
    });

    expect(release.slides[0]).toMatchObject({
      media: { src: "/release-assets/search.png", alt: "Search preview", caption: "Search reaches saved work." },
      links: [
        { label: "Open the guide", href: "https://example.com/guide" },
        { label: "Try it in the app", route: "home", focus: "header-search" },
      ],
      action: { label: "Open search", route: "home", focus: "header-search" },
    });
  });

  it("keeps desktop-only import guidance out of the web tour", () => {
    const content = {
      tips: [
        {
          id: "oracle",
          route: "quick-query",
          target: "#importOracleData",
          title: "Import Oracle",
          body: "Open import.",
          surfaces: ["desktop"],
        },
      ],
    };
    expect(normalizeReleasePayload({ ...content, surface: "web" }).tips).toHaveLength(0);
    expect(normalizeReleasePayload({ ...content, surface: "desktop" }).tips).toHaveLength(1);
  });

  it("keeps a contextual tip unfinished until its target is used", async () => {
    document.body.innerHTML = '<aside class="hidden-sidebar"></aside><button class="header-search">Search</button>';
    document.querySelector(".header-search").getBoundingClientRect = () => ({
      width: 160,
      height: 36,
      top: 20,
      right: 180,
      bottom: 56,
      left: 20,
    });
    const release = {
      releaseId: "release-1.3.6",
      version: "1.3.6",
      tips: [
        {
          id: "hidden-tip",
          route: "home",
          target: ".hidden-sidebar",
          title: "Hidden tip",
          body: "This should wait until its target is visible.",
        },
        {
          id: "global-search",
          route: "home",
          target: ".header-search",
          title: "Search with Command K",
          body: "Find saved Quick Query tables.",
          completeOn: { event: "click", target: ".header-search" },
        },
      ],
    };
    const tips = new ReleaseTips({ release, getRoute: () => "home" });

    expect(tips.start()).toBe(true);
    expect(tips.openForCurrentRoute()).toBe(true);
    expect(document.querySelector(".release-feature-tip")?.textContent).toContain("Search with Command K");
    expect(document.querySelector(".release-feature-tip")?.textContent).not.toContain("Hidden tip");
    expect(document.querySelector(".release-feature-tip .release-tour-tooltip-actions")?.children).toHaveLength(0);
    expect(localStorage.getItem("releaseTip.opened.release-1.3.6.global-search")).toBeNull();
    tips.close();
    expect(tips.openForCurrentRoute()).toBe(true);
    document.querySelector(".header-search").click();
    await Promise.resolve();
    expect(localStorage.getItem("releaseTip.opened.release-1.3.6.global-search")).toBe("true");
    expect(tips.openForCurrentRoute()).toBe(false);
    tips.destroy();
  });

  it("lets Escape close an action tip without recording completion", () => {
    document.body.innerHTML = '<button id="feature">Feature</button>';
    document.querySelector("#feature").getBoundingClientRect = () => ({
      width: 100,
      height: 30,
      top: 20,
      right: 120,
      bottom: 50,
      left: 20,
    });
    const tips = new ReleaseTips({
      release: {
        releaseId: "escape-tip",
        tips: [
          {
            id: "feature",
            route: "home",
            target: "#feature",
            title: "Feature",
            body: "Click it.",
            completeOn: { event: "click", target: "#feature" },
          },
        ],
      },
      getRoute: () => "home",
    });
    tips.start();
    expect(tips.openForCurrentRoute()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".release-feature-tip")).toBeNull();
    expect(localStorage.getItem("releaseTip.opened.escape-tip.feature")).toBeNull();
    expect(tips.openForCurrentRoute()).toBe(false);
    tips.destroy();
  });

  it("lets the close icon dismiss a tip without completing it", () => {
    document.body.innerHTML = '<button id="feature">Feature</button>';
    document.querySelector("#feature").getBoundingClientRect = () => ({
      width: 100,
      height: 30,
      top: 20,
      right: 120,
      bottom: 50,
      left: 20,
    });
    let route = "home";
    const tips = new ReleaseTips({
      release: {
        releaseId: "close-tip",
        tips: [{ id: "feature", route: "home", target: "#feature", title: "Feature", body: "Try it." }],
      },
      getRoute: () => route,
    });

    tips.start();
    expect(tips.openForCurrentRoute()).toBe(true);
    const closeButton = document.querySelector(".release-feature-tip-close");
    expect(closeButton?.getAttribute("aria-label")).toBe("Close feature tip");
    closeButton.click();
    expect(document.querySelector(".release-feature-tip")).toBeNull();
    expect(localStorage.getItem("releaseTip.opened.close-tip.feature")).toBeNull();
    expect(tips.openForCurrentRoute()).toBe(false);
    route = "quick-query";
    expect(tips.openForCurrentRoute()).toBe(false);
    route = "home";
    expect(tips.openForCurrentRoute()).toBe(true);
    tips.destroy();
  });

  it("chooses a visible target from responsive alternatives", () => {
    document.body.innerHTML = '<button id="compact-mode"></button><button id="wide-mode"></button>';
    document.querySelector("#compact-mode").getBoundingClientRect = () => ({
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    document.querySelector("#wide-mode").getBoundingClientRect = () => ({
      width: 90,
      height: 30,
      top: 20,
      right: 110,
      bottom: 50,
      left: 20,
    });
    const tips = new ReleaseTips({
      release: {
        releaseId: "release-responsive-tip",
        tips: [{ id: "mode", route: "home", target: "#compact-mode, #wide-mode", title: "Choose a mode", body: "Start here." }],
      },
      getRoute: () => "home",
    });

    tips.start();
    expect(tips.openForCurrentRoute()).toBe(true);
    expect(tips.activeTip?.id).toBe("mode");
    expect(document.querySelector(".release-feature-tip")?.textContent).toContain("Choose a mode");
    tips.destroy();
  });

  it("spotlights the preview control each HTML dropdown tip points at", () => {
    for (const [tipId, selectId] of [
      ["html-template-preview-width", "previewViewportSelect"],
      ["html-template-preview-vtl", "previewVtlModeSelect"],
    ]) {
      document.body.innerHTML = `<select id="${selectId}"></select>`;
      document.querySelector(`#${selectId}`).getBoundingClientRect = () => ({ width: 180, height: 36, top: 40, right: 200, bottom: 76, left: 20 });
      const tip = releaseContent.tips.find((item) => item.id === tipId);
      const tips = new ReleaseTips({ release: { releaseId: `test-${tipId}`, tips: [tip] }, getRoute: () => "html-template" });

      tips.start();
      expect(tips.openForCurrentRoute()).toBe(true);
      tips.reposition();
      expect(tips.spotlightEl.style.width).toBe("192px");
      expect(tips.spotlightEl.style.height).toBe("48px");
      expect(tips.tooltipEl.style.visibility).toBe("");
      tips.destroy();
    }
  });

  it("hides the tip while its target reports an expanded menu", async () => {
    document.body.innerHTML = '<button id="expander" aria-expanded="false">Open</button>';
    document.querySelector("#expander").getBoundingClientRect = () => ({ width: 180, height: 36, top: 40, right: 200, bottom: 76, left: 20 });
    const tips = new ReleaseTips({
      release: {
        releaseId: "release-expanded-tip",
        tips: [{ id: "expander", route: "home", target: "#expander", title: "Open it", body: "Toggle the menu." }],
      },
      getRoute: () => "home",
    });

    tips.start();
    expect(tips.openForCurrentRoute()).toBe(true);
    expect(tips.tooltipEl.style.visibility).toBe("");
    document.querySelector("#expander").setAttribute("aria-expanded", "true");
    await Promise.resolve();
    expect(tips.tooltipEl.style.visibility).toBe("hidden");
    document.querySelector("#expander").setAttribute("aria-expanded", "false");
    await Promise.resolve();
    expect(tips.tooltipEl.style.visibility).toBe("");
    tips.destroy();
  });

  it("requires UUID generation and a successful copy after opening the generator", async () => {
    document.body.innerHTML = '<button id="quickQueryUuidButton">UUID</button><button id="quickQueryUuidGenerate">Generate</button>';
    document.querySelectorAll("button").forEach((button) => {
      button.getBoundingClientRect = () => ({ width: 100, height: 30, top: 20, right: 120, bottom: 50, left: 20 });
    });
    let tipPresentDuringClick = false;
    document.querySelector("#quickQueryUuidButton").addEventListener("click", (event) => {
      tipPresentDuringClick = Boolean(document.querySelector(".release-feature-tip"));
      event.stopPropagation();
    });
    const tips = new ReleaseTips({
      release: {
        releaseId: "uuid-tour",
        tips: [
          {
            id: "uuid",
            route: "quick-query",
            target: "#quickQueryUuidButton",
            title: "UUID",
            body: "Open it.",
            completeOn: { event: "click", target: "#quickQueryUuidButton" },
            next: { target: "#quickQueryUuidGenerate", body: "Generate and copy.", completeOn: { event: "quick-query:uuid-copied" } },
          },
        ],
      },
      getRoute: () => "quick-query",
    });
    tips.start();
    expect(tips.openForCurrentRoute()).toBe(true);
    document.querySelector("#quickQueryUuidButton").click();
    await Promise.resolve();
    expect(tipPresentDuringClick).toBe(true);
    expect(localStorage.getItem("releaseTip.opened.uuid-tour.uuid")).toBeNull();
    expect(tips.openForCurrentRoute()).toBe(true);
    expect(document.querySelector(".release-feature-tip")?.textContent).toContain("Generate and copy.");
    document.querySelector("#quickQueryUuidGenerate").click();
    expect(localStorage.getItem("releaseTip.opened.uuid-tour.uuid")).toBeNull();
    document.dispatchEvent(new CustomEvent("quick-query:uuid-copied"));
    await Promise.resolve();
    expect(localStorage.getItem("releaseTip.opened.uuid-tour.uuid")).toBe("true");
    tips.destroy();
  });

  it("leaves a skipped action tip unfinished until the user returns to its route", () => {
    document.body.innerHTML = '<button id="feature">Feature</button>';
    document.querySelector("#feature").getBoundingClientRect = () => ({
      width: 100,
      height: 30,
      top: 20,
      right: 120,
      bottom: 50,
      left: 20,
    });
    let route = "home";
    const tips = new ReleaseTips({
      release: {
        releaseId: "skip-tour",
        tips: [
          {
            id: "feature",
            route: "home",
            target: "#feature",
            title: "Feature",
            body: "Try it.",
            completeOn: { event: "click", target: "#feature" },
          },
        ],
      },
      getRoute: () => route,
    });
    tips.startGuided();
    expect(tips.openForCurrentRoute()).toBe(true);
    document.querySelector(".release-feature-tip .btn-ghost").click();
    expect(localStorage.getItem("releaseTip.opened.skip-tour.feature")).toBeNull();
    expect(tips.openForCurrentRoute()).toBe(false);
    route = "quick-query";
    expect(tips.openForCurrentRoute()).toBe(false);
    route = "home";
    expect(tips.openForCurrentRoute()).toBe(true);
    tips.destroy();
  });

  it("waits for the Oracle import dialog to close before showing the audit tip", async () => {
    document.body.innerHTML = `
      <button id="importOracleData">Import Oracle</button>
      <button id="systemModeControl">Audit user</button>
      <div id="oracleDataModal" class="hidden" role="dialog" aria-modal="true"></div>
    `;
    document.querySelectorAll("button").forEach((button) => {
      button.getBoundingClientRect = () => ({ width: 120, height: 30, top: 20, right: 140, bottom: 50, left: 20 });
    });
    const modal = document.querySelector("#oracleDataModal");
    document.querySelector("#importOracleData").addEventListener("click", () => modal.classList.remove("hidden"));
    const tips = new ReleaseTips({
      release: {
        releaseId: "oracle-modal-tour",
        tips: [
          {
            id: "import",
            route: "quick-query",
            target: "#importOracleData",
            title: "Import",
            body: "Open it.",
            completeOn: { event: "click", target: "#importOracleData" },
          },
          {
            id: "audit",
            route: "quick-query",
            target: "#systemModeControl",
            title: "Audit",
            body: "Choose a user.",
            completeOn: { event: "click", target: "#systemModeControl" },
          },
        ],
      },
      getRoute: () => "quick-query",
    });
    tips.startGuided();
    expect(tips.openForCurrentRoute()).toBe(true);
    document.querySelector("#importOracleData").click();
    await Promise.resolve();

    expect(tips.guidedIndex).toBe(1);
    expect(tips.openForCurrentRoute()).toBe(false);
    expect(document.querySelector(".release-feature-tip")).toBeNull();
    expect(localStorage.getItem("releaseTip.opened.oracle-modal-tour.audit")).toBeNull();

    modal.classList.add("hidden");
    await vi.waitFor(() => expect(tips.activeTip?.id).toBe("audit"));
    modal.classList.remove("hidden");
    await vi.waitFor(() => expect(document.querySelector(".release-feature-tip")).toBeNull());
    expect(localStorage.getItem("releaseTip.opened.oracle-modal-tour.audit")).toBeNull();
    modal.classList.add("hidden");
    await vi.waitFor(() => expect(tips.activeTip?.id).toBe("audit"));
    tips.destroy();
  });

  it("navigates through feature tips as one guided flow", () => {
    document.body.innerHTML = '<div id="spreadsheet-data"></div><button id="savedReferencesButton">Saved references</button>';
    document.querySelectorAll("#spreadsheet-data, #savedReferencesButton").forEach((element) => {
      element.getBoundingClientRect = () => ({ width: 180, height: 40, top: 20, right: 200, bottom: 60, left: 20 });
    });
    let route = "home";
    const navigated = [];
    const tips = new ReleaseTips({
      release: {
        releaseId: "release-guided",
        tips: [
          {
            id: "safe-paste",
            route: "quick-query",
            target: "#spreadsheet-data",
            title: "Paste safely",
            body: "Preserve JSON quotes.",
          },
          {
            id: "saved-references",
            route: "check-image",
            target: "#savedReferencesButton",
            title: "Save references",
            body: "Reuse identifiers.",
          },
        ],
      },
      getRoute: () => route,
      onNavigate: ({ route: nextRoute }) => {
        route = nextRoute;
        navigated.push(nextRoute);
      },
    });

    expect(tips.startGuided()).toBe(true);
    expect(navigated).toEqual(["quick-query"]);
    expect(tips.openForCurrentRoute()).toBe(true);
    expect(document.querySelector(".release-feature-tip")?.textContent).toContain("Tip 1 of 2");

    document.querySelector(".release-feature-tip .btn-primary").click();
    expect(navigated).toEqual(["quick-query", "check-image"]);
    expect(tips.openForCurrentRoute()).toBe(true);
    expect(document.querySelector(".release-feature-tip")?.textContent).toContain("Tip 2 of 2");
    expect(document.querySelector(".release-feature-tip .btn-primary")?.textContent).toBe("Next");

    document.querySelector(".release-feature-tip .btn-primary").click();
    expect(tips.guided).toBe(false);
    tips.destroy();
  });

  it("renders safe text and remembers a dismissed release", () => {
    const tour = new ReleaseTour({
      release: {
        surface: "web",
        releaseId: "web:test-safe-text",
        title: "<img src=x onerror=alert(1)>",
        summary: "A safe summary",
        notes: ["A useful note"],
        tour: [],
      },
    });

    expect(tour.open()).toBe(true);
    expect(document.querySelector(".release-tour-title").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector(".release-tour-title img")).toBeNull();

    document.querySelector(".release-tour-skip").click();
    expect(document.querySelector(".release-tour-overlay")).toBeNull();
    expect(tour.open()).toBe(false);
  });

  it("renders media and links without turning authored text into markup", () => {
    const tour = new ReleaseTour({
      release: {
        releaseId: "web:render-media-links",
        title: "Preview",
        summary: "See the change.",
        image: { src: "/release-assets/preview.png", alt: "Preview image" },
        links: [{ label: "Read more", href: "https://example.com/release" }],
        tour: [],
      },
    });

    expect(tour.open()).toBe(true);
    expect(document.querySelector(".release-tour-media-image")).toMatchObject({ alt: "Preview image" });
    expect(document.querySelector(".release-tour-links a")).toMatchObject({
      textContent: "Read more",
      target: "_blank",
      rel: "noreferrer",
    });
    document.querySelector(".release-tour-skip").click();
  });

  it("can be reopened in preview mode without recording a seen release", () => {
    const tour = new ReleaseTour({
      preview: true,
      release: {
        releaseId: "web:preview",
        title: "Preview",
        summary: "Preview the current release content.",
        tour: [],
      },
    });

    expect(tour.open()).toBe(true);
    document.querySelector(".release-tour-skip").click();
    expect(tour.open()).toBe(true);
    tour.finish();
  });

});
