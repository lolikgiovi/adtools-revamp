# AD Tools Interface System

## Direction

Ticket Template is a compact Jira workbench for an Application Designer. It should feel like a focused internal tool: quiet chrome, dense controls, clear inheritance, and strong emphasis only on the next ticket decision.

## Foundations

- Density: workbench-tight; use a 4px rhythm, 9–14px group gaps, and 36px controls.
- Typography: compact system UI; body controls around 13px, labels around 11px, section headings around 13–16px. Use weight and muted text before larger type.
- Depth: light surface layering with quiet 1px borders and restrained shadows only for menus. Avoid heavy card outlines and decorative containers.
- Color: neutral surfaces with the Jira/Ticket Template cyan accent reserved for focus, active controls, links, and meaningful status.

## Ticket Template patterns

- Global defaults: label the section as “Defaults for every ticket” and state that feature settings can override it. Save action should say “Save defaults for all tickets.”
- Feature settings: describe values as feature-specific overrides inherited from Global defaults. Show the feature-level people matrix, including shared AD/SA reviewers.
- Keep the hero focused on the current action and Jira state. Put one-time “how it works” guidance in a dismissible tutorial, auto-show it once, and keep a visible `Show tutorial` trigger for later access.
- Single-value lookup: show a `1 value` hint and one removable identity chip when selected.
- Multi-value lookup: show a `Many values` hint, removable chips, and a remaining entry field.
- Jira people chips: show display name followed by the Jira username in parentheses, e.g. `FASHALLI GIOVI BILHAQ (2399783232)`.
- Lookup fields: use compact input-first controls, Jira autocomplete while typing, Arrow Up/Down navigation, Enter to commit, and Escape to close.
- Option menus: use a compact muted heading, short rows, active-row highlight, local filtering, and the `▼` trigger. Do not use native select or datalist controls.
