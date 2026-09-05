const PENDING_STORAGE_KEY = "releaseTour.pending";
const SEEN_STORAGE_KEY_PREFIX = "releaseTour.seen.";

const DEFAULT_TOUR_STEPS = [
  {
    target: ".header-search",
    placement: "bottom",
    title: "Search the workspace",
    body: "Use the search field or press ⌘K to jump to tools, pages, and saved Quick Query schemas.",
  },
  {
    target: ".sidebar",
    placement: "right",
    title: "Keep frequent tools close",
    body: "Pin the tools you use most from the sidebar so they stay easy to reach.",
  },
];

function safeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === "string") return [item];
        if (isRecord(item)) return [item.text || item.body || item.description || item.title || ""];
        return [];
      })
      .map((item) => safeString(item))
      .filter(Boolean);
  }

  const text = safeString(value);
  if (!text) return [];

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|#+\s*)/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^enter\s+\(t\)ext,\s+\(f\)ile,\s+or\s+\(d\)efault/i.test(line));
}

function normalizeReference(value) {
  const reference = safeString(value);
  if (!reference || /[\u0000-\u001f]/.test(reference)) return "";
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) && !/^https?:\/\//i.test(reference)) return "";
  if (reference.startsWith("//")) return "";
  return reference;
}

function normalizeMedia(value, alt, caption) {
  const source = isRecord(value) ? value : {};
  const src = normalizeReference(isRecord(value) ? value.src || value.url : value);
  if (!src) return null;
  return {
    src,
    alt: safeString(source.alt || alt) || "Release preview",
    caption: safeString(source.caption || caption),
  };
}

function normalizeLink(link) {
  if (typeof link === "string") {
    const href = normalizeReference(link);
    return href ? { label: "Learn more", href, route: "", focus: "" } : null;
  }
  if (!isRecord(link)) return null;
  const label = safeString(link.label || link.title);
  const href = normalizeReference(link.href || link.url);
  const route = safeString(link.route);
  if (!label || (!href && !route)) return null;
  return {
    label,
    href,
    route,
    focus: safeString(link.focus),
  };
}

function normalizeLinks(value) {
  const rawLinks = Array.isArray(value) ? value : value ? [value] : [];
  return rawLinks.map(normalizeLink).filter(Boolean);
}

function normalizeAction(action) {
  if (!isRecord(action)) return null;
  const label = safeString(action.label);
  const route = safeString(action.route);
  if (!label || !route) return null;
  return {
    label,
    route,
    focus: safeString(action.focus),
  };
}

function normalizeSlide(slide) {
  if (!isRecord(slide)) return null;
  const title = safeString(slide.title);
  const body = safeString(slide.body || slide.description);
  const bullets = normalizeTextList(slide.bullets || slide.items || slide.points);
  const action = normalizeAction(slide.action);
  const media = normalizeMedia(slide.image || slide.media, slide.imageAlt || slide.alt, slide.imageCaption || slide.caption);
  const links = normalizeLinks(slide.links || slide.link);
  if (!title && !body && bullets.length === 0) return null;
  return { title, body, bullets, action, media, links, kind: "custom" };
}

function normalizeTourStep(step) {
  if (!isRecord(step)) return null;
  const target = safeString(step.target);
  const title = safeString(step.title);
  const body = safeString(step.body || step.description);
  if (!target || !title || !body) return null;
  return {
    target,
    placement: safeString(step.placement) || "bottom",
    title,
    body,
  };
}

function releaseSource(payload = {}) {
  const manifest = isRecord(payload.manifest) ? payload.manifest : {};
  const nestedRelease = isRecord(payload.release) ? payload.release : {};
  return { ...manifest, ...nestedRelease, ...payload };
}

