# Compare Config Feature Documentation

Welcome to the Compare Config feature documentation. This feature enables comparison of Oracle database configuration tables between different environments.

---

## 📚 Documentation Index

### Main Specification
- **[COMPARE-CONFIG-FEATURE.md](./COMPARE-CONFIG-FEATURE.md)** - Complete technical specification (v3.0)
  - System architecture
  - Data models
  - Implementation details for all phases
  - Testing strategies
  - Deployment plan

### Implementation Progress
- **[IMPLEMENTATION-PROGRESS.md](./IMPLEMENTATION-PROGRESS.md)** - Overall project progress tracker
  - Phase status overview
  - Completion metrics
  - Risk assessment
  - Change log

### Phase Documentation
- **[PHASE-3-IMPLEMENTATION.md](./PHASE-3-IMPLEMENTATION.md)** - Schema & Table Discovery (Nov 8, 2025) ✅
  - Backend implementation details
  - Frontend implementation details
  - Architecture decisions
  - Testing results

### Coming Soon
- **PHASE-1-IMPLEMENTATION.md** - Oracle Client Integration & Foundation
- **PHASE-2-IMPLEMENTATION.md** - Connection Management (Settings Integration)
- **PHASE-4-IMPLEMENTATION.md** - Data Fetching & Comparison Engine
- **PHASE-5-IMPLEMENTATION.md** - Results Display & Export
- **PHASE-6-IMPLEMENTATION.md** - Integration & Testing

---

## 🎯 Feature Overview

The Compare Config feature allows users to:

1. **Connect to Oracle Databases** - Securely connect to multiple Oracle database instances
2. **Browse Schemas & Tables** - Discover available schemas and tables in each database
3. **Configure Comparisons** - Select tables and fields to compare with optional WHERE clauses
4. **View Differences** - See side-by-side configuration differences with visual highlighting
5. **Export Results** - Export comparison results to JSON or CSV formats

---

## 🏗️ Architecture

### Technology Stack

**Backend (Rust + Tauri)**
- Rust with Tauri 2.x framework
- `oracle` crate (0.6+) for database connectivity
- `keyring` crate for credential storage
- `libloading` for Oracle client management

**Frontend (Vanilla JavaScript)**
- ES6+ modules
- BaseTool architecture
- EventBus communication
- localStorage for configuration

**Database**
- Oracle Database 11g+ (via Oracle Instant Client)
- Read-only access required

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                 Frontend (Vanilla JS)                       │
│  app/tools/compare-config/                                  │
│  ├─ main.js              (Tool controller)                  │
│  ├─ service.js           (Business logic)                   │
│  ├─ template.js          (HTML templates)                   │
│  └─ styles.css           (Component styles)                 │
└─────────────────────────────────────────────────────────────┘
                            ↕ Tauri IPC
┌─────────────────────────────────────────────────────────────┐
│                 Backend (Rust - Tauri)                      │
│  src-tauri/src/oracle/                                      │
│  ├─ client.rs            (Oracle client management)         │
│  ├─ connection.rs        (Database connections)             │
│  ├─ comparison.rs        (Comparison engine)                │
│  ├─ commands.rs          (Tauri command handlers)           │
│  └─ models.rs            (Data structures)                  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                 Oracle Instant Client                       │
│  ~/Documents/adtools_library/oracle_instantclient/          │
│  └─ libclntsh.dylib      (Loaded at runtime)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Current Status (as of November 8, 2025)

### Completed Phases

#### Phase 1: Oracle Client Integration & Foundation ✅
- Oracle Instant Client detection and loading
- Installation guide with one-line install script
- Graceful degradation when client not installed

#### Phase 2: Connection Management ✅
- Settings page integration for Oracle connections
- Secure keychain storage via macOS Keychain
- Connection testing functionality
- CRUD operations for connections

#### Phase 3: Schema & Table Discovery ✅
- Schema browsing with system schema filtering
- Table browsing for selected schemas
- Table metadata fetching (columns, primary keys)
- Progressive disclosure UI (connection → schema → table)
- Field selection interface

### Upcoming Phases

#### Phase 4: Data Fetching & Comparison Engine ⏳ (Next)
- Record fetching with WHERE clause support
- Data sanitization for Oracle types
- LCS-based diff algorithm
- Comparison engine implementation

#### Phase 5: Results Display & Export ⏳
- Multiple view modes (Expandable, Card, Master-Detail)
- Diff highlighting with color coding
- JSON and CSV export

#### Phase 6: Integration & Testing ⏳
- End-to-end testing
- Performance optimization
- Documentation completion

---

## 📊 Progress Metrics

- **Phases Complete:** 3 / 6 (50%)
- **Backend Components:** 60% complete
- **Frontend Components:** 60% complete
- **Testing:** 30% complete
- **Target Completion:** Late November 2025

---

## 🔑 Key Features

### 1. Optional Oracle Client Integration
The Oracle Instant Client is **not bundled** with AD Tools. Users who want to use this feature must install it separately using our one-line install script:

```bash
curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash
```

