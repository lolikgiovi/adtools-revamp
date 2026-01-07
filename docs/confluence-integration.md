# Confluence Integration (Master Lockey)

This feature integrates Confluence Data Center with the Master Lockey tool, allowing users to fetch localization keys from Confluence pages, compare them against live remote data, and manage results with caching and export capabilities.

## Overview

- **Location**: Confluence section within the `Master Lockey` tool.
- **Authentication**: Personal Access Token (PAT) stored in macOS Keychain via Tauri.
- **Caching**: Pages cached in IndexedDB for offline access and quick reloading.
- **Comparison**: Extracted lockeys compared against live remote lockey.json data.
- **Export**: Results exportable as TSV or CSV.

## Settings

Open `Settings` → `Credential Management` to configure:

### Required Settings

| Setting | Storage Key | Description |
|---------|------------|-------------|
| Confluence Domain | `config.confluence.domain` | Your Confluence Data Center domain (e.g., `confluence.company.com`) |
| Confluence Username | `config.confluence.username` | Your Confluence username |
| Confluence PAT | `secure.confluence.pat` | Personal Access Token stored in macOS Keychain |

### Generating a PAT

1. Log into Confluence Data Center.
2. Go to **Profile** → **Settings** → **Personal Access Tokens**.
3. Click **Create token**, give it a name, and copy the token.
4. Paste the token in the AD Tools Settings page.

## Using the Feature

### Prerequisites

1. Configure all three Confluence settings in Settings page.
2. Load lockey data for a domain in Master Lockey (required for comparison).

### Workflow

1. **Open Master Lockey** and select a domain to load lockey data.
2. **Confluence Section** appears below the main table (desktop app only).
3. **Enter Page URL or ID**:
   - Full URL: `https://confluence.company.com/pages/viewpage.action?pageId=12345`
   - Short form: Just the page ID `12345`
4. **Click "Fetch Lockeys"** to retrieve and parse the page.
5. **View Results**: Table shows extracted lockeys with:
   - **Key**: The localization key name
   - **Status**: `plain`, `new` (colored), `removed` (strikethrough), or `removed-new`
   - **In Remote**: Whether the key exists in the loaded remote lockey.json
6. **Cache Management**:
   - Cached pages appear in the dropdown for quick access.
   - Use 🔄 to refresh a cached page from Confluence.
   - Use 🗑️ to delete a cached page.