export function normalizeReleasePayload(payload = {}) {
  const source = releaseSource(payload);
  const rawSurface = safeString(source.surface || source.source).toLowerCase();
  const surface = rawSurface === "desktop" || rawSurface === "tauri" ? "desktop" : "web";
  const version = safeString(source.version || source.latest);
  const build = safeString(source.build || source.buildId);
  const channel = safeString(source.channel) || "stable";
  const releaseId = safeString(source.releaseId) || `${surface}:${channel}:${version || build || "latest"}`;
  const rawSlides = Array.isArray(source.slides) ? source.slides : [];
  const rawTour = Array.isArray(source.tour) ? source.tour : undefined;
  const media = normalizeMedia(source.image || source.media, source.imageAlt || source.alt, source.imageCaption || source.caption);
  const links = normalizeLinks(source.links || source.link);
  const action = normalizeAction(source.action);

  return {
    surface,
    releaseId,
    expectedVersion: safeString(source.expectedVersion || source.version),
    expectedBuild: safeString(source.expectedBuild || source.build),
    version,
    build,
    channel,
    title: safeString(source.title),
    summary: safeString(source.summary),
    notes: source.notes || "",
    media,
    links,
    action,
    slides: rawSlides.map(normalizeSlide).filter(Boolean),
    // An explicit empty array disables the default tour for a release.
    tour: rawTour === undefined ? undefined : rawTour.map(normalizeTourStep).filter(Boolean),
  };
}

export function markPendingRelease(payload = {}) {
  const release = normalizeReleasePayload(payload);
  try {
    localStorage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({
        ...release,
        pendingAt: new Date().toISOString(),
      }),
    );
    return true;
  } catch (_) {
    return false;
  }
}

export function clearPendingRelease(releaseId) {
  try {
    if (!releaseId) {
      localStorage.removeItem(PENDING_STORAGE_KEY);
      return;
    }
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return;
    const current = JSON.parse(raw);
    if (!current?.releaseId || current.releaseId === releaseId) {
      localStorage.removeItem(PENDING_STORAGE_KEY);
    }
  } catch (_) {
    try {
      localStorage.removeItem(PENDING_STORAGE_KEY);
    } catch (_) {}
  }
}

export function takePendingRelease() {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_STORAGE_KEY);
    return normalizeReleasePayload(JSON.parse(raw));
  } catch (_) {
    try {
      localStorage.removeItem(PENDING_STORAGE_KEY);
    } catch (_) {}
    return null;
  }
}

function seenStorageKey(releaseId) {
  return `${SEEN_STORAGE_KEY_PREFIX}${encodeURIComponent(safeString(releaseId))}`;
}

function hasSeenRelease(releaseId) {
  if (!releaseId) return false;
  try {
    return localStorage.getItem(seenStorageKey(releaseId)) === "true";
  } catch (_) {
    return false;
  }
}

