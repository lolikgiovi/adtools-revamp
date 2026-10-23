import { capabilities } from "../config/capabilities.js";
import { UsageTracker } from "./UsageTracker.js";
import { isTauri } from "./Runtime.js";

const DETAIL_KEYS = new Set([
  "row_count",
  "table_count",
  "column_count",
  "field_count",
  "file_count",
  "file_size",
  "duration_ms",
  "status_code",
  "reason",
  "outcome",
  "data_source",
  "query_type",
  "file_name",
  "table_name",
  "source_tables",
  "has_join",
]);
const STAGES = new Set(["exposed", "opened", "started", "configured", "succeeded", "failed", "blocked", "cancelled"]);

/** Named capability reach and outcomes. Visibility is evidence of exposure, never proof of attention. */
export class CapabilityTracker {
  constructor(eventBus) {
    this.feature = null;
    this.visitId = null;
    this.exposures = new Set();
    this.targets = new Map();
    this.timers = new Map();
    this.runtime = isTauri() ? "tauri" : "web";
    this.observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => this.intersections(entries), { threshold: [0, 0.5] })
        : null;
    this.onClick = (event) => this.interact(event, "click");
    this.onChange = (event) => this.interact(event, "change");
    this.onVisibility = () => {
      if (document.hidden) this.clearTimers();
      else this.scan();
    };
    this.unsubscribers = [
      eventBus.on("page:changed", ({ toolId }) => this.visit(toolId)),
      eventBus.on("usage:event", (event) => this.outcome(event)),
      eventBus.on("usage:toolUse", (use) => this.completedUse(use)),
    ];
    document.addEventListener("click", this.onClick, true);
    document.addEventListener("change", this.onChange, true);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.mutations =
      typeof MutationObserver === "function"
        ? new MutationObserver((records) => {
            if (!records.some((record) => !record.target.closest?.(".monaco-editor"))) return;
            clearTimeout(this.scanTimer);
            this.scanTimer = setTimeout(() => this.scan(), 200);
          })
        : null;
    const root = document.querySelector(".main-content");
    if (root) this.mutations?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
  }

  visit(toolId) {
    if (toolId === this.feature) return;
    this.clearTimers();
    this.observer?.disconnect();
    this.targets.clear();
    this.exposures.clear();
    this.feature = toolId || null;
    this.visitId = crypto.randomUUID();
    if (!capabilities.some((item) => item.tool === toolId)) return;
    this.emit(toolId, "visit", { schema_version: 1, runtime: this.runtime, visit_id: this.visitId });
    this.scan();
  }

  emit(tool, stage, meta) {
    try {
      UsageTracker.trackEvent(tool, `capability_${stage}`, meta);
    } catch (_) {
      /* Best effort. */
    }
  }

  record(definition, stage, details = {}) {
    if (!STAGES.has(stage)) return;
    const meta = { schema_version: 1, capability: definition.id, runtime: this.runtime };
    if (definition.tool === this.feature) meta.visit_id = this.visitId;
    for (const [key, value] of Object.entries(details)) {
      if (!DETAIL_KEYS.has(key)) continue;
      if (key === "file_name") meta[key] = String(value).split(/[\\/]/).pop().slice(0, 255);
      else if (["string", "number", "boolean"].includes(typeof value)) meta[key] = value;
    }
    if (stage === "exposed") meta.available = details.available === true;
    this.emit(definition.tool, stage, meta);
  }

  scan() {
    if (!this.feature || !this.observer) return;
    for (const [element] of this.targets) {
      if (!element.isConnected) {
        clearTimeout(this.timers.get(element));
        this.timers.delete(element);
        this.targets.delete(element);
        this.observer.unobserve(element);
      }
    }
    const root = document.querySelector(`[data-tool-root="${this.feature}"]`);
    if (!root) return;
    for (const definition of capabilities.filter((item) => item.tool === this.feature)) {
      const selector = [definition.open, definition.start, definition.change, definition.expose].filter(Boolean).join(",");
      if (!selector) continue;
      for (const element of root.querySelectorAll(selector)) {
        if (!this.targets.has(element)) {
          this.targets.set(element, { definitions: new Set(), visible: false });
          this.observer.observe(element);
        }
        this.targets.get(element).definitions.add(definition);
        this.scheduleExposure(element);
      }
    }
  }

  intersections(entries) {
    for (const entry of entries) {
      const target = this.targets.get(entry.target);
      if (!target) continue;
      target.visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      if (!target.visible) {
        clearTimeout(this.timers.get(entry.target));
        this.timers.delete(entry.target);
      } else this.scheduleExposure(entry.target);
    }
  }

  scheduleExposure(element) {
    const target = this.targets.get(element);
    if (!target?.visible || document.hidden || this.timers.has(element)) return;
    const available = !element.disabled && element.getAttribute("aria-disabled") !== "true";
    if (
      [...target.definitions].every((item) => this.exposures.has(`${item.id}:${available && (!item.desktop || this.runtime === "tauri")}`))
    )
      return;
    this.timers.set(
      element,
      setTimeout(() => {
        this.timers.delete(element);
        if (!element.isConnected || document.hidden || !target.visible) return;
        const stillAvailable = !element.disabled && element.getAttribute("aria-disabled") !== "true";
        if (stillAvailable !== available) {
          this.scheduleExposure(element);
          return;
        }
        for (const definition of target.definitions) {
          const eligible = available && (!definition.desktop || this.runtime === "tauri");
          const key = `${definition.id}:${eligible}`;
          if (this.exposures.has(key)) continue;
          this.exposures.add(key);
          this.record(definition, "exposed", { available: eligible });
        }
      }, 1000),
    );
  }

  interact(event, kind) {
    if (!(event.target instanceof Element)) return;
    const root = event.target.closest("[data-tool-root]");
    if (!root?.closest(".main-content")) return;
    for (const definition of capabilities.filter((item) => item.tool === root.dataset.toolRoot)) {
      for (const [key, stage] of kind === "change"
        ? [["change", "configured"]]
        : [
            ["open", "opened"],
            ["start", "started"],
          ]) {
        if (!definition[key]) continue;
        const control = event.target.closest(definition[key]);
        if (control && root.contains(control) && !control.disabled && control.getAttribute("aria-disabled") !== "true") {
          this.record(definition, stage);
        }
      }
    }
  }

  completedUse(use) {
    for (const definition of capabilities) {
      if ((definition.useTool || definition.tool) !== use.tool_id) continue;
      if (definition.uses?.some((action) => (action.endsWith("*") ? use.action.startsWith(action.slice(0, -1)) : action === use.action))) {
        this.record(definition, "succeeded", use.meta);
      }
    }
  }

  outcome({ featureId, action, meta = {} }) {
    if (action === "schema_load" && meta.automatic) return;
    for (const definition of capabilities) {
      if ((definition.useTool || definition.tool) !== featureId) continue;
      let stage = definition.events?.[action];
      if (stage === "outcome")
        stage = { success: "succeeded", failure: "failed", failed: "failed", blocked: "blocked", cancelled: "cancelled" }[meta.outcome];
      if (stage === "render_failure") stage = meta.outcome === "empty" ? "blocked" : meta.outcome !== "valid" ? "failed" : null;
      if (stage === "validation_failure")
        stage = meta.outcome === "invalid_input" ? "blocked" : ["http_error", "unavailable"].includes(meta.outcome) ? "failed" : null;
      if (stage === "minification") stage = meta.success_count > 0 ? "succeeded" : "failed";
      if (stage === "succeeded" && action === "attachment_added" && !(meta.added_count > 0)) continue;
      if (stage) this.record(definition, stage, meta);
    }
  }

  clearTimers() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  destroy() {
    this.clearTimers();
    clearTimeout(this.scanTimer);
    this.observer?.disconnect();
    this.mutations?.disconnect();
    this.unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("change", this.onChange, true);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}
