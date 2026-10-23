import { UsageTracker } from "./UsageTracker.js";

/** Content-free interaction events; completed work remains in the Tool Use ledger. */
export class BehaviorTracker {
  constructor(eventBus) {
    this.feature = null;
    this.startedAt = null;
    this.onClick = (event) => this.recordControl(event, "click");
    this.onChange = (event) => this.recordControl(event, "change");
    this.onVisibility = () => {
      if (document.hidden) this.leave("hidden");
      else if (this.feature && this.startedAt === null) this.startedAt = Date.now();
    };
    this.onPageHide = () => {
      this.leave("pagehide");
      try {
        UsageTracker.flushSync();
      } catch (_) {
        /* Best effort. */
      }
    };
    this.unsubscribe = eventBus.on("page:changed", ({ page, toolId }) => {
      const feature = toolId || page;
      if (!feature || feature === this.feature) return;
      const previous = this.feature;
      this.leave("navigation");
      this.feature = feature;
      this.startedAt = document.hidden ? null : Date.now();
      this.track(feature, "page_view", { previous: previous || "none" });
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

  leave(reason) {
    if (!this.feature || this.startedAt === null) return;
    this.track(this.feature, "page_leave", { duration_ms: Math.max(0, Date.now() - this.startedAt), reason });
    this.startedAt = null;
  }

  destroy() {
    this.unsubscribe?.();
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("change", this.onChange, true);
    document.removeEventListener("visibilitychange", this.onVisibility, true);
    window.removeEventListener("pagehide", this.onPageHide);
  }
}
