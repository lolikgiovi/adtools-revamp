# Compress Image design handoff

## Overview

This is an Operate surface inside AD Tools: add images, choose compression,
compress, inspect the result, then download individually or as a ZIP.
Preserve the existing application design system and product context.
`docs/PRODUCT.md` records analytics context outside this tool's scope; this
handoff does not repair or replace it or any global design artifact.
Design-taste frontend applies as component guidance here. Marketing-page
layout draws, imagery requirements, and motion floors do not govern this tool.

## Colors

Use inherited HSL tokens from `frontend/styles/themes.css`: `--background`,
`--foreground`, `--card`, `--muted`, `--muted-foreground`, `--primary`,
`--primary-foreground`, `--border`, `--ring`, and `--destructive`.
Local `--ci-surface` and `--ci-subtle` alias card and muted; they do not define
a separate palette. Checkerboards indicate transparency, not decoration.

## Typography

`frontend/styles/reset.css` supplies IBM Plex Sans Variable with sans-serif
fallback and body line-height 1.5. The tool uses 0.875rem body text, a 1.25rem
title, 1rem inspector heading, and smaller supporting text. File sizes and
totals use tabular numerals; filenames wrap anywhere rather than truncate.

## Layout

Desktop setup places upload beside settings. Results precede the inspector.
Side by side is the confirmed default (`this.view = "pair"`), with equal
Original and Result panes; Slider is an explicit alternate view.
At 680px and below, setup becomes one column, preview height changes from
380px to 240px, captions stack, and action rows wrap. Results become compact
three-column row grids: filename and download above Before, After, and Saved.
The pair stays side by side at this breakpoint for direct visual comparison.
These are source-defined responsive results, not browser-verification claims.

## Elevation & Depth

Muted fills, separators, and selected-row shading establish hierarchy.
The comparison divider uses white with a black shadow for image visibility.

## Shapes

Reuse global `--radius` (0.5rem at root); fields use radius minus 2px.
Keep neutral surfaces and compact spacing consistent with the application.

## Components

Reuse `frontend/styles/buttons.css`: primary for Compress images, secondary
for Add images, ZIP, and comparison choices, ghost for Clear all and row
downloads. Shared hover and disabled treatments remain inherited.
Mode-specific quality and resize bounds appear only when relevant. Changed
settings prompt recompression; results state smaller or larger explicitly.
The inspector exposes linked 1–8× zoom, Reset view, pointer pan when zoomed,
arrow-key pan, and plus/minus zoom. Slider uses a labeled native range input.
Linked cursor markers aid matching locations across the two panes.
Processing details stay in a collapsed native disclosure with Copy log.

## Do's and Don'ts

- Do keep real labels, native buttons, nested field labels, and a settings legend.
- Do preserve comparison `aria-pressed` state, image alt text, scoped table
  headers, named results/comparison regions, polite status, and alert errors.
- Do retain 2px token-based focus outlines and focusable preview panes.
- Do expose text states alongside color; keep unavailable actions disabled.
- Don't introduce a new product identity, decorative imagery, or obligatory motion.
- Don't treat this source review as a full accessibility or browser audit.

Evidence: `main.js`, `styles.css` in this tool; `frontend/styles/themes.css`,
`reset.css`, `buttons.css`; Impeccable `reference/document.md` (canonical
section ordering adapted to this scoped handoff). Runtime evidence is separate.

## 2026-10-22 refinement

Upload has a deliberate height and a capped desktop column. Quality label/value
share a line. Batch ready count, savings, Clear all and ZIP download sit together.
Completed compression uses a secondary action until settings change. Comparison
modes form a neutral segmented control; zoom/reset and original/result downloads
are grouped. Transparency uses a low contrast checker. Diagnostics keep themed
links, a separate action row and a bounded keyboard-focusable log surface.
File input naming, selected-image state, invalid field focus and ZIP progress
are exposed to assistive technology.

Reproduce dark viewport checks at `/tools/compress-image/tests/browser.html?theme=dark`
and `/tools/compress-image/tests/review.html?theme=dark` (390px), or append
`&width=768` for the intermediate viewport. The light theme remains the default.

## Setup structure correction

The setup now uses one full-width panel with a 1:2.5 upload/settings split.
Settings fields fill two equal columns; PNG and resize each own their controls
and supporting notes. The run action sits in a right-aligned footer. Below
900px options stack, and below 680px the entire panel stacks with a full-width
run action. This supersedes the capped upload column described above.

Visual review uses the actual empty state, not just the populated functional
harness. Open `tests/layout.html`, or `tests/review.html?layout&width=2394`
for the wide viewport scaled to fit the review window; `?layout` uses 390px.
Both optional groups were expanded and inspected at desktop and phone widths.
