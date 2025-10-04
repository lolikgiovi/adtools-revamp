# AD Tools Architecture

This document describes the system design of the AD Tools application, its core modules, tool structure, routing, and recommended patterns for UI and business logic separation.

## System Overview

AD Tools is a client-side, modular web application that hosts multiple small utilities (tools) under a unified UI. Each tool renders into the main content area and is navigable via hash-based routing. Common services (event bus, router, theme, UI components) orchestrate the experience.

## Core Modules

- App (`app/App.js`)
  - Initializes the application, sets up DOM, components, routes, and notifications.
  - Registers tools and manages activation/mounting via `showTool(toolId)`.
  - Coordinates global events with the `EventBus`.
- EventBus (`app/core/EventBus.js`)
  - Lightweight pub/sub mechanism to decouple components and tools.
  - Common events include `tool:registered`, `tool:activate`, `page:changed`, `route:change`, and `route:changed`.
- Router (`app/core/Router.js`)
  - Hash-based navigation (`#<route>`). Registers handlers per path and emits route change events.
  - Provides `navigate(path)`, `handleRouteChange()`, `setDefaultRoute()`, and query parsing.
- ThemeManager (`app/core/ThemeManager.js`)
  - Controls light/dark theme by toggling CSS variables/classes at the root.
- BaseTool (`app/core/BaseTool.js`)
  - Optional shared lifecycle contracts for tools (activate, mount, deactivate).
- UI Components
  - Sidebar (`app/components/Sidebar.js`): Lists tools by category, handles selection, mobile toggle, and navigation.
  - Breadcrumb (`app/components/Breadcrumb.js`): Reflects current location/tool.

## Tool Architecture

Each tool is implemented as a class instance (exposed on `window`) that App registers and routes to. Tools follow a common pattern:

- Files per tool (under `app/tools/<tool-name>/`):
  - `template.js`: Defines HTML template for the tool UI as a string (global assignment).
  - `styles.css`: Scoped styles for the tool.
  - `script.js` (current pattern): Tool class implementing lifecycle, DOM bindings, and logic.

### Lifecycle

Typical lifecycle methods in a tool class:

- `activate()` / `deactivate()`: Prepare or tear down state when navigating between tools.
- `mount(container)`: Injects the `template.js` HTML into the main content container.
- `onMount()`: Runs after mount; queries DOM, initializes editors, binds events.
- `bindToolEvents()`: Attaches event listeners to DOM elements.

### UI vs Logic Separation

To improve maintainability and testability, we use a simple separation of concerns:

- `main.js` (UI/controller)
  - Owns lifecycle, DOM, event wiring, tab state, clipboard, error panel UI.
  - Calls service functions with plain values and renders results.
- `service.js` (business logic)
  - Stateless processing functions (input → output) for validation, formatting, conversion, etc.
  - Contains no DOM or framework-specific code.

This split is recommended for tools with meaningful processing (e.g., JSON/Base64). For small tools, keep logic in `main.js` or use a very small `service.js` to retain consistency without over-structuring.

## Implemented Tools

- JSON Tools (`app/tools/json-tools/`)
  - Uses Monaco Editor for input; tabs control actions (validate, prettify, minify, stringify, unstringify, escape/unescape, extract keys).
  - UI: binds tabs and buttons, manages error panel and output title.
  - Logic: JSON parsing/formatting/transform operations suitable for `service.js`.
- Base64 Tools (`app/tools/base64-tools/`)
  - UI: tabbed interface and file/text inputs; event binding for actions.
  - Logic: base64 encode/decode for strings and files; can be isolated in `service.js`.
- UUID Generator (`app/tools/uuid-generator/`)
  - UI: controls to generate/copy single/multiple UUIDs.
  - Logic: uses `crypto.randomUUID()`; simple enough to keep in `main.js`, or provide a minimal `service.js` with `generate(count)` for consistency.

## Routing and Navigation

- App registers routes for special pages and each tool ID.
- On navigation, App deactivates the current tool, activates the target tool, and mounts its UI.
- Sidebar navigates via `router.navigate(toolId)` and emits `tool:activate`.

## Error Handling & UX

- Tools display operation results in an output area; error states are styled distinctly.
- JSON Tools includes error positioning and a collapsible error panel to improve feedback.
- Clipboard operations provide success/error notifications via EventBus.

## Dependencies

- Monaco Editor is vendored under the root `libs/monaco-editor/` and used by JSON Tools for rich editing.
- Vanilla JS and CSS; no external framework dependency.

## Script Loading & Globals

- Tool classes and templates are exposed on `window` for App to instantiate/register.
- If adopting `main.js` + `service.js`, include `service.js` before `main.js` so the controller can import or access the service.
- Maintain consistent global naming: `window.<ToolName>` for controllers, `window.<ToolName>Service` for logic (optional).

## Testing Strategy

- Unit test `service.js` functions (pure logic) with various inputs and edge cases.
- Manual or E2E tests for `main.js` UI flows: tab switching, button actions, clipboard, error display.
- Prefer throwing or returning `{ result, error }` from services to simplify UI assertions.

## Extensibility

To add a new tool:

1. Create `app/tools/<tool>/template.js`, `styles.css`, `main.js` (and `service.js` if needed).
2. Expose the controller class globally (`window.<ToolClass>`).
3. Register in `App.registerTools()` by instantiating the class with `eventBus`.
4. The Sidebar will render it via `tool:registered` metadata.

## Design Principles

- Separation of concerns: UI vs logic, shared services vs tool-specific code.
- Minimal coupling via EventBus; tools communicate with the app and components through events.
- Stateless services to ease reuse and unit testing.
- Keep changes focused and consistent with the existing style.

## Notes & Future Work

- Consider extracting common helpers (clipboard, error formatting) to shared utilities.
- Preview in localhost:5500 since it has hot-reloading enabled.
- Add light integration tests for routing and tool activation.
- Evaluate lazy-loading of heavy dependencies (e.g., Monaco) to improve initial load times.
- If needed, further standardize the Tool base class (`BaseTool`) usage across tools.
