import { UsageTracker } from "./UsageTracker.js";

/** Content-free interaction events; completed work remains in the Tool Use ledger. */
export class BehaviorTracker {
  constructor(eventBus) {
    this.feature = null;
    this.startedAt = null;
    this.onClick = (event) => this.recordControl(event, "click");
    this.onChange = (event) => this.recordControl(event, "change");
    this.visitOpen = false;
    this.onVisibility = () => {
      if (document.hidden) this.pause();
      else if (this.visitOpen && this.startedAt === null) this.startedAt = Date.now();
    };
    this.onPageHide = () => {
      this.leave("pagehide");
      try {
        UsageTracker.flushSync();
      } catch (_) {
        /* Best effort. */
      }
    };
    this.unsubscribe = eventBus.on("page:changed", ({ page, toolId, source }) => {
      const feature = toolId || page;
      if (!feature || feature === this.feature) return;
      const previous = this.feature;
      this.leave("navigation");
      this.feature = feature;
      this.visitOpen = true;
      this.startedAt = document.hidden ? null : Date.now();
      this.track(feature, "page_view", { previous: previous || "none", ...(source ? { source } : {}) });
    });
    document.addEventListener("click", this.onClick, true);
    document.addEventListener("change", this.onChange, true);
    document.addEventListener("visibilitychange", this.onVisibility, true);
    window.addEventListener("pagehide", this.onPageHide);
  }

  track(feature, action, meta) {
    try {
      UsageTracker.trackEvent(feature, action, meta);
    } catch (_) {
      /* Best effort. */
    }
  }

  recordControl(event, kind) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".monaco-editor")) return;
    const control = target.closest(kind === "click" ? 'button, [role="tab"], summary' : "input, select, textarea");
    if (!control || control.disabled || !control.closest(".main-content")) return;
    if (kind === "change" && ["password", "hidden", "file"].includes(control.type)) return;
    const feature = control.closest("[data-tool-root]")?.dataset.toolRoot || this.feature;
    if (!feature) return;
    // Only conventional static button IDs are retained. No labels, values, filenames,
    // data-action/document/row IDs, text, selected options, or user-generated identifiers.
    const identifier = /^btn[A-Z][A-Za-z]{0,70}$/.test(control.id) ? control.id : control.tagName.toLowerCase();
    this.track(feature, `control_${kind}`, {
      control: identifier,
      control_type: control.getAttribute("role") === "tab" ? "tab" : control.tagName.toLowerCase(),
      input_method: kind === "click" ? (event.detail === 0 ? "keyboard" : "pointer") : "change",
    });
  }

  visibleMs() {
    return this.startedAt === null ? 0 : Math.max(0, Date.now() - this.startedAt);
  }

  // A hidden window pauses the visit: page_hidden carries the visible time so far, and the visit resumes on return.
  pause() {
    if (!this.visitOpen || this.startedAt === null) return;
    this.track(this.feature, "page_hidden", { duration_ms: this.visibleMs() });
    this.startedAt = null;
  }

  // Each page_view closes with exactly one page_leave; its duration is the visible time since the last pause.
  leave(reason) {
    if (!this.feature || !this.visitOpen) return;
    this.track(this.feature, "page_leave", { duration_ms: this.visibleMs(), reason });
    this.startedAt = null;
    this.visitOpen = false;
  }

  destroy() {
    this.unsubscribe?.();
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("change", this.onChange, true);
    document.removeEventListener("visibilitychange", this.onVisibility, true);
    window.removeEventListener("pagehide", this.onPageHide);
  }
}
