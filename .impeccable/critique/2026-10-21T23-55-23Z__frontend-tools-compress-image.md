---
target: frontend/tools/compress-image
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/ddl/projects/ad-tools-revamp/frontend/tools/compress-image"
timestamp: 2026-10-21T23-55-23Z
slug: frontend-tools-compress-image
---
Method: dual-agent (A: /root/design_review; B: /root/technical_review).

Compress Image looks unfinished because spacing, control grouping and preview chrome compete with the images. This is an Operate surface; marketing imagery and animation floors do not apply.

Priority findings:
- P1 styles.css:313: High contrast full-pane checker overwhelms portrait images. Use a quiet canvas and subtler transparency pattern.
- P2 styles.css:61: Upload stretches to settings height. Give it deliberate sizing and compact the completed setup.
- P2 main.js:44: Quality output occupies its own grid row. Align label/value and normalize control rhythm.
- P2 main.js:571: Results are a dense sentence while Compress again remains dominant. Group ready count, savings and ZIP action by results.
- P2 main.js:382 and styles.css:400: Details read as raw console spill. Theme the link, separate toolbar and explanatory text, give logs a bounded surface.
- P2 main.js:417: Comparison toolbar scatters modes, zoom, reset and download. Group related controls.

Design specificity: appropriate familiar utility components, but no composed image workspace. Preserve existing AD Tools identity. No decorative imagery required.

Nielsen heuristic scores, provisional /4:
System status 3; real-world match 3; control/freedom 2; consistency 2; prevention 3; recognition 2; efficiency 3; minimalist design 2; recovery 2; help 2. Total 24/40.

Strengths: lossless default; explicit before/after sizes; batch ZIP; linked zoom and keyboard alternatives; collapsed diagnostics.
Cognitive load: settings lack grouping, rather than excessive options in a single choice.
Emotional journey: clear upload, weak completed payoff, demanding comparison chrome.
Personas: first-time user must infer clickable filename; power user travels between table and inspector; keyboard/screen-reader user encounters unnamed file input and visual-only selection.

Web Interface Guidelines findings:
main.js:38 - unnamed focusable file input.
main.js:171 - quality errors lack field association/focus; height errors focus width.
main.js:609 - ZIP generation lacks announced progress.
main.js:376 - selected image state exposed only visually.

Detector: 3 broken-image warnings at main.js 421, 422, 424; false positives because URLs and dimensions are assigned synchronously at 428-433.
Design Taste lint: 3 flags (table divider, transparency gradient, comparison divider shadow). Functional exceptions; do not remove solely for marketing-page compliance.
Evidence: user dark screenshots, current source, live localhost desktop and 390px harness, both PASS 39 checks. Live harness uses light theme; dark evidence is supplied screenshots. No packaged-native proof. No product files edited.
Recommended next pass: layout, quieter preview chrome, polish diagnostics.
Questions skipped: request was a diagnostic review; concrete next-pass recommendation supplied.
