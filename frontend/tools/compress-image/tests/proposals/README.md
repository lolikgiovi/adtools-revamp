# Compress Image UI proposals

These standalone design prototypes do not modify the production tool or invoke its compression engine. All output values are illustrative. Artwork is displayed from a CSS crop of the screenshot supplied by the user in this chat; the same crop is used on both sides of the mock comparison. No before/after quality claim is made.

Start the existing Vite server with `npm run dev`, then open:

- `/tools/compress-image/tests/proposals/index.html?layout=studio`
- `/tools/compress-image/tests/proposals/index.html?layout=canvas`
- `/tools/compress-image/tests/proposals/index.html?layout=batch`

Use **Sample batch** to switch between PNG and mixed-format content. The navigation preserves that choice in the URL. `review.html?layout=studio` (or `canvas` / `batch`) renders a 390 px mixed-format review frame.

## Directions

| Proposal   | Layout                                                                   | Strength                                               | Tradeoff                                                |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------- |
| Studio     | Compact file rail, centered comparison, visible settings rail            | Clear separation of browsing, judging, and configuring | Three columns leave less preview width on small laptops |
| Canvas     | Comparison with thumbnail strip and settings rail                        | Most space for visual assessment                       | Horizontal strip is slower for scanning a large batch   |
| Batch desk | Compact file ledger and selected-file comparison; grouped settings above | Most direct comparison of dimensions and file sizes    | More analytical; less room for the artwork              |

Recommendation: Studio. It puts the lossy offer inside PNG settings, removes the full-width advice band, replaces the ambiguous Lossy switch with explicit Lossless/Lossy radio choices, and puts downloads beside the content they export.

Shared behavior: lossless PNG is the default; JPEG/WebP have their own quality group; resize is opt-in with labelled bounds. Mixed fixtures include an oversized banner with a row-level warning and phone-bound resize choices. Settings apply to all images. On phones the regions stack and file navigation becomes horizontal where appropriate.

## Review

Applied the user-requested Design Taste principles to composition and restraint; its marketing-specific random direction, imagery quotas, headline scale, and motion requirements do not apply to this app screen. Impeccable Operate guidance governs task hierarchy. The repository's existing surface brief was read as historical context; its old hidden-settings flow and phone bounds are superseded by the current request.

Fresh [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) informed labelled native controls, semantic buttons, keyboard focus, dark native form controls, reduced-motion handling, long-name truncation with full selected filenames, and tabular figures. This is a proposal review, not a claim of a complete production accessibility audit.

Browser checks performed:

- Visually inspected all three desktop variants and their 390 px mixed-format states.
- Studio at the inspected desktop width: viewport and document width both 1196 px; file rail 218 px, comparison 643 px, settings rail 260 px. No document-level horizontal overflow.
- Changed mixed sample, selected Lossy, applied the 1440 × 3200 preset, and switched to Slider. DOM confirmed the selected mode, resize switch, actual input values, visible photo settings, and comparison mode.
- Screenshots: `studio.png`, `canvas.png`, `batch.png`. These show the PNG-only desktop variants.

The launcher-based Impeccable workflow was not executed: it can run or download a bundled binary, which conflicts with the endpoint restrictions recorded in this chat. Existing project context and the skill's written references were used directly. No dependencies were installed.

## Selected Batch Desk refinement

The chosen settings treatment uses three separately outlined native fieldsets: All, PNG Only, and JPEG & WebP Only. The shared background band is removed. All comes first; absent-format groups are hidden and remaining groups fill the available width. Mobile stacks the fieldsets. PNG retains explicit lossless/lossy controls; resize remains opt-in. This modifies only the standalone proposal.

Browser verification: the mixed batch exposes all three groups, each with a 1 px outline; the PNG-only batch exposes All and PNG Only. Desktop document and viewport widths both measured 1280 px, with no horizontal overflow. Applying the portrait preset enables resize and exposes its bounds. `batch-outlined.png` records the refined mixed-batch layout.
