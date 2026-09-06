// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { ReleaseTour, buildReleaseTourModel, markPendingRelease, normalizeReleasePayload, takePendingRelease } from "../ReleaseTour.js";

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

  it("builds release, next-step, and optional guided-tour slides", () => {
    const model = buildReleaseTourModel({
      surface: "web",
      releaseId: "web:20260905",
      build: "20260905120000",
      title: "Web build ready",
      notes: ["Saved settings are preserved."],
      tour: [
        {
          target: ".header-search",
          title: "Search",
          body: "Find tools quickly.",
        },
      ],
    });

    expect(model.slides.map((slide) => slide.kind)).toEqual(["release", "next", "tour"]);
    expect(model.slides[0].bullets).toEqual(["Saved settings are preserved."]);
    expect(model.slides[1].action).toMatchObject({ route: "home" });
    expect(model.tour).toHaveLength(1);

    const desktopModel = buildReleaseTourModel({ surface: "desktop", version: "1.4.0" });
    expect(desktopModel.slides[1].action).toMatchObject({ route: "settings", focus: "update.autoCheck" });
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

  it("renders a complete update icon for the What's new context", () => {
    const tour = new ReleaseTour({
      release: {
        releaseId: "web:update-icon",
        title: "Icon check",
        summary: "The icon should be recognizable.",
        tour: [],
      },
    });

    expect(tour.open()).toBe(true);

    const icon = document.querySelector(".release-tour-icon");
    const svg = icon?.querySelector("svg");

    expect(icon?.dataset.icon).toBe("circle-check");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.querySelector("circle")?.getAttribute("r")).toBe("9");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("m8.5 12 2.2 2.2 4.8-5");
  });
});
