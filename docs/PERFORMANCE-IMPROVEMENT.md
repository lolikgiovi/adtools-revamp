# Performance Improvement Without UX Regression

## Summary

AD Tools should improve memory and CPU behavior without making quick feature switching feel slower. Heavy tools should not be destroyed immediately when the user switches routes. Instead, the app keeps recently used heavy tools warm for a short grace period, then releases their expensive resources only after the user has likely moved on.

Default policy:

- Keep heavy tools warm for 90 seconds after navigation.
- Keep at most 2 idle heavy tools warm.
- Never hard-dispose a tool while it has active background work.

## Lifecycle Policy

Tools can participate in a two-stage lifecycle:

- `onSoftDeactivate()` pauses hidden work when a tool is deactivated but may be resumed soon.
- `onWarmResume()` refreshes state/layout when a warm tool is shown again.
- `onUnmount()` detaches the tool and releases normal mounted resources.
- `disposeHeavyResources(reason)` releases any remaining heavyweight resources after app-level cache eviction.
- `hasActiveBackgroundWork()` blocks delayed hard disposal when a tool must keep running.

The app detaches heavy tool DOM roots into a warm cache instead of immediately unmounting them. Returning before the idle timeout reuses the cached DOM and tool instance, preserving a fast Quick Query <-> Run Query style workflow.

## Implementation Priorities

- Quick Query should flush autosave before hard disposal, then release Monaco editors, Handsontable instances, workers, file references, and transient split state.
- Run Query should preserve active Jenkins/split execution state and log listeners while background work is running.
- Compare Config should release diff workers, sidecar subscriptions, and large parsed/result data when hard-disposed.
- Editor-heavy tools such as JSON Tools, HTML Template, Splunk Template, SQL IN, and Merge SQL are warm-cache candidates.
- Hidden high-frequency work should be paused or debounced where practical, especially resize/layout refreshes and analytics persistence.

## Test Plan

Use focused commands only; do not run `npm run test`.

- `npx vitest run frontend/core/tests/tool-lifecycle.test.js`
- `npx vitest run frontend/core/tests/usage-tracker.test.js`
- `npx vite build --outDir /tmp/adtools-build --emptyOutDir true`

Manual checks:

- Switch quickly between Quick Query and Run Query; the UI should remain fast and preserve state.
- Leave Quick Query idle for more than 90 seconds, return, and confirm saved state restores correctly.
- Run a Jenkins job, navigate away, and confirm execution continues through the minimized status flow.
- Open several heavy tools in sequence and confirm old idle tools are eventually released without disrupting active work.
