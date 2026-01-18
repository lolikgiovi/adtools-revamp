# Compare Config - Comprehensive Feature Report

**Version:** 4.0
**Date:** January 18, 2026
**Status:** Production Ready

---

## Executive Summary

The **Compare Config Tool** is a sophisticated data comparison utility within AD Tools that enables users to compare Oracle database configurations between environments, compare raw SQL query results, and compare Excel/CSV files. It features dual-environment comparison with intelligent diff rendering, multiple view types, and persistent user preferences.

### Key Capabilities

- **3 Comparison Modes**: Schema/Table, Raw SQL, Excel Compare
- **3 View Types**: Summary Grid (default), Detail View, Cards
- **2 Deployment Modes**: Tauri (full features) and Web (Excel only)
- **Supported Formats**: XLSX, XLS, CSV for Excel mode
- **Performance**: Lazy loading for 4000+ row datasets
- **Persistence**: IndexedDB for file caching, localStorage for preferences

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Comparison Modes](#2-comparison-modes)
3. [Result Views](#3-result-views)
4. [User Preferences & Persistence](#4-user-preferences--persistence)
5. [Performance Optimizations](#5-performance-optimizations)
6. [Backend Architecture](#6-backend-architecture)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Security](#8-security)
9. [Known Limitations](#9-known-limitations)
10. [Improvement Opportunities](#10-improvement-opportunities)
11. [File Structure](#11-file-structure)

---

## 1. Feature Overview

### What Users Can Do

| Feature                           | Schema/Table | Raw SQL | Excel Compare |
| --------------------------------- | :----------: | :-----: | :-----------: |
| Compare data between two sources  |      ✓       |    ✓    |       ✓       |
| Custom primary key selection      |      ✓       |    ✓    |       ✓       |
| Field selection for comparison    |      ✓       |    ✓    |       ✓       |
| WHERE clause filtering            |      ✓       |    ✗    |       ✗       |
| Row limit configuration           |      ✓       |    ✓    |       ✗       |
| Export to JSON                    |      ✓       |    ✓    |       ✓       |
| Export to CSV                     |      ✓       |    ✓    |       ✓       |
| Character-level diff highlighting |      ✓       |    ✓    |       ✓       |
| Auto-match files by name          |      ✗       |    ✗    |       ✓       |
| Works in Web browser              |      ✗       |    ✗    |       ✓       |

### Environment Support

| Mode          | Tauri Desktop | Web Browser |
| ------------- | :-----------: | :---------: |
| Schema/Table  |       ✓       |      ✗      |
| Raw SQL       |       ✓       |      ✗      |
| Excel Compare |       ✓       |      ✓      |

---

## 2. Comparison Modes

### 2.1 Schema/Table Mode (Tauri Only)

**Purpose**: Compare Oracle database table contents between two environments.

**Workflow**:

1. Select Env1 and Env2 connections from saved Oracle connections
2. Fetch and select schema (validates schema exists in both envs)
3. Fetch and select table (validates table exists in both envs)
4. Configure primary key fields and comparison fields
5. Optionally add WHERE clause and row limit
6. Execute comparison

**Features**:

- Cascading validation (schema → table existence check)
- Auto-detection of primary keys from database metadata
- 18 system schemas automatically filtered (SYS, SYSTEM, etc.)
- Max rows limit: 1-10,000 (default 100)
- User preferences saved per table name

### 2.2 Raw SQL Mode (Tauri Only)

**Purpose**: Compare results of custom SQL queries across two environments.

**Workflow**:

1. Select Env1 and Env2 connections
2. Write SQL query (same query runs on both)
3. Optionally specify primary key field(s)
4. Execute comparison

**Features**:

- Free-form SQL with alias support
- Comma-separated primary key specification
- Composite key support
- Preferences saved per query hash

### 2.3 Excel Compare Mode (Tauri + Web)

**Purpose**: Compare Excel/CSV files without database connectivity.

**Workflow**:

1. Upload Reference files (drag-drop, browse, or folder select)
2. Upload Comparator files
3. Auto-matching pairs files by name/path
4. Configure field selection and matching options
5. Execute comparison

**Supported Formats**:

- `.xlsx` (Excel 2007+)
- `.xls` (Excel 97-2003)
- `.csv` (Comma-separated values)

**Matching Options**:

- **Row Matching**: By key values or by row position
- **Data Comparison**: Strict (as-is) or Normalized (dates/numbers)

**Auto-Match Algorithm**:

1. Exact filename match
2. Base name match (ignoring extension)
3. Base name match (ignoring suffixes: BEFORE/AFTER/OLD/NEW/PROD/DEV/etc.)
4. Folder-relative path matching

**Features**:

- Files cached in IndexedDB (persist across sessions)
- Preferences saved per reference filename
- Multi-file batch comparison
- Searchable file selection dropdowns

---

## 3. Result Views

### 3.1 Summary Grid (Default)

**Best For**: Quick overview and scanning large datasets

**Features**:

- Excel-style two-tier header (field names + env labels)
- Sticky PK and Status columns
- Smart column filtering (hides identical columns)
- Character-level diff highlighting
- **Lazy loading**: 100 rows initial, loads more on scroll
- Row count indicator: "Showing X of Y rows"
- Reference/Comparator labels when filenames match

### 3.2 Detail View (formerly Master-Detail)

**Best For**: Detailed examination of individual records

**Features**:

- Master list (left): All records with PK and status
- Detail panel (right): Selected record's full field comparison
- Previous/Next navigation with position indicator
- Click to select from master list

### 3.3 Cards View

**Best For**: Visual scanning with compact layout

**Features**:

- Each comparison as a vertical card
- Color-coded status badges
- Side-by-side Env1/Env2 values
- Difference highlighting

### View Selection

- Default view: Summary Grid
- User's view preference saved to localStorage
- View persists across sessions

---

## 4. User Preferences & Persistence

### 4.1 IndexedDB Storage (CompareConfigDB v2)

| Store               | Purpose                         | Key                 |
| ------------------- | ------------------------------- | ------------------- |
| `excelFiles`        | Cached uploaded Excel/CSV files | File ID             |
| `excelCompareState` | Session state during comparison | 'current'           |
| `excelFilePrefs`    | User preferences per Excel file | Reference filename  |
| `schemaTablePrefs`  | User preferences per table      | `table_{tableName}` |
| `rawSqlPrefs`       | User preferences per SQL query  | Query hash          |
| `comparisonHistory` | Past comparison records         | Auto-increment      |

### 4.2 localStorage Storage

| Key                         | Content                                 |
| --------------------------- | --------------------------------------- |
| `config.oracle.connections` | Saved Oracle connections                |
| `compare-config.last-state` | Tool state (connections, results, view) |

### 4.3 Preference Behavior

**Excel Compare**:

- When selecting a reference file, saved preferences are loaded
- Preferences include: PK fields, comparison fields, row matching, data comparison
- Only valid fields (present in current file) are restored
- Preferences saved when comparison is executed

**Schema/Table**:

- Preferences keyed by table name only (portable across schemas/connections)
- Includes: PK fields, comparison fields
- Loaded when table metadata is fetched

**Raw SQL**:

- Preferences keyed by query hash (case-insensitive, whitespace-normalized)
- Auto-fills PK field on query match

---

## 5. Performance Optimizations

### 5.1 Frontend Optimizations

| Optimization               | Description                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| **Lazy Loading**           | GridView renders 100 rows initially, loads more on scroll via IntersectionObserver |
| **Smart Column Filtering** | Automatically hides columns with no differences                                    |
| **Natural Field Order**    | Fields displayed in source order (no alphabetical sorting overhead)                |
| **Batch File Parsing**     | Excel files parsed in parallel using Promise.all                                   |
| **IndexedDB Caching**      | Uploaded files cached to avoid re-upload                                           |

### 5.2 Backend Optimizations

| Optimization              | Description                                   |
| ------------------------- | --------------------------------------------- |
| **Connection Pooling**    | Max 4 connections, reused by credentials      |
| **5-min Idle Timeout**    | Stale connections auto-closed                 |
| **5-min Query Timeout**   | Prevents hung queries                         |
| **Parameterized Queries** | SQL injection prevention + query plan caching |
| **Max Rows Limit**        | Prevents memory exhaustion (default 100)      |

### 5.3 Memory Management

- CLOB/NCLOB truncated at 1MB with indicator
- BLOB/RAW shown as placeholder with size
- Result caching in localStorage with quota handling
- Graceful degradation on quota exceeded

---

## 6. Backend Architecture

### 6.1 Rust/Tauri Commands

| Command                       | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `check_oracle_client_ready()` | Check if Oracle Instant Client installed |
| `prime_oracle_client()`       | Initialize Oracle client library         |
| `test_oracle_connection()`    | Test connection credentials              |
| `fetch_schemas()`             | Get schemas from database                |
| `fetch_tables()`              | Get tables in schema                     |
| `fetch_table_metadata()`      | Get column info and PKs                  |
| `compare_configurations()`    | Execute table comparison                 |
| `compare_raw_sql()`           | Execute SQL comparison                   |
| `export_comparison_result()`  | Export to JSON/CSV                       |
| `get_active_connections()`    | List connection pool                     |
| `close_connection()`          | Terminate specific connection            |
| `close_all_connections()`     | Terminate all connections                |
| `set_oracle_credentials()`    | Store credentials in keychain            |
| `get_oracle_credentials()`    | Retrieve credentials from keychain       |
| `delete_oracle_credentials()` | Remove credentials from keychain         |
| `has_oracle_credentials()`    | Check if credentials exist               |

### 6.2 Connection Pool

- **Max Connections**: 4
- **Idle Timeout**: 5 minutes
- **Query Timeout**: 5 minutes
- **Reuse Strategy**: Match by connect_string + username

### 6.3 Data Type Handling

| Oracle Type     | Handling                             |
| --------------- | ------------------------------------ |
| VARCHAR2, CHAR  | As-is string                         |
| NUMBER          | String (preserves precision)         |
| DATE, TIMESTAMP | ISO 8601 string                      |
| CLOB, NCLOB     | String (truncate at 1MB)             |
| BLOB            | Placeholder with size                |
| RAW, LONG RAW   | Placeholder with size                |
| BFILE           | Placeholder "[BFILE: external file]" |

---

## 7. Frontend Architecture

### 7.1 Core Files

| File          | Lines  | Purpose                           |
| ------------- | ------ | --------------------------------- |
| `main.js`     | ~4,700 | Main controller, state management |
| `service.js`  | ~230   | Tauri API wrapper                 |
| `template.js` | ~480   | HTML structure                    |
| `styles.css`  | ~2,700 | Styling                           |

### 7.2 Libraries

| Library                 | Purpose                                |
| ----------------------- | -------------------------------------- |
| `diff-engine.js`        | Character-level diff (Myers algorithm) |
| `diff-adapter.js`       | Format conversion between JS/Rust      |
| `file-parser.js`        | XLSX/XLS/CSV parsing (SheetJS)         |
| `file-matcher.js`       | Auto-match files by name               |
| `excel-comparator.js`   | Orchestrate multi-file comparison      |
| `indexed-db-manager.js` | IndexedDB operations                   |
| `diff-worker.js`        | Web Worker for heavy computation       |

### 7.3 View Components

| View             | File                        | Key Features                 |
| ---------------- | --------------------------- | ---------------------------- |
| GridView         | `views/GridView.js`         | Lazy loading, sticky headers |
| MasterDetailView | `views/MasterDetailView.js` | Split pane, navigation       |
| VerticalCardView | `views/VerticalCardView.js` | Card layout                  |

---

## 8. Security

### 8.1 Credential Storage

- **macOS Keychain**: Credentials stored securely
- **Service Key**: `ad-tools:oracle`
- **Format**: JSON with username/password per connection
- **Access**: Backend only, never exposed to frontend

### 8.2 SQL Injection Prevention

- Identifier validation (128 chars, alphanumeric + \_ $ #)
- Parameterized queries for all user input
- WHERE clause passed as parameter

### 8.3 Data Sanitization

- Control character removal
- Size limits (10MB strings, 1MB CLOBs)
- Binary data markers for BLOB/RAW

---

## 9. Known Limitations

### 9.1 Current Limitations

1. **Schema/Table & Raw SQL**: Tauri desktop only (requires Oracle client)
2. **Excel file size**: Large files (>10MB) may cause browser memory issues
3. **Row position matching**: May give unexpected results if row order differs
4. **Composite keys**: Join delimiter `|NULL|` could theoretically conflict with data

### 9.2 Browser Limitations (Web Mode)

1. Only Excel Compare mode available
2. No Oracle database connectivity
3. File caching limited by IndexedDB quota

---

## 10. Improvement Opportunities

### 10.1 High Priority

| Improvement                        | Benefit                                | Complexity |
| ---------------------------------- | -------------------------------------- | ---------- |
| **Virtual scrolling for GridView** | Handle 10,000+ rows smoothly           | Medium     |
| **Diff caching**                   | Avoid recomputing diffs on view switch | Low        |
| **Batch export**                   | Export multiple comparisons at once    | Low        |
| **Keyboard navigation**            | Power user efficiency                  | Medium     |

### 10.2 Medium Priority

| Improvement                     | Benefit                         | Complexity |
| ------------------------------- | ------------------------------- | ---------- |
| **Comparison history UI**       | Re-run past comparisons easily  | Medium     |
| **Field mapping for Excel**     | Handle renamed columns          | Medium     |
| **Saved comparison templates**  | Quick re-run with same settings | Medium     |
| **Dark/Light mode consistency** | Better visual accessibility     | Low        |

### 10.3 Technical Debt

| Item                       | Description                          |
| -------------------------- | ------------------------------------ |
| Consolidate view rendering | Reduce code duplication across views |
| Extract comparison logic   | Separate comparison from UI          |
| Add unit tests             | Increase frontend test coverage      |
| Document IndexedDB schema  | Add migration strategy               |

---

## 11. File Structure

```
frontend/tools/compare-config/
├── main.js                          # Main controller (4,700 lines)
├── service.js                       # Tauri API wrapper
├── template.js                      # HTML structure
├── icon.js                          # SVG icon
├── styles.css                       # Comprehensive styling
├── lib/
│   ├── diff-engine.js               # Comparison logic
│   ├── diff-adapter.js              # Format conversion
│   ├── file-parser.js               # XLSX/CSV parsing
│   ├── file-matcher.js              # Auto-matching
│   ├── excel-comparator.js          # Excel orchestration
│   ├── indexed-db-manager.js        # IndexedDB operations
│   ├── diff-worker-manager.js       # Web worker management
│   ├── diff-worker.js               # Worker implementation
│   └── feature-flags.js             # Feature control
├── views/
│   ├── GridView.js                  # Table view with lazy loading
│   ├── VerticalCardView.js          # Card view
│   └── MasterDetailView.js          # Split view
└── tests/
    ├── diff-engine.test.js
    ├── file-parser.test.js
    ├── file-matcher.test.js
    └── excel-comparator.test.js

src-tauri/src/
├── oracle.rs                        # Oracle operations (1,450 lines)
├── lib.rs                           # Rust command exports
└── main.rs                          # Tauri app entry
```

---

## Version History

| Version | Date       | Changes                                                 |
| ------- | ---------- | ------------------------------------------------------- |
| 4.0     | 2026-01-18 | Lazy loading, preference persistence, view improvements |
| 3.0     | 2025-11-08 | Schema/Table discovery complete                         |
| 2.0     | 2025-11-07 | Connection management complete                          |
| 1.0     | 2025-11-07 | Initial Oracle client integration                       |

---

**Last Updated:** January 18, 2026
**Maintained By:** AD Tools Development Team