function markReleaseSeen(releaseId) {
  if (!releaseId) return;
  try {
    localStorage.setItem(seenStorageKey(releaseId), "true");
  } catch (_) {}
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendCloseIcon(button) {
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>';
}

function appendUpdateIcon(parent) {
  const icon = createElement("span", "release-tour-icon");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.3" /><path d="M20 4v7h-7" /><path d="m8.5 12.5 2.2 2.2 4.8-5" /></svg>';
  parent.appendChild(icon);
}

function versionLabel(release) {
  if (release.version) return `v${release.version}`;
  if (release.build) return `build ${release.build}`;
  return "the latest build";
}

export function buildReleaseTourModel(payload = {}) {
  const release = normalizeReleasePayload(payload);
  const isDesktop = release.surface === "desktop";
  const platformLabel = isDesktop ? "Desktop update" : "Web update";
  const label = versionLabel(release);
  const notes = normalizeTextList(release.notes);
  const customSlides = release.slides || [];
  const tour = release.tour === undefined ? DEFAULT_TOUR_STEPS.map((step) => ({ ...step })) : release.tour;

  const slides = [
    {
      kind: "release",
      title: release.title || (isDesktop ? `Desktop updated to ${label}` : "The web app is up to date"),
      body:
        release.summary ||
        (isDesktop
          ? "The signed desktop update installed successfully and AD Tools is ready to use."
          : "The latest web build loaded automatically. You can continue working in this tab."),
      bullets: notes.length > 0 ? notes.slice(0, 8) : ["Your workspace is ready with the latest build."],
      action: release.action,
      media: release.media,
      links: release.links,
    },
    ...customSlides,
    {
      kind: "next",
      title: isDesktop ? "Pick up where you left off" : "Keep working in the browser",
      body: isDesktop
        ? "Your saved settings stay available, and future desktop releases can be checked from Settings."
        : "Your account and saved settings stay available after the automatic refresh; use Home or search to continue.",
      bullets: isDesktop
        ? ["Open Settings → Check for Update to check manually.", "Use the header banner to choose when to install an optional release."]
        : [
            "Use the search field or press ⌘K to jump to any tool or page.",
            "Web updates are applied automatically when a new build is deployed.",
          ],
      action: isDesktop
        ? { label: "Open update settings", route: "settings", focus: "update.autoCheck" }
        : { label: "Explore tools", route: "home", focus: "" },
    },
  ];

  if (tour.length > 0) {
    slides.push({
      kind: "tour",
      title: "A quick look around",
      body: "Want a short reminder of the workspace? I’ll point out a couple of useful places, and you can skip at any time.",
      bullets: [`${tour.length} quick ${tour.length === 1 ? "tip" : "tips"}`],
      action: null,
    });
  }

  return {
    ...release,
    platformLabel,
    versionLabel: label,
    slides,
    tour,
  };
}

export class ReleaseTour {
  constructor({ release, onNavigate, preview = false } = {}) {
    this.model = buildReleaseTourModel(release || {});
    this.onNavigate = typeof onNavigate === "function" ? onNavigate : null;
    this.preview = preview;
    this.mode = "modal";
    this.slideIndex = 0;
    this.tourIndex = 0;
    this.overlayEl = null;
    this.dialogEl = null;
    this.contentEl = null;
    this.progressEl = null;
    this.footerEl = null;
    this.tourLayerEl = null;
    this.spotlightEl = null;
    this.tooltipEl = null;
    this.previousActiveElement = null;
    this.tourTarget = null;
    this.repositionTour = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  open() {
    if (this.overlayEl || this.tourLayerEl || (!this.preview && hasSeenRelease(this.model.releaseId))) return false;
    this.previousActiveElement = document.activeElement;
    this.mode = "modal";

    this.overlayEl = createElement("div", "release-tour-overlay");
    this.overlayEl.setAttribute("role", "dialog");
    this.overlayEl.setAttribute("aria-modal", "true");
    this.overlayEl.setAttribute("aria-labelledby", "release-tour-title");
    this.overlayEl.setAttribute("aria-describedby", "release-tour-description");

    this.dialogEl = createElement("div", "release-tour-dialog");
    const topbar = createElement("div", "release-tour-topbar");
    const context = createElement("div", "release-tour-context");
    appendUpdateIcon(context);
    context.appendChild(createElement("span", "release-tour-context-label", "What's new"));
    topbar.appendChild(context);

    const closeButton = createElement("button", "release-tour-close");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close what's new");
    appendCloseIcon(closeButton);
    closeButton.addEventListener("click", () => this.finish());
    topbar.appendChild(closeButton);
    this.dialogEl.appendChild(topbar);

    this.progressEl = createElement("div", "release-tour-progress");
    this.dialogEl.appendChild(this.progressEl);
    this.contentEl = createElement("div", "release-tour-content");
    this.dialogEl.appendChild(this.contentEl);
    this.footerEl = createElement("div", "release-tour-footer");
    this.dialogEl.appendChild(this.footerEl);
    this.overlayEl.appendChild(this.dialogEl);
    document.body.appendChild(this.overlayEl);
    document.body.classList.add("release-tour-open");
    document.addEventListener("keydown", this.handleKeyDown, true);
    this.renderSlide();
    const nextFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
    nextFrame(() => this.overlayEl?.classList.add("is-open"));
    window.setTimeout(() => this.dialogEl?.querySelector(".release-tour-next")?.focus(), 40);
    return true;
  }

  renderSlide() {
    if (!this.contentEl || !this.footerEl || !this.progressEl) return;
    const slide = this.model.slides[this.slideIndex];
    if (!slide) return;

    this.progressEl.innerHTML = "";
    const progressLabel = createElement("span", "release-tour-progress-label", `${this.slideIndex + 1} of ${this.model.slides.length}`);
    this.progressEl.appendChild(progressLabel);
    const dots = createElement("div", "release-tour-progress-dots");
    dots.setAttribute("aria-hidden", "true");
    this.model.slides.forEach((_, index) => {
      const dot = createElement("span", `release-tour-progress-dot${index === this.slideIndex ? " is-active" : ""}`);
      dots.appendChild(dot);
    });
    this.progressEl.appendChild(dots);

    this.contentEl.innerHTML = "";
    const meta = createElement("p", "release-tour-meta", `${this.model.platformLabel} · ${this.model.versionLabel}`);
    this.contentEl.appendChild(meta);
    const title = createElement("h2", "release-tour-title", slide.title);
    title.id = "release-tour-title";
    this.contentEl.appendChild(title);
    const body = createElement("p", "release-tour-description", slide.body);
    body.id = "release-tour-description";
    this.contentEl.appendChild(body);

    if (slide.media) {
      const media = createElement("figure", "release-tour-media");
      const image = createElement("img", "release-tour-media-image");
      image.src = slide.media.src;
      image.alt = slide.media.alt;
      image.loading = "eager";
      image.decoding = "async";
      const fallback = createElement("p", "release-tour-media-fallback", "Preview unavailable");
      fallback.hidden = true;
      image.addEventListener("error", () => {
        media.classList.add("is-broken");
        fallback.hidden = false;
      });
      media.appendChild(image);
      media.appendChild(fallback);
      if (slide.media.caption) media.appendChild(createElement("figcaption", "release-tour-media-caption", slide.media.caption));
      this.contentEl.appendChild(media);
    }

    if (slide.bullets?.length) {
      const list = createElement("ul", "release-tour-list");
      slide.bullets.forEach((bullet) => list.appendChild(createElement("li", "", bullet)));
      this.contentEl.appendChild(list);
    }

    if (slide.links?.length) {
      const links = createElement("div", "release-tour-links");
      slide.links.forEach((link) => {
        if (link.route) {
          const routeLink = createElement("button", "release-tour-link", link.label);
          routeLink.type = "button";
          routeLink.addEventListener("click", () => this.finish({ route: link.route, focus: link.focus }));
          links.appendChild(routeLink);
          return;
        }
        const hrefLink = createElement("a", "release-tour-link", link.label);
        hrefLink.href = link.href;
        if (/^https?:\/\//i.test(link.href)) {
          hrefLink.target = "_blank";
          hrefLink.rel = "noreferrer";
        }
        hrefLink.addEventListener("click", () => this.finish());
        links.appendChild(hrefLink);
      });
      this.contentEl.appendChild(links);
    }

    if (slide.action) {
      const action = createElement("button", "btn btn-outline release-tour-content-action", slide.action.label);
      action.type = "button";
      action.addEventListener("click", () => this.finish(slide.action));
      this.contentEl.appendChild(action);
    }

    this.footerEl.innerHTML = "";
    const skipButton = createElement("button", "btn btn-ghost release-tour-skip", "Skip tour");
    skipButton.type = "button";
    skipButton.addEventListener("click", () => this.finish());
    this.footerEl.appendChild(skipButton);

    const navigation = createElement("div", "release-tour-navigation");
    const backButton = createElement("button", "btn btn-secondary release-tour-back", "Back");
    backButton.type = "button";
    backButton.disabled = this.slideIndex === 0;
    backButton.addEventListener("click", () => this.goBack());
    navigation.appendChild(backButton);

    const nextLabel = slide.kind === "tour" ? "Start quick tour" : this.slideIndex === this.model.slides.length - 1 ? "Done" : "Next";
    const nextButton = createElement("button", "btn btn-primary release-tour-next", nextLabel);
    nextButton.type = "button";
    nextButton.addEventListener("click", () => this.goNext());
    navigation.appendChild(nextButton);
    this.footerEl.appendChild(navigation);
  }

  goBack() {
    if (this.mode !== "modal" || this.slideIndex <= 0) return;
    this.slideIndex -= 1;
    this.renderSlide();
    this.dialogEl?.querySelector(".release-tour-next")?.focus();
  }

  goNext() {
    if (this.mode !== "modal") return;
    const slide = this.model.slides[this.slideIndex];
    if (this.slideIndex < this.model.slides.length - 1) {
      this.slideIndex += 1;
      this.renderSlide();
      this.dialogEl?.querySelector(".release-tour-next")?.focus();
      return;
    }
    if (slide?.kind === "tour" && this.model.tour.length > 0) {
      this.startTour();
      return;
    }
    this.finish();
  }

  startTour() {
    if (!this.model.tour.length) {
      this.finish();
      return;
    }
    this.mode = "tour";
    this.overlayEl?.remove();
    this.overlayEl = null;
    document.body.classList.remove("release-tour-open");

    this.tourLayerEl = createElement("div", "release-tour-layer");
    this.tourLayerEl.setAttribute("role", "region");
    this.tourLayerEl.setAttribute("aria-label", "Quick tour");
    this.spotlightEl = createElement("div", "release-tour-spotlight");
    this.tooltipEl = createElement("div", "release-tour-tooltip");
    this.tourLayerEl.appendChild(this.spotlightEl);
    this.tourLayerEl.appendChild(this.tooltipEl);
    document.body.appendChild(this.tourLayerEl);
    this.tourIndex = 0;
    this.repositionTour = () => this.positionTourStep();
    window.addEventListener("resize", this.repositionTour);
    window.addEventListener("scroll", this.repositionTour, true);
    this.renderTourStep();
  }

  findTourTarget() {
    while (this.tourIndex < this.model.tour.length) {
      const step = this.model.tour[this.tourIndex];
      let target = null;
      try {
        target = document.querySelector(step.target);
      } catch (_) {}
      const rect = target?.getBoundingClientRect?.();
      const isVisible =
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight;
      if (target && isVisible) return { step, target };
      this.tourIndex += 1;
    }
    return null;
  }

  renderTourStep() {
    const match = this.findTourTarget();
    if (!match || !this.tooltipEl) {
      this.finish();
      return;
    }
    this.tourTarget = match.target;
    this.tooltipEl.innerHTML = "";
    const title = createElement("h3", "release-tour-tooltip-title", match.step.title);
    title.id = "release-tour-tooltip-title";
    this.tooltipEl.appendChild(title);
    const body = createElement("p", "release-tour-tooltip-body", match.step.body);
    body.id = "release-tour-tooltip-body";
    this.tooltipEl.appendChild(body);

    const footer = createElement("div", "release-tour-tooltip-footer");
    footer.appendChild(createElement("span", "release-tour-tooltip-count", `Tip ${this.tourIndex + 1} of ${this.model.tour.length}`));
    const actions = createElement("div", "release-tour-tooltip-actions");
    const skip = createElement("button", "btn btn-ghost btn-sm", "Skip");
    skip.type = "button";
    skip.addEventListener("click", () => this.finish());
    actions.appendChild(skip);
    const next = createElement("button", "btn btn-primary btn-sm", this.tourIndex === this.model.tour.length - 1 ? "Done" : "Next");
    next.type = "button";
    next.addEventListener("click", () => this.nextTourStep());
    actions.appendChild(next);
    footer.appendChild(actions);
    this.tooltipEl.appendChild(footer);
    this.tooltipEl.setAttribute("aria-labelledby", title.id);
    this.tooltipEl.setAttribute("aria-describedby", body.id);
    this.positionTourStep();
    next.focus();
  }

  nextTourStep() {
    if (this.tourIndex >= this.model.tour.length - 1) {
      this.finish();
      return;
    }
    this.tourIndex += 1;
    this.renderTourStep();
  }

  positionTourStep() {
    if (!this.tourTarget || !this.spotlightEl || !this.tooltipEl) return;
    const rect = this.tourTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const pad = 6;
    this.spotlightEl.style.left = `${Math.max(4, rect.left - pad)}px`;
    this.spotlightEl.style.top = `${Math.max(4, rect.top - pad)}px`;
    this.spotlightEl.style.width = `${Math.min(viewportWidth - 8, rect.width + pad * 2)}px`;
    this.spotlightEl.style.height = `${Math.min(viewportHeight - 8, rect.height + pad * 2)}px`;

    const step = this.model.tour[this.tourIndex];
    const tooltipWidth = Math.min(340, viewportWidth - 24);
    const gap = 14;
    this.tooltipEl.style.width = `${tooltipWidth}px`;
    const tooltipHeight = this.tooltipEl.offsetHeight || 150;
    let placement = step?.placement || "bottom";
    if (placement === "bottom" && rect.bottom + gap + tooltipHeight > viewportHeight - 8) placement = "top";
    if (placement === "top" && rect.top - gap - tooltipHeight < 8) placement = "bottom";
    if (placement === "right" && rect.right + gap + tooltipWidth > viewportWidth - 8) placement = "left";
    if (placement === "left" && rect.left - gap - tooltipWidth < 8) placement = "right";

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.bottom + gap;
    if (placement === "top") {
      top = rect.top - gap - tooltipHeight;
    } else if (placement === "right") {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - tooltipHeight / 2;
    } else if (placement === "left") {
      left = rect.left - gap - tooltipWidth;
      top = rect.top + rect.height / 2 - tooltipHeight / 2;
    }
    left = Math.max(12, Math.min(left, viewportWidth - tooltipWidth - 12));
    top = Math.max(12, Math.min(top, viewportHeight - tooltipHeight - 12));
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  handleKeyDown(event) {
    if (!this.overlayEl && !this.tourLayerEl) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.finish();
      return;
    }
    if (this.mode === "modal" && event.key === "Tab" && this.dialogEl) {
      const focusable = Array.from(
        this.dialogEl.querySelectorAll('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (this.mode === "tour" && event.key === "Tab" && this.tooltipEl) {
      const focusable = Array.from(this.tooltipEl.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (this.mode === "modal" && event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      this.goNext();
    } else if (this.mode === "modal" && event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      this.goBack();
    }
  }

  finish(action) {
    if (!this.preview) markReleaseSeen(this.model.releaseId);
    document.removeEventListener("keydown", this.handleKeyDown, true);
    if (this.repositionTour) {
      window.removeEventListener("resize", this.repositionTour);
      window.removeEventListener("scroll", this.repositionTour, true);
    }
    this.overlayEl?.remove();
    this.tourLayerEl?.remove();
    this.overlayEl = null;
    this.tourLayerEl = null;
    this.dialogEl = null;
    this.tooltipEl = null;
    this.spotlightEl = null;
    this.repositionTour = null;
    document.body.classList.remove("release-tour-open");
    const previous = this.previousActiveElement;
    this.previousActiveElement = null;
    if (previous && typeof previous.focus === "function" && document.contains(previous)) {
      try {
        previous.focus();
      } catch (_) {}
    }
    if (action && this.onNavigate) {
      try {
        this.onNavigate(action);
      } catch (_) {}
    }
  }
}

export default {
  ReleaseTour,
  buildReleaseTourModel,
  clearPendingRelease,
  markPendingRelease,
  normalizeReleasePayload,
  takePendingRelease,
};
