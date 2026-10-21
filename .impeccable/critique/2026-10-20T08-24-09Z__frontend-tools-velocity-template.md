---
target: frontend/tools/velocity-template/
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
p2_count: 2
target_identity: "file:/Users/ddl/projects/ad-tools-revamp/frontend/tools/velocity-template"
timestamp: 2026-10-20T08-24-09Z
slug: frontend-tools-velocity-template
---
# Critique — Velocity Template

Method: dual-agent (A: DesignReviewA · B: DetectorBrowserB). Mode: Operate. Target: `frontend/tools/velocity-template/`, inspected at 1440×900, 768×1024, 390×844.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No save or render status; context edits leave output stale with only 58% opacity. |
| 2 | Match System / Real World | 2 | "Sync fields" fabricates sample values; "Create query" is an Oracle UPDATE generator with no Oracle framing. |
| 3 | User Control and Freedom | 2 | Clear, Paste, Import, and Sync overwrite content without confirm or undo. |
| 4 | Consistency and Standards | 2 | Two buttons named "Copy"; Wrap's label and aria-pressed encode state twice; invalid tab ownership. |
| 5 | Error Prevention | 1 | Every destructive path is one click; no undo toast despite the pattern existing in the shared stylesheet. |
| 6 | Recognition Rather Than Recall | 2 | Rename is double-click-only; no Velocity reference or context-key legend. |
| 7 | Flexibility and Efficiency | 3 | Context-aware completion, roving tab keys, keyboard resizer; no shortcuts or duplicate action. |
| 8 | Aesthetic and Minimalist Design | 2 | Nine controls across three 38px headers, an inert primary CTA, empty output shows a lone "1". |
| 9 | Error Recovery | 2 | Expert-grade error copy, but no jump-to-error and stale output stays copyable. |
| 10 | Help and Documentation | 1 | No syntax reference, no empty-state guidance, disabled CTA explained only by title. |
| **Total** | | **19/40** | Below the typical 20–32 band; core-loop trust is the drag. |

## Design Specificity Verdict

**Partially authored — 6.5/10.** The language layer is bespoke: custom Monarch tokenizer/theme, directive snippets, 15 Velocity method completions with provenance labels, structural directive validation, and output-JSON errors mapped back to template line/column. The workbench chrome is borrowed: `styles.css:1` imports the Splunk Template stylesheet wholesale, the root class is `splunk-vtl-editor`, and unused Splunk affordances (function panel, undo toast, editor views) ship without being rendered. Swap the language plus `service.js` and the same UI would serve Handlebars. The only Velocity workflow affordance — template → update statement — is Oracle-gated and invisible on web, leaving a generic code-in/text-out split pane.

Deterministic scan: `impeccable detect --json frontend/tools/velocity-template/` returned `[]`, exit 0; verified live against the sibling tool, which returns a finding. Taste-skill lint reports 10 FAIL / 2 WARN; most are inapplicable to an Operate editor (hairline pane borders, focus-ring box-shadows, monospace in a code editor, a ✓ menu glyph). Browser visualization: harness `eval`/browser access is blocked by user policy; used headless Chrome + raw CDP. No user-visible overlay was injected.

## Overall Impression

The live render loop is the product, and it is currently the least trustworthy surface: context edits do not validate or re-render while you type, the previous result stays copyable while dimmed, and the loudest button can never activate in the browser build. Fix the loop's truthfulness before adding expression.

## What's Working

1. Error copy names the construct, location, and remedy ("Unclosed #if block: add a matching #end"), including template line/column for output-JSON failures.
2. Context-aware completion is the spine: real context paths plus template-local variables, labelled by provenance.
3. Desktop pane hierarchy matches the mental model; the 6px separator is keyboard-operable and panes collapse to give the editor room.

## Priority Issues

### [P1] The result pane presents stale output as the artifact
- **What**: Context edits are not in the render path (`main.js:945-960`). While focused, invalid JSON shows no error and the last render stays at 58% opacity; Copy reads `previewEditor.getValue()` unconditionally (`main.js:989-991`). Verified live.
- **Why it matters**: Operators paste this output into downstream systems. A dimmed panel is not provenance; copying a previous render is a production incident.
- **Fix**: Debounce context parsing like the template. Put provenance in the result header ("Last successful render · 12:04:31 · 1.8 KB"), gate or relabel Copy while stale, and announce the state with `aria-live="polite"`.
- **Command**: `$impeccable harden`

### [P1] The primary CTA is permanently dead on web
- **What**: "Create query" requires `sourceIdentity`, assigned only by SQL import (`main.js:899`), whose button is hidden when `!isTauri()` (`main.js:769`). Web users see a disabled primary button with a hover-only explanation.
- **Why it matters**: The loudest control promises an action that cannot exist; the only terminal action (Copy output) is secondary.
- **Fix**: Hide Create query on web exactly like Import SQL, and promote Copy output. In the desktop app, show Import SQL → Create query as explicit sequential state with an inline caption, not a tooltip.
- **Command**: `$impeccable clarify`

### [P1] Destructive actions have no undo
- **What**: Clear template (`main.js:1003`), Paste (`:992`), Import over current content (`:885`), and Sync fields (`main.js:702-715`) overwrite immediately; Sync injects synthetic `sample-*` values and toasts "synchronized".
- **Why it matters**: One misplaced click in the More menu destroys autosaved work. The shared stylesheet already ships `.vtl-undo-toast`; the pattern exists and is unused.
- **Fix**: Route Clear/Paste/Import through the undo toast; rename Sync to "Add missing fields…" with a preview of keys and placeholder values before applying.
- **Command**: `$impeccable harden`

