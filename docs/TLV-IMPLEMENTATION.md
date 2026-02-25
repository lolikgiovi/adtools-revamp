# TLV Viewer Implementation Plan

## Objective

Build a new **TLV Viewer** tool for AD Tools with a stronger parsing UX than raw JSON output. The tool must support:

- Fast parsing of TLV payloads from multiple input formats
- A readable tree view
- A structured table view for scanning offsets, tags, and lengths
- Safe error handling for malformed payloads

## Scope

### In Scope

- New frontend tool under `frontend/tools/tlv-viewer/`
- Input modes: `Hex`, `Base64`, `UTF-8/Text`
- BER-style TLV parser (tag + definite length + value)
- Recursive parsing for constructed tags
- Dual output modes:
  - Tree + JSON panel
  - Flat table panel
- Parsing summary cards (total bytes, node count, max depth)
- Local persistence for input and selected view
- Unit tests for parser service
- Registration in app shell (`App.js`, `tools.json`, `index.html`)

### Out of Scope (Phase 1)

- Full ASN.1 schema decoding/OID dictionaries
- BER indefinite length (`0x80`) support
- File import/export workflows
- Backend integration (not needed)

## UX Requirements

1. The tool should parse with one click and clear errors with one click.
2. Users can switch between output tabs without re-parsing.
3. Table mode should show: row index, depth, offset, tag class, tag, constructed flag, length, value preview, and raw TLV bytes.
4. Tree mode should remain useful for nested payloads and allow copying JSON output quickly.
5. Malformed input must show actionable errors with byte offset context.

## Parsing Rules (Phase 1)

- Tag parsing:
  - Support single-byte tags and high-tag-number form (`0x1F` continuation).
  - Decode class bits (Universal, Application, Context-specific, Private).
  - Detect constructed flag from bit 6.
- Length parsing:
  - Short form and long form supported.
  - Indefinite length is rejected with explicit error.
- Value parsing:
  - Primitive values rendered as hex with printable preview where possible.
  - Constructed values are parsed recursively within their value range.

## Architecture Plan

### Files to Add

- `frontend/tools/tlv-viewer/main.js`
- `frontend/tools/tlv-viewer/service.js`
- `frontend/tools/tlv-viewer/template.js`
- `frontend/tools/tlv-viewer/styles.css`
- `frontend/tools/tlv-viewer/icon.js`
- `frontend/tools/tlv-viewer/tests/service.test.js`

### Files to Update

- `frontend/App.js` (import + register tool)
- `frontend/config/tools.json` (tool metadata)
- `frontend/index.html` (tool stylesheet link)

## Implementation Phases

### Phase 1: Tool Skeleton + Registration

- Create new tool module folder and base files.
- Add tool metadata to sidebar/home config.
- Register tool in `App.js`.

### Phase 2: Parser Service

- Implement pure parsing utilities in `service.js`.
- Implement conversion from input mode to byte array.
- Implement recursive TLV parse and flatten rows for table rendering.

### Phase 3: UI + Interactions

- Build split layout for input and output.
- Add output tabs (`Tree`, `Table`).
- Add summary metrics.
- Add parse, paste, sample, clear, copy actions.

### Phase 4: Tests + Validation

- Add service-level tests for:
  - primitive TLV
  - constructed TLV
  - long-form length
  - high-tag-number tag
  - invalid and truncated payloads
- Run targeted vitest file only (single instance).

## Risk Controls

- Prevent parser runaway with bounds checks on tag/length decoding.
- Reject malformed lengths early.
- Keep parser logic pure and DOM-free for reliable tests.
- Keep UI rendering escaped to avoid HTML injection from decoded previews.

## Deliverables

- Working TLV Viewer available in AD Tools sidebar and home cards
- Improved TLV visualization with both tree and table outputs
- Parser test coverage in `frontend/tools/tlv-viewer/tests/service.test.js`
