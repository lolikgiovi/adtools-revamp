---
target: splunk-template function reference UI
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/ddl/projects/ad-tools-revamp/frontend/tools/splunk-template/template.js"
target_fingerprint: "sha256:764e6646b6455be0ad7575bf5fbfcd509d22709a39944d7e371a3f9a76347397"
target_path: /Users/ddl/projects/ad-tools-revamp/frontend/tools/splunk-template/template.js
timestamp: 2026-09-13T03-27-53Z
slug: frontend-tools-splunk-template-template-js
closed: true
---
# Splunk Template Function Reference Critique

Method: dual-agent (A: design_review · B: detector_review)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2/4 | Copy, paste, and autosave lack confirmation; clipboard failures are silent. |
| 2 | Match System / Real World | 3/4 | Domain terminology fits experts; Sync and duplicate Format labels need context. |
| 3 | User Control and Freedom | 2/4 | Clear is immediate and help lacks an explicit close/Escape contract. |
| 4 | Consistency and Standards | 2/4 | Pane headers and action hierarchy are inconsistent. |
| 5 | Error Prevention | 2/4 | Function syntax must be transcribed and destructive edits are unguarded. |
| 6 | Recognition Rather Than Recall | 3/4 | Help is contextual but long and requires syntax recall after closing. |
| 7 | Flexibility and Efficiency | 2/4 | No search, insertion, autocomplete, or discoverable shortcuts. |
| 8 | Aesthetic and Minimalist Design | 2/4 | Open help dominates and obscures the primary workflow. |
| 9 | Error Recovery | 2/4 | Context errors are distant and remove the last valid preview. |
| 10 | Help and Documentation | 2/4 | Thorough but static, unsearchable, and not actionable. |
| **Total** | | **22/40** | **Acceptable; significant improvement needed** |

## Design Specificity Verdict

The three-pane template + context to Splunk output model and syntax highlighting are product-specific and strong. The function reference is generic documentation inside an oversized popover. It covers the editor and result, removes insertion context, and behaves like a reading surface rather than an editor tool.

The deterministic detector returned 0 findings for `frontend/tools/splunk-template/template.js`. Source inspection still found incomplete ARIA tab keyboard behavior, a mouse-only separator, a narrow 901–910 px overflow band, and mobile flyout clipping risk. Browser automation was unavailable, so no live overlay was produced.

## Overall Impression

The underlying editor is good; the open Functions experience is not. The primary opportunity is to turn it from documentation users read into a searchable palette users operate.

## What's Working

- Source and context remain spatially connected to a persistent rendered result.
- VTL, JSON, and Splunk output highlighting supports real parsing work.
- Live preview, sample data, autosave, resizing, and Text/Table modes form a strong expert-tool foundation.

## Priority Issues

1. **[P1] Reference overwhelms and occludes the workflow.** Replace the giant popover with a 420–520 px docked inspector/right drawer, preserve editor/result visibility, add explicit close/Escape, and progressively disclose deep pattern documentation. Suggested: `$impeccable distill` / `$impeccable layout`.
2. **[P1] Help is informative but not actionable.** Add search, categories, concise details, Insert at cursor, per-example Copy, Monaco autocomplete, and hover signatures. Suggested: `$impeccable clarify` / `$impeccable onboard`.
3. **[P1] Important actions and outcomes are too quiet.** Add copied/pasted feedback, clipboard errors, Undo after Clear, inline Context Data errors, and retain/dim the last valid preview on error. Suggested: `$impeccable harden`.
4. **[P2] Accessibility and responsive mechanics are incomplete.** Add ARIA tab keyboard behavior, a focusable keyboard-resizable separator, larger supporting text/touch targets, and a viewport-safe mobile sheet. Suggested: `$impeccable audit` / `$impeccable adapt`.
5. **[P2] Header hierarchy is inconsistent and overloaded.** Normalize pane headers, keep common actions first-level, group secondary actions, and separate Clear as destructive. Suggested: `$impeccable layout` / `$impeccable distill`.

## Persona Red Flags

- **Alex, power user:** No search, keyboard route, insertion, or autocomplete; eight equal-weight header actions slow repeated use.
- **Jordan, first-timer:** Velocity, VTL, locale tags, Java patterns, and parsing caveats arrive before task-based guidance.
- **Sam, accessibility-dependent:** Tabs lack standard keyboard navigation, separator is mouse/touch-only, help lacks managed focus, and supporting text is too small.

## Minor Observations

- The native focus ring on Accepted input date formats resembles a selected input.
- The overlay scale and shadow disconnect it from its small trigger.
- Parsing-order caveats belong deeper than everyday function signatures.
- A preview wrap toggle would help long event comparison.

## Questions to Consider

- Is Functions documentation to read, or a palette to operate?
- Which source context must stay visible while selecting a formatter?
- Which three header actions account for most sessions?
- Could autocomplete handle routine recall while the Java catalog stays secondary?
