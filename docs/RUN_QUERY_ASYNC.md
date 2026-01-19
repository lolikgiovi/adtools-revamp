# Run Query: Async Split Execution

This document describes the asynchronous split query execution feature introduced to handle large SQL queries (>90KB) that exceed Jenkins' threshold.

## Overview

When a user submits a query larger than 90KB, the system:
1. Splits the SQL into smaller chunks (by statement boundaries)
2. Opens a split modal showing all chunks
3. Executes chunks sequentially via Jenkins jobs
4. Allows the user to minimize the modal and continue working

The execution runs asynchronously—users can navigate away, use other tools, and return to monitor progress.

## Architecture

### State Management

Split execution state is stored in `this.state.split`:

```js
{
  chunks: [],           // Array of SQL chunk strings
  sizes: [],            // Byte size of each chunk
  index: 0,             // Currently viewed chunk index
  statuses: [],         // Status per chunk: '', 'running', 'success', 'failed', 'error', 'timeout'
  started: false,       // Execution has begun
  cancelRequested: false,
  minimized: false,
  completed: false
}
```

### Global Indicator

A floating indicator (`#jr-global-split-indicator`) is appended to `document.body` and persists across navigation. Clicking it navigates back to run-query and restores the modal.

### State Preservation

When navigating away and back:
- `shouldPreserveState` checks if execution started or completed
- `shouldRestoreModal` auto-restores modal if it was minimized
- DOM elements are re-queried after navigation; the split editor is recreated if disposed

## Edge Cases & Handling Strategies

### 1. Navigation Away and Back

**Status**: ✅ Handled

The modal auto-restores via `shouldRestoreModal` check on mount. Button states (Execute All, Cancel/Dismiss) are restored based on `started` and `completed` flags.

### 2. Log Streaming After Minimize

**Status**: ✅ Expected Behavior

When minimized, the user will only see logs from when they restore the modal. Past log lines streamed while minimized are not buffered—this is acceptable since:
- The main logs panel (`#jenkins-logs`) continues receiving all logs
- History tab records each chunk's build link for full log access in Jenkins

### 3. Cancel Mid-Execution

**Status**: ✅ Handled

Clicking Cancel during execution:
1. Shows confirmation dialog explaining the currently-running Jenkins job cannot be stopped
2. Sets `cancelRequested = true`
3. The execution loop checks this flag before queuing the next chunk
4. Already-triggered Jenkins builds complete server-side (expected)

### 4. Chunk Failure Mid-Batch

**Status**: ⚠️ Partial

If a chunk fails (polling error, timeout, or `Argument list too long`):
- Execution stops at that chunk
- Remaining chunks are not executed
- User sees partial completion in the UI

**Current Strategy**: User must re-run the entire query. The system does not support resuming from a failed chunk.

**Future Enhancement** (optional): Add "Retry Failed" or "Resume from Chunk N" functionality.

### 5. Credential Expiry During Execution

**Status**: ✅ Non-Issue

Jenkins API tokens have a 3-month lifespan. Split executions complete within minutes, so token expiry mid-execution is not a practical concern.

### 6. Global Indicator Click from Different Tool

**Status**: ✅ Handled

When clicking the global indicator:
1. `window.location.hash = "run-query"` triggers navigation
2. Run Query tool mounts, DOM is initialized
3. After 200ms delay, the indicator's click handler:
   - Gets fresh DOM references via `document.getElementById()`
   - Recreates the split editor if needed
   - Re-renders chunk list with click handlers
   - Restores button states based on execution state

### 7. Multiple Split Sessions

**Status**: ✅ Handled

If a user tries to run another large query while a split execution is in progress, the system blocks it with an error message: "A split query execution is already in progress. Complete or cancel it first."

This check occurs before the split size warning dialog, ensuring the user cannot accidentally overwrite an in-progress execution's state.

## User Flow Diagram

```
┌─────────────────┐
│ User runs large │
│ query (>90KB)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Confirm split?  │──No──▶ (abort)
└────────┬────────┘
         │ Yes
         ▼
┌─────────────────┐
│ Split modal     │
│ shows chunks    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Execute All     │
└────────┬────────┘
         │
         ▼
    ┌────┴────┐
    │ Running │◀─────────────────┐
    └────┬────┘                  │
         │                       │
    ┌────┴────┐            ┌─────┴─────┐
    │Minimize │            │ Next chunk│
    └────┬────┘            └─────┬─────┘
         │                       │
         ▼                       │
┌─────────────────┐              │
│ Global indicator│              │
│ (user can work) │              │
└────────┬────────┘              │
         │                       │
         ▼                       │
┌─────────────────┐              │
│ Click indicator │──────────────┘
│ or navigate back│     (restore modal, continue watching)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ All chunks done │
│ ✓ Complete      │
└─────────────────┘
```

## Related Files

- `frontend/tools/run-query/main.js` – Main implementation
- `frontend/tools/run-query/styles.css` – Split modal and indicator styles
- `frontend/tools/run-query/template.js` – Modal HTML structure
