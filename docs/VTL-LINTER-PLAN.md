# VTL+JSON Editor — Implementation Plan

## Goal

Build a new tool (`vtl-json-editor`) for editing AWS API Gateway–style VTL mapping templates: Velocity logic directives at the top, JSON response body below. Includes syntax highlighting, formatting, linting, and (in Tauri/desktop) live validation against an API endpoint with user-provided input JSON.

## Use Case

Templates follow this pattern:

```vtl
#set($inputRoot = $input.path('$'))
#set($userId = $inputRoot.userId)
#if($inputRoot.items && $inputRoot.items.size() > 0)
#foreach($item in $inputRoot.items)
{
  "userId": "$userId",
  "itemName": "$item.name",
  "count": $item.count
}#if($foreach.hasNext),#end
#end
#else
{
  "error": "No items found"
}
#end
```

---

## Architecture

### New Files

```
frontend/
  core/
    VtlMonaco.js          ← shared VTL language registration (highlighter, completion, theme)
    VtlFormatter.js        ← shared VTL+JSON formatter
    VtlLinter.js           ← shared VTL linter (velocityjs parse + structural checks)
  tools/
    vtl-json-editor/
      main.js              ← BaseTool subclass
      template.js           ← HTML template
      service.js            ← tool-specific logic (endpoint validation, input parsing)
      styles.css            ← layout + editor styling
      icon.js               ← SVG icon
      tests/
        VtlFormatter.test.js
        VtlLinter.test.js
        service.test.js
```

### Modified Files

```
frontend/config/tools.json  ← register new tool
```

### No Refactor

The existing `splunk-template` tool keeps its own inline VTL tokenizer. Shared core modules are available for future migration but not required now.

---

## Component Breakdown

### 1. VtlMonaco.js — Shared Highlighter + Completion + Theme

**Language ID**: `vtl-json`

**Monarch Tokenizer Design**

The tokenizer uses a state machine to handle the VTL→JSON transition:

```
States:
  root        — VTL directive zone (#set, #if, #foreach, etc.)
  jsonBody    — JSON zone (entered when { or [ appears at line start)
  jsonString  — inside a JSON string (still recognizes $variables)
  comment     — VTL block comment #* ... *#
```

Transition logic:
- In `root`: tokenize VTL directives, variables, comments as normal
- When a `{` or `[` appears at the **start of a line** (after optional whitespace) and we're not inside a directive, transition to `jsonBody`
- In `jsonBody`: tokenize JSON structure (keys, colons, commas, braces, brackets, numbers, booleans, null) but still recognize `$variable` / `$!{var}` references inside JSON string values
- VTL directives can reappear inside JSON (e.g., `#if` / `#end` wrapping JSON blocks) — handled by checking for `#` at line start within `jsonBody` state

Token classes:

| Token | Class | Color (dark theme) |
|-------|-------|-------------------|
| `#set`, `#if`, `#foreach`, etc. | `keyword.directive` | `#c586c0` (purple) |
| `#else`, `#elseif`, `#end` | `keyword.control` | `#c586c0` |
| `$variable`, `$!{var}` | `variable.vtl` | `#4ec9b0` (teal) |
| JSON key (before `:`) | `string.key.json` | `#9cdcfe` (light blue) |
| JSON string value | `string.value.json` | `#ce9178` (orange) |
| JSON number | `number.json` | `#b5cea8` (green) |
| JSON boolean/null | `constant.json` | `#569cd6` (blue) |
| VTL comment `##` / `#* *#` | `comment` | `#6a9955` (green) |

**Completion Provider**

- VTL directives: `#set`, `#if`, `#elseif`, `#else`, `#end`, `#foreach`, `#macro`, `#define`, `#parse`, `#include`, `#stop`, `#break`
- Snippet completions:
  - `#set($… = …)` → `#set(\${1:var} = \${2:value})`
  - `#if(…)` → `#if(\${1:condition})\n  \${2}\n#end`
  - `#foreach($… in …)` → `#foreach(\${1:item} in \${2:list})\n  \${3}\n#end`
