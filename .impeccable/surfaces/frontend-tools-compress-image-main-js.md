---
version: 1
slug: "frontend-tools-compress-image-main-js"
primary_target: "frontend/tools/compress-image/main.js"
related_targets: ["frontend/tools/compress-image/styles.css"]
---

# Compress Image surface brief

Scope: `frontend/tools/compress-image/` inside the AD Tools app shell. Mode: Operate.

Audience and job: someone with ad or card artwork who wants smaller files. They drop images and expect the tool to
tell them what is worth changing. Most never open settings.

Task: drop, review what the tool found, compress, accept or skip the smaller offer, download.

Constraints: keep the app shell, tokens and button vocabulary; keep every engine guarantee (lossless by default,
format kept, verified outputs, previous result kept on failure); keep `data-ci` hooks for the browser harness;
nothing runs until the user presses Compress (confirmed 2026-10-23).

Size targets (researched 2026-10-23): the widest common phone layout is 440 CSS px at 3x (iPhone 16/17 Pro Max,
1320 × 2868). Full width fits within 1320 × 2868; half width within 660 × 1434. Custom sizes stay in settings.

Lossy offer: after a lossless run, idle workers precompute the reduced-color PNGs and the offer shows real sizes;
applying it is instant and reversible (confirmed 2026-10-23).

## Direction contract

THESIS: The tool reads the images first and asks only what matters, one decision card per finding. It refuses the
category default of a settings form placed before any file exists.

OWN-WORLD: AD Tools shell tokens (zinc neutrals, muted panels, `--radius`), the shared `.btn` vocabulary, one
primary action in the shell's zinc `--primary` (near-black in light theme, near-white in dark). Decision cards are flat muted panels with a sentence and one segmented control (muted track, chosen
segment raised on `--background`); no icons standing in for words, no nested cards.

STORY: The visitor drops files, sees each file's real dimensions and size, answers the size card with one click,
presses Compress, then sees the result and a second card offering smaller PNGs with real before and after sizes.

FIRST VIEWPORT: Empty: the whole tool area is one drop target with a single "Add images" button at its center.
With files: a bar (count and total size left; Settings, Add, Clear, Compress right, Compress primary), the decision
cards under it at full content width, then the file table, then the comparison when a row is selected.

FORM: Advisor stack, position 7 on the ordered list, surface seed key 31837066.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Roll record: `impeccable concept-seed --scope surface --mode operate` printed "SURFACE CONCEPT SEED (key:
31837066; mode: operate; source: api; approved pool: c3b204a1eed6)" and "DEALT INDICES: 7, 6, 1 (index 7 leads)" on
2026-10-23. Dealt cards: Advisor stack (7, lead), Savings ledger (6), Review sheet (1). The decision page closed
unanswered; the same three were put through the structured question tool and the user chose Advisor stack.
