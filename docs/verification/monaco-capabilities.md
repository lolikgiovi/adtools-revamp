# Monaco capabilities test startup

## Failure investigated

The reported full-suite run failed in `beforeAll` after 30 seconds, before any
capability assertion ran. That hook only prepares browser shims and dynamically
imports `MonacoOracle.js`. The import loads Monaco's full editor bundle, including
its standard contributions and language registrations. Consequently, the hook's
wall-clock deadline includes Vite's first dependency transformation and evaluation.
The reported suite had unusually high transform, setup, and environment timings.
A focused baseline passed with 8.7 seconds spent in setup plus the test; this supports
load-sensitive module startup, rather than a broken Find/Replace assertion.

Failure cases considered before changing the test:

- Monaco must not initialize before the jsdom browser shims exist.
- The test must keep using the real production module and full editor bundle.
- Find and Replace actions must still be asserted; no mocking or skipped coverage.
- Editor disposal must still run after the test.
- Global hook deadlines and production Monaco behavior must remain unchanged.

## Fix and reproduction

Move browser shims into `vi.hoisted` and use a static import for the production
editor module. Vitest runs the hoisted shims before imports, and dependency loading
occurs during collection rather than within a lifecycle hook's deadline.

```sh
./node_modules/.bin/vitest run frontend/core/tests/monaco-capabilities.test.js
npm run test:ci
```

Verification results are recorded below after execution.

## Verified results (2026-10-14)

- Focused test: passed; collection took 8.51 seconds and editor assertions took
  94 milliseconds. Overall startup still took about 11 seconds, so this change
  removes dependency loading from the hook deadline rather than claiming faster
  Monaco startup.
- `npm run test:ci`: all 1,271 tests across 105 files passed, without skipped tests;
  total duration was 42.70 seconds.
- Existing missing dependency source-map warnings were nonfatal.
- `git diff --check`: passed.

This fixes test lifecycle attribution. Resource contention in the original run is
inferred from its timing breakdown; it was not reproduced as a deterministic hang.
No production editor code or global timeout settings were changed.