- JSON snippets: `{ "key": "value" }`, etc.
- No AWS-specific completions ($input, $util, $context) per requirements

**Theme**: `vtl-json-dark` — based on `vs-dark` with custom token colors above

**API** (mirrors `MonacoOracle.js` pattern):
```js
export const VTL_JSON_LANGUAGE_ID = "vtl-json";
export const VTL_JSON_THEME = "vtl-json-dark";
export function setupVtlJsonLanguage();  // register language + tokenizer + completions + theme
export function createVtlJsonEditor(container, options = {});  // create editor instance
```

---

### 2. VtlFormatter.js — Shared VTL+JSON Formatter

**Strategy**: Parse template into two zones, format each independently, then recombine.

```
Input template
      │
      ▼
  Split into zones
  ┌──────────────────┐
  │ VTL Logic Zone   │  Lines starting with # directives or blank
  │ (#set, #if, etc) │
  ├──────────────────┤
  │ JSON Body Zone   │  Lines containing JSON structure
  │ (may contain     │  (may also have inline VTL directives)
  │  $variables)     │
  └──────────────────┘
      │
      ▼
  Format VTL zone        Format JSON zone
  - indent #if/#foreach  - parse as best-effort JSON
  - wrap long #set       - indent with 2 spaces
  - normalize spacing    - preserve $variable refs in strings
      │                       │
      └───────────┬───────────┘
                  ▼
            Recombine zones
```

**VTL Zone Formatting Rules**:
1. Each `#set`, `#if`, `#foreach`, `#macro`, `#define` on its own line
2. Indent body of `#if`/`#foreach`/`#macro`/`#define` by 2 spaces
3. `#else` / `#elseif` aligns with matching `#if`
4. `#end` aligns with opening directive
5. Normalize whitespace inside `#set(...)` and `#if(...)`
6. Preserve comments and blank lines between directive blocks

