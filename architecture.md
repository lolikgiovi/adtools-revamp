# AD Tools Architecture

This document describes the system design of the AD Tools application, its core modules, tool structure, routing, and recommended patterns for UI and business logic separation.

## System Overview

AD Tools is a client-side, modular web application built with Vite that hosts multiple small utilities (tools) under a unified UI. Each tool renders into the main content area and is navigable via hash-based routing. The application uses ES modules for code organization and Vite for development and build processes. Common services (event bus, router, theme, UI components) orchestrate the experience.

## Core Modules

- App (`app/App.js`)
  - Initializes the application, sets up DOM, components, routes, and notifications.
  - Registers tools and manages activation/mounting via `showTool(toolId)`.
  - Coordinates global events with the `EventBus`.
  - Uses ES module imports to load all tools and core components.
- EventBus (`app/core/EventBus.js`)
  - Lightweight pub/sub mechanism to decouple components and tools.
  - Common events include `tool:registered`, `tool:activate`, `page:changed`, `route:change`, and `route:changed`.
- Router (`app/core/Router.js`)
  - Hash-based navigation (`#<route>`). Registers handlers per path and emits route change events.
  - Provides `navigate(path)`, `handleRouteChange()`, `setDefaultRoute()`, and query parsing.
- ThemeManager (`app/core/ThemeManager.js`)
  - Controls light/dark theme by toggling CSS variables/classes at the root.
- BaseTool (`app/core/BaseTool.js`)
  - Shared lifecycle contracts (activate, mount, deactivate) and notification helpers (`showSuccess`, `showError`) that emit via EventBus with inline toast fallback.
- UI Components
  - Sidebar (`app/components/Sidebar.js`): Lists tools by category, handles selection, mobile toggle, and navigation.
  - Breadcrumb (`app/components/Breadcrumb.js`): Reflects current location/tool.

## Tool Architecture

Each tool is implemented as a class that exports from its module and is imported by App for registration and routing. Tools follow a common pattern:

- Files per tool (under `app/tools/<tool-name>/`):
  - `template.js`: Defines HTML template for the tool UI as a string (exported as a module).
  - `styles.css`: Scoped styles for the tool.
  - `main.js`: Tool class implementing lifecycle, DOM bindings, and logic (exported as ES module).
  - `service.js` (optional): Pure business logic functions exported as ES modules.

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
  - Imports and calls service functions with plain values and renders results.
  - Exports the tool class as an ES module for App to import and register.
- `service.js` (business logic)
  - Stateless processing functions (input → output) for validation, formatting, conversion, etc.
  - Contains no DOM or framework-specific code.
  - Exports pure functions as ES modules for easy testing and reuse.

This split is recommended for tools with meaningful processing (e.g., JSON/Base64). For small tools, keep logic in `main.js` or use a very small `service.js` to retain consistency without over-structuring.

## Implemented Tools

- JSON Tools (`app/tools/json-tools/`)
  - Uses Monaco Editor (imported as ES modules) for input; tabs control actions (validate, prettify, minify, stringify, unstringify, escape/unescape, extract keys).
  - UI: binds tabs and buttons, manages error panel and output title.
  - Logic: JSON parsing/formatting/transform operations in `service.js`.
- Base64 Tools (`app/tools/base64-tools/`)
  - UI: tabbed interface and file/text inputs; event binding for actions.
  - Logic: base64 encode/decode for strings and files; isolated in `service.js`.
- UUID Generator (`app/tools/uuid-generator/`)
  - UI: controls to generate/copy single/multiple UUIDs.
  - Logic: uses `crypto.randomUUID()`; simple enough to keep in `main.js`.
- QR Tools (`app/tools/qr-tools/`)
  - UI: QR code generation and customization interface.
  - Logic: uses QRCode library (imported as ES module) for QR generation and canvas manipulation.
- HTML Editor (`app/tools/html-editor/`)
  - Preview iframe defaults to `sandbox="allow-scripts allow-forms"`; `allow-same-origin` is disabled by default for safer isolation.
  - HTML Minify Worker (`minify.worker.js`) provides standards-compliant minification and is reusable by other tools.
- Quick Query (`app/tools/quick-query/`)
  - UI: Monaco SQL editor, Handsontable grids for schema/data, and attachment management.
  - Logic: `AttachmentProcessorService` processes files and uses the HTML Minify Worker for HTML/HTM attachments; async minify awaits worker results; JSON/text handled inline.

## Routing and Navigation

- App registers routes for special pages and each tool ID.
- On navigation, App deactivates the current tool, activates the target tool, and mounts its UI.
- Sidebar navigates via `router.navigate(toolId)` and emits `tool:activate`.

## Security

- HTML Editor preview uses a restricted iframe sandbox (`allow-scripts allow-forms`) by default; `allow-same-origin` is disabled unless explicitly enabled.
- This isolates untrusted content from cookies/storage and prevents parent DOM access.

## Error Handling & UX

