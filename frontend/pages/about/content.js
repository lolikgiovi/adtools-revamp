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
- **Jenkins Runner** — Execute Oracle SQL on Jenkins directly from your desktop
- **JSON Tools** — Format, validate, and manipulate JSON
- **Base64 Tools** — Encode and decode Base64
- **And more!**

## How It Started

AD Tools was initially built to automate non-practical chores like generating multiple UUIDs without formatting, encoding/decoding Base64, and creating SQL queries.

The app started as a static page hosted on Cloudflare Pages, and has evolved into both a Desktop app (using Tauri) and a Web App.

## Desktop vs Web

| Feature | Desktop | Web |
|---------|---------|-----|
| Jenkins Runner | ✅ Available | ❌ Not available |
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
- First row should contain column headers (or use "Add field names from schema")
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
          id: "jenkins-runner",
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

Encode and decode Base64 strings and images.

## Tabs

### Encode
Convert plain text to Base64-encoded string.

### Decode
Convert Base64-encoded string back to plain text.

### Image Encode
Convert images to Base64 data URLs:
1. Drag & drop an image or click to select
2. The Base64 data URL is generated automatically
3. Copy to use in HTML/CSS

### Image Decode
Convert Base64 data URLs back to viewable images:
1. Paste a Base64 data URL
2. Preview the decoded image
3. Download if needed

## Use Cases

- Embedding images in HTML/CSS
- Encoding API payloads
- Decoding Base64 responses
- Quick data transformation

## Tips

- 💡 Image encode preserves the original format (PNG, JPEG, etc.)
- 💡 Maximum recommended image size: 5MB
          `,
        },
        {
          id: "qr-tools",
          title: "QR Tools",
          content: `
# QR Tools

Generate and read QR codes.

## Generate Tab

Create QR codes from text:
1. Enter text or URL in the input field
2. QR code generates automatically
3. Download as PNG or copy to clipboard

## Read Tab

Decode QR codes from images:
1. Upload an image containing a QR code
2. The decoded content appears below
3. Copy the result

## Use Cases

- Generate QR codes for URLs
- Create QR codes for WiFi credentials
- Decode QR codes from screenshots
- Quick information sharing

## Tips

- 💡 Works with most QR code types
- 💡 Supports camera input on supported devices
          `,
        },
        {
          id: "sql-in-clause",
          title: "SQL In-Clause",
          content: `
# SQL In-Clause Generator

Generate SQL IN clauses from lists of values.

## How to Use

1. Paste a list of values (one per line or comma-separated)
2. Select the data type (String, Number, etc.)
3. Click Generate
4. Copy the formatted IN clause

## Example

**Input:**
\`\`\`
apple
banana
cherry
\`\`\`

**Output:**
\`\`\`sql
('apple', 'banana', 'cherry')
\`\`\`

## Options

- **Quote Type** — Single or double quotes for strings
- **Data Type** — String (quoted) or Number (unquoted)
- **Separator** — Comma, newline, or custom

## Tips

- 💡 Handles duplicates automatically
- 💡 Trims whitespace from values
- 💡 Escapes special characters
          `,
        },
        {
          id: "uuid-generator",
          title: "UUID Generator",
          content: `
# UUID Generator

Generate multiple UUIDs in various formats.

## Options

| Option | Description |
|--------|-------------|
| **Count** | Number of UUIDs to generate (1-1000) |
| **Format** | Uppercase, lowercase, or with braces |
| **Version** | UUID v4 (random) |

## Formats

- \`550e8400-e29b-41d4-a716-446655440000\` — Standard
- \`550E8400-E29B-41D4-A716-446655440000\` — Uppercase
- \`{550e8400-e29b-41d4-a716-446655440000}\` — With braces

## How to Use

1. Set the number of UUIDs needed
2. Choose format options
3. Click Generate
4. Copy all or individual UUIDs

## Tips

- 💡 Click individual UUIDs to copy them
- 💡 No formatting characters (just raw UUIDs) for easy pasting
          `,
        },
        {
          id: "master-lockey",
          title: "Master Lockey",
          content: `
# Master Lockey

Lock key and cache management utility.

## Overview

Master Lockey helps manage distributed lock keys and cache entries across different environments.

## Features

- View active locks
- Release stale locks
- Manage cache entries
- Environment-specific operations

## How to Use

1. Select the target environment
2. Enter the lock key pattern or cache key
3. Choose the operation (View, Release, Clear)
4. Execute and view results

## Tips

- 💡 Use wildcards for pattern matching
- 💡 Be careful when releasing locks in production
          `,
        },
        {
          id: "splunk-template",
          title: "Splunk Template",
          content: `
# Splunk Template

Generate Splunk search queries from templates.

## Overview

Create commonly-used Splunk search queries with variable substitution.

## How to Use

1. Select a template or create a new one
2. Fill in the required variables
3. Generate the final Splunk query
4. Copy and paste into Splunk

## Template Variables

Templates support variables like:
- \`{{startTime}}\` — Search start time
- \`{{endTime}}\` — Search end time
- \`{{index}}\` — Target index
- \`{{searchTerm}}\` — Custom search terms

## Tips

- 💡 Save frequently used queries as templates
- 💡 Templates persist across sessions
          `,
        },
        {
          id: "image-checker",
          title: "Image Checker",
          content: `
# Image Checker

Validate and analyze images.

## Features

- Check image dimensions
- Verify file format
- View metadata (EXIF data)
- Validate for specific requirements

## How to Use

1. Drag & drop an image or click to upload
2. View analysis results:
   - Dimensions (width × height)
   - File size
   - Format (PNG, JPEG, etc.)
   - Color profile

## Use Cases

- Validate images before upload
- Check ad creative dimensions
- Extract image metadata
- Quick image inspection

## Tips

- 💡 Supports common formats: PNG, JPEG, GIF, WebP
- 💡 Shows exact pixel dimensions
          `,
        },
        {
          id: "html-editor",
          title: "HTML Editor",
          content: `
# HTML Editor

Live HTML/CSS/JavaScript preview editor.

## Overview

A simple code playground for HTML, CSS, and JavaScript with live preview.

## Panels

- **HTML** — Write your HTML markup
- **CSS** — Add styles
- **JavaScript** — Add interactivity
- **Preview** — Live rendered output

## Features

- Real-time preview updates
- Syntax highlighting
- Error display in console
- Responsive preview

## How to Use

1. Write HTML in the HTML panel
2. Add CSS for styling
3. Add JavaScript for interactivity
4. View live preview in the Preview panel

## Tips

- 💡 Changes are reflected immediately
- 💡 Use for quick prototyping
- 💡 Perfect for testing CSS snippets
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

Jenkins Runner uses the Jenkins REST API to:
1. Trigger a parameterized build job
2. Pass SQL as a parameter
3. Poll for build status and logs

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
Use the Feedback option in the sidebar to report issues.
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
