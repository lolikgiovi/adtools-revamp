# React tool sizing

All six React tools use the shared shadcn sizing scale while retaining the deployed AD Tools compositions.
Sizes below are computed CSS pixels with the configured Mira preset, rather than browser zoom measurements.

| Role                                             | Shared size                        |
| ------------------------------------------------ | ---------------------------------- |
| Buttons, inputs, selects, toggles, tab triggers  | 28.8px height; 12.6px text         |
| Tab strip                                        | 36px minimum height                |
| Panel titles and field labels                    | 12.6px; titles use weight 600      |
| Multiline/editor text                            | 13px                               |
| Helper text                                      | 10.8px                             |
| Panel content padding                            | 14.4px                             |
| Toolbar padding                                  | 10.8px vertical, 14.4px horizontal |
| Section gap                                      | 16px                               |
| Outer workspace padding at supported test widths | 21.6px                             |

Shared components own control sizing; tools no longer override tab fonts/heights or mix small and default action controls.
Spacing and editor sizes are centralized in `frontend/src/index.css`. Editor viewport heights and QR canvas dimensions remain
workflow-specific. Shared compact variants remain available for compositions that require them elsewhere.

## Verification, 2026-10-11

Source base: `c0777120` plus working-tree changes. `npm run e2e` passed all 64 tests across 1280×900 and 820×900,
light and dark themes. The final 28 layout/sizing checks also passed after the shared token and title adjustments. Visually inspected all six tools at full-width dark and half-width light layouts; the evidence includes all 24 layout screenshots.
The sizing regression test measures visible controls and tabs in every tool and checks outer padding.
TypeScript, React ESLint, Prettier, `git diff --check`, and direct Vite production build passed.
Existing large bundle warnings remain. Full legacy tests, packaged Tauri, and live backend integrations were not rerun.

Evidence and source hashes: [sizing evidence](evidence/react-tools-sizing-2026-10-11/).
