---
target: Kafka Publish screenshot after split-workbench refinement
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/ddl/projects/ad-tools-revamp/frontend/tools/kafka/template.js"
target_fingerprint: "sha256:98442d980cc7e1eaaac15114c0a2ee6845ee7f7e466f65b1c90f3222dd8e6842"
target_path: /Users/ddl/projects/ad-tools-revamp/frontend/tools/kafka/template.js
timestamp: 2026-09-21T16-28-25Z
slug: frontend-tools-kafka-template-js
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2/4 | The blue Publish button still looks actionable while the topic is empty. |
| 2 | Match system / real world | 3/4 | The publish sequence is recognizable, but advanced fields precede the main payload. |
| 3 | User control and freedom | 3/4 | Topic, template, and editor controls are available without blocking navigation. |
| 4 | Consistency and standards | 2/4 | Repeated Format buttons and dense bordered surfaces create visual noise. |
| 5 | Error prevention | 2/4 | The starter payload can be mistaken for a real payload, and disabled-state reasoning is unclear. |
| 6 | Recognition rather than recall | 2/4 | The primary payload is pushed low; the saved template name is truncated. |
| 7 | Flexibility and efficiency | 3/4 | Templates and bulk publishing help repeat use, but the layout wastes vertical space. |
| 8 | Aesthetic and minimalist design | 1/4 | A three-line payload occupies most of the viewport and leaves a large empty template rail. |
| 9 | Error recovery | 2/4 | The visible state gives little guidance about what must be fixed before publishing. |
| 10 | Help and documentation | 1/4 | The subtitle is generic and the starter JSON does not explain what to replace. |
| **Total** | | **22/40** | Functional, but still not compact enough for an operate-focused tool. |

## Design specificity verdict

The surface is functional but still category-interchangeable: it could be a generic dark API form. The Kafka-specific concepts are present in the topic picker and templates, but the composition does not yet make the publish loop feel fast or confident.

The deterministic detector returned no findings. That is expected: the main problems are proportionality, reading order, truncation, and disabled-state styling, which the detector cannot judge. No live browser or overlay was available for this screenshot-only review.

## Overall impression

The form is tidier than the earlier version, but it is still designed around containing fields instead of completing a publish. The three-line starter payload is the clearest evidence: it occupies roughly half the viewport, while the actual next actions are either disabled, truncated, or below the fold.

## What's working

- Topic selection, favorite, and Publish are grouped into one clear starting row.
- The saved template rail is contextually attached to Publish rather than being a separate page.
- Monaco makes JSON editing readable and familiar for technical users.

## Priority issues

### [P1] The editor is far too tall for its content

**Why it matters:** The payload has three lines, but the editor extends to the bottom of the viewport. This pushes the save-template controls and delivery feedback out of view and makes the interface feel unfinished.

**Fix:** Make Headers a compact collapsed optional section, put Payload directly after Topic/Key, and use a content-aware editor height with a smaller maximum. Keep scrolling inside the workbench rather than making the primary action disappear below the fold.

**Suggested command:** `$impeccable layout`

### [P1] Publish looks enabled even when it is not ready

**Why it matters:** The blue fill communicates “click me,” while the empty topic means the action cannot succeed. The user has to infer why the button does nothing.

**Fix:** Use a neutral disabled treatment until broker, topic, and payload are ready. Add one compact readiness hint near the button, such as `Select a topic to publish`, rather than relying on a muted count line far below.

**Suggested command:** `$impeccable clarify`

### [P1] The visual order gives Headers too much priority

**Why it matters:** Headers are an advanced Kafka concern, while Payload is the primary publish input. The screenshot makes users pass through a large Headers editor before reaching the thing they came to write.

**Fix:** Put Payload immediately after Topic. Move Key and Headers into a single `Options` disclosure or a compact secondary row.

**Suggested command:** `$impeccable distill`

### [P2] The Templates rail wastes space and hides the useful information

**Why it matters:** One template does not justify a 220px side column. The name and topic are truncated, so the rail both consumes space and weakens recognition.

**Fix:** Collapse templates into a compact picker when there are zero or one templates; show a rail only when the list is meaningfully populated. Give the name full width and make Remove a quieter overflow action.

**Suggested command:** `$impeccable distill`

### [P2] The header and controls are heavier than the work itself

**Why it matters:** The large Publish heading, subtitle, borders, and two identical Format buttons consume attention before the user reaches the payload.

**Fix:** Reduce the pane header height, shorten the subtitle, and keep one Format action per editor only when needed. The payload should be the visual anchor, not the card chrome.

**Suggested command:** `$impeccable quieter`

## Persona red flags

**Alex, power user:** Repeated Format controls, a large fixed editor, and the truncated template row slow down the common “load, edit, publish” loop. The useful controls are not keyboard-dense enough for repeat operation.

**Jordan, first-timer:** The generic `example/value` payload can look publishable, while the blue disabled button does not explain the missing topic. The first successful action is not obvious.

**Sam, accessibility-focused user:** The icon and editor focus states need browser validation, but the disabled primary action is already a concern because its color does not clearly communicate unavailable state. The readiness explanation should be text, not only color.

## Minor observations

- `Key optional` is understandable but visually awkward; keep `optional` muted and closer to the field name.
- `prebook ...` and `streaming.g...` are too aggressively truncated to identify the template.
- The star is visually detached from the topic control; place it inside the topic field row or next to the selected topic value.
- A generic `example/value` sample is safer as `{}` or should be clearly marked as a starter to replace.

## Questions to consider

- What if Payload were the first large editor immediately below Topic, with Headers hidden under Options?
- What if the template rail appeared only when there were multiple saved templates?
- What if the Publish button stayed neutral until ready and explicitly said what is missing?