- Tools display operation results in an output area; error states are styled distinctly.
- JSON Tools includes error positioning and a collapsible error panel to improve feedback.
- Global notifications: Tools call `BaseTool`’s `showSuccess`/`showError` to publish via EventBus; `App.js` listens and renders toasts. The HTML Editor now uses this shared system.

## Dependencies

- **Monaco Editor**: Imported as ES modules from npm package (`monaco-editor`). Workers are configured using Vite's `?worker` syntax for proper bundling.
- **Handsontable**: Imported from npm (`handsontable`) for grid rendering in Quick Query; CSS is included via ESM import. No global variables or CDN scripts required.
- **QRCode**: Imported as ES module from npm package (`qrcode`) for QR code generation.
- **Vite**: Development server and build tool providing HMR, ES module bundling, and modern tooling.
- **Vitest**: Testing framework with JSDOM environment for unit testing service logic.
- Vanilla JS and CSS; no external framework dependency.

### Editor Migration
- CodeMirror usage has been removed. Editor functionality is now provided by Monaco Editor across tools (e.g., JSON Tools, Quick Query). This ensures consistent ESM-based loading and worker configuration under Vite.

## Build Process & Development

### Development
- `npm run dev`: Starts Vite development server with hot module replacement (HMR)
- Vite serves the application with ES module support and fast refresh
- Monaco Editor workers are handled via Vite's worker bundling

### Build
- `npm run build`: Creates optimized production build in `dist/` directory
- `npm run preview`: Serves the built application for testing
- Post-build step copies `app/` directory to `dist/app` for compatibility

### Testing
- `npm run test`: Runs Vitest with JSDOM environment
- Unit tests focus on service logic with coverage reporting
- Tests are located in `tests/` directory

## Module System & Application Loading

### ES Module Architecture
- Application uses ES modules (`import`/`export`) throughout the codebase
- Main application entry point is `index.html` with a module script that imports `App.js`
- All tools, components, and core modules are imported as ES modules
- No reliance on global `window` assignments for application logic

### Application Initialization
```javascript
// index.html
<script type="module">
  import { App } from './app/App.js';
  document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.app = app; // Only for debugging/console access
  });
</script>
```

### Tool Registration
- Tools are imported directly in `App.js` and instantiated with dependency injection
- Each tool exports its main class from `main.js`
- Services are imported by tools as needed, promoting modularity and testability

## Testing Strategy

- **Unit Tests**: Focus on `service.js` functions (pure logic) with various inputs and edge cases using Vitest
- **Test Environment**: JSDOM provides browser-like environment for DOM-dependent code
- **Coverage**: V8 coverage provider generates detailed coverage reports
- **Test Structure**: Tests import service modules directly, enabling isolated testing of business logic
- **Manual Testing**: UI flows like tab switching, button actions, clipboard, and error display
- Service functions should return consistent data structures or throw errors to simplify assertions

## Extensibility

To add a new tool:

1. Create `app/tools/<tool>/template.js`, `styles.css`, `main.js` (and `service.js` if needed).
2. Export the tool class from `main.js` as an ES module.
3. Import and register the tool in `App.js` by adding it to the imports and `registerTools()` method.
4. The Sidebar will render it via `tool:registered` metadata emitted during registration.

## Design Principles

- **Separation of concerns**: UI vs logic, shared services vs tool-specific code.
- **ES Module Architecture**: Clean imports/exports eliminate global dependencies and improve maintainability.
- **Minimal coupling via EventBus**: Tools communicate with the app and components through events.
- **Stateless services**: Pure functions ease reuse, testing, and debugging.
- **Modern tooling**: Vite provides fast development experience with HMR and optimized builds.
- Keep changes focused and consistent with the existing style.

## Notes & Future Work

- Consider extracting common helpers (clipboard, error formatting) to shared utilities.
- **Development server**: Use `npm run dev` for development with HMR enabled.
- **Production builds**: Use `npm run build` for optimized production artifacts.
- Add light integration tests for routing and tool activation.
- Evaluate lazy-loading of heavy dependencies (e.g., Monaco) to improve initial load times.
- If needed, further standardize the Tool base class (`BaseTool`) usage across tools.

## Migration from Previous Architecture

This application was migrated from a vanilla JS setup without a build tool to the current Vite-based architecture:

### Key Changes Made:
- **Build System**: Migrated from static file serving to Vite development server and build process
- **Module System**: Converted from global `window` assignments to ES module imports/exports
- **Dependencies**: Moved from vendored libraries to npm packages (Monaco Editor, QRCode)
- **Testing**: Added Vitest with JSDOM for comprehensive unit testing
- **Development Experience**: Gained HMR, fast refresh, and modern development tooling

### Benefits Achieved:
- **Faster Development**: HMR provides instant feedback during development
- **Better Testing**: Isolated unit tests with coverage reporting
- **Improved Maintainability**: ES modules eliminate global dependencies
- **Modern Tooling**: Vite provides optimized builds and development experience
- **Dependency Management**: npm packages ensure consistent, updatable dependencies