The app remains fully functional without the Oracle client.

### 2. Secure Credential Management
Credentials are stored in the macOS Keychain and never exposed to the frontend:
- Username/password stored per connection
- Backend retrieves credentials on demand
- No credentials in localStorage or memory

### 3. Progressive Disclosure UX
Clear workflow with cascading dropdowns:
1. Select connections for both environments
2. Select schema (enabled after connection)
3. Select table (enabled after schema)
4. Select fields (shown after table)
5. Execute comparison

### 4. System Schema Filtering
Automatically filters out 18 common Oracle system schemas:
```
SYS, SYSTEM, OUTLN, DBSNMP, APPQOSSYS, WMSYS, EXFSYS, CTXSYS,
XDB, ANONYMOUS, ORDSYS, ORDDATA, MDSYS, LBACSYS, DVSYS, DVF,
AUDSYS, OJVMSYS, GSMADMIN_INTERNAL
```

### 5. Flexible Comparison Options
- **WHERE Clause:** Filter records before comparison
- **Field Selection:** Compare all fields or select specific ones
- **Primary Key Detection:** Automatic PK identification for record matching

---

## 🧪 Testing

### Unit Tests
All backend unit tests passing:
```bash
$ cargo test --lib oracle
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured
```

### Integration Tests
Integration tests require a running Oracle database. See testing documentation for setup instructions.

### Manual Testing
See [PHASE-3-IMPLEMENTATION.md](./PHASE-3-IMPLEMENTATION.md#manual-testing-checklist) for the manual testing checklist.

---

## 🛠️ Development

### Prerequisites
- Rust 1.70+
- Node.js 18+
- Oracle Instant Client (for testing)

### Build
```bash
# Backend
cd src-tauri
cargo build

# Frontend
npm run dev
```

### Test
```bash
# Backend tests
cd src-tauri
env DYLD_LIBRARY_PATH=~/Documents/adtools_library/oracle_instantclient cargo test

# Frontend tests
npm test
```

---

## 📖 API Reference

### Backend Commands

#### `check_oracle_client_ready() -> bool`
Checks if Oracle Instant Client is installed and ready.

#### `prime_oracle_client() -> Result<(), String>`
Loads the Oracle client library into memory.

#### `test_oracle_connection_saved(connection_name: String, config: ConnectionConfig) -> Result<String, String>`
Tests a database connection using saved credentials.

#### `fetch_schemas(connection_name: String, config: ConnectionConfig) -> Result<Vec<String>, String>`
Fetches available schemas from a database.

#### `fetch_tables(connection_name: String, config: ConnectionConfig, owner: String) -> Result<Vec<String>, String>`
Fetches tables for a specific schema.

#### `fetch_table_metadata(connection_name: String, config: ConnectionConfig, owner: String, table_name: String) -> Result<TableMetadata, String>`
Fetches metadata for a specific table.

### Data Models

See [models.rs](../../src-tauri/src/oracle/models.rs) for complete type definitions:
- `ConnectionConfig`
- `Credentials`
- `TableMetadata`
- `ColumnInfo`
- `ComparisonRequest`
- `ComparisonResult`
- `ComparisonSummary`
- `ConfigComparison`
- `ComparisonStatus`
- `FieldDifference`
- `DiffChunk`
- `DiffChunkType`

---

## 🔐 Security

### Credential Storage
- Credentials stored in macOS Keychain
- Service name: `adtools.oracle.<connection_name>`
- Separate entries for username and password

### SQL Injection Prevention
- Parameterized queries for all user input
- WHERE clause validation (read-only operations only)
- No direct SQL construction from user input

### Data Sanitization
- Control character removal
- Size limits (10MB strings, 1MB CLOBs)
- Binary data markers for BLOB/RAW types

---

## 🐛 Known Issues

None currently. The feature is in active development.

---

## 🤝 Contributing

This feature is part of the AD Tools project. For contribution guidelines, see the main project README.

---

## 📝 License

Same license as AD Tools project.

---

## 📞 Support

For issues or questions:
1. Check the troubleshooting guide in the app
2. Review the [COMPARE-CONFIG-FEATURE.md](./COMPARE-CONFIG-FEATURE.md) specification
3. Consult the implementation documentation for your specific phase

---

## 📅 Version History

### v3.0 (November 8, 2025)
- ✅ Phase 3 complete: Schema & Table Discovery
- Added schema browsing functionality
- Added table browsing functionality
- Added table metadata fetching
- Implemented progressive disclosure UI

### v2.0 (November 7, 2025)
- ✅ Phase 2 complete: Connection Management
- Settings page integration
- Keychain credential storage
- Connection testing

### v1.0 (November 7, 2025)
- ✅ Phase 1 complete: Oracle Client Integration
- Initial project structure
- Oracle client detection and loading
- Installation guide

---

## 🗺️ Roadmap

- **November 2025:** Complete Phases 4-6
- **December 2025:** Production release
- **Future:** Cross-database support (PostgreSQL, MySQL)

---

**Last Updated:** November 8, 2025
**Maintained By:** AD Tools Development Team
