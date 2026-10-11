---
target: all migrated React tools visual audit
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/Users/ddl/projects/ad-tools-revamp-react/frontend/src/tools"
timestamp: 2026-10-11T02-13-44Z
slug: frontend-src-tools
---
# Impeccable Visual Critique — React Tools

**Target:** All migrated React tool pages (`frontend/src/tools`)
**Verdict:** Good — **30/40** across Nielsen’s ten heuristics. This score reflects the final live visual review after the styling pass. The initial screenshot review scored 26/40.

## Heuristic scores

| Heuristic | Score |
|---|---:|
| Visibility of system status | 3/4 |
| Match between system and the real world | 3/4 |
| User control and freedom | 3/4 |
| Consistency and standards | 3/4 |
| Error prevention | 3/4 |
| Recognition rather than recall | 4/4 |
| Flexibility and efficiency of use | 3/4 |
| Aesthetic and minimalist design | 3/4 |
| Help users recognize, diagnose, and recover from errors | 2/4 |
| Help and documentation | 3/4 |
| **Total** | **30/40** |

## What works well

- The shared React shell and shadcn controls give the six routes a consistent navigation and interaction vocabulary.
- Char Counter, TLV Viewer, and QR Tools now explain their empty states; Base64 and JSON fields have readable boundaries and useful initial prompts.
- The split layouts use available desktop width, while JSON, QR, TLV, Char Counter, and UUID reflow at narrower widths. Base64 now places input and output side by side on desktop and stacks them at half width.

## Priority findings and fixes

1. **[P2] Tool surfaces lost their theme colors.** Several styles wrapped OKLCH design tokens in `hsl(...)`, which made borders and panel backgrounds disappear. Replaced those wrappers with direct token use and `color-mix()` where alpha was needed across Base64, Char Counter, JSON, QR, and TLV. Suggested command: `$impeccable colorize`.
2. **[P2] First-use states did not explain what to do.** The Char Counter placeholder looked like sample content; QR began as a blank preview, and TLV had an unhelpful empty result. Added a direct Char Counter prompt and shadcn empty states for QR and TLV. Suggested command: `$impeccable clarify`.
3. **[P2] Half-window layouts made key regions harder to scan.** JSON tabs could crowd, and QR/TLV/JSON content needed a clearer narrow-width arrangement. Tabs now wrap, and those panels stack before they become cramped; Char Counter and UUID also use clearer narrow-width grids. The routes were checked at half-width sizes. Suggested command: `$impeccable layout`.
4. **[P2] Base64 output sat below the input even on desktop.** This pushed the result beyond the initial viewport. The wide layout now aligns input and output in two columns, with the action under the input; at half width, the panels stack. Suggested command: `$impeccable layout`.

## Personas

- **Occasional utility user:** Clearer empty prompts and visibly bounded fields make the first action easier to discover.
- **Frequent developer:** Side-by-side Base64 and JSON work areas reduce scrolling on desktop; responsive layouts preserve readable controls in a half-width window.
- **Keyboard or assistive-technology user:** Native labels and disabled action states remain visible. Error recovery still scores lower because the reviewed empty states do not cover every malformed-input outcome.

## Minor observations

- The JSON “To Table” header-to-cell alignment was questioned during an earlier sample-data review. The final visual pass had empty output and could not confirm that case; table markup was not changed. Verify with representative JSON before treating it as resolved.
- At 640×720, the Base64, TLV, and QR output/preview regions fall below the first viewport after the narrow layout stacks. Scrolling is expected; at the taller half-window used in the parent review, all three remained reachable and readable.
- At 640px, the shared sidebar opens as a full-height drawer over the tool and must be dismissed to return to the content.

## Review questions

For a follow-up pass, which should come first: verify JSON “To Table” alignment with representative data, or tune the Base64 stack for shorter 640×720 viewports?

## Run notes

- Scope: UUID Generator, JSON Tools, Base64 Tools, Char Counter, TLV Viewer, and QR Tools.
- Two independent Impeccable reviews were authorized. One reviewed the baseline screens and final diff; its isolated in-app browser could not show the final screens. The evidence review inspected the final screens in Chrome at 1232×720 and 640×720; it could not freshly inspect UUID because an earlier initial mount had populated a value without pressing Generate. The parent agent checked all six final routes at desktop and half-window sizes, including UUID.
- The final `impeccable detect --json` pass covered five changed TSX files and returned `[]` (zero findings). Base64 had a CSS-only change.
- `npm run typecheck` passed. `git diff --check` passed. No tests were run.
- The first baseline detector attempt had a command typo; a subsequent baseline scan and the final scan completed correctly.
- During the earlier baseline review, the UUID bulk Generate action copied three generated UUIDs to the browser clipboard. The prior clipboard contents were not captured and could not be restored. The final evidence review did not copy or generate values.

## Follow-up correction after user screenshots

The 30/40 “Good” verdict above was overconfident. The screenshots showed a Base64 grid that stretched the Encode action far below its input, plus full-width line-tab bars that wasted space and looked inconsistent. The follow-up fixes the grid with content-sized rows and top alignment, reduces the default textareas, and changes both JSON and Base64 to the same compact shadcn segmented tabs. A fresh live pass showed the action directly below the input and both tab groups compact at desktop width; JSON wraps to two rows at half width. This follow-up did not re-score all six routes.

After the markup update, the Impeccable detector reported three `broken-image` warnings in Base64. They are false positives: the corresponding effects assign object URLs to the image refs and revoke the URLs during cleanup. Typecheck and `git diff --check` passed.
