# Oracle Instant Client Integration Plan (macOS, Tauri Desktop)

## Development Setup

### Prerequisites

1. **Oracle Instant Client** installed at:
   ```
   ~/Documents/adtools_library/oracle_instantclient/
   ```

2. **Required files** in the IC directory:
   - `libclntsh.dylib` (symlink to versioned file)
   - `libclntsh.dylib.XX.1` (actual library)
   - `libnnz.dylib`
   - `libociei.dylib`

### Installing Oracle Instant Client (if not installed)

1. Download from Oracle:
   - [ARM64 (Apple Silicon)](https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html)
   - [x86_64 (Intel)](https://www.oracle.com/database/technologies/instant-client/macos-intel-x86-downloads.html)

2. Extract and install:
   ```bash
   mkdir -p ~/Documents/adtools_library/oracle_instantclient
   # Extract the downloaded DMG/ZIP contents to the above directory
   # Ensure libclntsh.dylib symlink exists
   cd ~/Documents/adtools_library/oracle_instantclient
   ln -sf libclntsh.dylib.*.1 libclntsh.dylib
   ```

### Building with Oracle Support

**Development build:**
```bash
# Set environment variable for the current terminal session
export OCI_LIB_DIR="$HOME/Documents/adtools_library/oracle_instantclient"

# Build with oracle feature
cd tauri
cargo build --features oracle
```

**Release build:**
```bash
# The build script auto-detects IC at the default location
npm run release:build
```

The `build_release.sh` script automatically:
- Detects Oracle IC at `~/Documents/adtools_library/oracle_instantclient/`
- Sets `OCI_LIB_DIR` if found
- Enables `--features oracle` when IC is available
- Falls back to building without Oracle if IC not found

### Building WITHOUT Oracle Support

```bash
cd tauri
cargo build  # No --features oracle
```

The app will still compile and run, but Oracle commands will return "Oracle support not compiled".

## Goals

- Enable Oracle SELECT capabilities in the desktop app with zero user setup.
- Bundle Oracle Instant Client within the app for each architecture (arm64, x86_64).
- Integrate with Quick Query for table properties and Jenkins Runner for preflight backup SELECTs.

## Summary Approach

- Ship app with Oracle Instant Client (Basic Lite, ~30MB) bundled inside the app bundle.
- Each architecture build (arm64, x86_64) includes the matching IC binaries.
- At runtime, load `libclntsh.dylib` from the app bundle using `@executable_path` relative paths.
- Use connection pooling (max 4 connections) and result streaming for large queries.
- Store Oracle credentials in macOS Keychain as a single consolidated entry.

## Existing Frontend (Cherry-picked from e25e4d8)

The Compare Config tool UI has been cherry-picked from branch `backup-before-compare-config-revert` (commit e25e4d8). This provides a complete frontend implementation.

### Files

| File | Lines | Description |
|------|-------|-------------|
| `app/tools/compare-config/main.js` | ~1700 | Full tool logic, state management, UI binding |
| `app/tools/compare-config/template.js` | ~240 | HTML template with installation guide, forms, results |
| `app/tools/compare-config/service.js` | ~180 | Tauri invoke calls (backend interface) |
| `app/tools/compare-config/styles.css` | ~800 | Complete styling |
| `app/tools/compare-config/icon.js` | ~20 | Tool icon |
| `app/tools/compare-config/views/` | - | MasterDetailView.js, VerticalCardView.js |

### Features Implemented (UI only, backend pending)

- **Installation Guide**: Shows when Oracle client not detected (adapt for bundled mode)
- **Schema/Table Mode**: Connection → Schema → Table → Field selection → Compare
- **Raw SQL Mode**: Custom SQL queries against two environments
- **Result Views**: Expandable rows, vertical cards, master-detail
- **Export**: JSON/CSV download
- **Connection Management**: Save/load connections, Keychain credentials

### Adaptation Needed for Bundled IC

Since IC is now bundled (not user-installed), the installation guide should become an error state:

```javascript
// In main.js checkOracleClient(), change showInstallationGuide() to show error:
showInstallationGuide() {
  // Change message from "install Oracle client" to
  // "Oracle client failed to load. Please reinstall the app or contact support."
}
```

## Bundle Structure

```
ADTools.app/
└── Contents/
    ├── MacOS/
    │   └── ad-tools (main executable)
    └── Frameworks/
        └── instantclient/
            ├── libclntsh.dylib
            ├── libclntsh.dylib.19.1 (or current version)
            ├── libnnz19.dylib
            ├── libociei.dylib
            └── ... (other IC files)
```

### Build & Signing Requirements

- Copy IC files into `Frameworks/instantclient/` during Tauri build.
- Sign all dylibs: `codesign --force --sign "$IDENTITY" --timestamp Contents/Frameworks/instantclient/*.dylib`
- Notarization should cover bundled dylibs automatically if signed correctly.
- Add to `tauri.conf.json` resources or use build script to copy files.

## Backend Safety Requirements

- Never panic if the client fails to load. All Tauri commands must return `Result<T, OracleError>`.
- Use `OnceLock` for library handle - load once, clean lifecycle, no memory leaks.
- Load the client lazily on first Oracle action (not at app startup).
- Implement query timeout (default 5 minutes) to prevent hung connections.

### Library Loading with OnceLock (No Memory Leak)

```rust
use std::sync::OnceLock;
use libloading::Library;

static ORACLE_LIB: OnceLock<Library> = OnceLock::new();

fn get_oracle_lib() -> Result<&'static Library, OracleError> {
    ORACLE_LIB.get_or_try_init(|| {
        let exe_path = std::env::current_exe()
            .map_err(|e| OracleError::new(0, format!("Failed to get exe path: {}", e)))?;
        let frameworks_path = exe_path
            .parent()  // MacOS/
            .and_then(|p| p.parent())  // Contents/
            .map(|p| p.join("Frameworks/instantclient/libclntsh.dylib"))
            .ok_or_else(|| OracleError::new(0, "Invalid app bundle structure".into()))?;

        unsafe { Library::new(&frameworks_path) }
            .map_err(|e| OracleError::new(0, format!("Failed to load Oracle client: {}", e)))
    })
}
```

## Connection Pooling

- Use `oracle` crate's connection pool or implement simple pool with `deadpool`.
- Configuration:
  - `min_connections`: 0 (create on demand)
  - `max_connections`: 4
  - `connection_timeout`: 30 seconds
  - `idle_timeout`: 300 seconds (close idle connections after 5 min)
- Connections are heavyweight (~1-5MB each); limit prevents memory bloat.

```rust
use oracle::pool::{Pool, PoolBuilder};

fn create_pool(connect_string: &str, user: &str, pass: &str) -> Result<Pool, OracleError> {
    PoolBuilder::new(user, pass, connect_string)
        .min_connections(0)
        .max_connections(4)
        .connection_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| map_oracle_error(e))
}
```

## Result Streaming

For large result sets, stream rows in batches to prevent memory exhaustion.

### Streaming Strategy

- Fetch rows in batches of 1000.
- Send batches to frontend via Tauri events or chunked responses.
- Frontend renders incrementally (virtualized list recommended).
- Optional: User can set row limit before executing.

```rust
#[tauri::command]
async fn oracle_select_stream(
    window: Window,
    connect: String,
    username: String,
    password: String,
    sql: String,
    batch_size: Option<u32>,
    row_limit: Option<u32>,
) -> Result<StreamInfo, OracleError> {
    let batch = batch_size.unwrap_or(1000);
    let limit = row_limit; // None = unlimited

    // Execute query and stream batches via events
    let conn = get_connection(&connect, &username, &password)?;
    let mut stmt = conn.statement(&sql).build()?;
    let rows = stmt.query(&[])?;

    let mut count = 0u32;
    let mut batch_rows = Vec::with_capacity(batch as usize);

    for row_result in rows {
        let row = row_result.map_err(map_oracle_error)?;
        batch_rows.push(row_to_json(&row)?);
        count += 1;

        if batch_rows.len() >= batch as usize {
            window.emit("oracle-rows", &batch_rows)?;
            batch_rows.clear();
        }

        if let Some(max) = limit {
            if count >= max { break; }
        }
    }

    // Emit remaining rows
    if !batch_rows.is_empty() {
        window.emit("oracle-rows", &batch_rows)?;
    }

    window.emit("oracle-complete", count)?;
    Ok(StreamInfo { total_rows: count })
}
```

## Rich Error Handling

Map Oracle errors to user-friendly messages with actionable hints.

```rust
#[derive(Debug, Serialize, Clone)]
pub struct OracleError {
    pub code: i32,
    pub message: String,
    pub hint: Option<String>,
}

impl OracleError {
    pub fn new(code: i32, message: String) -> Self {
        let hint = match code {
            1017 => Some("Check your username and password.".into()),
            12154 => Some("Verify connection string format: host:port/service_name".into()),
            12170 => Some("Connection timed out. Check network and firewall.".into()),
            12541 => Some("No listener at specified host:port. Verify the address.".into()),
            942 => Some("Table or view does not exist, or you lack permissions.".into()),
            1031 => Some("Insufficient privileges. Contact your DBA.".into()),
            _ => None,
        };
        Self { code, message, hint }
    }
}

fn map_oracle_error(e: oracle::Error) -> OracleError {
    let code = e.oci_error().map(|o| o.code()).unwrap_or(0);
    let message = e.to_string();
    OracleError::new(code, message)
}
```

## Tauri Backend Commands

These commands map directly to the existing `CompareConfigService` in `app/tools/compare-config/service.js`.

### Command Mapping (service.js → Rust)

| Frontend Method | Tauri Command | Description |
|-----------------|---------------|-------------|
| `checkOracleClientReady()` | `check_oracle_client_ready` | Check if IC is loaded |
| `primeOracleClient()` | `prime_oracle_client` | Load IC library |
| `testConnection(config, user, pass)` | `test_oracle_connection` | Validate connection |
| `fetchSchemas(name, config)` | `fetch_schemas` | List available schemas |
| `fetchTables(name, config, owner)` | `fetch_tables` | List tables in schema |
| `fetchTableMetadata(name, config, owner, table)` | `fetch_table_metadata` | Get columns, PKs |
| `compareConfigurations(request)` | `compare_configurations` | Compare two environments |
| `compareRawSql(request)` | `compare_raw_sql` | Compare raw SQL results |
| `exportComparisonResult(result, format)` | `export_comparison_result` | Export to JSON/CSV |
| `setOracleCredentials(name, user, pass)` | `set_oracle_credentials` | Store in Keychain |
| `getOracleCredentials(name)` | `get_oracle_credentials` | Retrieve from Keychain |
| `deleteOracleCredentials(name)` | `delete_oracle_credentials` | Remove from Keychain |
| `hasOracleCredentials(name)` | `has_oracle_credentials` | Check if exists |

### Client Readiness Commands

```rust
#[tauri::command]
fn check_oracle_client_ready() -> Result<bool, String> {
    get_oracle_lib().map(|_| true).map_err(|e| e.message)
}

#[tauri::command]
fn prime_oracle_client() -> Result<(), String> {
    get_oracle_lib().map(|_| ()).map_err(|e| e.message)
}
```

### Connection Commands

```rust
#[tauri::command]
fn test_oracle_connection(
    config: ConnectionConfig,
    username: String,
    password: String,
) -> Result<String, OracleError> {
    let conn = create_connection(&config.connect_string, &username, &password)?;
    // Simple query to verify connection
    conn.query_row_as::<String>("SELECT 'OK' FROM DUAL", &[])?;
    Ok("Connection successful".into())
}

#[tauri::command]
fn fetch_schemas(
    connection_name: String,
    config: ConnectionConfig,
) -> Result<Vec<String>, OracleError> {
    let (username, password) = get_credentials_from_keychain(&connection_name)?;
    let conn = get_pooled_connection(&config.connect_string, &username, &password)?;

    let sql = "SELECT DISTINCT OWNER FROM ALL_TABLES ORDER BY OWNER";
    let rows = conn.query_as::<String>(sql, &[])?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
fn fetch_tables(
    connection_name: String,
    config: ConnectionConfig,
    owner: String,
) -> Result<Vec<String>, OracleError> {
    let (username, password) = get_credentials_from_keychain(&connection_name)?;
    let conn = get_pooled_connection(&config.connect_string, &username, &password)?;

    let sql = "SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :1 ORDER BY TABLE_NAME";
    let rows = conn.query_as::<String>(sql, &[&owner])?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
```

### Table Metadata Command

```rust
#[derive(Serialize)]
struct TableMetadata {
    columns: Vec<ColumnInfo>,
    primary_key: Vec<String>,
}

#[derive(Serialize)]
struct ColumnInfo {
    column_id: i32,
    column_name: String,
    data_type: String,
    data_length: Option<i32>,
    data_precision: Option<i32>,
    data_scale: Option<i32>,
    nullable: bool,
    data_default: Option<String>,
}

#[tauri::command]
fn fetch_table_metadata(
    connection_name: String,
    config: ConnectionConfig,
    owner: String,
    table_name: String,
) -> Result<TableMetadata, OracleError> {
    let safe_owner = validate_identifier(&owner)?;
    let safe_table = validate_identifier(&table_name)?;

    let (username, password) = get_credentials_from_keychain(&connection_name)?;
    let conn = get_pooled_connection(&config.connect_string, &username, &password)?;

    // Fetch columns
    let columns_sql = r#"
        SELECT COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
               DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT
        FROM ALL_TAB_COLUMNS
        WHERE OWNER = :1 AND TABLE_NAME = :2
        ORDER BY COLUMN_ID
    "#;

    // Fetch primary key
    let pk_sql = r#"
        SELECT cc.COLUMN_NAME
        FROM ALL_CONSTRAINTS cons
        JOIN ALL_CONS_COLUMNS cc ON cons.OWNER = cc.OWNER
            AND cons.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE cons.OWNER = :1 AND cons.TABLE_NAME = :2
            AND cons.CONSTRAINT_TYPE = 'P'
        ORDER BY cc.POSITION
    "#;

    // Execute and build response...
}
```

### Comparison Commands

```rust
#[derive(Deserialize)]
struct CompareRequest {
    env1_connection_name: String,
    env1_config: ConnectionConfig,
    env2_connection_name: String,
    env2_config: ConnectionConfig,
    owner: String,
    table_name: String,
    primary_key: Vec<String>,
    fields: Vec<String>,
    where_clause: Option<String>,
    max_rows: Option<u32>,
}

#[derive(Serialize)]
struct CompareResult {
    env1_name: String,
    env2_name: String,
    table: String,
    summary: CompareSummary,
    rows: Vec<CompareRow>,
}

#[tauri::command]
fn compare_configurations(request: CompareRequest) -> Result<CompareResult, OracleError> {
    // Fetch data from both environments
    // Compare rows by primary key
    // Categorize: match, differ, only_in_env1, only_in_env2
    // Return structured result
}

#[derive(Deserialize)]
struct RawSqlRequest {
    env1_connection_name: String,
    env1_config: ConnectionConfig,
    env2_connection_name: String,
    env2_config: ConnectionConfig,
    sql: String,
    primary_key: Option<String>,
    max_rows: Option<u32>,
}

#[tauri::command]
fn compare_raw_sql(request: RawSqlRequest) -> Result<CompareResult, OracleError> {
    // Execute same SQL on both environments
    // Compare results
}
```

### Export Command

```rust
#[derive(Serialize)]
struct ExportData {
    filename: String,
    content: String,
    format: String,
}

#[tauri::command]
fn export_comparison_result(
    result: CompareResult,
    format: String,
) -> Result<ExportData, OracleError> {
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("comparison_{}_{}.{}", result.table, timestamp, format);

    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&result)?,
        "csv" => convert_to_csv(&result)?,
        _ => return Err(OracleError::new(0, "Invalid format".into())),
    };

    Ok(ExportData { filename, content, format })
}
```

### Credential Commands (Keychain)

```rust
use security_framework::passwords::{get_generic_password, set_generic_password, delete_generic_password};

const KEYCHAIN_SERVICE: &str = "com.adtools.oracle";

#[tauri::command]
fn set_oracle_credentials(name: String, username: String, password: String) -> Result<(), String> {
    let account = format!("{}:user", name);
    let pass_account = format!("{}:pass", name);

    set_generic_password(KEYCHAIN_SERVICE, &account, username.as_bytes())
        .map_err(|e| e.to_string())?;
    set_generic_password(KEYCHAIN_SERVICE, &pass_account, password.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_oracle_credentials(name: String) -> Result<(String, String), String> {
    let account = format!("{}:user", name);
    let pass_account = format!("{}:pass", name);

    let username = get_generic_password(KEYCHAIN_SERVICE, &account)
        .map_err(|e| e.to_string())?;
    let password = get_generic_password(KEYCHAIN_SERVICE, &pass_account)
        .map_err(|e| e.to_string())?;

    Ok((
        String::from_utf8(username).map_err(|e| e.to_string())?,
        String::from_utf8(password).map_err(|e| e.to_string())?,
    ))
}

#[tauri::command]
fn delete_oracle_credentials(name: String) -> Result<(), String> {
    let account = format!("{}:user", name);
    let pass_account = format!("{}:pass", name);

    let _ = delete_generic_password(KEYCHAIN_SERVICE, &account);
    let _ = delete_generic_password(KEYCHAIN_SERVICE, &pass_account);

    Ok(())
}

#[tauri::command]
fn has_oracle_credentials(name: String) -> Result<bool, String> {
    let account = format!("{}:user", name);
    Ok(get_generic_password(KEYCHAIN_SERVICE, &account).is_ok())
}
```

### Identifier Validation

```rust
/// Validate Oracle identifier to prevent SQL injection
fn validate_identifier(s: &str) -> Result<String, OracleError> {
    let valid = s.len() <= 128
        && s.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false)
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$' || c == '#');

    if valid {
        Ok(s.to_uppercase())
    } else {
        Err(OracleError::new(0, format!("Invalid identifier: {}", s)))
    }
}
```

## Security & Credentials

### macOS Keychain Storage

Store Oracle credentials per connection in Keychain. Connection metadata (name, connect string) stored in localStorage; only sensitive credentials go to Keychain.

**Storage Strategy:**
- **localStorage**: Connection profiles (name, connect_string, environment label)
- **Keychain**: Username/password pairs, keyed by connection name

This matches the existing `CompareConfigService` interface which stores/retrieves credentials per connection name.

### Security Guidelines

- Never log credentials or include in error messages.
- Use read-only DB users for SELECT operations.
- Connection strings use Easy Connect format: `host:port/service_name`
- No support for TCPS/Wallet initially (can add later if needed).

## Quick Query Integration

### UI Changes

- Add "Fetch Schema" button that calls `oracle_table_properties`.
- Add "Run Locally" button to execute SELECT via `oracle_select_json` or streaming variant.
- Add connection profile dropdown (populated from Keychain).
- Add optional row limit input (default: unlimited, with warning for large results).

### Behavior

- On tool init, call `check_oracle_ready()`.
- If ready, enable Oracle features.
- If not ready (bundled IC failed to load), show error and disable features.

## Jenkins Runner Integration

### Preflight Snapshot (Optional)

- Toggle in UI: "Create local backup before execution"
- Before running MERGE/INSERT/UPDATE, SELECT current data (limited rows).
- Save snapshot to `~/Documents/adtools_library/backups/<schema>.<table>-<timestamp>.json`.

### Snapshot Query

```rust
fn snapshot_table(owner: &str, table: &str, conn: &Connection) -> Result<Vec<serde_json::Value>, OracleError> {
    let safe_owner = validate_identifier(owner)?;
    let safe_table = validate_identifier(table)?;

    // Build query with validated identifiers (not bind variables for identifiers)
    let sql = format!(
        "SELECT * FROM \"{}\".\"{}\" FETCH FIRST 100 ROWS ONLY",
        safe_owner, safe_table
    );

    let rows = conn.query(&sql, &[]).map_err(map_oracle_error)?;
    // ... convert to JSON
}
```

### Behavior When Unavailable

- If Oracle client fails to load, show "Local snapshot unavailable" and allow proceeding.
- Snapshot is optional enhancement, not a blocker.

## Testing & Verification

### Unit Tests

- Mock `OnceLock` initialization to test client-absent scenarios.
- Test identifier validation with edge cases (SQL injection attempts).
- Test error mapping for common Oracle error codes.

### Integration Tests (Local)

- Verify bundled IC loads correctly from app bundle path.
- Test connection pool lifecycle (create, use, idle timeout, reconnect).
- Test streaming with various result sizes (10, 1000, 100000 rows).
- Test Keychain save/load cycle.

### Manual Tests

- Fresh app launch: Oracle features work immediately (no setup).
- Large query: streaming works, memory stays bounded.
- Network timeout: proper error message with hint.
- Invalid credentials: clear error message.

## Known Caveats

### Licensing

- Oracle Instant Client is free to redistribute.
- No user acceptance required since IC is bundled (not downloaded).

### Bundle Size

- Basic Lite adds ~30MB per architecture to app bundle.
- Total app size increase: ~30MB (since builds are per-architecture).

### Complex Datatypes

- LOB, BLOB, RAW: stringify as hex or base64, or return null with warning.
- DATE/TIMESTAMP: return as ISO 8601 string.
- NUMBER: return as string to preserve precision for large numbers.

### Architecture

- arm64 build bundles arm64 IC.
- x86_64 build bundles x86_64 IC.
- Universal binary not recommended (doubles IC size for no benefit).

## Implementation Order

### Phase 1: Core Infrastructure
1. **Bundle Setup**: Add IC files to Tauri build, configure signing.
2. **Backend Core**: Implement `OnceLock` loading, `check_oracle_client_ready`, `prime_oracle_client`.
3. **Connection Pool**: Implement pool with limits and timeouts.
4. **Keychain Commands**: Implement `set/get/delete/has_oracle_credentials`.

### Phase 2: Compare Config Backend (Frontend already exists)
5. **Test Connection**: Implement `test_oracle_connection`.
6. **Schema/Table Fetch**: Implement `fetch_schemas`, `fetch_tables`.
7. **Table Metadata**: Implement `fetch_table_metadata`.
8. **Comparison Logic**: Implement `compare_configurations`, `compare_raw_sql`.
9. **Export**: Implement `export_comparison_result`.
10. **Adapt Installation Guide**: Update UI for bundled IC (error state vs install guide).

### Phase 3: Quick Query Integration
11. **Quick Query UI**: Add connection selector, Run Locally button.
12. **Streaming**: Implement `oracle_select_stream` for large results.

### Phase 4: Jenkins Runner Integration
13. **Jenkins Snapshot**: Add preflight backup toggle and storage.

### Phase 5: Polish
14. **Error Polish**: Refine error messages and hints.
15. **Testing**: Full integration tests.

## Open Questions (Resolved)

| Question                      | Decision                                   |
| ----------------------------- | ------------------------------------------ |
| User-installed vs bundled IC? | **Bundled** - zero setup for users         |
| Basic vs Basic Lite?          | **Basic Lite** - smaller, UTF-8 sufficient |
| Connection pooling?           | **Yes**, max 4 connections                 |
| Result streaming?             | **Yes**, batch size 1000                   |
| Credential storage?           | **macOS Keychain**, per-connection entries |
| Windows support?              | **No**, macOS only                         |
| Compare Config UI?            | **Reuse existing** from e25e4d8 branch     |
