import { UsageTracker } from "./UsageTracker.js";

/** Best-effort workflow outcomes. Callers provide bounded facts, never contents or error messages. */
export function trackWorkflowEvent(feature, action, meta = {}) {
  try {
    UsageTracker.trackEvent(feature, action, meta);
  } catch (_) {
    // Analytics must never change the outcome of the operation being measured.
  }
}
