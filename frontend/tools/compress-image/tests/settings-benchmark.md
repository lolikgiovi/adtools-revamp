# Compress Image settings benchmark

Assessed 2026-10-23 against the existing AD Tools implementation. This is a design comparison, not a performance benchmark.

| Reference | Evidence | Useful pattern | Compressor difference |
| --- | --- | --- | --- |
| Compare Config | Source: `../compare-config/styles.css` equivalents at `frontend/tools/compare-config/styles.css:4105`; markup at `frontend/tools/compare-config/template.js:549`. The decision bar was not exercised live because it requires loaded comparison sources. | Three decision groups use the same label row and control row. Labels have 8 px separation from controls; choice controls share a 40 px minimum height. | Compressor headings sit beside controls, while field labels sit above them. The first row has no consistent visual role. |
| QR Generator | Live application at `#qr-tools`, 1280 px viewport; source `frontend/tools/qr-tools/styles.css:28`. Screenshot: `settings-benchmark-qr.png`. | Related fields form pairs; each field has a label above its input with a measured 6 px gap. Groups and rows use a 12 px gap. | Compressor uses independent wrapping flex groups. Adding resize or PNG quality fields changes the composition rather than filling an established field row. |
| Check Image | Live application at `#check-image`, 1280 px viewport; source `frontend/tools/image-checker/styles.css:596`. Screenshot: `settings-benchmark-check-image.png`. | Visible toolbar buttons and environment picker all measured 39.195 px high; controls align as a coherent action row. | Compressor mixes a switch, two-line mode choices, numeric fields, a select, and a slider without a shared alignment scheme. |
| Kafka | Source only: `frontend/tools/kafka/styles.css:407`. | Secondary settings live in an explicit settings disclosure with a 12 px padded popover and consistent label styling. | Useful precedent for distinguishing core versus occasional controls, but a popover would change the requested always-visible three-group structure. Do not copy it for this task. |

## Confirmed style leak

In one fresh browser tab, after app initialization:

1. Open `#compress-image`: Resize label computes to **12 px, weight 400**; QR stylesheet absent.
2. Open `#qr-tools`.
3. Return to `#compress-image`: the same label computes to **14.4 px, weight 600**; QR stylesheet present.

`frontend/tools/qr-tools/styles.css:40` styles every `label` globally. Lazy-loaded styles remain active across route changes. The compressor does not set its own label typography, so its appearance depends on navigation history. The local standalone compressor harness does not reproduce this route sequence.

## Recommended direction

Use Compare Config's alignment model and QR Generator's field pairing, preserving the user's requested separators, labels above fields, visible Lossless/Lossy explanations, and no All label:

- Align group headers on one row: Resize with its switch, PNG Only, and JPEG & WebP Only.
- Put each group's controls below that header. Keep width/height and minimum/target as paired fields.
- Let the PNG choice descriptions determine the mode selector's natural height; align other controls within their own field row rather than centering headings against it.
- Size groups for their contents, with a bounded photo group and flexible PNG/resize space. Do not return to three equally stretched columns.
- Stack whole groups at the responsive breakpoint. Keep vertical separators on desktop and horizontal separators when stacked.
- Scope the QR label rule and explicitly define compressor label typography before judging spacing.
- Verify in the actual app after visiting QR Generator as well as in the standalone expanded-state harness.

No production code was changed during this benchmark. The screenshots show local browser rendering; no deployed or packaged-native proof is claimed.
