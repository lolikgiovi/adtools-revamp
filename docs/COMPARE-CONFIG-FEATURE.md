# Database Configuration Comparison Feature - Technical Specification

**Version:** 2.0
**Date:** November 6, 2025
**Project:** AD Tools (Tauri Desktop Application)
**Feature:** Oracle Database Configuration Comparison with Instant Client Integration

---

## Table of Contents

1. [Overview](#1-overview)
2. [User Flow](#2-user-flow)
3. [System Architecture](#3-system-architecture)
4. [Data Models](#4-data-models)
5. [Backend Implementation](#5-backend-implementation)
6. [Frontend Implementation](#6-frontend-implementation)
7. [Oracle Instant Client Integration](#7-oracle-instant-client-integration)
8. [Security & Credentials](#8-security--credentials)
9. [Error Handling](#9-error-handling)
10. [Testing Strategy](#10-testing-strategy)
11. [Deployment Plan](#11-deployment-plan)
12. [Future Enhancements](#12-future-enhancements)

---

## 1. Overview

### 1.1 Purpose

This document specifies the implementation of a database configuration comparison feature in the AD Tools Tauri application. The feature enables users to compare configuration tables between Oracle database environments with flexible filtering and visualization options.

**IMPORTANT:** This is an **optional feature** that requires Oracle Instant Client installation. The application remains fully functional without this feature, and users who don't need Oracle database comparison capabilities can use all other tools without installing the Oracle client.

### 1.2 Scope

- Compare configuration records between two Oracle database instances
- Support flexible primary key definition via WHERE clause
- Allow selective field comparison or all fields
- Display differences with multiple visualization options
- **Character/word-level diff highlighting with color-coded visualization** (NEW)
- Export comparison results
- Integrate Oracle Instant Client for local execution (optional, user-installed)
- Provide installation script and guidance for Oracle client setup
- Gracefully degrade when Oracle client is not installed

### 1.3 Goals

- Enable quick identification of configuration discrepancies between environments
- Provide flexible, user-defined comparison criteria
- Support operational and deployment workflows
- Maintain security best practices with credential management
- **Gracefully handle Oracle client availability with clear installation guidance**
- **Keep the feature entirely optional - app works perfectly without it**
- **Never bundle Oracle client - user-driven installation only**
- **Provide visual diff highlighting for instant identification of differences**

### 1.4 Key Features

**🎨 Visual Diff Highlighting (NEW)**

The comparison results include **character/word-level diff highlighting** to instantly identify what changed between environments:

- **Green highlighting**: Text added or changed in Environment 2
- **Red highlighting** (with strikethrough): Text removed or changed from Environment 1
- **Yellow highlighting**: Modified text (for complex changes)
- **No highlighting**: Identical text in both environments

This provides a Git-like diff experience directly in the comparison table, eliminating the need for manual scanning and reducing cognitive load.

**Example:**
- **Env1**: `timeout = `<span style="background:#f8d7da">~~5000~~</span>` ms`
- **Env2**: `timeout = `<span style="background:#d4edda">**8000**</span>` ms`

See [Section 6.7](#67-diff-highlighting-example) for detailed examples.

**🔒 Comprehensive Data Sanitization (NEW)**

All Oracle query results are sanitized in the backend before reaching the frontend:

- **Type-safe conversion**: Oracle types → JSON with proper handling of NUMBER, DATE, CLOB, BLOB, etc.
- **Control character removal**: Prevents malformed data from crashing the UI
- **Size limits**: Strings truncated at 10MB, CLOBs at 1MB to prevent DoS
- **Binary data handling**: BLOB/RAW types displayed as `[BINARY DATA]` markers
- **NULL handling**: Consistent null values across all data types
- **XSS prevention**: Sanitization prevents script injection attacks

See [Section 8.3](#83-data-sanitization--type-safety) for implementation details.

**⚡ Backend Diff Processing**

The diff algorithm runs entirely in Rust (backend) rather than JavaScript (frontend):

- **Performance**: 10-100x faster text processing with Rust
- **Memory efficiency**: Large datasets don't block UI thread
- **Consistency**: Same algorithm for display, JSON export, CSV export
- **Testability**: Comprehensive unit tests in Rust

See [Section 5.4](#54-comparison-engine-comparisonrs) for technical details.

### 1.5 Integration with Existing Architecture

**Frontend:** Vanilla JavaScript module in `app/tools/compare-config/`

- Follows `BaseTool` pattern with lifecycle hooks
- Uses EventBus for notifications
- Integrates with existing settings and credential management

**Backend:** Rust module in `src-tauri/src/oracle/`

- Tauri commands for database operations
- Oracle Instant Client integration
- Keychain integration for credentials
- Result-based error handling

---

## 2. User Flow

### 2.1 Oracle Client Installation Check Flow

**CRITICAL:** Before the main comparison flow, users must have Oracle Instant Client installed.

```
┌─────────────────────────────────────────────────────────────┐
│ Step 0: Tool Access & Oracle Client Check                  │
├─────────────────────────────────────────────────────────────┤
│ User opens Compare Config tool                              │
│ → App checks: invoke('check_oracle_client_ready')          │
│                                                              │
│ IF Oracle Client NOT INSTALLED:                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ ⚠️  FEATURE NOT AVAILABLE                           │  │
│   │                                                       │  │
│   │ Oracle Instant Client Required                       │  │
│   │                                                       │  │
│   │ This feature requires Oracle Instant Client to       │  │
│   │ connect to Oracle databases. The client is NOT       │  │
│   │ bundled with AD Tools due to licensing and size.     │  │
│   │                                                       │  │
│   │ Installation Steps:                                  │  │
│   │ 1. Download Oracle Instant Client Basic Light        │  │
│   │    for your architecture (arm64/x86_64)              │  │
│   │    from: oracle.com/database/technologies/...        │  │
│   │                                                       │  │
│   │ 2. Run the installation script:                      │  │
│   │    ./scripts/install-oracle-client.sh /path/to.zip   │  │
│   │                                                       │  │
│   │ 3. Restart AD Tools                                  │  │
│   │                                                       │  │
│   │ [📋 Copy Download URL]  [📖 View Full Guide]         │  │
│   │                                                       │  │
│   │ Note: Oracle client is ~80MB. Installation requires  │  │
│   │ no admin privileges.                                 │  │
│   └─────────────────────────────────────────────────────┘  │
│   • All form inputs: DISABLED                               │
│   • "Compare" button: DISABLED                              │
│   • User cannot proceed until client is installed           │
└─────────────────────────────────────────────────────────────┘
                            ↓
                  (After Installation)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Oracle Client INSTALLED & READY                             │
├─────────────────────────────────────────────────────────────┤
│ → App calls: invoke('prime_oracle_client')                 │
│ → Success: Feature unlocked, forms enabled                  │
│ → User can now proceed with comparison                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Settings Integration - Oracle Database Connections

**Before using Compare Config, users configure Oracle connections in Settings:**

```
┌─────────────────────────────────────────────────────────────┐
│ Settings → Oracle Database Connections                     │
├─────────────────────────────────────────────────────────────┤
│ User adds Oracle database connections:                      │
│                                                              │
│ ┌─ Connection: UAT1 ─────────────────────────────────────┐ │
│ │ Host:         db-uat1.company.com                       │ │
│ │ Port:         1521                                      │ │
│ │ Service Name: ORCLPDB1                                  │ │
│ │ Schema:       APP_SCHEMA                                │ │
│ │ Username:     ******** (keychain)                       │ │
│ │ Password:     ******** (keychain)                       │ │
│ │ [Test] [Save] [Delete]                      Status: ✓   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ Saved Connections:                                           │
│ • UAT1 - db-uat1.company.com ✓                              │
│ • UAT2 - db-uat2.company.com ✓                              │
│ • PROD - db-prod.company.com ✓                              │
│                                                              │
│ [+ Add New Connection]                                       │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Step-by-Step User Journey (After Oracle Client Installation & Settings Configuration)

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Select Reference Environment (Env1)                │
├─────────────────────────────────────────────────────────────┤
│ - Dropdown shows saved connections from Settings:           │
│   [Select Connection ▼]                                      │
│    • UAT1 - db-uat1.company.com                             │
│    • UAT2 - db-uat2.company.com                             │
│    • PROD - db-prod.company.com                             │
│                                                              │
│ - Select "UAT1" → auto-fills all connection details         │
│ - Credentials loaded from keychain automatically            │
│ - Status: ✓ Connected                                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Select Comparison Environment (Env2)               │
├─────────────────────────────────────────────────────────────┤
│ - Dropdown shows saved connections from Settings:           │
│   [Select Connection ▼]                                      │
│    • UAT1 - db-uat1.company.com                             │
│    • UAT2 - db-uat2.company.com ← Selected                  │
│    • PROD - db-prod.company.com                             │
│                                                              │
│ - Select "UAT2" → auto-fills all connection details         │
│ - Credentials loaded from keychain automatically            │
│ - Status: ✓ Connected                                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Select Table to Compare                            │
├─────────────────────────────────────────────────────────────┤
│ - Browse tables from Env1 schema (optional)                 │
│ - Or enter table name directly                              │
│ - Fetch table properties to preview columns                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Define Primary Key Filter (WHERE Clause)           │
├─────────────────────────────────────────────────────────────┤
│ - Text field for WHERE clause definition                    │
│ - Examples:                                                  │
│   • config_key IN ('db_pool', 'api_timeout')                │
│   • category = 'DATABASE' AND is_active = 'Y'               │
│   • config_key LIKE 'feature_%'                             │
│   • (Leave blank to compare all records)                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 5: Select Fields to Compare                           │
├─────────────────────────────────────────────────────────────┤
│ - Multi-select checkbox list of columns                     │
│ - "Select All" / "Deselect All" shortcuts                   │
│ - Primary key always included automatically                 │
│ - Preview: "Comparing 8 of 10 fields"                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 6: Execute Comparison                                  │
├─────────────────────────────────────────────────────────────┤
│ - Click "Compare Configurations"                            │
│ - Backend fetches data from both environments               │
│ - Comparison engine processes differences                   │
│ - Progress indicator shows status                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 7: View Results                                        │
├─────────────────────────────────────────────────────────────┤
│ - Summary statistics (matching, differing, unique)          │
│ - Choose view mode:                                          │
│   • Expandable Rows (default)                               │
│   • Vertical Cards                                           │
│   • Master-Detail Split                                      │
│ - Color-coded status badges                                  │
│ - Filter/search results                                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 8: Export (Optional)                                   │
├─────────────────────────────────────────────────────────────┤
│ - Export to JSON, CSV, or HTML                              │
│ - Save to ~/Documents/adtools_library/comparisons/          │
│ - Timestamped filename                                       │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Settings Configuration Details

**Add to `app/pages/settings/config.json`:**

```json
{
  "id": "oracle",
  "label": "Oracle Database Connections",
  "requiresTauri": true,
  "initiallyExpanded": false,
  "description": "Manage Oracle database connections for Compare Config tool. Requires Oracle Instant Client.",
  "items": [
    {
      "key": "oracle.connections",
      "storageKey": "config.oracle.connections",
      "label": "Database Connections",
      "type": "kvlist",
      "default": [],
      "keyPlaceholder": "Connection Name",
      "valuePlaceholder": "Connection Details (JSON)",
      "description": "Configure Oracle database connections. Format: {\"host\": \"...\", \"port\": 1521, \"service_name\": \"...\", \"schema\": \"...\"}",
      "validation": {
        "jsonValue": true
      }
    }
  ]
}
```

**Connection Data Structure (stored in localStorage as JSON array):**

```javascript
// config.oracle.connections
[
  {
    name: "UAT1",
    host: "db-uat1.company.com",
    port: 1521,
    service_name: "ORCLPDB1",
    schema: "APP_SCHEMA",
    lastTested: "2025-11-06T14:30:00Z",
    status: "active",
  },
  {
    name: "UAT2",
    host: "db-uat2.company.com",
    port: 1521,
    service_name: "ORCLPDB2",
    schema: "APP_SCHEMA",
    lastTested: "2025-11-06T14:31:00Z",
    status: "active",
  },
];
```

**Credentials Storage (macOS Keychain via Tauri):**

- Username: `adtools.oracle.{name}.username`
- Password: `adtools.oracle.{name}.password`

### 2.5 Example Scenarios

**Scenario 1: Compare All Configs**

- Env1: UAT1 → Env2: UAT2
- Table: APP_CONFIG
- WHERE clause: (blank - compare all)
- Fields: All fields selected
- Result: Shows all config keys with differences highlighted

**Scenario 2: Compare Specific Category**

- Env1: PROD → Env2: DR
- Table: SYSTEM_PARAMETERS
- WHERE clause: `category = 'DATABASE' AND is_active = 'Y'`
- Fields: param_key, param_value, modified_date
- Result: Shows only database-related active parameters

**Scenario 3: Compare Feature Flags**

- Env1: DEV → Env2: TEST
- Table: FEATURE_FLAGS
- WHERE clause: `flag_name LIKE 'feature_%' AND environment IN ('dev', 'test')`
- Fields: flag_name, enabled, rollout_percentage
- Result: Shows feature flag differences

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Frontend (Vanilla JS)                       │
│  app/tools/compare-config/                                  │
│  ├─ main.js              (Tool controller, extends BaseTool)│
│  ├─ template.js          (HTML templates)                   │
│  ├─ styles.css           (Component styles)                 │
│  ├─ service.js           (Business logic)                   │
│  └─ views/                                                   │
│      ├─ ExpandableRowView.js                               │
│      ├─ VerticalCardView.js                                │
│      └─ MasterDetailView.js                                │
└─────────────────────────────────────────────────────────────┘
                            ↕ Tauri IPC (invoke)
┌─────────────────────────────────────────────────────────────┐
│                 Backend (Rust - Tauri)                      │
│  src-tauri/src/oracle/                                      │
│  ├─ mod.rs               (Module definition)                │
│  ├─ client.rs            (Oracle client management)         │
│  ├─ connection.rs        (Connection pooling)               │
│  ├─ comparison.rs        (Comparison engine)                │
│  ├─ commands.rs          (Tauri command handlers)           │
│  └─ models.rs            (Data structures)                  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                 Oracle Instant Client                       │
│  ~/Documents/adtools_library/instantclient/                 │
│  └─ libclntsh.dylib      (Loaded at runtime)               │
└─────────────────────────────────────────────────────────────┘
                            ↕
        ┌──────────────────┐         ┌──────────────────┐
        │   Oracle DB      │         │   Oracle DB      │
        │  Environment 1   │         │  Environment 2   │
        │   (Reference)    │         │  (Comparison)    │
        └──────────────────┘         └──────────────────┘
```

### 3.2 Technology Stack

**Frontend:**

- Vanilla JavaScript ES6+ modules (consistent with existing tools)
- Vite for development builds
- EventBus for inter-component communication
- localStorage for saved connections
- Tauri API for backend invocation

**Backend:**

- Rust with Tauri 2.x framework
- `oracle` crate (0.6+) or `sibyl` crate for database connectivity
- `serde` + `serde_json` for serialization
- `tokio` for async runtime
- `anyhow` for error handling
- `keyring` crate for credential storage
- `libloading` for explicit Oracle client loading

**Database:**

- Oracle Database 11g+ (any version supporting Instant Client)
- Read-only access required
- Standard SQL queries via Oracle SQL dialect

---

## 4. Data Models

### 4.1 Frontend Models (JavaScript)

```javascript
// Connection configuration
class ConnectionConfig {
  constructor(name, host, port, serviceName, schema) {
    this.name = name; // Display name (e.g., "UAT1")
    this.host = host; // Database host
    this.port = port; // Port (default 1521)
    this.serviceName = serviceName; // Oracle service name
    this.schema = schema; // Schema/owner
  }
}

// Comparison request
class ComparisonRequest {
  constructor(env1, env2, tableName, whereClause, fields) {
    this.env1_name = env1.name;
    this.env1_connection = env1;
    this.env2_name = env2.name;
    this.env2_connection = env2;
    this.table_name = tableName;
    this.where_clause = whereClause; // Optional SQL WHERE clause
    this.fields = fields; // Array of field names or null for all
  }
}

// Comparison result
class ComparisonResult {
  constructor(env1Name, env2Name, timestamp, summary, comparisons) {
    this.env1_name = env1Name;
    this.env2_name = env2Name;
    this.timestamp = timestamp;
    this.summary = summary; // ComparisonSummary
    this.comparisons = comparisons; // Array of ConfigComparison
  }
}

// Single config comparison
class ConfigComparison {
  constructor(primaryKey, status, env1Data, env2Data, differences) {
    this.primary_key = primaryKey; // Primary key value(s)
    this.status = status; // "Match" | "Differ" | "OnlyInEnv1" | "OnlyInEnv2"
    this.env1_data = env1Data; // Object with field values
    this.env2_data = env2Data; // Object with field values
    this.differences = differences; // Array of FieldDifference
  }
}

// Field difference with diff chunks
class FieldDifference {
  constructor(fieldName, env1Value, env2Value, env1DiffChunks, env2DiffChunks) {
    this.field_name = fieldName;
    this.env1_value = env1Value;
    this.env2_value = env2Value;
    this.env1_diff_chunks = env1DiffChunks; // Array of DiffChunk
    this.env2_diff_chunks = env2DiffChunks; // Array of DiffChunk
  }
}

// Diff chunk for character-level highlighting
class DiffChunk {
  constructor(text, chunkType) {
    this.text = text;
    this.chunk_type = chunkType; // "Same" | "Added" | "Removed" | "Modified"
  }
}
```

### 4.2 Backend Models (Rust)

```rust
use serde::{Deserialize, Serialize};

/// Connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub service_name: String,
    pub schema: String,
}

/// Comparison request from frontend
#[derive(Debug, Deserialize)]
pub struct ComparisonRequest {
    pub env1_name: String,
    pub env1_connection: ConnectionConfig,
    pub env2_name: String,
    pub env2_connection: ConnectionConfig,
    pub table_name: String,
    pub where_clause: Option<String>,  // Optional WHERE clause
    pub fields: Option<Vec<String>>,   // Optional field list (null = all)
}

/// Complete comparison result
#[derive(Debug, Serialize)]
pub struct ComparisonResult {
    pub env1_name: String,
    pub env2_name: String,
    pub timestamp: String,
    pub summary: ComparisonSummary,
    pub comparisons: Vec<ConfigComparison>,
}

/// Summary statistics
#[derive(Debug, Serialize)]
pub struct ComparisonSummary {
    pub total_records: usize,
    pub matching: usize,
    pub differing: usize,
    pub only_in_env1: usize,
    pub only_in_env2: usize,
}

/// Single record comparison
#[derive(Debug, Serialize)]
pub struct ConfigComparison {
    pub primary_key: String,
    pub status: ComparisonStatus,
    pub env1_data: Option<serde_json::Value>,
    pub env2_data: Option<serde_json::Value>,
    pub differences: Vec<FieldDifference>,
}

/// Comparison status enum
#[derive(Debug, Serialize, PartialEq)]
pub enum ComparisonStatus {
    Match,
    Differ,
    OnlyInEnv1,
    OnlyInEnv2,
}

/// Field-level difference with character-level highlighting
#[derive(Debug, Serialize)]
pub struct FieldDifference {
    pub field_name: String,
    pub env1_value: Option<String>,
    pub env2_value: Option<String>,
    /// Character-level diff chunks for highlighting (see DiffChunk)
    pub env1_diff_chunks: Option<Vec<DiffChunk>>,
    pub env2_diff_chunks: Option<Vec<DiffChunk>>,
}

/// Represents a chunk of text with its diff type for highlighting
#[derive(Debug, Serialize, Clone)]
pub struct DiffChunk {
    pub text: String,
    pub chunk_type: DiffChunkType,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub enum DiffChunkType {
    Same,      // No change (no highlighting)
    Added,     // Text added (green)
    Removed,   // Text removed (red)
    Modified,  // Text changed (yellow)
}

/// Table metadata
#[derive(Debug, Serialize)]
pub struct TableMetadata {
    pub owner: String,
    pub table_name: String,
    pub columns: Vec<ColumnInfo>,
    pub primary_key: Vec<String>,
}

/// Column information
#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_pk: bool,
}
```

---

## 5. Backend Implementation

### 5.1 File Structure

```
src-tauri/src/oracle/
├── mod.rs              # Module exports
├── client.rs           # Oracle client lifecycle management
├── connection.rs       # Database connection handling
├── comparison.rs       # Comparison engine logic
├── commands.rs         # Tauri command handlers
└── models.rs           # Data structures
```

### 5.2 Oracle Client Management (client.rs)

```rust
use libloading::{Library, Symbol};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

static ORACLE_CLIENT: Mutex<Option<Arc<Library>>> = Mutex::new(None);

/// Check if Oracle Instant Client is available
pub fn check_client_ready(custom_dir: Option<String>) -> Result<bool, String> {
    let lib_path = resolve_client_path(custom_dir)?;

    if !lib_path.exists() {
        return Ok(false);
    }

    // Verify it's a valid library
    match unsafe { Library::new(&lib_path) } {
        Ok(_) => Ok(true),
        Err(e) => Ok(false),
    }
}

/// Load Oracle client library explicitly
pub fn prime_client(custom_dir: Option<String>) -> Result<(), String> {
    let lib_path = resolve_client_path(custom_dir)?;

    if !lib_path.exists() {
        return Err(format!("Oracle client not found at: {:?}", lib_path));
    }

    let lib = unsafe {
        Library::new(&lib_path)
            .map_err(|e| format!("Failed to load Oracle client: {}", e))?
    };

    // Keep the library loaded by storing it
    let arc_lib = Arc::new(lib);
    let mut client = ORACLE_CLIENT.lock().unwrap();
    *client = Some(arc_lib);

    Ok(())
}

/// Resolve Oracle client library path
fn resolve_client_path(custom_dir: Option<String>) -> Result<PathBuf, String> {
    let base_dir = if let Some(custom) = custom_dir {
        PathBuf::from(custom)
    } else {
        let home = std::env::var("HOME")
            .map_err(|_| "Could not determine HOME directory".to_string())?;
        PathBuf::from(home)
            .join("Documents")
            .join("adtools_library")
            .join("instantclient")
    };

    Ok(base_dir.join("libclntsh.dylib"))
}
```

### 5.3 Database Connection (connection.rs)

```rust
use oracle::{Connection, Row};
use crate::oracle::models::*;

pub struct DatabaseConnection {
    conn: Connection,
}

impl DatabaseConnection {
    /// Create new connection with credentials from keychain
    pub fn new(config: &ConnectionConfig, credentials: &Credentials) -> Result<Self, String> {
        let connect_string = format!(
            "{}:{}/{}",
            config.host,
            config.port,
            config.service_name
        );

        let conn = Connection::connect(
            &credentials.username,
            &credentials.password,
            &connect_string,
        )
        .map_err(|e| format!("Connection failed: {}", e))?;

        Ok(DatabaseConnection { conn })
    }

    /// Test connection
    pub fn test_connection(&self) -> Result<(), String> {
        self.conn
            .query_row("SELECT 1 FROM dual", &[])
            .map_err(|e| format!("Connection test failed: {}", e))?;
        Ok(())
    }

    /// Fetch table metadata
    pub fn fetch_table_metadata(
        &self,
        owner: &str,
        table_name: &str,
    ) -> Result<TableMetadata, String> {
        // Query columns
        let sql_columns = r#"
            SELECT c.COLUMN_NAME,
                   c.DATA_TYPE,
                   c.NULLABLE
            FROM   ALL_TAB_COLUMNS c
            WHERE  c.OWNER = :owner
            AND    c.TABLE_NAME = :table_name
            ORDER BY c.COLUMN_ID
        "#;

        let rows = self.conn
            .query(sql_columns, &[&owner, &table_name])
            .map_err(|e| format!("Failed to fetch columns: {}", e))?;

        let mut columns = Vec::new();
        for row_result in rows {
            let row = row_result.map_err(|e| format!("Row error: {}", e))?;
            columns.push(ColumnInfo {
                name: row.get(0).map_err(|e| format!("Column error: {}", e))?,
                data_type: row.get(1).map_err(|e| format!("Column error: {}", e))?,
                nullable: row.get::<usize, String>(2)
                    .map_err(|e| format!("Column error: {}", e))? == "Y",
                is_pk: false,  // Will be updated below
            });
        }

        // Query primary key
        let sql_pk = r#"
            SELECT cc.COLUMN_NAME
            FROM   ALL_CONSTRAINTS cons
            JOIN   ALL_CONS_COLUMNS cc
              ON   cons.OWNER = cc.OWNER
             AND   cons.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
            WHERE  cons.OWNER = :owner
            AND    cons.TABLE_NAME = :table_name
            AND    cons.CONSTRAINT_TYPE = 'P'
        "#;

        let pk_rows = self.conn
            .query(sql_pk, &[&owner, &table_name])
            .map_err(|e| format!("Failed to fetch PK: {}", e))?;

        let mut primary_key = Vec::new();
        for row_result in pk_rows {
            let row = row_result.map_err(|e| format!("Row error: {}", e))?;
            let pk_col: String = row.get(0).map_err(|e| format!("PK error: {}", e))?;
            primary_key.push(pk_col.clone());

            // Mark column as PK
            if let Some(col) = columns.iter_mut().find(|c| c.name == pk_col) {
                col.is_pk = true;
            }
        }

        Ok(TableMetadata {
            owner: owner.to_string(),
            table_name: table_name.to_string(),
            columns,
            primary_key,
        })
    }

    /// Fetch records with optional WHERE clause and field selection
    pub fn fetch_records(
        &self,
        owner: &str,
        table_name: &str,
        where_clause: Option<&str>,
        fields: Option<&[String]>,
    ) -> Result<Vec<serde_json::Value>, String> {
        let field_list = if let Some(f) = fields {
            f.join(", ")
        } else {
            "*".to_string()
        };

        let mut sql = format!(
            "SELECT {} FROM {}.{}",
            field_list,
            owner,
            table_name
        );

        if let Some(where_sql) = where_clause {
            sql.push_str(" WHERE ");
            sql.push_str(where_sql);
        }

        let rows = self.conn
            .query(&sql, &[])
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut records = Vec::new();
        for row_result in rows {
            let row = row_result.map_err(|e| format!("Row error: {}", e))?;
            let record = row_to_json(&row)?;
            records.push(record);
        }

        Ok(records)
    }
}

/// Convert Oracle row to JSON with proper sanitization
fn row_to_json(row: &Row) -> Result<serde_json::Value, String> {
    let mut map = serde_json::Map::new();

    for i in 0..row.column_count() {
        let col_info = row.column_info(i);
        let col_name = col_info.name().to_string();

        // Sanitize and convert value based on Oracle type
        let value: serde_json::Value = sanitize_oracle_value(row, i)?;

        map.insert(col_name, value);
    }

    Ok(serde_json::Value::Object(map))
}

/// Sanitize Oracle value with proper type handling and security
fn sanitize_oracle_value(row: &Row, idx: usize) -> Result<serde_json::Value, String> {
    use oracle::sql_type::OracleType;

    let col_info = row.column_info(idx);
    let oracle_type = col_info.oracle_type();

    // Handle NULL values first
    if row.get::<_, Option<String>>(idx).unwrap_or(None).is_none() {
        return Ok(serde_json::Value::Null);
    }

    match oracle_type {
        // String types: VARCHAR2, CHAR, NVARCHAR2, NCHAR
        OracleType::Varchar2(_) | OracleType::Char(_) |
        OracleType::NVarchar2(_) | OracleType::NChar(_) => {
            match row.get::<_, String>(idx) {
                Ok(mut s) => {
                    // Sanitize: remove control characters except newline/tab
                    s = s.chars()
                        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
                        .collect();

                    // Truncate if too long (safety limit: 10MB)
                    const MAX_STRING_LEN: usize = 10_000_000;
                    if s.len() > MAX_STRING_LEN {
                        s.truncate(MAX_STRING_LEN);
                        s.push_str("... [TRUNCATED]");
                    }

                    Ok(serde_json::Value::String(s))
                }
                Err(_) => Ok(serde_json::Value::Null),
            }
        }

        // Number types: NUMBER, FLOAT, BINARY_FLOAT, BINARY_DOUBLE
        OracleType::Number(_, _) | OracleType::Float(_) |
        OracleType::BinaryFloat | OracleType::BinaryDouble => {
            // Convert to string to preserve precision (Oracle NUMBER can be very large)
            match row.get::<_, String>(idx) {
                Ok(s) => Ok(serde_json::Value::String(s)),
                Err(_) => Ok(serde_json::Value::Null),
            }
        }

        // Date/Timestamp types
        OracleType::Date | OracleType::Timestamp(_) |
        OracleType::TimestampTZ(_) | OracleType::TimestampLTZ(_) => {
            match row.get::<_, String>(idx) {
                Ok(s) => Ok(serde_json::Value::String(s)),
                Err(_) => Ok(serde_json::Value::Null),
            }
        }

        // CLOB: Character Large Object
        OracleType::CLOB => {
            match row.get::<_, String>(idx) {
                Ok(mut s) => {
                    // Remove control characters
                    s = s.chars()
                        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
                        .collect();

                    // Truncate large CLOBs (limit: 1MB for UI performance)
                    const MAX_CLOB_LEN: usize = 1_000_000;
                    if s.len() > MAX_CLOB_LEN {
                        s.truncate(MAX_CLOB_LEN);
                        s.push_str("\n... [CLOB TRUNCATED - too large for comparison]");
                    }

                    Ok(serde_json::Value::String(s))
                }
                Err(_) => Ok(serde_json::Value::Null),
            }
        }

        // BLOB: Binary Large Object (not suitable for text comparison)
        OracleType::BLOB => {
            Ok(serde_json::Value::String("[BLOB - binary data not displayed]".to_string()))
        }

        // RAW, LONG RAW: Binary data
        OracleType::Raw(_) | OracleType::LongRaw => {
            Ok(serde_json::Value::String("[BINARY DATA]".to_string()))
        }

        // Other types: fallback to string conversion
        _ => {
            match row.get::<_, String>(idx) {
                Ok(s) => Ok(serde_json::Value::String(s)),
                Err(_) => Ok(serde_json::Value::Null),
            }
        }
    }
}
```

### 5.4 Comparison Engine (comparison.rs)

**Important Design Decision:** The diff computation happens entirely in the **backend (Rust)** for the following reasons:

1. **Performance**: Rust is significantly faster than JavaScript for text processing algorithms (LCS)
2. **Memory Efficiency**: Large datasets don't block the UI thread
3. **Consistency**: Same diff algorithm used for all export formats (JSON, CSV, Excel)
4. **Security**: Data sanitization happens server-side before sending to frontend
5. **Testability**: Easier to write comprehensive unit tests in Rust

The frontend receives pre-computed `DiffChunk` arrays and simply renders them with color coding.

```rust
use std::collections::HashMap;
use crate::oracle::models::*;

pub struct ComparisonEngine;

impl ComparisonEngine {
    pub fn compare(
        env1_name: String,
        env1_records: Vec<serde_json::Value>,
        env2_name: String,
        env2_records: Vec<serde_json::Value>,
        primary_key_fields: &[String],
        compare_fields: Option<&[String]>,
    ) -> ComparisonResult {
        // Build maps keyed by primary key
        let env1_map = Self::build_record_map(&env1_records, primary_key_fields);
        let env2_map = Self::build_record_map(&env2_records, primary_key_fields);

        // Get all unique primary keys
        let all_keys: std::collections::HashSet<_> = env1_map
            .keys()
            .chain(env2_map.keys())
            .cloned()
            .collect();

        let mut comparisons = Vec::new();
        let mut summary = ComparisonSummary {
            total_records: all_keys.len(),
            matching: 0,
            differing: 0,
            only_in_env1: 0,
            only_in_env2: 0,
        };

        for key in all_keys {
            let env1_record = env1_map.get(&key);
            let env2_record = env2_map.get(&key);

            let (status, differences) = match (env1_record, env2_record) {
                (Some(r1), Some(r2)) => {
                    let diffs = Self::find_differences(r1, r2, compare_fields);
                    if diffs.is_empty() {
                        summary.matching += 1;
                        (ComparisonStatus::Match, diffs)
                    } else {
                        summary.differing += 1;
                        (ComparisonStatus::Differ, diffs)
                    }
                }
                (Some(_), None) => {
                    summary.only_in_env1 += 1;
                    (ComparisonStatus::OnlyInEnv1, vec![])
                }
                (None, Some(_)) => {
                    summary.only_in_env2 += 1;
                    (ComparisonStatus::OnlyInEnv2, vec![])
                }
                (None, None) => unreachable!(),
            };

            comparisons.push(ConfigComparison {
                primary_key: key,
                status,
                env1_data: env1_record.cloned(),
                env2_data: env2_record.cloned(),
                differences,
            });
        }

        // Sort: differences first, then by primary key
        comparisons.sort_by(|a, b| {
            match (&a.status, &b.status) {
                (ComparisonStatus::Match, ComparisonStatus::Match) => {
                    a.primary_key.cmp(&b.primary_key)
                }
                (ComparisonStatus::Match, _) => std::cmp::Ordering::Greater,
                (_, ComparisonStatus::Match) => std::cmp::Ordering::Less,
                _ => a.primary_key.cmp(&b.primary_key),
            }
        });

        ComparisonResult {
            env1_name,
            env2_name,
            timestamp: chrono::Local::now().to_rfc3339(),
            summary,
            comparisons,
        }
    }

    fn build_record_map(
        records: &[serde_json::Value],
        primary_key_fields: &[String],
    ) -> HashMap<String, serde_json::Value> {
        let mut map = HashMap::new();

        for record in records {
            if let Some(obj) = record.as_object() {
                let key = primary_key_fields
                    .iter()
                    .filter_map(|field| {
                        obj.get(field)
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect::<Vec<_>>()
                    .join("::");

                map.insert(key, record.clone());
            }
        }

        map
    }

    fn find_differences(
        r1: &serde_json::Value,
        r2: &serde_json::Value,
        compare_fields: Option<&[String]>,
    ) -> Vec<FieldDifference> {
        let mut differences = Vec::new();

        let obj1 = r1.as_object().unwrap();
        let obj2 = r2.as_object().unwrap();

        let fields_to_compare: Vec<String> = if let Some(fields) = compare_fields {
            fields.to_vec()
        } else {
            obj1.keys().cloned().collect()
        };

        for field in fields_to_compare {
            let val1 = obj1.get(&field);
            let val2 = obj2.get(&field);

            if val1 != val2 {
                let str1 = val1.and_then(|v| v.as_str()).map(String::from);
                let str2 = val2.and_then(|v| v.as_str()).map(String::from);

                // Generate character-level diff chunks for highlighting
                let (chunks1, chunks2) = match (&str1, &str2) {
                    (Some(s1), Some(s2)) => {
                        let (c1, c2) = Self::compute_diff_chunks(s1, s2);
                        (Some(c1), Some(c2))
                    }
                    _ => (None, None),
                };

                differences.push(FieldDifference {
                    field_name: field.clone(),
                    env1_value: str1,
                    env2_value: str2,
                    env1_diff_chunks: chunks1,
                    env2_diff_chunks: chunks2,
                });
            }
        }

        differences
    }

    /// Computes character-level diff chunks for two strings
    /// Uses simple word-based diff algorithm for performance
    fn compute_diff_chunks(s1: &str, s2: &str) -> (Vec<DiffChunk>, Vec<DiffChunk>) {
        // Split by whitespace to get word tokens
        let words1: Vec<&str> = s1.split_whitespace().collect();
        let words2: Vec<&str> = s2.split_whitespace().collect();

        // Simple LCS-based diff (Longest Common Subsequence)
        let lcs = Self::compute_lcs(&words1, &words2);

        let mut chunks1 = Vec::new();
        let mut chunks2 = Vec::new();
        let mut i = 0;
        let mut j = 0;
        let mut lcs_idx = 0;

        while i < words1.len() || j < words2.len() {
            if lcs_idx < lcs.len() {
                let (lcs_i, lcs_j) = lcs[lcs_idx];

                // Add removed words (only in s1)
                while i < lcs_i {
                    chunks1.push(DiffChunk {
                        text: format!("{} ", words1[i]),
                        chunk_type: DiffChunkType::Removed,
                    });
                    i += 1;
                }

                // Add added words (only in s2)
                while j < lcs_j {
                    chunks2.push(DiffChunk {
                        text: format!("{} ", words2[j]),
                        chunk_type: DiffChunkType::Added,
                    });
                    j += 1;
                }

                // Add common word
                chunks1.push(DiffChunk {
                    text: format!("{} ", words1[i]),
                    chunk_type: DiffChunkType::Same,
                });
                chunks2.push(DiffChunk {
                    text: format!("{} ", words2[j]),
                    chunk_type: DiffChunkType::Same,
                });
                i += 1;
                j += 1;
                lcs_idx += 1;
            } else {
                // Remaining words after LCS
                while i < words1.len() {
                    chunks1.push(DiffChunk {
                        text: format!("{} ", words1[i]),
                        chunk_type: DiffChunkType::Removed,
                    });
                    i += 1;
                }
                while j < words2.len() {
                    chunks2.push(DiffChunk {
                        text: format!("{} ", words2[j]),
                        chunk_type: DiffChunkType::Added,
                    });
                    j += 1;
                }
            }
        }

        (chunks1, chunks2)
    }

    /// Computes Longest Common Subsequence (LCS) for diff algorithm
    fn compute_lcs<'a>(words1: &[&'a str], words2: &[&'a str]) -> Vec<(usize, usize)> {
        let m = words1.len();
        let n = words2.len();
        let mut dp = vec![vec![0; n + 1]; m + 1];

        // Fill DP table
        for i in 1..=m {
            for j in 1..=n {
                if words1[i - 1] == words2[j - 1] {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
                }
            }
        }

        // Backtrack to find LCS positions
        let mut lcs = Vec::new();
        let mut i = m;
        let mut j = n;

        while i > 0 && j > 0 {
            if words1[i - 1] == words2[j - 1] {
                lcs.push((i - 1, j - 1));
                i -= 1;
                j -= 1;
            } else if dp[i - 1][j] > dp[i][j - 1] {
                i -= 1;
            } else {
                j -= 1;
            }
        }

        lcs.reverse();
        lcs
    }
}
```

### 5.5 Tauri Commands (commands.rs)

```rust
use tauri::State;
use crate::oracle::{client, connection::DatabaseConnection, comparison::ComparisonEngine};
use crate::oracle::models::*;
use crate::credentials::CredentialManager;

#[tauri::command]
pub async fn check_oracle_client_ready(
    custom_dir: Option<String>,
) -> Result<bool, String> {
    client::check_client_ready(custom_dir)
}

#[tauri::command]
pub async fn prime_oracle_client(
    custom_dir: Option<String>,
) -> Result<(), String> {
    client::prime_client(custom_dir)
}

#[tauri::command]
pub async fn test_oracle_connection(
    config: ConnectionConfig,
    credential_manager: State<'_, CredentialManager>,
) -> Result<String, String> {
    let creds = credential_manager
        .get_oracle_credentials(&config.name)
        .map_err(|e| format!("Failed to get credentials: {}", e))?;

    let conn = DatabaseConnection::new(&config, &creds)?;
    conn.test_connection()?;

    Ok("Connection successful".to_string())
}

#[tauri::command]
pub async fn fetch_table_metadata(
    config: ConnectionConfig,
    table_name: String,
    credential_manager: State<'_, CredentialManager>,
) -> Result<TableMetadata, String> {
    let creds = credential_manager
        .get_oracle_credentials(&config.name)
        .map_err(|e| format!("Failed to get credentials: {}", e))?;

    let conn = DatabaseConnection::new(&config, &creds)?;
    conn.fetch_table_metadata(&config.schema, &table_name)
}

#[tauri::command]
pub async fn compare_configurations(
    request: ComparisonRequest,
    credential_manager: State<'_, CredentialManager>,
) -> Result<ComparisonResult, String> {
    // Get credentials for both environments
    let creds1 = credential_manager
        .get_oracle_credentials(&request.env1_name)
        .map_err(|e| format!("Failed to get credentials for {}: {}", request.env1_name, e))?;

    let creds2 = credential_manager
        .get_oracle_credentials(&request.env2_name)
        .map_err(|e| format!("Failed to get credentials for {}: {}", request.env2_name, e))?;

    // Connect to both environments
    let conn1 = DatabaseConnection::new(&request.env1_connection, &creds1)?;
    let conn2 = DatabaseConnection::new(&request.env2_connection, &creds2)?;

    // Fetch metadata to determine primary key
    let metadata = conn1.fetch_table_metadata(
        &request.env1_connection.schema,
        &request.table_name,
    )?;

    if metadata.primary_key.is_empty() {
        return Err("Table has no primary key defined".to_string());
    }

    // Fetch records from both environments
    let env1_records = conn1.fetch_records(
        &request.env1_connection.schema,
        &request.table_name,
        request.where_clause.as_deref(),
        request.fields.as_deref(),
    )?;

    let env2_records = conn2.fetch_records(
        &request.env2_connection.schema,
        &request.table_name,
        request.where_clause.as_deref(),
        request.fields.as_deref(),
    )?;

    // Perform comparison
    let result = ComparisonEngine::compare(
        request.env1_name,
        env1_records,
        request.env2_name,
        env2_records,
        &metadata.primary_key,
        request.fields.as_deref(),
    );

    Ok(result)
}

#[tauri::command]
pub async fn export_comparison_result(
    result: ComparisonResult,
    format: String,
) -> Result<String, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "Could not determine HOME directory".to_string())?;

    let export_dir = std::path::PathBuf::from(home)
        .join("Documents")
        .join("adtools_library")
        .join("comparisons");

    std::fs::create_dir_all(&export_dir)
        .map_err(|e| format!("Failed to create export directory: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!(
        "comparison_{}_{}_vs_{}_{}.{}",
        result.env1_name, result.env2_name, timestamp, format
    );

    let filepath = export_dir.join(&filename);

    match format.as_str() {
        "json" => {
            let json = serde_json::to_string_pretty(&result)
                .map_err(|e| format!("JSON serialization failed: {}", e))?;
            std::fs::write(&filepath, json)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
        "csv" => {
            let csv = export_to_csv(&result)?;
            std::fs::write(&filepath, csv)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
        _ => return Err(format!("Unsupported format: {}", format)),
    }

    Ok(filepath.to_string_lossy().to_string())
}

fn export_to_csv(result: &ComparisonResult) -> Result<String, String> {
    let mut csv = String::new();

    // Header
    csv.push_str("Primary Key,Status,Environment 1,Environment 2,Differences\n");

    // Rows
    for comp in &result.comparisons {
        csv.push_str(&comp.primary_key);
        csv.push(',');
        csv.push_str(&format!("{:?}", comp.status));
        csv.push(',');
        csv.push_str(&format!("{:?}", comp.env1_data));
        csv.push(',');
        csv.push_str(&format!("{:?}", comp.env2_data));
        csv.push(',');
        csv.push_str(&format!("{}", comp.differences.len()));
        csv.push('\n');
    }

    Ok(csv)
}
```

---

## 6. Frontend Implementation

### 6.1 File Structure

```
app/tools/compare-config/
├── main.js              # Main tool controller
├── template.js          # HTML template strings
├── styles.css           # Component styles
├── service.js           # Business logic
└── views/
    ├── ExpandableRowView.js
    ├── VerticalCardView.js
    └── MasterDetailView.js
```

### 6.2 Main Tool Controller (main.js)

```javascript
import { BaseTool } from "../../core/BaseTool.js";
import { EventBus } from "../../core/EventBus.js";
import { invoke } from "@tauri-apps/api/tauri";
import { getTemplate } from "./template.js";
import * as CompareService from "./service.js";
import { ExpandableRowView } from "./views/ExpandableRowView.js";

export class CompareConfigTool extends BaseTool {
  constructor(container) {
    super(container);
    this.state = {
      env1: null,
      env2: null,
      tableName: "",
      whereClause: "",
      selectedFields: [],
      metadata: null,
      result: null,
      isLoading: false,
      oracleClientReady: false,
      currentView: "expandable",
    };

    this.views = {
      expandable: null,
      cards: null,
      masterDetail: null,
    };
  }

  async onMount() {
    this.container.innerHTML = getTemplate();
    this.attachEventListeners();
    await this.checkOracleClient();
    this.loadSavedConnections();
  }

  async checkOracleClient() {
    try {
      const isReady = await invoke("check_oracle_client_ready");
      this.state.oracleClientReady = isReady;

      if (!isReady) {
        // Show installation guide and disable all features
        this.showInstallationGuide();
        this.disableAllFeatures();
      } else {
        // Prime the client and enable features
        await invoke("prime_oracle_client");
        this.hideInstallationGuide();
        this.enableAllFeatures();
      }
    } catch (error) {
      console.error("Oracle client check failed:", error);
      // On error, assume client not installed
      this.showInstallationGuide();
      this.disableAllFeatures();
    }
  }

  showInstallationGuide() {
    const guideContainer = document.getElementById("oracle-installation-guide");
    if (!guideContainer) return;

    guideContainer.innerHTML = /* html */ `
      <div class="installation-required-overlay">
        <div class="installation-card">
          <div class="installation-icon">⚠️</div>
          <h2>Oracle Instant Client Required</h2>

          <p class="installation-description">
            This feature requires Oracle Instant Client to connect to Oracle databases.
            The client is <strong>not bundled</strong> with AD Tools due to licensing
            restrictions and size (~80MB).
          </p>

          <div class="installation-steps">
            <h3>Installation Steps:</h3>

            <div class="step">
              <div class="step-number">1</div>
              <div class="step-content">
                <h4>Download Oracle Instant Client</h4>
                <p>Download <strong>Basic Light</strong> package for your architecture:</p>
                <div class="download-links">
                  <a href="https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html"
                     target="_blank"
                     class="download-btn">
                    Apple Silicon (M1/M2/M3)
                  </a>
                  <a href="https://www.oracle.com/database/technologies/instant-client/macos-intel-x86-downloads.html"
                     target="_blank"
                     class="download-btn">
                    Intel (x86_64)
                  </a>
                </div>
                <p class="note">Note: You'll need an Oracle account (free registration)</p>
              </div>
            </div>

            <div class="step">
              <div class="step-number">2</div>
              <div class="step-content">
                <h4>Run Installation Script</h4>
                <p>Open Terminal and run:</p>
                <pre class="code-block"><code>cd /Applications/AD\\ Tools.app/Contents/Resources
./scripts/install-oracle-client.sh ~/Downloads/instantclient-*.zip</code></pre>
                <button id="copy-install-command" class="btn-secondary btn-small">
                  📋 Copy Command
                </button>
              </div>
            </div>

            <div class="step">
              <div class="step-number">3</div>
              <div class="step-content">
                <h4>Restart AD Tools</h4>
                <p>Close and reopen AD Tools. The feature will be automatically enabled.</p>
              </div>
            </div>
          </div>

          <div class="installation-info">
            <h4>Technical Details:</h4>
            <ul>
              <li><strong>Installation Size:</strong> ~80MB</li>
              <li><strong>Installation Location:</strong> ~/Documents/adtools_library/instantclient</li>
              <li><strong>Admin Rights:</strong> Not required</li>
              <li><strong>Automatic Updates:</strong> No (manual updates only)</li>
            </ul>
          </div>

          <div class="installation-actions">
            <button id="check-again-btn" class="btn-primary">
              🔄 Check Installation Status
            </button>
            <button id="view-troubleshooting" class="btn-secondary">
              📖 Troubleshooting Guide
            </button>
          </div>
        </div>
      </div>
    `;

    guideContainer.classList.remove("hidden");

    // Attach event listeners
    document.getElementById("copy-install-command")?.addEventListener("click", () => {
      const command = `cd /Applications/AD\\ Tools.app/Contents/Resources\n./scripts/install-oracle-client.sh ~/Downloads/instantclient-*.zip`;
      navigator.clipboard.writeText(command);
      this.showSuccess("Installation command copied to clipboard!");
    });

    document.getElementById("check-again-btn")?.addEventListener("click", () => {
      this.checkOracleClient();
    });

    document.getElementById("view-troubleshooting")?.addEventListener("click", () => {
      this.showTroubleshootingModal();
    });
  }

  hideInstallationGuide() {
    const guideContainer = document.getElementById("oracle-installation-guide");
    guideContainer?.classList.add("hidden");
  }

  disableAllFeatures() {
    // Disable all form inputs
    const inputs = this.container.querySelectorAll("input, textarea, select, button");
    inputs.forEach((input) => {
      if (input.id !== "check-again-btn" && input.id !== "view-troubleshooting" && input.id !== "copy-install-command") {
        input.disabled = true;
      }
    });

    // Hide main form, show installation guide
    document.getElementById("setup-form")?.classList.add("hidden");
    document.getElementById("oracle-installation-guide")?.classList.remove("hidden");
  }

  enableAllFeatures() {
    // Enable all form inputs
    const inputs = this.container.querySelectorAll("input, textarea, select, button");
    inputs.forEach((input) => {
      input.disabled = false;
    });

    // Show main form, hide installation guide
    document.getElementById("setup-form")?.classList.remove("hidden");
    document.getElementById("oracle-installation-guide")?.classList.add("hidden");
  }

  showTroubleshootingModal() {
    // Show modal with common issues and solutions
    const troubleshootingContent = /* html */ `
      <div class="troubleshooting-modal">
        <h3>Troubleshooting Oracle Client Installation</h3>

        <div class="troubleshooting-item">
          <h4>❌ "Architecture mismatch" error</h4>
          <p>Solution: Make sure you downloaded the correct package:</p>
          <ul>
            <li>Apple Silicon Macs (M1/M2/M3): Use ARM64 package</li>
            <li>Intel Macs: Use x86_64 package</li>
          </ul>
          <p>Check your architecture: <code>uname -m</code></p>
        </div>

        <div class="troubleshooting-item">
          <h4>❌ "libclntsh.dylib not found"</h4>
          <p>Solution: Verify installation location:</p>
          <pre><code>ls ~/Documents/adtools_library/instantclient/libclntsh.dylib</code></pre>
          <p>If missing, re-run the installation script.</p>
        </div>

        <div class="troubleshooting-item">
          <h4>❌ "Permission denied"</h4>
          <p>Solution: Ensure the script is executable:</p>
          <pre><code>chmod +x ./scripts/install-oracle-client.sh</code></pre>
        </div>

        <div class="troubleshooting-item">
          <h4>❌ Feature still not available after installation</h4>
          <p>Solution:</p>
          <ol>
            <li>Completely quit AD Tools (⌘Q)</li>
            <li>Reopen AD Tools</li>
            <li>Navigate back to Compare Config tool</li>
          </ol>
        </div>

        <div class="troubleshooting-item">
          <h4>Need more help?</h4>
          <p>Check the full documentation or contact support:</p>
          <a href="docs/user-guide/oracle-client-setup.md">Oracle Client Setup Guide</a>
        </div>
      </div>
    `;

    // Show modal (use existing modal system)
    EventBus.emit("modal:show", {
      title: "Troubleshooting",
      content: troubleshootingContent,
    });
  }

  attachEventListeners() {
    // Environment 1 connection select
    document.getElementById("env1-connection-select")?.addEventListener("change", (e) => {
      this.onConnectionSelected("env1", e.target.value);
    });

    // Environment 2 connection select
    document.getElementById("env2-connection-select")?.addEventListener("change", (e) => {
      this.onConnectionSelected("env2", e.target.value);
    });

    // Fetch table metadata
    document.getElementById("fetch-metadata")?.addEventListener("click", () => {
      this.fetchTableMetadata();
    });

    // Compare button
    document.getElementById("compare-btn")?.addEventListener("click", () => {
      this.executeComparison();
    });

    // View selector
    document.getElementById("view-select")?.addEventListener("change", (e) => {
      this.state.currentView = e.target.value;
      this.renderResults();
    });

    // Export button
    document.getElementById("export-json")?.addEventListener("click", () => {
      this.exportResults("json");
    });

    document.getElementById("export-csv")?.addEventListener("click", () => {
      this.exportResults("csv");
    });

    // Field selection
    document.getElementById("select-all-fields")?.addEventListener("click", () => {
      this.selectAllFields(true);
    });

    document.getElementById("deselect-all-fields")?.addEventListener("click", () => {
      this.selectAllFields(false);
    });
  }

  async testConnection(envKey) {
    const config = this.getConnectionConfig(envKey);
    if (!config) return;

    const button = document.getElementById(`test-${envKey}`);
    const originalText = button.textContent;

    try {
      button.disabled = true;
      button.textContent = "Testing...";

      await invoke("test_oracle_connection", { config });

      this.showSuccess(`✓ ${config.name} connection successful!`);
      this.state[envKey] = config;
    } catch (error) {
      this.showError(`✗ ${config.name} connection failed: ${error}`);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async fetchTableMetadata() {
    if (!this.state.env1) {
      this.showError("Please test Environment 1 connection first");
      return;
    }

    const tableName = document.getElementById("table-name")?.value?.trim();
    if (!tableName) {
      this.showError("Please enter a table name");
      return;
    }

    try {
      this.state.isLoading = true;
      this.updateLoadingState("Fetching table metadata...");

      const metadata = await invoke("fetch_table_metadata", {
        config: this.state.env1,
        tableName,
      });

      this.state.metadata = metadata;
      this.state.tableName = tableName;
      this.renderFieldSelection(metadata);
      this.showSuccess(`Fetched metadata for ${metadata.columns.length} columns`);
    } catch (error) {
      this.showError(`Failed to fetch metadata: ${error}`);
    } finally {
      this.state.isLoading = false;
      this.updateLoadingState(null);
    }
  }

  renderFieldSelection(metadata) {
    const container = document.getElementById("field-selection");
    if (!container) return;

    container.innerHTML = "";

    metadata.columns.forEach((col) => {
      const label = document.createElement("label");
      label.className = "field-checkbox";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = col.name;
      checkbox.checked = true;
      checkbox.disabled = col.is_pk; // Always include PK

      checkbox.addEventListener("change", (e) => {
        this.updateSelectedFields();
      });

      const text = document.createTextNode(` ${col.name} ${col.is_pk ? "(PK)" : ""} - ${col.data_type}`);

      label.appendChild(checkbox);
      label.appendChild(text);
      container.appendChild(label);
    });

    this.updateSelectedFields();
  }

  updateSelectedFields() {
    const checkboxes = document.querySelectorAll('#field-selection input[type="checkbox"]:checked');
    this.state.selectedFields = Array.from(checkboxes).map((cb) => cb.value);

    const preview = document.getElementById("field-preview");
    if (preview) {
      preview.textContent = `Comparing ${this.state.selectedFields.length} fields`;
    }
  }

  selectAllFields(select) {
    const checkboxes = document.querySelectorAll('#field-selection input[type="checkbox"]:not(:disabled)');
    checkboxes.forEach((cb) => (cb.checked = select));
    this.updateSelectedFields();
  }

  async executeComparison() {
    if (!this.validateComparisonRequest()) return;

    const whereClause = document.getElementById("where-clause")?.value?.trim() || null;

    const request = {
      env1_name: this.state.env1.name,
      env1_connection: this.state.env1,
      env2_name: this.state.env2.name,
      env2_connection: this.state.env2,
      table_name: this.state.tableName,
      where_clause: whereClause,
      fields: this.state.selectedFields.length > 0 ? this.state.selectedFields : null,
    };

    try {
      this.state.isLoading = true;
      this.updateLoadingState("Comparing configurations...");

      const result = await invoke("compare_configurations", { request });

      this.state.result = result;
      this.showResults();
      this.renderResults();

      EventBus.emit("comparison:complete", result);
    } catch (error) {
      this.showError(`Comparison failed: ${error}`);
    } finally {
      this.state.isLoading = false;
      this.updateLoadingState(null);
    }
  }

  validateComparisonRequest() {
    if (!this.state.env1) {
      this.showError("Please configure and test Environment 1");
      return false;
    }

    if (!this.state.env2) {
      this.showError("Please configure and test Environment 2");
      return false;
    }

    if (!this.state.tableName) {
      this.showError("Please enter a table name");
      return false;
    }

    if (!this.state.metadata) {
      this.showError("Please fetch table metadata first");
      return false;
    }

    return true;
  }

  showResults() {
    document.getElementById("setup-form")?.classList.add("hidden");
    document.getElementById("results-section")?.classList.remove("hidden");
  }

  renderResults() {
    if (!this.state.result) return;

    const container = document.getElementById("results-container");
    if (!container) return;

    // Render summary
    this.renderSummary(this.state.result.summary);

    // Render comparison view
    if (!this.views[this.state.currentView]) {
      this.views.expandable = new ExpandableRowView(container);
      // Initialize other views as needed
    }

    const view = this.views[this.state.currentView];
    if (view) {
      view.render(this.state.result.comparisons, this.state.result.env1_name, this.state.result.env2_name);
    }
  }

  renderSummary(summary) {
    const summaryEl = document.getElementById("comparison-summary");
    if (!summaryEl) return;

    const syncPercentage = summary.total_records > 0 ? Math.round((summary.matching / summary.total_records) * 100) : 0;

    summaryEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card stat-total">
          <div class="stat-value">${summary.total_records}</div>
          <div class="stat-label">Total Records</div>
        </div>
        <div class="stat-card stat-match">
          <div class="stat-value">${summary.matching}</div>
          <div class="stat-label">Matching</div>
        </div>
        <div class="stat-card stat-differ">
          <div class="stat-value">${summary.differing}</div>
          <div class="stat-label">Differing</div>
        </div>
        <div class="stat-card stat-env1">
          <div class="stat-value">${summary.only_in_env1}</div>
          <div class="stat-label">Only in ${this.state.result.env1_name}</div>
        </div>
        <div class="stat-card stat-env2">
          <div class="stat-value">${summary.only_in_env2}</div>
          <div class="stat-label">Only in ${this.state.result.env2_name}</div>
        </div>
      </div>
      <div class="sync-status ${syncPercentage === 100 ? "status-synced" : "status-out-of-sync"}">
        ${syncPercentage === 100 ? "✓" : "⚠️"} Environments are ${syncPercentage}% synchronized
      </div>
    `;
  }

  async exportResults(format) {
    if (!this.state.result) return;

    try {
      const filepath = await invoke("export_comparison_result", {
        result: this.state.result,
        format,
      });

      this.showSuccess(`Exported to: ${filepath}`);
      EventBus.emit("comparison:exported", { filepath, format });
    } catch (error) {
      this.showError(`Export failed: ${error}`);
    }
  }

  getConnectionConfig(envKey) {
    const prefix = envKey === "env1" ? "env1" : "env2";

    return {
      name: document.getElementById(`${prefix}-name`)?.value || "",
      host: document.getElementById(`${prefix}-host`)?.value || "",
      port: parseInt(document.getElementById(`${prefix}-port`)?.value) || 1521,
      service_name: document.getElementById(`${prefix}-service`)?.value || "",
      schema: document.getElementById(`${prefix}-schema`)?.value || "",
    };
  }

  loadSavedConnections() {
    // Load from Settings (config.oracle.connections)
    const saved = CompareService.getSavedConnections();

    // Populate environment 1 dropdown
    const env1Select = document.getElementById("env1-connection-select");
    if (env1Select) {
      env1Select.innerHTML = '<option value="">-- Select Connection --</option>';
      saved.forEach((conn) => {
        const option = document.createElement("option");
        option.value = conn.name;
        option.textContent = `${conn.name} - ${conn.host}`;
        env1Select.appendChild(option);
      });
    }

    // Populate environment 2 dropdown
    const env2Select = document.getElementById("env2-connection-select");
    if (env2Select) {
      env2Select.innerHTML = '<option value="">-- Select Connection --</option>';
      saved.forEach((conn) => {
        const option = document.createElement("option");
        option.value = conn.name;
        option.textContent = `${conn.name} - ${conn.host}`;
        env2Select.appendChild(option);
      });
    }

    // Show "No connections" message if empty
    if (saved.length === 0) {
      this.showNoConnectionsMessage();
    }
  }

  showNoConnectionsMessage() {
    const message = document.getElementById("no-connections-message");
    if (message) {
      message.classList.remove("hidden");
      message.innerHTML = /* html */ `
        <div class="info-box">
          <p><strong>No Oracle connections configured.</strong></p>
          <p>Please configure Oracle database connections in Settings first.</p>
          <button id="open-settings-btn" class="btn-secondary">
            ⚙️ Open Settings
          </button>
        </div>
      `;

      document.getElementById("open-settings-btn")?.addEventListener("click", () => {
        // Navigate to settings page
        window.location.hash = "#/settings";
      });
    }
  }

  onConnectionSelected(envKey, connectionName) {
    const connections = CompareService.getSavedConnections();
    const conn = connections.find((c) => c.name === connectionName);

    if (conn) {
      this.state[envKey] = {
        name: conn.name,
        host: conn.host,
        port: conn.port,
        service_name: conn.service_name,
        schema: conn.schema,
      };

      // Update UI to show connection details
      this.displayConnectionInfo(envKey, conn);
    }
  }

  displayConnectionInfo(envKey, conn) {
    const infoContainer = document.getElementById(`${envKey}-info`);
    if (infoContainer) {
      infoContainer.innerHTML = /* html */ `
        <div class="connection-info">
          <span class="connection-badge status-active">✓ ${conn.name}</span>
          <span class="connection-detail">${conn.host}:${conn.port}/${conn.service_name}</span>
          <span class="connection-detail">Schema: ${conn.schema}</span>
        </div>
      `;
    }
  }

  onUnmount() {
    // Cleanup
  }
}
```

### 6.3 Service Layer (service.js)

```javascript
// Business logic for compare-config tool

export function getSavedConnections() {
  const saved = localStorage.getItem("config.oracleConnections");
  return saved ? JSON.parse(saved) : [];
}

export function saveConnection(connection) {
  const connections = getSavedConnections();
  const existing = connections.findIndex((c) => c.name === connection.name);

  if (existing >= 0) {
    connections[existing] = connection;
  } else {
    connections.push(connection);
  }

  localStorage.setItem("config.oracleConnections", JSON.stringify(connections));
}

export function deleteConnection(name) {
  const connections = getSavedConnections().filter((c) => c.name !== name);
  localStorage.setItem("config.oracleConnections", JSON.stringify(connections));
}

export function validateWhereClause(whereClause) {
  // Basic SQL injection prevention
  const dangerous = /(\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE|ALTER|CREATE)\b)/i;
  if (dangerous.test(whereClause)) {
    throw new Error("WHERE clause contains potentially dangerous SQL keywords");
  }
  return true;
}
```

### 6.4 Template (template.js)

```javascript
export function getTemplate() {
  return /* html */ `
    <div class="compare-config-container">
      <!-- Oracle Installation Guide (shown when client not installed) -->
      <div id="oracle-installation-guide" class="hidden"></div>

      <!-- Main Setup Form (hidden when client not installed) -->
      <div id="setup-form">
        <h2>Database Configuration Comparison</h2>

        <!-- No Connections Message -->
        <div id="no-connections-message" class="hidden"></div>

        <!-- Environment 1 -->
        <section class="environment-config">
          <h3>Environment 1 (Reference)</h3>
          <div class="form-row">
            <label for="env1-connection-select">Select Connection:</label>
            <select id="env1-connection-select" class="connection-select">
              <option value="">-- Select Connection --</option>
            </select>
          </div>
          <div id="env1-info" class="connection-info-display"></div>
          <p class="help-text">
            Configure connections in <a href="#/settings">Settings → Oracle Database Connections</a>
          </p>
        </section>

        <!-- Environment 2 -->
        <section class="environment-config">
          <h3>Environment 2 (Comparison)</h3>
          <div class="form-row">
            <label for="env2-connection-select">Select Connection:</label>
            <select id="env2-connection-select" class="connection-select">
              <option value="">-- Select Connection --</option>
            </select>
          </div>
          <div id="env2-info" class="connection-info-display"></div>
          <p class="help-text">
            Configure connections in <a href="#/settings">Settings → Oracle Database Connections</a>
          </p>
        </section>

        <!-- Table Selection -->
        <section class="table-config">
          <h3>Table Configuration</h3>
          <div class="form-row">
            <input type="text" id="table-name" placeholder="Table Name" />
            <button id="fetch-metadata" class="btn-secondary">Fetch Metadata</button>
          </div>
        </section>

        <!-- WHERE Clause -->
        <section class="filter-config">
          <h3>Filter Criteria (Optional)</h3>
          <textarea
            id="where-clause"
            placeholder="Enter WHERE clause (e.g., config_key IN ('db_pool', 'api_timeout'))"
            rows="3"
          ></textarea>
          <p class="help-text">
            Leave blank to compare all records. Examples:<br/>
            • config_key IN ('db_pool', 'api_timeout')<br/>
            • category = 'DATABASE' AND is_active = 'Y'<br/>
            • config_key LIKE 'feature_%'
          </p>
        </section>

        <!-- Field Selection -->
        <section class="field-config">
          <h3>Fields to Compare</h3>
          <div class="field-actions">
            <button id="select-all-fields" class="btn-link">Select All</button>
            <button id="deselect-all-fields" class="btn-link">Deselect All</button>
            <span id="field-preview" class="field-preview"></span>
          </div>
          <div id="field-selection" class="field-list"></div>
        </section>

        <!-- Compare Button -->
        <div class="actions">
          <button id="compare-btn" class="btn-primary">Compare Configurations</button>
        </div>

        <div id="error-message" class="error-box hidden"></div>
        <div id="loading-message" class="loading-box hidden"></div>
      </div>

      <!-- Results Section -->
      <div id="results-section" class="hidden">
        <div class="results-header">
          <h2>Comparison Results</h2>
          <button id="new-comparison" class="btn-secondary">New Comparison</button>
        </div>

        <div id="comparison-summary"></div>

        <div class="results-controls">
          <div class="view-selector">
            <label>View Mode:</label>
            <select id="view-select">
              <option value="expandable">Expandable Rows</option>
              <option value="cards">Vertical Cards</option>
              <option value="masterDetail">Master-Detail</option>
            </select>
          </div>

          <div class="export-buttons">
            <button id="export-json" class="btn-secondary">Export JSON</button>
            <button id="export-csv" class="btn-secondary">Export CSV</button>
          </div>
        </div>

        <div id="results-container"></div>
      </div>
    </div>
  `;
}
```

### 6.5 Views with Diff Highlighting (views/ExpandableRowView.js)

```javascript
/**
 * ExpandableRowView - Renders comparison results with character-level diff highlighting
 *
 * Features:
 * - Expandable rows showing differences
 * - Color-coded diff chunks: green (added), red (removed), yellow (modified)
 * - Character/word-level highlighting for precise diff visualization
 */
export class ExpandableRowView {
  constructor(container) {
    this.container = container;
  }

  render(comparisons, env1Name, env2Name) {
    const html = /* html */ `
      <div class="expandable-view">
        <table class="comparison-table">
          <thead>
            <tr>
              <th class="col-expand"></th>
              <th class="col-primary-key">Primary Key</th>
              <th class="col-status">Status</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${comparisons.map((comp, idx) => this.renderRow(comp, idx, env1Name, env2Name)).join("")}
          </tbody>
        </table>
      </div>
    `;

    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  renderRow(comparison, idx, env1Name, env2Name) {
    const statusClass = this.getStatusClass(comparison.status);
    const statusIcon = this.getStatusIcon(comparison.status);
    const hasDetails = comparison.differences && comparison.differences.length > 0;

    return /* html */ `
      <tr class="comparison-row ${statusClass}" data-row-id="${idx}">
        <td class="col-expand">
          ${hasDetails ? '<button class="expand-btn" data-row-id="' + idx + '">▶</button>' : ""}
        </td>
        <td class="col-primary-key">${comparison.primary_key}</td>
        <td class="col-status">
          <span class="status-badge ${statusClass}">${statusIcon} ${comparison.status}</span>
        </td>
        <td class="col-actions">
          ${hasDetails ? '<button class="copy-diff-btn btn-icon" data-row-id="' + idx + '">📋</button>' : ""}
        </td>
      </tr>
      ${hasDetails ? this.renderExpandedRow(comparison, idx, env1Name, env2Name) : ""}
    `;
  }

  renderExpandedRow(comparison, idx, env1Name, env2Name) {
    return /* html */ `
      <tr class="expanded-row" id="expanded-${idx}" style="display: none;">
        <td colspan="4">
          <div class="diff-details">
            <table class="diff-table">
              <thead>
                <tr>
                  <th class="col-field-name">Field</th>
                  <th class="col-env-value">${env1Name}</th>
                  <th class="col-env-value">${env2Name}</th>
                </tr>
              </thead>
              <tbody>
                ${comparison.differences.map((diff) => this.renderDiffRow(diff)).join("")}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    `;
  }

  /**
   * Renders a single field difference with character-level highlighting
   */
  renderDiffRow(diff) {
    const env1Html = this.renderDiffChunks(diff.env1_diff_chunks, diff.env1_value);
    const env2Html = this.renderDiffChunks(diff.env2_diff_chunks, diff.env2_value);

    return /* html */ `
      <tr class="diff-row">
        <td class="col-field-name"><strong>${diff.field_name}</strong></td>
        <td class="col-env-value diff-env1">${env1Html}</td>
        <td class="col-env-value diff-env2">${env2Html}</td>
      </tr>
    `;
  }

  /**
   * Renders diff chunks with color-coded highlighting
   *
   * Chunk types:
   * - Same: No highlighting (normal text)
   * - Added: Green background (text added in env2)
   * - Removed: Red background (text removed from env1)
   * - Modified: Yellow background (text changed)
   */
  renderDiffChunks(chunks, fallbackValue) {
    if (!chunks || chunks.length === 0) {
      // Fallback: no diff chunks available, show plain value
      return this.escapeHtml(fallbackValue || "(null)");
    }

    return chunks
      .map((chunk) => {
        const escapedText = this.escapeHtml(chunk.text);

        switch (chunk.chunk_type) {
          case "Same":
            return `<span class="diff-same">${escapedText}</span>`;
          case "Added":
            return `<span class="diff-added">${escapedText}</span>`;
          case "Removed":
            return `<span class="diff-removed">${escapedText}</span>`;
          case "Modified":
            return `<span class="diff-modified">${escapedText}</span>`;
          default:
            return escapedText;
        }
      })
      .join("");
  }

  getStatusClass(status) {
    const map = {
      Match: "status-match",
      Differ: "status-differ",
      OnlyInEnv1: "status-only-env1",
      OnlyInEnv2: "status-only-env2",
    };
    return map[status] || "";
  }

  getStatusIcon(status) {
    const map = {
      Match: "✓",
      Differ: "⚠️",
      OnlyInEnv1: "←",
      OnlyInEnv2: "→",
    };
    return map[status] || "?";
  }

  attachEventListeners() {
    // Expand/collapse rows
    this.container.querySelectorAll(".expand-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const rowId = e.target.dataset.rowId;
        const expandedRow = document.getElementById(`expanded-${rowId}`);
        const isExpanded = expandedRow.style.display !== "none";

        if (isExpanded) {
          expandedRow.style.display = "none";
          e.target.textContent = "▶";
        } else {
          expandedRow.style.display = "table-row";
          e.target.textContent = "▼";
        }
      });
    });

    // Copy diff to clipboard
    this.container.querySelectorAll(".copy-diff-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const rowId = e.target.dataset.rowId;
        const expandedRow = document.getElementById(`expanded-${rowId}`);
        const text = expandedRow.textContent.trim();
        navigator.clipboard.writeText(text);
        // Show success feedback
        e.target.textContent = "✓";
        setTimeout(() => {
          e.target.textContent = "📋";
        }, 1500);
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
```

### 6.6 Diff Highlighting Styles (styles.css)

Add these styles to `app/tools/compare-config/styles.css` for color-coded diff highlighting:

```css
/* ========================================
   Diff Highlighting Styles
   ======================================== */

/* Diff chunks */
.diff-same {
  /* No special styling for unchanged text */
  color: inherit;
}

.diff-added {
  background-color: #d4edda; /* Light green */
  color: #155724;
  font-weight: 500;
  padding: 2px 4px;
  border-radius: 2px;
}

.diff-removed {
  background-color: #f8d7da; /* Light red */
  color: #721c24;
  font-weight: 500;
  padding: 2px 4px;
  border-radius: 2px;
  text-decoration: line-through;
}

.diff-modified {
  background-color: #fff3cd; /* Light yellow */
  color: #856404;
  font-weight: 500;
  padding: 2px 4px;
  border-radius: 2px;
}

/* Diff table */
.diff-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}

.diff-table th {
  background-color: #f5f5f5;
  padding: 8px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid #ddd;
}

.diff-table td {
  padding: 8px;
  border-bottom: 1px solid #eee;
  vertical-align: top;
}

.diff-table .col-field-name {
  width: 20%;
  font-weight: 600;
  color: #333;
}

.diff-table .col-env-value {
  width: 40%;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Row highlighting on hover */
.diff-row:hover {
  background-color: #f9f9f9;
}

/* Comparison table */
.comparison-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 16px;
}

.comparison-table th {
  background-color: #007bff;
  color: white;
  padding: 12px;
  text-align: left;
  font-weight: 600;
}

.comparison-table td {
  padding: 12px;
  border-bottom: 1px solid #ddd;
}

.comparison-row {
  cursor: pointer;
  transition: background-color 0.2s;
}

.comparison-row:hover {
  background-color: #f0f8ff;
}

/* Status badges */
.status-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.status-match {
  background-color: #d4edda;
  color: #155724;
}

.status-differ {
  background-color: #fff3cd;
  color: #856404;
}

.status-only-env1 {
  background-color: #cce5ff;
  color: #004085;
}

.status-only-env2 {
  background-color: #f8d7da;
  color: #721c24;
}

/* Expand button */
.expand-btn {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  color: #007bff;
  transition: transform 0.2s;
}

.expand-btn:hover {
  transform: scale(1.2);
}

/* Copy button */
.btn-icon {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  transition: transform 0.2s;
}

.btn-icon:hover {
  transform: scale(1.2);
}

/* Expanded row */
.expanded-row td {
  background-color: #f9f9f9;
  padding: 16px;
}

.diff-details {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 6.7 Diff Highlighting Example

**Visual Example of Diff Highlighting:**

When comparing two configuration values:

**Environment 1 (Reference):**
```
timeout = 5000 retry_count = 3 enable_cache = true
```

**Environment 2 (Comparison):**
```
timeout = 8000 retry_count = 3 enable_cache = false
```

**Rendered Diff View:**

| Field | Environment 1 | Environment 2 |
|-------|---------------|---------------|
| `config_value` | timeout = <span style="background:#f8d7da; color:#721c24; text-decoration:line-through;">**5000**</span> retry_count = 3 enable_cache = <span style="background:#f8d7da; color:#721c24; text-decoration:line-through;">**true**</span> | timeout = <span style="background:#d4edda; color:#155724;">**8000**</span> retry_count = 3 enable_cache = <span style="background:#d4edda; color:#155724;">**false**</span> |

**Color Legend:**
- **Green** (`diff-added`): Text added or changed in Environment 2
- **Red** (`diff-removed`): Text removed or changed from Environment 1
- **Yellow** (`diff-modified`): Text modified (optional, for complex changes)
- **No highlighting**: Text is identical in both environments

**Benefits:**
1. **Instant Visual Feedback**: Users immediately see what changed
2. **Word/Character-Level Precision**: Highlights exact differences, not just entire fields
3. **Reduces Cognitive Load**: No need to manually scan and compare long strings
4. **Professional UX**: Similar to Git diffs, familiar to developers

---

## 7. Oracle Instant Client Integration

### 7.1 Client Not Installed - UI Behavior

**Design Philosophy:** The Compare Config tool is an optional feature. When Oracle Instant Client is not installed, the tool should:

1. Display a prominent, friendly installation guide
2. Disable all comparison functionality
3. Provide clear, actionable steps for installation
4. NOT break the rest of the application

**Frontend Implementation for "Not Installed" State:**

```javascript
// In main.js - checkOracleClient()
async checkOracleClient() {
  try {
    const isReady = await invoke('check_oracle_client_ready');
    this.state.oracleClientReady = isReady;

    if (!isReady) {
      this.showInstallationGuide();
      this.disableAllFeatures();
    } else {
      await invoke('prime_oracle_client');
      this.hideInstallationGuide();
      this.enableAllFeatures();
    }
  } catch (error) {
    console.error('Oracle client check failed:', error);
    this.showInstallationGuide();
    this.disableAllFeatures();
  }
}

showInstallationGuide() {
  const guideContainer = document.getElementById('oracle-installation-guide');
  if (!guideContainer) return;

  guideContainer.innerHTML = /* html */ `
    <div class="installation-required-overlay">
      <div class="installation-card">
        <div class="installation-icon">⚠️</div>
        <h2>Oracle Instant Client Required</h2>

        <p class="installation-description">
          This feature requires Oracle Instant Client to connect to Oracle databases.
          The client is <strong>not bundled</strong> with AD Tools due to licensing
          restrictions and size (~80MB).
        </p>

        <div class="installation-steps">
          <h3>Installation Steps:</h3>

          <div class="step">
            <div class="step-number">1</div>
            <div class="step-content">
              <h4>Download Oracle Instant Client</h4>
              <p>Download <strong>Basic Light</strong> package for your architecture:</p>
              <div class="download-links">
                <a href="https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html"
                   target="_blank"
                   class="download-btn">
                  Apple Silicon (M1/M2/M3)
                </a>
                <a href="https://www.oracle.com/database/technologies/instant-client/macos-intel-x86-downloads.html"
                   target="_blank"
                   class="download-btn">
                  Intel (x86_64)
                </a>
              </div>
              <p class="note">Note: You'll need an Oracle account (free registration)</p>
            </div>
          </div>

          <div class="step">
            <div class="step-number">2</div>
            <div class="step-content">
              <h4>Run Installation Script</h4>
              <p>Open Terminal and run:</p>
              <pre class="code-block"><code>cd /Applications/AD\\ Tools.app/Contents/Resources
./scripts/install-oracle-client.sh ~/Downloads/instantclient-*.zip</code></pre>
              <button id="copy-install-command" class="btn-secondary btn-small">
                📋 Copy Command
              </button>
            </div>
          </div>

          <div class="step">
            <div class="step-number">3</div>
            <div class="step-content">
              <h4>Restart AD Tools</h4>
              <p>Close and reopen AD Tools. The feature will be automatically enabled.</p>
            </div>
          </div>
        </div>

        <div class="installation-info">
          <h4>Technical Details:</h4>
          <ul>
            <li><strong>Installation Size:</strong> ~80MB</li>
            <li><strong>Installation Location:</strong> ~/Documents/adtools_library/instantclient</li>
            <li><strong>Admin Rights:</strong> Not required</li>
            <li><strong>Automatic Updates:</strong> No (manual updates only)</li>
          </ul>
        </div>

        <div class="installation-actions">
          <button id="check-again-btn" class="btn-primary">
            🔄 Check Installation Status
          </button>
          <button id="view-troubleshooting" class="btn-secondary">
            📖 Troubleshooting Guide
          </button>
        </div>
      </div>
    </div>
  `;

  guideContainer.classList.remove('hidden');

  // Attach event listeners
  document.getElementById('copy-install-command')?.addEventListener('click', () => {
    const command = `cd /Applications/AD\\ Tools.app/Contents/Resources\n./scripts/install-oracle-client.sh ~/Downloads/instantclient-*.zip`;
    navigator.clipboard.writeText(command);
    this.showSuccess('Installation command copied to clipboard!');
  });

  document.getElementById('check-again-btn')?.addEventListener('click', () => {
    this.checkOracleClient();
  });

  document.getElementById('view-troubleshooting')?.addEventListener('click', () => {
    this.showTroubleshootingModal();
  });
}

hideInstallationGuide() {
  const guideContainer = document.getElementById('oracle-installation-guide');
  guideContainer?.classList.add('hidden');
}

disableAllFeatures() {
  // Disable all form inputs
  const inputs = this.container.querySelectorAll('input, textarea, select, button');
  inputs.forEach(input => {
    if (input.id !== 'check-again-btn' &&
        input.id !== 'view-troubleshooting' &&
        input.id !== 'copy-install-command') {
      input.disabled = true;
    }
  });

  // Hide main form, show installation guide
  document.getElementById('setup-form')?.classList.add('hidden');
  document.getElementById('oracle-installation-guide')?.classList.remove('hidden');
}

enableAllFeatures() {
  // Enable all form inputs
  const inputs = this.container.querySelectorAll('input, textarea, select, button');
  inputs.forEach(input => {
    input.disabled = false;
  });

  // Show main form, hide installation guide
  document.getElementById('setup-form')?.classList.remove('hidden');
  document.getElementById('oracle-installation-guide')?.classList.add('hidden');
}

showTroubleshootingModal() {
  // Show modal with common issues and solutions
  const modal = /* html */ `
    <div class="troubleshooting-modal">
      <h3>Troubleshooting Oracle Client Installation</h3>

      <div class="troubleshooting-item">
        <h4>❌ "Architecture mismatch" error</h4>
        <p>Solution: Make sure you downloaded the correct package:</p>
        <ul>
          <li>Apple Silicon Macs (M1/M2/M3): Use ARM64 package</li>
          <li>Intel Macs: Use x86_64 package</li>
        </ul>
        <p>Check your architecture: <code>uname -m</code></p>
      </div>

      <div class="troubleshooting-item">
        <h4>❌ "libclntsh.dylib not found"</h4>
        <p>Solution: Verify installation location:</p>
        <pre><code>ls ~/Documents/adtools_library/instantclient/libclntsh.dylib</code></pre>
        <p>If missing, re-run the installation script.</p>
      </div>

      <div class="troubleshooting-item">
        <h4>❌ "Permission denied"</h4>
        <p>Solution: Ensure the script is executable:</p>
        <pre><code>chmod +x ./scripts/install-oracle-client.sh</code></pre>
      </div>

      <div class="troubleshooting-item">
        <h4>❌ Feature still not available after installation</h4>
        <p>Solution:</p>
        <ol>
          <li>Completely quit AD Tools (⌘Q)</li>
          <li>Reopen AD Tools</li>
          <li>Navigate back to Compare Config tool</li>
        </ol>
      </div>

      <div class="troubleshooting-item">
        <h4>Need more help?</h4>
        <p>Check the full documentation or contact support:</p>
        <a href="docs/user-guide/oracle-client-setup.md">Oracle Client Setup Guide</a>
      </div>
    </div>
  `;

  // Show modal (use existing modal system)
  this.showModal('Troubleshooting', modal);
}
```

**CSS Styles for Installation Guide:**

```css
/* Oracle Installation Guide Styles */
.installation-required-overlay {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 2rem;
  min-height: 600px;
}

.installation-card {
  max-width: 800px;
  background: white;
  border-radius: 12px;
  padding: 3rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.installation-icon {
  font-size: 4rem;
  text-align: center;
  margin-bottom: 1rem;
}

.installation-card h2 {
  text-align: center;
  color: #333;
  margin-bottom: 1rem;
}

.installation-description {
  text-align: center;
  color: #666;
  font-size: 1.1rem;
  line-height: 1.6;
  margin-bottom: 2rem;
  padding: 0 2rem;
}

.installation-steps {
  margin: 2rem 0;
}

.installation-steps h3 {
  color: #667eea;
  margin-bottom: 1.5rem;
  font-size: 1.3rem;
}

.step {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: #f8f9fa;
  border-radius: 8px;
  border-left: 4px solid #667eea;
}

.step-number {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  background: #667eea;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  font-weight: bold;
}

.step-content h4 {
  margin-bottom: 0.5rem;
  color: #333;
}

.step-content p {
  color: #666;
  line-height: 1.6;
  margin-bottom: 0.75rem;
}

.download-links {
  display: flex;
  gap: 1rem;
  margin: 1rem 0;
}

.download-btn {
  display: inline-block;
  padding: 0.75rem 1.5rem;
  background: #667eea;
  color: white;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 600;
  transition: background 0.2s;
}

.download-btn:hover {
  background: #5568d3;
}

.code-block {
  background: #2d2d2d;
  color: #f8f8f2;
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.75rem 0;
  font-family: "Monaco", "Courier New", monospace;
  font-size: 0.9rem;
}

.note {
  font-size: 0.9rem;
  color: #888;
  font-style: italic;
}

.installation-info {
  background: #e3f2fd;
  padding: 1.5rem;
  border-radius: 8px;
  margin: 2rem 0;
}

.installation-info h4 {
  color: #1976d2;
  margin-bottom: 1rem;
}

.installation-info ul {
  list-style: none;
  padding: 0;
}

.installation-info li {
  padding: 0.5rem 0;
  color: #333;
}

.installation-info strong {
  color: #1976d2;
}

.installation-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-top: 2rem;
}

.btn-small {
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
}

.troubleshooting-item {
  margin-bottom: 2rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 6px;
}

.troubleshooting-item h4 {
  color: #d32f2f;
  margin-bottom: 0.5rem;
}
```

### 7.2 Installation Script (scripts/install-oracle-client.sh)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Oracle Instant Client Installer for AD Tools
# Installs Oracle Instant Client to ~/Documents/adtools_library/instantclient

ARCH="$(uname -m)"
TARGET="$HOME/Documents/adtools_library/instantclient"
CONF_DIR="$HOME/.adtools"
ZIP_PATH="${1:-}"

echo "=== Oracle Instant Client Installer for AD Tools ==="
echo "Architecture: $ARCH"
echo ""

# Validate architecture
if [[ "$ARCH" != "arm64" && "$ARCH" != "x86_64" ]]; then
  echo "ERROR: Unsupported architecture: $ARCH"
  exit 1
fi

# Check if ZIP path provided
if [[ -z "$ZIP_PATH" ]]; then
  echo "Usage: install-oracle-client.sh /path/to/instantclient-basiclite-macos-<arch>.zip"
  echo ""
  echo "Download Oracle Instant Client Basic Light from:"
  echo "https://www.oracle.com/database/technologies/instant-client/macos-intel-x86-downloads.html (x86_64)"
  echo "https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html (arm64)"
  exit 1
fi

# Verify ZIP exists
if [[ ! -f "$ZIP_PATH" ]]; then
  echo "ERROR: File not found: $ZIP_PATH"
  exit 1
fi

# Verify ZIP matches architecture
if [[ "$ARCH" == "arm64" ]] && ! echo "$ZIP_PATH" | grep -q "arm64"; then
  echo "WARNING: ZIP filename does not contain 'arm64' but system is Apple Silicon"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Create directories
echo "Creating directories..."
mkdir -p "$TARGET" "$CONF_DIR"

# Extract ZIP
echo "Extracting Instant Client..."
unzip -q "$ZIP_PATH" -d "$TARGET"

# Flatten nested structure if present
IC_DIR=$(find "$TARGET" -name "instantclient_*" -type d | head -n 1)
if [[ -n "$IC_DIR" && "$IC_DIR" != "$TARGET" ]]; then
  echo "Flattening directory structure..."
  mv "$IC_DIR"/* "$TARGET/"
  rmdir "$IC_DIR"
fi

# Create symlink for libclntsh.dylib if needed
if [[ ! -f "$TARGET/libclntsh.dylib" ]]; then
  VERSIONED=$(find "$TARGET" -name "libclntsh.dylib.*" | head -n 1)
  if [[ -n "$VERSIONED" ]]; then
    echo "Creating symlink for libclntsh.dylib..."
    ln -s "$(basename "$VERSIONED")" "$TARGET/libclntsh.dylib"
  else
    echo "ERROR: libclntsh.dylib not found in extracted files"
    exit 1
  fi
fi

# Verify library
if ! otool -L "$TARGET/libclntsh.dylib" &> /dev/null; then
  echo "WARNING: libclntsh.dylib may not be a valid library"
fi

# Record path
echo "$TARGET" > "$CONF_DIR/oracle_ic_path"

# Record version if available
VERSION=$(basename "$ZIP_PATH" | grep -oE '[0-9]+\.[0-9]+' | head -n 1)
if [[ -n "$VERSION" ]]; then
  echo "$VERSION" > "$TARGET/version.lock"
fi

echo ""
echo "✓ Oracle Instant Client installed successfully!"
echo "Location: $TARGET"
echo ""
echo "Next steps:"
echo "1. Restart AD Tools application"
echo "2. The application will automatically detect the client"
echo "3. Configure database connections in the Compare Config tool"
```

### 7.2 Runtime Detection in Tool

```javascript
// In main.js onMount()
async checkOracleClient() {
  try {
    const isReady = await invoke('check_oracle_client_ready');
    this.state.oracleClientReady = isReady;

    if (!isReady) {
      this.showWarning(
        'Oracle Instant Client not installed. ' +
        '<a href="#" id="install-guide">View installation guide</a>'
      );
      this.disableCompareFeatures();
    } else {
      // Prime the client on first use
      await invoke('prime_oracle_client');
      this.enableCompareFeatures();
    }
  } catch (error) {
    console.error('Oracle client check failed:', error);
  }
}

disableCompareFeatures() {
  document.getElementById('compare-btn')?.setAttribute('disabled', 'true');
  document.getElementById('fetch-metadata')?.setAttribute('disabled', 'true');
  // Show overlay with installation instructions
}

enableCompareFeatures() {
  document.getElementById('compare-btn')?.removeAttribute('disabled');
  document.getElementById('fetch-metadata')?.removeAttribute('disabled');
}
```

---

## 8. Security & Credentials

### 8.1 Credential Management

**Storage:** macOS Keychain (via Rust `keyring` crate)

```rust
// In src-tauri/src/credentials.rs
use keyring::Entry;

pub struct CredentialManager;

impl CredentialManager {
    pub fn get_oracle_credentials(&self, env_name: &str) -> Result<Credentials, String> {
        let username_key = format!("adtools.oracle.{}.username", env_name);
        let password_key = format!("adtools.oracle.{}.password", env_name);

        let username_entry = Entry::new("ADTools", &username_key)
            .map_err(|e| format!("Keychain error: {}", e))?;
        let password_entry = Entry::new("ADTools", &password_key)
            .map_err(|e| format!("Keychain error: {}", e))?;

        let username = username_entry.get_password()
            .map_err(|e| format!("Username not found in keychain: {}", e))?;
        let password = password_entry.get_password()
            .map_err(|e| format!("Password not found in keychain: {}", e))?;

        Ok(Credentials { username, password })
    }

    pub fn set_oracle_credentials(
        &self,
        env_name: &str,
        username: &str,
        password: &str,
    ) -> Result<(), String> {
        let username_key = format!("adtools.oracle.{}.username", env_name);
        let password_key = format!("adtools.oracle.{}.password", env_name);

        let username_entry = Entry::new("ADTools", &username_key)
            .map_err(|e| format!("Keychain error: {}", e))?;
        let password_entry = Entry::new("ADTools", &password_key)
            .map_err(|e| format!("Keychain error: {}", e))?;

        username_entry.set_password(username)
            .map_err(|e| format!("Failed to save username: {}", e))?;
        password_entry.set_password(password)
            .map_err(|e| format!("Failed to save password: {}", e))?;

        Ok(())
    }
}

pub struct Credentials {
    pub username: String,
    pub password: String,
}
```

**Frontend:** Prompt for credentials on first use, store in keychain

```javascript
async promptForCredentials(envName) {
  // Show modal dialog
  const username = prompt(`Enter username for ${envName}:`);
  const password = prompt(`Enter password for ${envName}:`, '', 'password');

  if (username && password) {
    await invoke('set_oracle_credentials', {
      envName,
      username,
      password,
    });
  }
}
```

### 8.2 SQL Injection Prevention

- Use bound parameters for user-provided WHERE clauses
- Validate table and column names against metadata
- Reject dangerous keywords (DROP, DELETE, etc.)
- Limit query execution to SELECT only

### 8.3 Data Sanitization & Type Safety

**Critical for Security and Stability!**

The backend performs comprehensive data sanitization on all Oracle query results before sending to the frontend:

#### Type-Based Sanitization (see `sanitize_oracle_value()` in [Section 5.3](#53-database-connection-connectionrs)):

1. **String Types** (VARCHAR2, CHAR, NVARCHAR2, NCHAR):
   - Remove control characters (except `\n` and `\t`)
   - Truncate strings > 10MB with `[TRUNCATED]` marker
   - Prevents malformed Unicode from crashing the UI

2. **Number Types** (NUMBER, FLOAT):
   - Convert to string to preserve precision (Oracle NUMBER supports arbitrary precision)
   - Prevents floating-point precision issues in JavaScript

3. **Date/Timestamp Types**:
   - Convert to ISO 8601 string format
   - Ensures consistent date rendering across timezones

4. **CLOB** (Character Large Object):
   - Remove control characters
   - Truncate > 1MB with `[CLOB TRUNCATED]` marker
   - Prevents UI freezing on massive text fields

5. **BLOB** (Binary Large Object):
   - Display as `[BLOB - binary data not displayed]`
   - Binary data is not suitable for text comparison

6. **RAW/LONG RAW** (Binary):
   - Display as `[BINARY DATA]`
   - Prevents binary injection attacks

7. **NULL Handling**:
   - Consistently converted to `serde_json::Value::Null`
   - Prevents "undefined" issues in JavaScript

#### Security Benefits:

- **XSS Prevention**: Control character removal prevents script injection
- **DoS Prevention**: Size limits prevent memory exhaustion
- **Type Safety**: Consistent JSON types prevent frontend errors
- **Performance**: Truncation keeps UI responsive

#### Example Sanitization:

```rust
// Input from Oracle
let oracle_value = "config_value = 5000\x00\x01\x02 [binary garbage]";

// After sanitization
let sanitized = "config_value = 5000  [binary garbage]";  // Control chars removed
```

### 8.4 Connection Security

- Support TCPS (TLS) connections
- Wallet support via TNS_ADMIN environment variable
- Connection timeout (30 seconds default)
- Read-only database users recommended

---

## 9. Error Handling

### 9.1 Error Categories

**Connection Errors:**

- Invalid credentials → "Invalid username or password"
- Host unreachable → "Cannot reach database host. Check network connection."
- Service not found → "Service name not found. Verify service name."
- Timeout → "Connection timed out after 30 seconds"

**Query Errors:**

- Table not found → "Table does not exist in schema"
- Invalid WHERE clause → "Invalid WHERE clause syntax"
- Permission denied → "Insufficient privileges to query table"

**Client Errors:**

- Client not installed → "Oracle Instant Client not found. Run installer."
- Client load failed → "Failed to load Oracle client library"
- Architecture mismatch → "Oracle client architecture does not match system"

### 9.2 Error Display (Frontend)

```javascript
showError(message) {
  const errorBox = document.getElementById('error-message');
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');

  EventBus.emit('notification:error', message);
}

showWarning(message) {
  const warningBox = document.getElementById('warning-message');
  warningBox.innerHTML = message;
  warningBox.classList.remove('hidden');
}

clearErrors() {
  document.getElementById('error-message')?.classList.add('hidden');
  document.getElementById('warning-message')?.classList.add('hidden');
}
```

### 9.3 Error Handling (Backend)

```rust
// Consistent Result<T, String> pattern
#[tauri::command]
pub async fn compare_configurations(
    request: ComparisonRequest,
    credential_manager: State<'_, CredentialManager>,
) -> Result<ComparisonResult, String> {
    // All errors converted to String for frontend
    let creds1 = credential_manager
        .get_oracle_credentials(&request.env1_name)
        .map_err(|e| format!("Credentials error for {}: {}", request.env1_name, e))?;

    let conn1 = DatabaseConnection::new(&request.env1_connection, &creds1)
        .map_err(|e| format!("Connection error for {}: {}", request.env1_name, e))?;

    // ... rest of implementation
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests (Backend)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comparison_engine_matching() {
        let env1_records = vec![
            json!({"config_key": "key1", "value": "10"}),
            json!({"config_key": "key2", "value": "20"}),
        ];

        let env2_records = vec![
            json!({"config_key": "key1", "value": "10"}),
            json!({"config_key": "key2", "value": "20"}),
        ];

        let result = ComparisonEngine::compare(
            "Env1".to_string(),
            env1_records,
            "Env2".to_string(),
            env2_records,
            &["config_key".to_string()],
            None,
        );

        assert_eq!(result.summary.total_records, 2);
        assert_eq!(result.summary.matching, 2);
        assert_eq!(result.summary.differing, 0);
    }

    #[test]
    fn test_comparison_engine_differences() {
        let env1_records = vec![
            json!({"config_key": "key1", "value": "10"}),
        ];

        let env2_records = vec![
            json!({"config_key": "key1", "value": "20"}),
        ];

        let result = ComparisonEngine::compare(
            "Env1".to_string(),
            env1_records,
            "Env2".to_string(),
            env2_records,
            &["config_key".to_string()],
            None,
        );

        assert_eq!(result.summary.total_records, 1);
        assert_eq!(result.summary.matching, 0);
        assert_eq!(result.summary.differing, 1);
        assert_eq!(result.comparisons[0].differences.len(), 1);
    }
}
```

### 10.2 Integration Tests

```rust
#[tokio::test]
async fn test_fetch_table_metadata() {
    let config = ConnectionConfig {
        name: "test".to_string(),
        host: "localhost".to_string(),
        port: 1521,
        service_name: "ORCLPDB1".to_string(),
        schema: "TEST_SCHEMA".to_string(),
    };

    let creds = Credentials {
        username: "test_user".to_string(),
        password: "test_pass".to_string(),
    };

    let conn = DatabaseConnection::new(&config, &creds).unwrap();
    let metadata = conn.fetch_table_metadata("TEST_SCHEMA", "APP_CONFIG").unwrap();

    assert!(!metadata.columns.is_empty());
    assert!(!metadata.primary_key.is_empty());
}
```

### 10.3 Frontend Tests (Vitest)

```javascript
import { describe, it, expect, vi } from "vitest";
import { CompareConfigTool } from "./main.js";
import * as CompareService from "./service.js";

describe("CompareConfigTool", () => {
  it("should validate WHERE clause", () => {
    expect(() => {
      CompareService.validateWhereClause("config_key = 'test'");
    }).not.toThrow();

    expect(() => {
      CompareService.validateWhereClause("DROP TABLE users");
    }).toThrow();
  });

  it("should build connection config from form", () => {
    const container = document.createElement("div");
    const tool = new CompareConfigTool(container);

    // Mock DOM elements
    document.getElementById = vi.fn((id) => {
      if (id === "env1-name") return { value: "UAT1" };
      if (id === "env1-host") return { value: "db.example.com" };
      if (id === "env1-port") return { value: "1521" };
      if (id === "env1-service") return { value: "ORCLPDB1" };
      if (id === "env1-schema") return { value: "APP_SCHEMA" };
      return null;
    });

    const config = tool.getConnectionConfig("env1");

    expect(config.name).toBe("UAT1");
    expect(config.host).toBe("db.example.com");
    expect(config.port).toBe(1521);
  });
});
```

### 10.4 Manual Testing Checklist

- [ ] Oracle client not installed: app loads, clear warning shown, buttons disabled
- [ ] Oracle client installed: prime succeeds, buttons enabled
- [ ] Test connection: valid credentials succeed, invalid fail with message
- [ ] Fetch metadata: returns columns with correct types and PK flags
- [ ] WHERE clause: filters records correctly
- [ ] Field selection: includes only selected fields in comparison
- [ ] Comparison: correctly identifies matches, differences, and unique records
- [ ] View modes: expandable rows, cards, and master-detail all render
- [ ] Export: JSON and CSV files created with correct content
- [ ] Error handling: all error scenarios show user-friendly messages

---

## 11. Deployment Plan

### 11.1 Settings Category Registration

**Step 1:** Add Oracle Connections category to `app/pages/settings/config.json`:

```json
{
  "id": "oracle",
  "label": "Oracle Database Connections",
  "requiresTauri": true,
  "initiallyExpanded": false,
  "description": "Manage Oracle database connections for Compare Config tool. Requires Oracle Instant Client.",
  "items": [
    {
      "key": "oracle.connections",
      "storageKey": "config.oracle.connections",
      "label": "Database Connections",
      "type": "kvlist",
      "default": [],
      "keyPlaceholder": "Connection Name",
      "valuePlaceholder": "Connection Details (JSON)",
      "description": "Configure Oracle database connections. Format: {\"host\": \"...\", \"port\": 1521, \"service_name\": \"...\", \"schema\": \"...\"}. Credentials are stored in macOS Keychain.",
      "validation": {
        "jsonValue": true
      }
    },
    {
      "key": "oracle.client.path",
      "storageKey": "config.oracle.client.path",
      "label": "Custom Instant Client Path",
      "type": "string",
      "default": "",
      "description": "Optional: Override default Oracle Instant Client location (~/Documents/adtools_library/instantclient)",
      "validation": {
        "pattern": "^(/|~/).*"
      }
    }
  ]
}
```

### 11.2 Tool Registration

Add to `app/config/tools.json`:

```json
{
  "id": "compare-config",
  "name": "Compare Config",
  "description": "Compare Oracle database configurations between environments",
  "category": "database",
  "icon": "database-compare",
  "path": "tools/compare-config/main.js",
  "className": "CompareConfigTool",
  "requirements": ["desktop"],
  "order": 50
}
```

### 11.3 Cargo Dependencies

Add to `src-tauri/Cargo.toml`:

```toml
[dependencies]
oracle = "0.6"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tauri = { version = "2.0", features = ["dialog", "fs", "shell-open"] }
tokio = { version = "1", features = ["full"] }
chrono = "0.4"
anyhow = "1.0"
keyring = "2.0"
libloading = "0.8"
```

### 11.4 Command Registration

In `src-tauri/src/lib.rs`:

```rust
mod oracle;
mod credentials;

use oracle::commands::*;
use credentials::CredentialManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CredentialManager::new())
        .invoke_handler(tauri::generate_handler![
            check_oracle_client_ready,
            prime_oracle_client,
            test_oracle_connection,
            fetch_table_metadata,
            compare_configurations,
            export_comparison_result,
            set_oracle_credentials,
            get_oracle_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 11.5 Distribution

**macOS:**

- Include installation script in `scripts/install-oracle-client.sh`
- Document Oracle Instant Client download and installation
- Do NOT bundle Oracle client due to licensing
- Provide user guide for manual installation

**Documentation:**

- Add user guide: `docs/user-guide/compare-config.md`
- Add developer guide: `docs/developer/oracle-integration.md`
- Update README with Oracle client requirements

---

## 12. Future Enhancements

### 12.1 Phase 2

- **Saved Comparison Profiles:** Save connection pairs and settings
- **3+ Environment Comparison:** Compare more than 2 environments

### 12.3 Technical Debt

- **Connection Pooling:** Reuse connections for multiple queries
- **Query Optimization:** Batch fetches, parallel queries
- **Virtual Scrolling:** Handle 10,000+ record comparisons
- **Caching:** Cache metadata and recent comparisons
- **Logging:** Structured logging for debugging

---

## Appendix A: Sample Data

### A.1 Example Comparison Result

```json
{
  "env1_name": "UAT1",
  "env2_name": "UAT2",
  "timestamp": "2025-11-06T14:30:00+07:00",
  "summary": {
    "total_records": 5,
    "matching": 2,
    "differing": 2,
    "only_in_env1": 1,
    "only_in_env2": 0
  },
  "comparisons": [
    {
      "primary_key": "db_pool_size",
      "status": "Differ",
      "env1_data": {
        "config_key": "db_pool_size",
        "value": "10",
        "category": "DATABASE",
        "is_active": "Y"
      },
      "env2_data": {
        "config_key": "db_pool_size",
        "value": "20",
        "category": "DATABASE",
        "is_active": "Y"
      },
      "differences": [
        {
          "field_name": "value",
          "env1_value": "10",
          "env2_value": "20"
        }
      ]
    },
    {
      "primary_key": "api_timeout",
      "status": "Match",
      "env1_data": {
        "config_key": "api_timeout",
        "value": "30",
        "category": "API",
        "is_active": "Y"
      },
      "env2_data": {
        "config_key": "api_timeout",
        "value": "30",
        "category": "API",
        "is_active": "Y"
      },
      "differences": []
    },
    {
      "primary_key": "feature_x",
      "status": "OnlyInEnv1",
      "env1_data": {
        "config_key": "feature_x",
        "value": "enabled",
        "category": "FEATURES",
        "is_active": "Y"
      },
      "env2_data": null,
      "differences": []
    }
  ]
}
```

---

## Appendix B: References

- [Tauri 2.x Documentation](https://tauri.app/v2/guides/)
- [Oracle Rust Driver (oracle crate)](https://github.com/kubo/rust-oracle)
- [Oracle Instant Client Downloads](https://www.oracle.com/database/technologies/instant-client.html)
- [Rust Keyring Crate](https://docs.rs/keyring/)
- [AD Tools Architecture Patterns](./ARCHITECTURE_PATTERNS.md)

---

**Document Control**

| Version | Date       | Author | Changes                                            |
| ------- | ---------- | ------ | -------------------------------------------------- |
| 2.0     | 2025-11-06 | System | Integrated specification with current architecture |

---

**Sign-off**

This document integrates the general comparison specification with Oracle Instant Client integration and aligns with the current AD Tools architecture (Vanilla JS frontend, Tauri/Rust backend).

---

## Summary: Optional Feature Implementation

### Key Points

1. **100% Optional Feature**

   - Compare Config tool is NOT mandatory for AD Tools operation
   - All other tools work perfectly without Oracle Instant Client
   - Users who don't need Oracle comparison never see installation prompts

2. **Graceful Degradation**

   - When Oracle client not installed: Feature shows installation guide
   - Clear, step-by-step instructions provided
   - "Check Again" button allows re-checking after installation
   - No errors, crashes, or broken UI states

3. **User-Driven Installation**

   - Oracle client is NEVER bundled with AD Tools
   - Users manually download from Oracle (licensing requirement)
   - Installation script provided for easy setup
   - No admin privileges required (~80MB in user directory)

4. **Installation Flow**

   ```
   User Opens Tool → Check Oracle Client
                        ↓
           ┌────────────┴────────────┐
           │                         │
       Not Found                  Found
           │                         │
   Show Installation Guide    Prime & Enable
   Disable All Features       Show Main Form
           │                         │
   User Installs Client      User Uses Feature
           │                         │
   Clicks "Check Again"           Success
           │                         │
   Prime & Enable ←──────────────────┘
   ```

5. **Zero Impact on Other Tools**

   - Quick Query: Works with all features except Oracle-specific ones
   - Jenkins Runner: Works fully without Oracle client
   - All other tools: Unaffected by Oracle client presence

6. **Testing Requirements**

   - Test with client NOT installed: Installation guide appears, features disabled
   - Test with client installed: Features enabled, comparison works
   - Test architecture mismatch: Clear error message
   - Test reinstallation: Script handles existing installations

7. **Documentation Requirements**
   - User guide: Oracle client download and installation
   - Troubleshooting: Common installation issues
   - FAQ: Why isn't Oracle bundled? (licensing, size)
   - Architectural decision: Optional dependency pattern

This implementation ensures AD Tools remains lightweight and accessible while providing powerful Oracle database comparison capabilities for users who need them.
