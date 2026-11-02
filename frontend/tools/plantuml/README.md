# PlantUML

Vanilla JS integration of [lolikgiovi/plantuml](https://github.com/lolikgiovi/plantuml), adapted from commit
`74bc3e7d69f39e522f511b9a7fd0c828265e257e`. Source workspace validation, templates, formatting, completions,
and the serialized renderer host retain the original behavior. The UI uses Ad Tools' `BaseTool` lifecycle,
native dialogs, shared Monaco workers, IndexedDB, and the already installed JSZip.

- `main.js`: workspace UI, editor models, autosave coordination, and tool lifecycle.
- `service.js`: serialized IndexedDB saves with revision conflict detection.
- `workspace.js`: validated files/folders, moves, paths, and ZIP session format.
- `editor.js`, `completions.js`, `plantuml.js`: language support, snippets, templates, palette, and formatter.
- `renderer.js`: debounced render requests, readiness, stale results, timeouts, and restart.
- `preview.js`, `files.js`: image-document preview, pan/zoom, source/SVG/PNG/ZIP import/export.
- `../../public/plantuml/`: separate rendering document with restrictive CSP and a local-only file loader.
- `../../../scripts/plantuml-assets.mjs`: Vite serves/emits the pinned engine and its support files for web and Tauri.

The engine is loaded only when opening the tool. Source stays on the device; remote includes are disabled.
The iframe requires DOM/font APIs and does not provide CPU isolation. Large diagrams may still pause the UI.
Browser-engine parity with Java PlantUML is not guaranteed; large external standard libraries must be imported as source.

Workspace ZIPs retain the original `.plantuml-workspace.json` format, including source, folders, open tabs, and selection.
Standalone app browser storage belongs to its origin and must be transferred by ZIP. Ad Tools stores its own workspace in
the `adtools-plantuml` IndexedDB database. Storage failures preserve editable in-memory work and show an export warning.

Shortcuts: Cmd/Ctrl+P opens a file picker, Cmd/Ctrl+Shift+P opens commands, Cmd/Ctrl+B toggles files,
Alt+N creates a file, Alt+Z toggles wrapping, Shift+Alt+F formats, and Cmd/Ctrl+S exports the current source.
Monaco also provides its editor context menu and command palette.

For reproducible browser checks, see [verification instructions](../../../docs/verification/plantuml/README.md).

The workspace fills the application content area. Files and Preview can be toggled independently; both
vertical dividers support dragging and arrow keys. The font-size selector changes source text only (12 px
by default) and remembers the preference. The preview percentage always reports the effective scale;
click it for 100% or choose Fit to keep the whole diagram visible as the pane changes size.
Interaction verification is recorded in [UX checks](../../../docs/verification/plantuml/ux/README.md).

File creation, folder creation, and import live in the Workspace header. The activity rail toggles the workspace,
opens file-path search, and opens Commands. Format, font size, colors, and source export live above the source tabs.
Preview controls include hide and maximize; maximize fills the workbench and Escape restores the split view.
Workspace ZIP export remains available in Commands (Cmd/Ctrl+Shift+P).

Source edits render after two seconds of inactivity; file opening and explicit renderer restart remain immediate.
Syntax errors retain the previous diagram and offer navigation to the affected source line. The indentation formatter
handles nested blocks and preserves relative whitespace inside text blocks; non-UML languages remain untouched.
See [formatting and feedback checks](../../../docs/verification/plantuml/quality/README.md) for reproducible cases.
