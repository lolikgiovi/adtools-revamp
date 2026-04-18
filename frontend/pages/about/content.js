/**
 * Tutorial/Help Content Data
 * Structured content for the Tutorial/Wiki/FAQ page
 */

export const tutorialContent = {
  categories: [
    {
      id: "getting-started",
      name: "Getting Started",
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
      items: [
        {
          id: "welcome",
          title: "Welcome",
          content: `
# Welcome to AD Tools

AD Tools is a collection of practical utilities designed to streamline daily tasks for Application Designers (ADs).

## What's Inside?

This app bundles utilities like:
- **Quick Query** — Generate Oracle SQL queries from spreadsheet data
- **Compare Config** — Compare data between database environments or files
- **Jenkins Runner** — Execute Oracle SQL on Jenkins directly from your desktop
- **Run Batch** — Trigger Jenkins batch jobs with real-time log streaming
- **JSON Tools** — Format, validate, and manipulate JSON
- **Base64 Tools** — Encode and decode Base64
- **TLV Viewer** — Parse and inspect QRIS and BER-TLV payloads
- **Merge SQL** — Merge multiple SQL files with duplicate detection
- **And more!**

## How It Started

AD Tools was initially built to automate non-practical chores like generating multiple UUIDs without formatting, encoding/decoding Base64, and creating SQL queries.

The app started as a static page hosted on Cloudflare Pages, and has evolved into both a Desktop app (using Tauri) and a Web App.

## Desktop vs Web

| Feature | Desktop | Web |
|---------|---------|-----|
| Jenkins Runner | ✅ Available | ❌ Not available |
| Run Batch | ✅ Available | ❌ Not available |
| Compare Config (Oracle) | ✅ Available | ❌ Not available |
| Compare Config (Excel) | ✅ Available | ✅ Available |
| All other tools | ✅ Available | ✅ Available |
| Auto-updates | ✅ Available | ✅ Always latest |
| Offline access | ✅ Full support | ❌ Requires internet on the first time load|
          `,
        },
        {
          id: "quick-start",
          title: "Quick Start",
          content: `
# Quick Start Guide

Get up and running with AD Tools in just a few steps.

## Step 1: Register

1. Open **Settings** from the sidebar footer
2. Enter your work email address
3. An OTP will be sent to your email for verification

## Step 2: Load Default Settings

After verification:
1. Go to **Settings**
2. Click **Load Default Settings**
3. This will fetch pre-configured settings from the cloud

## Step 3: Configure Tokens (Desktop Only)

For Jenkins integration:
1. Navigate to your Jenkins profile → **Security** → **API Token**
2. Click **Add new token** and copy it
3. In AD Tools Settings, paste the token under **Jenkins Token**

For Oracle database comparison (Compare Config):
1. The Desktop app manages a Python sidecar for Oracle connectivity automatically
2. Ensure Oracle Instant Client is available on your system

## Step 4: Import Schemas (Quick Query)

1. Open **Quick Query** tool
2. Click **Schemas** button
3. Select **Import default Schemas** to load pre-configured database schemas

## You're Ready! 🎉

Start exploring the tools from the sidebar. Use \`Cmd + P\` (or \`Ctrl + P\`) to quickly navigate between features.
          `,
        },
        {
          id: "shortcuts",
          title: "Keyboard Shortcuts",
          content: `
# Keyboard Shortcuts

Master these shortcuts to work faster with AD Tools.

## Navigation

| Shortcut | Action |
|----------|--------|
| \`Cmd/Ctrl + P\` | Open global search to navigate between features |
| \`Cmd/Ctrl + /\` | Toggle sidebar visibility |
| \`Cmd/Ctrl + R\` | Refresh the current page |
| \`Escape\` | Close modals and overlays |

## Editor Shortcuts

Most text editors in AD Tools uses Monaco Editor, it's the same editor used in VSCode, so it supports standard shortcuts:

| Shortcut | Action |
|----------|--------|
| \`Cmd/Ctrl + A\` | Select all text |
| \`Cmd/Ctrl + C\` | Copy selected text |
| \`Cmd/Ctrl + V\` | Paste from clipboard |
| \`Cmd/Ctrl + Z\` | Undo |
| \`Cmd/Ctrl + Shift + Z\` | Redo |
| \`Cmd/Ctrl + F\` | Find in editor (where supported) |

## Tips

- Use \`Tab\` to navigate between form fields
- Press \`Enter\` to confirm actions in modals
- The global search (\`Cmd + P\`) supports fuzzy matching
          `,
        },
      ],
    },
    {
      id: "tools",
      name: "Tools",
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
      isDropdown: true,
      items: [
        {
          id: "quick-query",
          title: "Quick Query",
          content: `
# Quick Query

Generate SQL queries (MERGE, INSERT, UPDATE) from spreadsheet data with schema support.

## Overview

Quick Query is a powerful tool for creating SQL queries from tabular data. It supports:
- **MERGE INTO** statements
- **INSERT** statements
- **UPDATE** statements

## How to Use

### 1. Select Query Type
Choose the type of SQL query from the dropdown (MERGE INTO, INSERT, UPDATE).

### 2. Configure Schema
- Click **Schemas** to open the schema manager
- Select a pre-configured schema or create a new one
- The schema defines table name and column types

### 3. Enter Data
Use the spreadsheet to enter your data:
- First row should contain column headers (or use "Sync Field Names")
- Enter data in subsequent rows
- Use \`max\` in ID fields to enable auto-increment

### 4. Generate Query
Click **Generate Query** to create your SQL in the editor panel.

## Features

| Feature | Description |
|---------|-------------|
| Schema Manager | Save and load table schemas for reuse |
| File Attachments | Attach files to include in queries |
| Word Wrap | Toggle word wrap in the SQL editor |
| Copy to Clipboard | One-click copy of generated queries |
| Query Splitting | Split large queries into smaller chunks |

## Tips

- 💡 Enter \`max\` for \`_id\` fields to auto-generate incremental IDs
- 💡 Import default schemas from Settings for pre-configured tables
- 💡 Use the file viewer to preview attached files before generation
          `,
        },
        {
          id: "compare-config",
          title: "Compare Config",
          content: `
# Compare Config

Compare data between Oracle database environments or Excel/CSV files to identify matching, differing, and unique rows.

## Overview

Compare Config supports side-by-side diffing of data from multiple sources:
- **Oracle-to-Oracle** — Compare table data across database environments
- **Excel-to-Excel** — Compare spreadsheet files directly
- **Unified** — Mix Oracle and Excel sources

## How to Use

### 1. Select Comparison Mode
Choose your source types (Oracle, Excel, or mixed).

### 2. Configure Sources
- For Oracle: Select connection, schema, and table; the Python sidecar manages connectivity
- For Excel: Upload .xlsx, .xls, or .csv files, or entire folders

### 3. Choose Key and Fields
- Select primary key field(s) for row matching
- Review detected common, unique, and mismatched columns

### 4. Run Comparison
Click **Compare** to analyze differences. Results appear in three view modes:
- **Grid** — Summary overview with status badges
- **Vertical Cards** — Row-by-row detail view
- **Master-Detail** — Select a row for deep comparison

## Features

| Feature | Description |
|---------|-------------|
| Multi-format Export | Export results as JSON, Excel, or CSV |
| Status Filtering | Filter by matched, differed, or unique rows |
| Field Reconciliation | Auto-detect common/unique columns between sources |
| Web Worker Diff | Computation runs off the main thread for performance |
| State Persistence | Settings saved to localStorage; large results to IndexedDB |

## Tips

- 💡 Oracle comparison requires the Desktop app with the Python sidecar running
- 💡 Use normalized comparison mode to ignore case and whitespace differences
- 💡 Upload entire folders for batch Excel comparisons
          `,
        },
        {
          id: "run-batch",
          title: "Run Batch",
          content: `
# Run Batch

Trigger Jenkins batch jobs with real-time log streaming and configuration management.

> ⚠️ **Desktop Only** — This feature requires the Desktop version of AD Tools.

## Overview

Run Batch allows you to:
- Select an environment, batch name, and job name
- Trigger Jenkins batch jobs directly
- Stream build console output in real time
- Save and manage named configurations
- Track run history with success/failed status

## How to Use

### Run Tab
1. Select the **Environment** from the dropdown
2. Choose a **Batch** and **Job** name
3. Click **Run on Jenkins** to trigger the build
4. View real-time log output below

### Saved Configs Tab
1. Click **Save** to name the current configuration
2. Load saved configs for quick re-runs
3. Search and filter saved configurations
4. Attach Confluence links per config
5. Edit or delete saved configs

### History Tab
- View the last 50 executions
- See timestamp, environment, batch/job name, and status
- Quick link to open the Jenkins build page in browser

## Tips

- 💡 Environment and batch dropdowns are auto-populated from Jenkins
- 💡 Confluence links can be attached to saved configs for reference
- 💡 A confirmation modal appears before deleting saved configurations
          `,
        },
        {
          id: "run-query",
          title: "Jenkins Runner",
          content: `
# Jenkins Runner

Execute SQL queries on Jenkins directly from your desktop.

> ⚠️ **Desktop Only** — This feature requires the Desktop version of AD Tools.

## Overview

Jenkins Runner allows you to:
- Write and execute SQL queries
- Send queries to Jenkins for execution
- View build logs in real-time
- Save and manage query templates
- Track execution history

## Setup Requirements

Before using Jenkins Runner, configure these settings:
1. **Jenkins URL** — Your Jenkins server base URL
2. **Jenkins Username** — Your Jenkins username
3. **Jenkins Token** — API token from Jenkins (Profile → Security → API Token)

## How to Use

### Run Tab
1. Write your SQL query in the editor
2. Select the target environment from the dropdown
3. Click **Run on Jenkins** to execute
4. View real-time build logs below

### History Tab
View past executions with:
- Timestamp
- Environment
- Query preview
- Build number and status
- Quick actions to re-run or view details

### Templates Tab
Save frequently used queries as templates:
1. Click **New** to create a template
2. Give it a name, description, and tags
3. Assign an environment
4. Save for future use

## Tips

- 💡 Use tags to organize templates by project or purpose
- 💡 The history tab persists across sessions
- 💡 Click the build number to open Jenkins in browser
          `,
        },
        {
          id: "json-tools",
          title: "JSON Tools",
          content: `
# JSON Tools

A comprehensive toolkit for working with JSON data.

## Available Operations

| Tab | Description |
|-----|-------------|
| **Beautify** | Format JSON with proper indentation |
| **Minify** | Compress JSON by removing whitespace |
| **Stringify** | Convert JSON to escaped string format |
| **Unstringify** | Parse escaped JSON string back to JSON |
| **Escape** | Escape special characters in JSON |
| **Unescape** | Unescape special characters |
| **Extract Keys** | Get all keys from JSON structure |
| **To Table** | Display JSON as an interactive table |

## How to Use

1. Paste or type JSON in the **Input** editor
2. Select the desired operation tab
3. Click **Action** button
4. Result appears in the **Output** section

## Extract Keys Options

When using Extract Keys:
- **Simple Keys** — Returns only key names
- **Key Paths** — Returns full dot-notation paths (e.g., \`user.address.city\`)

Sort options: Natural, A-Z, or Z-A

## To Table Features

The table view offers:
- **Search** — Filter visible rows
- **Expand** — View nested objects
- **Transpose** — Flip rows and columns
- **Copy** — Export table data

## Tips

- 💡 The input editor validates JSON and shows errors
- 💡 Use Paste button to quickly paste from clipboard
- 💡 Output is automatically copied when using Copy button
          `,
        },
        {
          id: "base64-tools",
          title: "Base64 Tools",
          content: `
# Base64 Tools

Encode and decode Base64 strings and files.

## Tabs

### Encode to Base64
Convert plain text or files to Base64-encoded string:
- Type or paste text in the input area
- Or upload files using the **Upload File** button
- Click **Encode to Base64** to convert
- Copy the result from the output area

### Decode from Base64
Convert Base64-encoded string back to plain text or files:
- Paste Base64 content in the input area
- Or upload .txt/.base64 files
- Click **Decode from Base64** to convert
- View or download the decoded result

## Features

| Feature | Description |
|---------|-------------|
| File Upload | Encode multiple files at once |
| Batch Processing | Process multiple files in one go |
| Copy/Clear | Quick clipboard and clear actions |
| Processed Files | View list of encoded/decoded files |

## Use Cases

- Encoding files for API payloads
- Decoding Base64 responses
- Converting images to data URLs
- Quick data transformation

## Tips

- 💡 Supports multiple file uploads at once
- 💡 Processed files are listed separately for easy access
          `,
        },
        {
          id: "tlv-viewer",
          title: "TLV Viewer",
          content: `
# TLV Viewer

Parse and inspect Tag-Length-Value (TLV) encoded payloads, supporting QRIS payment strings and BER-TLV binary data.

## Overview

TLV Viewer decodes structured TLV data into interactive views:
- **QRIS** — Indonesian Quick Response Code payment standard
- **BER-TLV** — Basic Encoding Rules TLV (hex or auto-detected)

## How to Use

1. Paste your TLV payload in the **Input** area (or click **Paste** from clipboard)
2. Select the **Format** (QRIS or BER-TLV, or use auto-detect)
3. Click **Parse** to process the data
4. Switch between **Tree**, **Table**, and **JSON** views

## Features

| Feature | Description |
|---------|-------------|
| Three View Modes | Tree, Table, and JSON output views |
| QRIS CRC Validation | Verifies CRC-CCITT (0xFFFF) checksum automatically |
| QRIS Mandatory Tags | Checks for required QRIS tags and reports missing ones |
| BER-TLV Parsing | Parses class/offset/preview details for binary TLV |
| Sample Data | Quick-load sample QRIS and BER-TLV payloads |
| Copy Output | Copy parsed output as JSON or tab-separated text |

## Tips

- 💡 Use **Cmd/Ctrl + Enter** to quickly trigger parsing
- 💡 QRIS validation reports CRC status (valid/invalid/missing) and mandatory tag errors
- 💡 BER-TLV mode shows byte offsets and constructed vs primitive tags
          `,
        },
        {
          id: "qr-tools",
          title: "QR Tools",
          content: `
# QR Tools

Generate QR codes with custom colors.

## How to Use

1. Select **Content Type** (Text or URL)
2. Enter your content in the text area
3. QR code generates automatically in the preview
4. Customize colors (optional):
   - **Foreground** — QR code color
   - **Background** — Background color
5. Download as **PNG** or **SVG**

## Features

| Feature | Description |
|---------|-------------|
| Live Preview | QR updates as you type |
| Custom Colors | Pick foreground and background colors |
| PNG Download | Download as raster image |
| SVG Download | Download as vector image |
| Contrast Warning | Alerts when colors have poor contrast |

## Use Cases

- Generate QR codes for URLs
- Create branded QR codes with custom colors
- Quick information sharing
- Marketing materials

## Tips

- 💡 Use high contrast colors for best scan reliability
- 💡 SVG format is better for print/scaling
          `,
        },
        {
          id: "sql-in-clause",
          title: "Query IN",
          content: `
# Query IN Generator

Generate SQL IN clauses from lists of values.

## How to Use

1. Enter items in the **Input** editor (one per line)
2. Select the **Format** from the dropdown
3. Output updates automatically
4. Click **Copy** to copy the result

## Format Options

| Format | Description | Example |
|--------|-------------|--------|
| Single-line | Comma-separated in parentheses | \`('a', 'b', 'c')\` |
| Multi-line | Each value on new line | One value per line |
| SELECT query | Full SELECT statement | \`SELECT * FROM table WHERE col IN (...)\` |

## SELECT Query Mode

When using SELECT query format:
- Enter **Table name** in the table input
- Enter **Column name** in the column input
- A complete SELECT query is generated

## Example

**Input:**
\`\`\`
apple
banana
cherry
\`\`\`

**Output (Single-line):**
\`\`\`sql
('apple', 'banana', 'cherry')
\`\`\`

## Tips

- 💡 Use **Paste** button for quick clipboard input
- 💡 Uses Monaco Editor with line numbers
- 💡 Values are automatically quoted as strings
          `,
        },
        {
          id: "uuid-generator",
          title: "UUID Generator",
          content: `
# UUID Generator

Generate single or multiple UUIDs quickly.

## Single UUID

Generate one UUID at a time:
1. Click **Generate** to create a new UUID
2. Click **Copy** to copy to clipboard

## Multiple UUIDs

Generate up to 10,000 UUIDs at once:
1. Enter the quantity (max 10,000)
2. Click **Generate**
3. UUIDs appear in the textarea
4. Click **Copy** to copy all
5. Click **Clear** to reset

## Format

All UUIDs are generated in standard lowercase format:
\`\`\`
550e8400-e29b-41d4-a716-446655440000
\`\`\`

## Use Cases

- Generate test data IDs
- Create unique identifiers
- Batch ID generation for imports
- Database seeding

## Tips

- 💡 UUIDs are v4 (random)
- 💡 Raw format without quotes for easy pasting
- 💡 Each UUID is on its own line
          `,
        },
        {
          id: "master-lockey",
          title: "Master Lockey",
          content: `
# Master Lockey

Localization key viewer and manager with Confluence integration.

## Overview

Master Lockey displays localization keys (lockey) from language packs in a searchable table format. It supports caching via IndexedDB for offline access.

## How to Use

1. Select a **Domain** from the dropdown
2. Click **Get Latest Data** to fetch language pack
3. Data is cached automatically for future use
4. Use search to find specific keys

## Search Modes

| Mode | Description |
|------|-------------|
| Search by Key | Find keys matching your search term |
| Search by Content | Search within the localized content |

## Features

- **Domain selector** — Switch between different language domains
- **Caching** — Data is cached with timestamp for offline use
- **Match Word** — Toggle whole word matching
- **Results count** — Shows number of matching keys
- **Language Pack Version** — Displays current version info

## Confluence Integration

Compare lockeys against Confluence pages:
1. Configure Confluence credentials in Settings
2. Enter a Confluence page URL or ID
3. Fetch lockeys from the page
4. View status comparison (found/missing)
5. Export as TSV or CSV

## Tips

- 💡 Use comma-separated values for key search (e.g., \`key1, key2\`)
- 💡 Cached data shows timestamp of last fetch
- 💡 Click table headers to sort
          `,
        },
        {
          id: "splunk-template",
          title: "Splunk Template",
          content: `
# Splunk Template

Splunk query editor with field extraction and formatting.

## Overview

A specialized editor for working with Splunk search queries. Includes tools for formatting, minifying, and managing extracted fields.

## Editor Panel

Write and edit Splunk queries with:
- **Format** — Pretty-print the query
- **Minify** — Compress to single line
- **Copy** — Copy to clipboard
- **Paste** — Paste from clipboard
- **Clear** — Clear the editor

## Fields Review Panel

Manage extracted fields in a spreadsheet-like table:
- **Add Field** — Add new field row
- Edit field names and values inline
- Resizable split between editor and table

## How to Use

1. Paste or write your Splunk query in the editor
2. Use **Format** to improve readability
3. Review and edit fields in the table
4. Use **Copy** to copy the final query

## Tips

- 💡 Uses Monaco Editor with syntax highlighting
- 💡 Drag the resizer to adjust panel sizes
- 💡 Fields table uses Handsontable for Excel-like editing
          `,
        },
        {
          id: "merge-sql",
          title: "Merge SQL",
          content: `
# Merge SQL

Merge multiple SQL files (MERGE/INSERT/UPDATE/DELETE) into combined output with duplicate detection and validation.

## Overview

Merge SQL processes SQL files and produces three outputs:
- **Merged SQL** — Combined SQL statements in one file
- **SELECT SQL** — Generated SELECT statements for verification
- **Validation SQL** — Validation queries for data integrity

## How to Use

### File Upload Mode
1. Upload .sql files or folders using the file picker
2. Review detected tables and statements
3. Click **Merge** to generate combined output
4. Download individual files or all at once

### SQL Text Mode
1. Paste existing merged SQL directly into the editor
2. Click **Process** to parse and generate reports
3. Review and download results

## Features

| Feature | Description |
|---------|-------------|
| Duplicate Detection | Identifies duplicated SQL statements across files |
| Dangerous Statement Alert | Flags DELETE, UPDATE without WHERE, and MERGE DELETE |
| Report Tab | Shows table summary, squad/feature/author counts, and per-table breakdown |
| File Editor | Edit individual files inline with autosave and revert |
| Sort Modes | Ascending, descending, or manual drag-and-drop table grouping |
| Copy Report | Copy report as text or image (via html2canvas) |

## Tips

- 💡 Use the **Report** tab to review a summary of all tables, squads, and dangerous statements
- 💡 The **File Editor** tab lets you fix SQL in individual files before merging
- 💡 State is persisted in IndexedDB — your work survives page reloads
          `,
        },
        {
          id: "check-image",
          title: "Check Image",
          content: `
# Check Image

Validate images by UUID or content path.

## Overview

Check if images exist and are accessible by providing their UUIDs or content API paths. Useful for validating ad creatives and content images.

## How to Use

1. Enter image identifiers in the textarea:
   - Image UUIDs (e.g., \`550e8400-e29b-41d4-a716-446655440000\`)
   - Content paths (e.g., \`/content/v1/image/...\`)
2. One identifier per line
3. Click **Check Images**
4. View results showing image status

## Input Formats

| Format | Example |
|--------|--------|
| UUID | \`550e8400-e29b-41d4-a716-446655440000\` |
| Content Path | \`/content/v1/image/abc123\` |

## Use Cases

- Validate image references in campaigns
- Check if creative assets are accessible
- Batch verify image availability
- Debug missing image issues

## Tips

- 💡 Enter multiple IDs, one per line
- 💡 Uses **Clear** to reset input and results
- 💡 Results show status for each image
          `,
        },
        {
          id: "html-template",
          title: "HTML Template",
          content: `
# HTML Template

HTML template editor with live preview and VTL support.

## Overview

Edit HTML templates with real-time preview rendering. Includes support for VTL (Velocity Template Language) variable extraction and environment switching.

## Editor Panel

Write and edit HTML with:
- **Format** — Pretty-print HTML
- **Minify** — Compress HTML
- **Extract VTL Fields** — Find VTL variables in template
- **Copy/Paste/Clear** — Clipboard operations

## Preview Panel

- Live rendered HTML output
- **ENV Selector** — Switch between environments
- **Reload** — Refresh preview manually

## VTL Variables

Extract and manage Velocity Template variables:
1. Click **Extract VTL Fields**
2. A modal shows all found variables
3. Edit variable values for preview
4. Click **Reset** to clear values

## How to Use

1. Write or paste HTML in the editor
2. Preview updates automatically in the iframe
3. Use **Extract VTL Fields** to find variables
4. Edit VTL values to test different data
5. Switch ENV to test against different environments

## Tips

- 💡 Uses Monaco Editor with HTML syntax highlighting
- 💡 Preview runs in a sandboxed iframe
- 💡 VTL variables follow \`\$variable\` or \`\${variable}\` syntax
          `,
        },
      ],
    },
    {
      id: "faq",
      name: "FAQ",
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`,
      items: [
        {
          id: "faq-general",
          title: "General",
          content: `
# Frequently Asked Questions — General

## What is AD Tools?

AD Tools is a collection of utilities designed to help Application Designers (ADs) with common daily tasks like generating SQL queries, working with JSON, encoding/decoding data, and more.

## Who is AD Tools for?

AD Tools was originally built for internal teams ("ADs" - Application Designers) but is useful for anyone who works with:
- Oracle SQL databases
- JSON data
- Base64 encoding
- Code formatting

## Is AD Tools free?

Yes! AD Tools is free to use.

## Desktop vs Web App — Which should I use?

**Use Desktop if:**
- You need Jenkins integration
- You want offline access
- You prefer a dedicated app window

**Use Web App if:**
- You don't need Jenkins features
- You want to access from any device
- You prefer not to install software

## Where is my data stored?

All data is stored locally:
- **Settings** — Browser localStorage
- **Templates** — Browser localStorage
- **Schemas** — Browser localStorage
- **Comparison Results & Merged SQL** — Browser IndexedDB (for large datasets)

No data is sent to external servers except for:
- OTP verification (email only)
- Default settings fetch (after verification)
          `,
        },
        {
          id: "faq-technical",
          title: "Technical",
          content: `
# Frequently Asked Questions — Technical

## How does Jenkins integration work?

**Jenkins Runner** uses the Jenkins REST API to:
1. Trigger a parameterized build job
2. Pass SQL as a parameter
3. Poll for build status and logs

**Run Batch** triggers Jenkins batch jobs by:
1. Selecting environment, batch name, and job
2. Streaming real-time build console output
3. Saving configurations for quick re-runs

Requirements:
- Jenkins API token (not password)
- Configured Jenkins job that accepts SQL parameter
- Network access to Jenkins server

## What technologies power AD Tools?

- **Frontend** — Vanilla JavaScript, CSS, Vite
- **Desktop** — Tauri (Rust-based)
- **Backend** — Cloudflare Workers
- **Editors** — CodeMirror / Monaco

## Can I use AD Tools offline?

**Desktop:** Yes, fully offline except for:
- Initial registration/OTP
- Loading default settings
- Jenkins features (requires Jenkins access)

**Web:** Requires internet connection.

## How do I update AD Tools?

**Desktop:** 
- Check for updates in Settings
- Updates download automatically when available

**Web:**
- Always uses the latest version automatically

## Is my Jenkins token secure?

Yes. On Desktop:
- Token is stored in the system keychain (secure storage)
- Never stored in localStorage or plain text
- Never sent to any server except Jenkins
          `,
        },
        {
          id: "faq-troubleshoot",
          title: "Troubleshooting",
          content: `
# Troubleshooting

## Jenkins Runner Issues

### "Jenkins authentication failed"
- Verify your Jenkins username is correct
- Regenerate your API token in Jenkins
- Ensure the token has appropriate permissions

### "Build not found" or timeout
- Check Jenkins server is accessible
- Verify the Jenkins URL in settings
- Check if the target job exists

### Logs not appearing
- Wait a few seconds for the build to start
- Check if the build is queued

## JSON Tools Issues

### "Invalid JSON" error
- Check for trailing commas
- Ensure all strings are quoted
- Verify brackets are balanced
- Use a JSON validator to find the error

## Quick Query Issues

### Query generation fails
- Ensure schema is selected
- Check that column names match schema
- Verify data types are compatible

### Schema not loading
- Try importing default schemas from Settings
- Check if localStorage is available

## General Issues

### Settings not saving
- Clear browser cache and try again
- Check if localStorage is enabled
- Check browser privacy settings

### App feels slow
- Clear browser cache
- Reduce number of open tools
- Restart the app

### Still need help?
Report the issue to me.
          `,
        },
      ],
    },
  ],
};

/**
 * Get all searchable items from content
 */
export function getSearchableItems() {
  const items = [];
  for (const category of tutorialContent.categories) {
    for (const item of category.items) {
      items.push({
        categoryId: category.id,
        categoryName: category.name,
        ...item,
      });
    }
  }
  return items;
}

/**
 * Find content by ID
 */
export function findContentById(itemId) {
  for (const category of tutorialContent.categories) {
    const item = category.items.find((i) => i.id === itemId);
    if (item) {
      return { category, item };
    }
  }
  return null;
}
