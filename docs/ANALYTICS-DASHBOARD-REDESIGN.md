# Analytics Dashboard Assessment

Date: 2026-10-14. Scope: adoption and user behavior. Build preference: direct implementation in code, confirmed by the user.

## Observed Problems

The live route exposes 46 peer tabs. At the user's narrow browser width, only the first few are visible; report discovery requires horizontal scrolling. Opportunities has 14 columns and places its explanation near the right edge, outside the initial viewport.

Overview contains seven equally weighted values. Clicking Uncaught Errors opens Row Details containing the same metric, value, and context, rather than error evidence. Verified in the live browser.

The Opportunities query labels a descending successful-use ranking as Priority. Its repeat-users calculation is `uses >= 2` in the selected period; calling this Retention implies return behavior that was not measured. Its friction numerator combines tracked error/validation events and uncaught reports. Dividing by successful uses is a reports-per-use ratio, not a failure probability; one report can also overlap another reporting stream.

Only Overview, Opportunities, Who, and Recent Activity accept the selected range in the current frontend. A redesign must not imply that all existing reports share this scope.

## Existing Evidence

The inspected 30-day view showed 34 active users and 4,994 successful uses. Quick Query accounted for 2,322 successful uses, about 46.5% of that total, across 31 users. This suggests concentrated usage worth exploring; it does not prove preference or satisfaction.

Opportunities showed 31 of 31 Quick Query users with at least two uses. This is repeated use in the selected window, not day-to-day retention. Compare Config showed 17 friction reports beside 37 successful uses and 4 users. Small populations and unequal event definitions need visible caveats.

## Proposed Information Architecture

Keep the shared AD Tools visual system. Replace the report strip with a small primary navigation: Overview, Tools, People, and Explore Reports. Move technical diagnostics and tool-specific report definitions into a grouped, searchable report picker. Preserve custom reports.

Overview should answer: How much real activity is recorded? Which tools account for it? How broad is adoption? What repeated behavior is visible? Tool rows should lead to action breakdowns and relevant evidence while preserving supported date scope.

Use a compact summary, a ranked tool comparison with visible counts and proportional bars, and clearly worded observations grounded in exact data. Hide generic row search on summary views. Show report-specific scope, refresh state, and metric definitions. Do not display fabricated comparison deltas.

## Web Interface Guidelines Findings

Source: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md (fetched 2026-10-14).

- `frontend/pages/analytics-dashboard/template.js:16` — password input lacks a label and name.
- `frontend/pages/analytics-dashboard/template.js:18` — authentication error lacks a live region.
- `frontend/pages/analytics-dashboard/template.js:61` — loading status lacks a live region; uses three dots instead of an ellipsis.
- `frontend/pages/analytics-dashboard/template.js:68` — overlay lacks dialog semantics; hidden content remains in the accessibility tree.
- `frontend/pages/analytics-dashboard/template.js:72` — close icon button lacks an accessible name.
- `frontend/pages/analytics-dashboard/main.js:472` — clickable table rows lack keyboard access or a semantic detail action.
- `frontend/pages/analytics-dashboard/main.js:248` — report selection is not reflected in the URL.
- `frontend/pages/analytics-dashboard/styles.css:594` — modal motion lacks a reduced-motion override.

## Verification Boundary

This assessment combines live browser observations and source inspection. No implementation, deployment, backend changes, or retention/cohort proof has occurred. Verify the selected implementation in both themes, desktop and the user's narrow viewport, with keyboard interaction, empty/error states, request races, custom reports, and pagination. Record reproducible checks and screenshots when implementation is complete.