### [P2] Mobile is a 1,900px scroll, not a workflow
- **What**: At ≤940px the grid stacks three panes with `min-height: 1100px`; at 390px the tool is ~1,957px tall and Rendered Result begins after a full screen of scrolling. The ≤640 title-group column rule floats the collapse chevron above its heading; 28px close/add/collapse targets remain.
- **Why it matters**: The edit → verify loop costs a scroll per keystroke-check; the result is below the fold by design.
- **Fix**: Sticky segmented control (Template | Context | Result) showing one pane at ≤940px, preserving the last pane per document. Keep the chevron inline. Raise touch targets to 44px.
- **Command**: `$impeccable adapt`

### [P2] Document tabs and the result menu break their own keyboard models
- **What**: `role="tablist"` owns wrapper divs, not tabs; no `aria-controls` or tabpanel. Rename is double-click-only (`main.js:968-971`); the rename input has no accessible name. The result-type `role="menu"` has no arrow/Escape handling and focus stays on a hidden item after selection (`main.js:730`). Wrap rewrites its name while `aria-pressed` flips. The last tab's close is disabled but looks enabled, keeps `cursor: pointer`, and hover-styles.
- **Why it matters**: Keyboard and screen-reader users cannot rename, navigate menus conventionally, or tell the last-tab close is unavailable.
- **Fix**: Implement the tabs pattern (tablist → tab → tabpanel, roving tabindex, F2 rename, focus to adjacent tab on close), a real menu keyboard model with focus return, a stable "Wrap" label with `aria-pressed` only, and a visible disabled style.
- **Command**: `$impeccable audit`

## Persona Red Flags

**Alex (power user)**: No keyboard path for new document or rename (F2/Enter do nothing); result type is global, so JSON and text templates fight over one setting; no duplicate or close-others action; no jump-to-error from the status line.

**Jordan (first-timer)**: Lands in a dense three-pane editor with no syntax reference; "Sync fields" silently fabricates data; "Create query" looks like the next step but is disabled with a hover-only reason; the starter only greets a virgin database.

**Keyboard / screen reader**: Tabs are announced from an unowned tablist; rename is unreachable; menu arrows and Escape do nothing; two identical "Copy" names; the JSON error fires two `role="alert"` regions; the output has no successful-render announcement.

## Minor Observations

- Two buttons labelled exactly "Copy" (`template.js:22`, `:70`) with one generic toast.
- No save indicator even though autosave is debounced at 300ms; `.vtl-save-status` exists in the shared CSS.
- Text mode forces line numbers, so an empty result shows a lone "1".
- Rename input is 12.8px → iOS focus zoom; truncates at 120 chars with no `maxlength`.
- Tab tooltip is the only rename affordance and reads "Double-click to rename".
- SQL import dialog declares `aria-modal` with no focus trap or inert background (latent, Tauri-only).
- Sync/Format sit in the Context header with equal weight although one mutates data.
- No render timestamp or byte count; the result type persists globally, not per document.
- `.velocity-document-tab-close:hover` is not guarded by `:not(:disabled)`.
- Empty new document has no placeholder or "start from example".

## Questions to Consider

1. If the rendered payload is the product's end state, why is it the least authoritative surface — no provenance, no size, no timestamp, and a live Copy while stale?
2. Who is the blank editor for? The domain-specific starter appears once per database lifetime; should every new document seed from a template gallery?
3. Is this one tool or three — template editing, context scaffolding, Oracle export — and should the web build present the smaller, honest tool?

## Web Interface Guidelines — Findings

### `template.js`
- `template.js:3` — aria-label on a roleless div; duplicates tablist name.
- `template.js:52` / `:74` / `:90` — aria-label on roleless wrappers double-announces the Monaco textbox.
- `template.js:4` — tablist owns wrapper divs; zero tabpanels; no `aria-controls`.
- `template.js:63-66` — menu trigger lacks `aria-haspopup`; no arrow/Escape/focus-return.
- `template.js:69` — toggle name changes while `aria-pressed` flips.
- `template.js:79` — modal has no focus trap, inert background, or initial focus.

### `main.js`
- `main.js:945-960` — context render only on blur; no live validation.
- `main.js:426`, `:968-971` — rename mouse-only; no F2/Enter.
- `main.js:542-545` — rename input has no accessible name.
- `main.js:730` — focus left on hidden menu item after selection.
- `main.js:1055-1058` — Escape does not close menus.
- `main.js:911` — Create query unreachable in web.
- `main.js:432` — lone-document close disabled with no visual affordance.

### `styles.css`
- `styles.css:68-69`, `:160-161` — 28×28px targets below touch minimum.
- `styles.css:74-81` — hover applies to disabled close.
- `styles.css:62-70` — no `:disabled` styling; cursor stays pointer.
- `styles.css:105` — rename input 12.8px triggers iOS zoom.
- `styles.css:278`, `:306-310` — `outline: 0` with `:focus` ring instead of `:focus-visible` (latent).

## Run Notes

- Target slug: `frontend-tools-velocity-template`; ignore list: none.
- Assessments independent; A returned before B's findings entered synthesis.
- Detector: 0 findings, exit 0 (verified functional on sibling tool).
- Browser: headless Chrome/CDP at 1440, 768, 390; overlay injection unavailable because harness eval/browser is policy-blocked.
- Live server and Chrome were started for this review and stopped; temp files removed.
