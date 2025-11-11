# AD Tools UI Style Guide

This guide documents the shared UI specifications implemented across AD Tools, with examples tailored to Jenkins Runner.

## Color Scheme

- Primary color uses `hsl(var(--primary, 0 0% 0%))` for a dark-neutral default; hover uses `--primary-hover`.
- Primary text uses `hsl(var(--primary-foreground))` on primary backgrounds.
- Avoid hard-coded reds for neutral UI. Use primary/black for borders and labels. Keep semantic error copy styled via existing `.jr-error`.

## Buttons

- Default button: `btn` — 0.875rem font, 0.625rem × 1.25rem padding.
- Small button: `btn-sm` — 0.8rem font, compact padding.
- Extra-small button: `btn-sm-xs` — 0.75rem font, `0.25rem 0.5rem` padding. Use for dense areas like card actions and table rows.
- Primary variant: `btn btn-primary` — uses the global primary color variables.
- Icon button: `btn btn-icon` — compact square icon hit-area; can be combined with `btn-sm-xs`.

## Timestamp Format

- Display format: `dd/mm/yyyy, hh:mm AM` (12-hour clock with leading zeros).
- Helper: `formatTimestamp(dateLike)` implemented in `jenkins-runner/main.js`.
- Apply to:
  - Template “Updated” meta tags.
  - History table “Time” column (`td.jr-timestamp`).
- Typography: `.jr-timestamp` and `.jr-card-updated` reduce font-size slightly for visual hierarchy.

## Jenkins Runner Templates

- Jobs filter removed from the templates toolbar; only ENV filter remains.
- Card styling:
  - Borders, chips, and soft labels use primary color (not red).
  - Actions use `btn-sm-xs` for compact controls.

## Accessibility

- Maintain focus rings via `--ring` with subdued box shadow.
- Preserve `aria-*` attributes in templates and tabs; ensure keyboard navigation works in modals.

## Usage Examples

```html
<button class="btn btn-primary btn-sm-xs">Run</button>
<span class="jr-card-updated">12/09/2025, 07:45 PM</span>
<td class="jr-timestamp">01/10/2025, 09:02 AM</td>
```

```css
.btn-sm-xs { padding: 0.25rem 0.5rem; font-size: 0.75rem; }
.jr-card-updated, .jr-timestamp { font-size: calc(1em - 2px); }
```

This guide should be applied as you build new tools or refine existing ones to keep a consistent, clean, and accessible UI.