**JSON Zone Formatting Rules**:
1. Parse and pretty-print JSON with 2-space indent
2. Preserve `$variable` / `$!{var}` references inside string values (don't escape them)
3. Preserve VTL directives that wrap JSON blocks (e.g., `#foreach` wrapping JSON objects)
4. Handle trailing commas before `#end` / `#if` (common pattern: `}#if($foreach.hasNext),#end`)

**Edge Cases**:
- VTL directives inside JSON values: `{"name": "$item.name"}` — treat as JSON string with embedded VTL
- `#if` / `#end` wrapping entire JSON objects — indent the JSON within the directive block
- Single-line VTL+JSON: `#set($x = "a"){ "key": "$x" }` — split across lines

**API**:
```js
export function formatVtlJson(input, options = {});
// options: { tabSize: 2, insertSpaces: true, vtlZoneSeparator: "\n\n" }

export function minifyVtlJson(input);
// Collapse VTL to single lines, compact JSON (no whitespace)
```

---

### 3. VtlLinter.js — Shared VTL Linter

**Two-phase approach**:

#### Phase 1: Structural Checks (instant, no dependencies)

Run on every content change (debounced 300ms):

1. **Unmatched `#end`** — count `#if`/`#foreach`/`#macro`/`#define` opens vs `#end` closes
2. **Unclosed directives** — `#if` without matching `#end`
3. **Mismatched `#else`/`#elseif`** — must be inside an `#if` block
4. **Unclosed braces** — `{` / `}` count mismatch (in JSON zone)
5. **Unclosed brackets** — `[` / `]` count mismatch
6. **Unclosed VTL references** — `$!{` without closing `}`
7. **Unclosed parentheses** in directives — `#set($x = ` without `)`
8. **Invalid JSON structure** — best-effort JSON parsing of the body zone (ignoring VTL expressions)

#### Phase 2: Velocity Parse (uses velocityjs)

Uses the `velocityjs` package (already in `package.json`) to parse the VTL:

```js
import Velocity from "velocityjs";

function parseVtl(template) {
  try {
    const ast = Velocity.parse(template);
    return { valid: true, ast };
  } catch (e) {
    return { valid: false, error: e.message, line: e.line, column: e.column };
  }
}
```

Catches: syntax errors in VTL directives, invalid variable references, malformed expressions.

**Monaco Integration**:

Lint results are reported as Monaco markers (squiggly underlines in the editor):

```js
export function lintVtlJson(template) {
  const diagnostics = [];
  diagnostics.push(...checkStructure(template));
  diagnostics.push(...checkVelocityParse(template));
  return diagnostics;
  // Each: { line, column, severity, message }
}

export function applyDiagnosticsToEditor(editor, diagnostics) {
  const model = editor.getModel();
  if (!model) return;
  const markers = diagnostics.map(d => ({
    severity: monaco.MarkerSeverity[...],
    startLineNumber: d.line,
    startColumn: d.column || 1,
    endLineNumber: d.line,
    endColumn: ...,
    message: d.message,
  }));
  monaco.editor.setModelMarkers(model, "vtl-json-linter", markers);
}
```

**Severity Guidelines**:

| Check | Severity |
|-------|----------|
| Unmatched `#end` | Error |
| Unclosed directive | Error |
| velocityjs parse error | Error |
| Invalid JSON structure | Warning (VTL may make it valid at runtime) |
| Unclosed `$!{` reference | Warning |
| `#else` outside `#if` | Error |

---

### 4. vtl-json-editor Tool

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ VTL+JSON Editor                                    [toolbar] │
├─────────────────────────────────┬───────────────────────────┤
│                                 │                           │
│  Monaco Editor                  │  Preview / Validation     │
│  (vtl-json language)            │  ┌─────────────────────┐  │
│                                 │  │ Input JSON          │  │
│                                 │  │ (Monaco, json lang) │  │
│                                 │  │                     │  │
│                                 │  ├─────────────────────┤  │
│                                 │  │ Output / Errors     │  │
│                                 │  │ (rendered result or │  │
│                                 │  │  lint diagnostics)  │  │
│                                 │  └─────────────────────┘  │
├─────────────────────────────────┴───────────────────────────┤
│ Status bar: lint status, line/col                           │
└─────────────────────────────────────────────────────────────┘
```

**Toolbar buttons**:
- **Format** — runs `formatVtlJson()`
- **Minify** — runs `minifyVtlJson()`
- **Lint** — runs linter and shows diagnostics
- **Copy** / **Paste** / **Clear**
- **Validate** (Tauri only) — sends template + input JSON to API endpoint
- **Load Example** — inserts a sample VTL+JSON template

#### Input JSON Panel (Right Side)

- Small Monaco editor with `json` language
- User provides JSON input that simulates `$input.path('$')` context
- Supports multiple JSON objects (array input)
- Persisted in localStorage per tool instance

#### Output Panel

Shows one of:
1. **Lint diagnostics** — list of errors/warnings from `lintVtlJson()`
2. **Local render result** — velocityjs renders the template with the provided input JSON (best-effort)
3. **API validation result** — when using "Validate" button in Tauri, shows the actual API response

#### Tauri/Desktop: API Endpoint Validation

**Flow**:
1. User writes VTL template (left panel)
2. User provides input JSON (right panel, top)
3. User clicks "Validate" button
4. Tool sends `POST {endpoint}/validate` with `{ template, input }`
5. Response: `{ valid, output, errors }`
6. Display result in output panel

**Configuration**:
- Endpoint URL stored in localStorage (`tool:vtl-json-editor:endpoint`)
- Configurable via settings input in toolbar/modal
- Uses Tauri HTTP client or `fetch`

**Implementation** (`service.js`):
```js
export async function validateWithEndpoint(endpoint, template, inputJson) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template, input: inputJson }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function renderLocally(template, context) {
  try {
    const engine = new Velocity(template);
    return { output: engine.render(context), error: null };
  } catch (e) {
    return { output: null, error: e.message };
  }
}
```

---

### 5. Registration in tools.json

```json
{
  "id": "vtl-json-editor",
  "name": "VTL+JSON Editor",
  "category": "config",
  "icon": "vtl-json",
  "showInSidebar": true,
  "showOnHome": true,
  "enabled": true,
  "order": 75
}
```

---

## Implementation Order

| Phase | Task | Dependencies | Est. Effort |
|-------|------|-------------|-------------|
| 1 | `VtlMonaco.js` — Monarch tokenizer + theme + completion | None | 1 day |
| 2 | `VtlLinter.js` — structural checks + velocityjs integration | None | 0.5 day |
| 3 | `VtlFormatter.js` — VTL+JSON formatter | None | 1 day |
| 4 | `vtl-json-editor` tool scaffold (template, main, styles, icon) | Phase 1 | 0.5 day |
| 5 | Wire linter into editor (debounced, Monaco markers) | Phase 2, 4 | 0.5 day |
| 6 | Wire formatter into toolbar buttons | Phase 3, 4 | 0.5 day |
| 7 | Input JSON panel + local render preview | Phase 4 | 0.5 day |
| 8 | Tauri endpoint validation (service.js) | Phase 7 | 0.5 day |
| 9 | Tests: VtlFormatter, VtlLinter, service | Phase 3, 2, 8 | 1 day |
| 10 | Polish: keyboard shortcuts, edge cases, status bar | All | 0.5 day |

**Total estimate: ~6.5 days**

---

## Testing Strategy

All tests in `frontend/tools/vtl-json-editor/tests/` per project convention.

### VtlFormatter.test.js
- formatVtlJson: basic #set + JSON body
- formatVtlJson: nested #if/#foreach with JSON
- formatVtlJson: VTL variables inside JSON string values
- formatVtlJson: trailing comma before #end pattern
- formatVtlJson: already-formatted template is idempotent
- formatVtlJson: empty input / VTL-only / JSON-only
- minifyVtlJson: round-trip with formatVtlJson

### VtlLinter.test.js
- checkStructure: unmatched #end → error
- checkStructure: unclosed #if → error
- checkStructure: #else outside #if → error
- checkStructure: unclosed $!{ reference → warning
- checkStructure: balanced template → no diagnostics
- checkVelocityParse: invalid syntax → error with line info
- checkVelocityParse: valid template → no diagnostics
- lintVtlJson: combined structural + parse checks

### service.test.js
- renderLocally: basic variable substitution
- renderLocally: #foreach iteration
- renderLocally: invalid template → error
- validateWithEndpoint: mocked fetch (success/error/network error)

---

## Open Questions / Future Considerations

1. **Endpoint contract** — The API endpoint schema (`{ template, input }` → `{ valid, output, errors }`) is proposed. Should be finalized with the backend team. The tool will be flexible about response shape with fallback parsing.

2. **velocityjs limitations** — velocityjs doesn't support all Apache Velocity features (e.g., `$input.path()`, `$util` helpers). Local rendering will be best-effort. The Tauri endpoint validation is the authoritative check.

3. **JSON zone detection heuristic** — The current approach (transition on `{`/`[` at line start) may misidentify VTL maps as JSON. May need refinement based on real-world templates. A configurable "JSON starts at line N" hint could be added later.

4. **Future: refactor splunk-template** — Once `VtlMonaco.js` is stable, the `splunk-template` tool could migrate to use it. Deferred for now.

5. **Future: VTL snippets library** — Common AWS API Gateway mapping template patterns as a snippets feature.

6. **Future: diff view** — Show before/after diff when formatting so user can review changes before accepting.