7. **Hide Keys**: Click "Hide" on keys you don't want to track; toggle "Hidden Keys" section to manage.
8. **Export**: Copy results as TSV or CSV to clipboard.

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend (Master Lockey)                                        │
│  └─ service.js → fetchConfluencePage() → extractPageId()        │
│                → parseConfluenceTableForLockeys()               │
│                → compareLockeyWithRemote()                      │
└────────────────────────────┬────────────────────────────────────┘
                             │ Tauri invoke
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Tauri Backend (Rust)                                            │
│  └─ confluence.rs → fetch_page_content()                        │
│                   → search_pages() (for future search feature)  │
│  └─ keyring integration for PAT                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP + Bearer Auth
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Confluence Data Center REST API                                 │
│  └─ /rest/api/content/{id}?expand=body.storage                  │
└─────────────────────────────────────────────────────────────────┘
```

### Table Parsing Logic

The parser looks for HTML tables with headers matching:
- `Localization Key`
- `Lockey`
- `Loc Key`

**Status Detection**:
| Visual Style | Detected Status |
|--------------|-----------------|
| Plain text | `plain` |
| Colored text (any non-default color) | `new` |
| Strikethrough (`<del>`, `<s>`, `<strike>`) | `removed` |
| Colored + strikethrough | `removed-new` |

**Value Validation**:
- Only camelCase values (e.g., `homeScreenTitle`) are accepted as lockeys.
- Dotted paths (e.g., `context.key.name`) are rejected.
- Nested tables are supported—the parser extracts from `Value` or `Lockey` columns.

### Caching

- **Storage**: IndexedDB (`ConfluenceLockeyDB`)
- **Stores**: 
  - `pages`: Cached page data (id, title, lockeys, timestamp)
  - `hiddenKeys`: User-hidden keys per page
- **Persistence**: Survives app restarts; manually deletable per page.

## Backend Commands (Tauri)

| Command | Parameters | Returns | Description |
|---------|------------|---------|-------------|
| `set_confluence_pat` | `pat: String` | `()` | Store PAT in macOS Keychain |
| `has_confluence_pat` | — | `bool` | Check if PAT exists |
| `confluence_fetch_page` | `domain, page_id, username, pat` | `PageContent` | Fetch page HTML |
| `confluence_search_pages` | `domain, query, username, pat` | `Vec<PageInfo>` | Search pages by title |

## Edge Cases & Error Handling

### No Credentials Configured

- **Behavior**: Confluence section shows warning banner with link to Settings.
- **Controls**: Input fields and buttons are disabled.

### Invalid Page URL/ID

- **Behavior**: Error message displayed inline.
- **Example**: "Could not extract page ID from input."

### No Lockey Table Found

- **Behavior**: Error with guidance message.
- **Example**: "No lockey table found on this page. Make sure the table has a column named 'Localization Key', 'Lockey', or 'Loc Key'."

### Network Errors

- **Behavior**: Error message with original error from Confluence API.
- **Common causes**: Invalid PAT, network issues, page not found.

### PAT Expired or Invalid

- **Behavior**: HTTP 401 error from Confluence.
- **Resolution**: Generate a new PAT and update in Settings.

## Testing Checklist

### Settings Integration

- [ ] PAT input shows masked value after saving.
- [ ] Clearing PAT and saving shows warning in Master Lockey.
- [ ] Settings link in warning banner navigates correctly.

### Fetch & Parse

- [ ] Valid page URL fetches and displays results.
- [ ] Page ID only (no URL) works correctly.
- [ ] Tables with different header names parse correctly.
- [ ] Colored text detected as `new` status.
- [ ] Strikethrough text detected as `removed` status.
- [ ] Nested tables within lockey cells are parsed.
- [ ] Dotted values (e.g., `context.x.key`) are rejected.

### Caching

- [ ] Fetched page appears in dropdown.
- [ ] Selecting cached page loads without network request.
- [ ] Refresh button updates cache with latest data.
- [ ] Delete button removes page from dropdown and IndexedDB.

### Hidden Keys

- [ ] Hiding a key removes it from main table.
- [ ] Hidden keys appear in expandable section.
- [ ] Unhiding restores key to main table.
- [ ] Hidden keys persist after page refresh (from cache).

### Export

- [ ] TSV export copies correct format with headers.
- [ ] CSV export handles commas in values.
- [ ] Only visible (non-hidden) keys are exported.

### Comparison

- [ ] Keys in remote show "✓ Yes" in "In Remote" column.
- [ ] Keys not in remote show "✗ No".
- [ ] Comparison updates when switching domains.

### Error States

- [ ] Invalid page ID shows clear error.
- [ ] Network timeout shows error.
- [ ] No table found shows guidance message.
- [ ] Expired PAT shows authentication error.

### Responsive & Styling

- [ ] Section displays correctly in dark and light themes.
- [ ] Table scrolls horizontally on narrow viewports.
- [ ] Buttons have proper hover/focus states.

## Usage Tracking

The following events are tracked:

| Event | Description |
|-------|-------------|
| `confluence_fetch` | User initiated page fetch |
| `confluence_fetch_success` | Page successfully fetched and parsed |
| `confluence_fetch_error` | Fetch or parse failed |
| `confluence_load_cached` | Loaded page from cache |
| `confluence_export_tsv` | Exported results as TSV |
| `confluence_export_csv` | Exported results as CSV |

## Future Enhancements

- **Page Search UI**: Leverage existing `confluence_search_pages` backend command.
- **Short URL Support**: Handle `/x/AbCd` base64-encoded short links.
- **Display URL Support**: Resolve `/display/SPACE/PageTitle` URLs via search.
