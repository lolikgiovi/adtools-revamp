# Compare Config — Performance Analysis & Enhancement Strategy

> **Date**: 2026-01-30
> **Scope**: `compare-config` tool — frontend, Python sidecar, data flow
> **Constraint**: Oracle Sidecar only (no Oracle Instant Client / Tauri Rust integration)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow](#2-data-flow)
   - [2a. Current Flow](#2a-current-flow-oracle--by-table-mode)
   - [2b. Proposed Flow (Schema-First)](#2b-proposed-flow-schema-first-approach-for-oracle--by-table-mode)
3. [Identified Bottlenecks](#3-identified-bottlenecks)
   - [B1: Sequential Oracle Fetches](#b1-sequential-oracle-fetches-critical)
   - [B2: Python Sidecar Blocks the Event Loop](#b2-python-sidecar-blocks-the-event-loop-critical)
   - [B3: Connection Pool Max Too Small](#b3-connection-pool-max-too-small-critical)
   - [B4: Diff Engine Runs on Main Thread](#b4-diff-engine-runs-on-main-thread-high)
   - [B5: Double Character Diff Computation](#b5-double-character-diff-computation-medium)
   - [B6: JSON Payload Overhead](#b6-json-payload-overhead-medium)
   - [B7: No Batch Query Endpoint](#b7-no-batch-query-endpoint-medium)
   - [B8: No Query Result Caching](#b8-no-query-result-caching-low-medium)
   - [B9: Python Row Conversion Loop](#b9-python-row-conversion-loop-low)
   - [B10: Premature Full Data Fetch (SELECT *)](#b10-premature-full-data-fetch-select--in-table-mode--high)
4. [Enhancement Priority Matrix](#4-enhancement-priority-matrix)
5. [Detailed Fixes](#5-detailed-fixes)
6. [Expected Outcome](#6-expected-outcome)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Frontend  (Vanilla JS + Vite, Web Workers)              │
│  main.js · service.js · diff-engine.js · GridView.js     │
└────────────────────┬─────────────────────────────────────┘
                     │  HTTP fetch() to localhost:21522
┌────────────────────▼─────────────────────────────────────┐
│  Python Sidecar  (FastAPI + uvicorn)                     │
│  oracle_sidecar.py — oracledb 2.x THIN mode             │
│  Connection pooling per unique {user@connect_string}     │
└────────────────────┬─────────────────────────────────────┘
                     │  oracledb thin driver (pure Python)
┌────────────────────▼─────────────────────────────────────┐
│  Oracle Database                                         │
└──────────────────────────────────────────────────────────┘
```

**Key files** (line counts are approximate):

| File | Lines | Role |
|------|------:|------|
| `frontend/tools/compare-config/main.js` | 8,437 | Main tool controller, comparison orchestration |
| `tauri/sidecar/oracle_sidecar.py` | 442 | FastAPI sidecar, connection pooling, query execution |
| `frontend/tools/compare-config/service.js` | 386 | Tauri command wrapper + sidecar API bridge |
| `frontend/tools/compare-config/lib/oracle-sidecar-client.js` | 420 | HTTP client for sidecar |
| `frontend/tools/compare-config/lib/diff-engine.js` | 820 | Row matching, field comparison, character-level diff |
| `frontend/tools/compare-config/lib/diff-worker.js` | 168 | Web Worker for off-thread diffing (**exists but unused**) |
| `frontend/tools/compare-config/lib/diff-worker-manager.js` | 347 | Worker lifecycle + task queuing (**exists but unused**) |
| `frontend/tools/compare-config/lib/unified-data-service.js` | 270 | Abstract data fetching (Oracle / Excel) |
| `frontend/tools/compare-config/views/GridView.js` | ~800 | Excel-style result table with lazy loading |

---

## 2. Current Data Flow

### 2a. Current Flow (Oracle — By Table mode)

```
User clicks "Load Data"
  │
  ├─ 1. Validate source configs
  │
  ├─ 2. Fetch Source A  ──► SELECT * FROM schema.table  ──► sidecar ──► Oracle (BLOCKS)
  │     await ... (fetches ALL columns, ALL rows up to max_rows)
  │
  ├─ 3. Fetch Source B  ──► SELECT * FROM schema.table  ──► sidecar ──► Oracle (BLOCKS)
  │     await ... (fetches ALL columns, ALL rows up to max_rows)
  │
  ├─ 4. Reconcile columns between Source A and Source B
  │
  └─ 5. Show field selection UI (user picks PK + comparison fields)

User clicks "Compare"
  │
  ├─ 6. compareDatasets()  ◄── runs on MAIN THREAD
  │     ├─ buildKeyMaps()          O(n)
  │     ├─ iterate all keys        O(n × fields)
  │     │   └─ computeAdaptiveDiff per differing cell
  │     │       └─ Diff.diffChars() — may run TWICE per cell
  │     └─ sort results            O(n log n)
  │
  └─ 7. Render results (GridView / MasterDetail / VerticalCard)
```

Steps 2–3 fetch **all columns** via `SELECT *`, even though the user will only compare a subset. Steps 2–3 are **sequential**. Step 6 is **synchronous on the main thread**.

### 2b. Proposed Flow (Schema-First approach for Oracle — By Table mode)

```
User clicks "Load Data"
  │
  ├─ 1. Validate source configs
  │
  ├─ 2. Fetch Source A schema  ──► SELECT column_name, data_type, nullable
  │     FROM all_tab_columns  (~milliseconds, metadata only)
  │
  ├─ 3. Fetch Source B schema  (same, ~milliseconds)
  │
  ├─ 4. Reconcile columns between Source A and Source B
  │
  └─ 5. Show field selection UI (user picks PK + comparison fields)

User clicks "Compare"
  │
  ├─ 6. Fetch Source A  ──► SELECT pk, field1, field2 FROM schema.table
  │     (only selected columns)
  │
  ├─ 7. Fetch Source B  (same, only selected columns)
  │
  ├─ 8. compareDatasets()
  │
  └─ 9. Render results
```

**Key change**: "Load Data" fetches **only table metadata** (column names/types). The actual data fetch is deferred to "Compare" and uses a targeted `SELECT` with only the PK and comparison fields. This eliminates wasted bandwidth, memory, and DB work for unused columns.

---

## 3. Identified Bottlenecks

### B1: Sequential Oracle Fetches — CRITICAL

**Location**: `main.js` — `executeComparison()` (~line 2775), `executeRawSqlComparison()` (~line 2913), `loadUnifiedData()` (~line 6869)

Source A and Source B are fetched with sequential `await`:

```js
const dataEnv1 = await CompareConfigService.fetchOracleDataViaSidecar({...});
// ↑ waits for completion before starting Env2

const dataEnv2 = await CompareConfigService.fetchOracleDataViaSidecar({...});
```

**Impact**: Total fetch time = `Env1_time + Env2_time`. If each takes 3 s, user waits 6 s. With parallel execution it would be ~3 s.

> Note: Excel file parsing already uses `Promise.all()` (~line 1922). Oracle fetches do not.

---

### B2: Python Sidecar Blocks the Event Loop — CRITICAL

**Location**: `oracle_sidecar.py:283–338` (`/query`), `oracle_sidecar.py:341–395` (`/query-dict`)

The FastAPI endpoints are declared `async` but call **synchronous** `oracledb` operations:

```python
@app.post("/query-dict")
async def execute_query_dict(request: QueryRequest):
    pool = pool_manager.get_pool(request.connection)   # sync — blocks event loop
    with pool.acquire() as conn:                        # sync — blocks event loop
        cursor = conn.cursor()
        cursor.execute(request.sql)                     # sync — blocks event loop
        rows = cursor.fetchmany(request.max_rows)       # sync — blocks event loop
```

Because `uvicorn` runs a single-threaded asyncio event loop by default, **synchronous calls inside `async def` block all other requests**. Even if the frontend sends two HTTP requests in parallel, the sidecar processes them one at a time.

**Impact**: Completely negates any frontend-side parallelization (B1 fix is useless without this fix).

---

### B3: Connection Pool Max Too Small — CRITICAL

**Location**: `oracle_sidecar.py:39–40`

```python
POOL_MIN = 1
POOL_MAX = 2
```

When Source A and Source B target the **same** database (common for config comparison across schemas), they share one pool with only 2 connection slots. With parallel queries, one query may block waiting for a free connection.

**Impact**: Bottleneck when comparing two schemas on the same database in parallel.

---

### B4: Diff Engine Runs on Main Thread — HIGH

**Location**: `main.js` calls `compareDatasets()` directly from `diff-engine.js`

```js
// main.js — synchronous on main thread
const jsResult = compareDatasets(dataEnv1.rows, dataEnv2.rows, {
  keyColumns: pkColumns,
  fields: this.selectedFields || dataEnv1.headers,
  normalize: false,
  matchMode: "key",
});
```

The `DiffWorkerManager` + `diff-worker.js` infrastructure is **fully implemented** but **never invoked** in any comparison entry point. For datasets with 1000+ rows and many columns, the main thread is blocked during:

- Key map construction — O(n)
- Row-by-row field comparison — O(n × fields)
- Character-level diffing per differing cell — O(text_length) via Myers algorithm (jsdiff)
- Final sort — O(n log n)

**Impact**: UI freezes during comparison. No spinner animation, no responsiveness.

---

### B5: Double Character Diff Computation — MEDIUM

**Location**: `diff-engine.js:153–189` (`computeAdaptiveDiff`)

`computeAdaptiveDiff()` runs `Diff.diffChars()` **twice** for cells with small differences:

1. **First call**: `calculateChangeRatio()` (line 168) internally runs `Diff.diffChars()` to measure the ratio.
2. **Second call**: If `changeRatio <= threshold`, `computeCharDiff()` (line 186) runs `Diff.diffChars()` **again** to get the segments.

```js
const changeRatio = calculateChangeRatio(oldVal, newVal);  // ← diffChars() #1
if (changeRatio > threshold) {
  return { type: 'cell-diff', ... };
} else {
  return { type: 'char-diff', segments: computeCharDiff(oldVal, newVal) };
  //                                    ↑ diffChars() #2 — redundant
}
```

**Impact**: ~2x CPU time for the diff phase on cells with small changes (the most common case in config comparison).

---

### B6: JSON Payload Overhead — MEDIUM

**Location**: `oracle_sidecar.py:341` (`/query-dict`), `oracle-sidecar-client.js:266` (`queryAsDict`)

The `/query-dict` endpoint returns rows as objects with **column names repeated per row**:

```json
{
  "rows": [
    {"ID": 1, "NAME": "foo", "STATUS": "active", "REGION": "US", ...},
    {"ID": 2, "NAME": "bar", "STATUS": "active", "REGION": "EU", ...}
  ]
}
```

For 500 rows x 20 columns, column names are serialized **10,000 times**. The `/query` endpoint already returns a compact array-of-arrays format but is not used for main data fetches.

**Impact**: ~30–50% larger JSON payloads than necessary. Slower serialization in Python, slower parsing in JS, more memory.

---

### B7: No Batch Query Endpoint — MEDIUM

Each source requires a **separate** HTTP round-trip:

```
Frontend  ──POST /query-dict──►  Sidecar  (Source A)
Frontend  ──POST /query-dict──►  Sidecar  (Source B)
```

There is no endpoint to submit both queries in a single request and let the sidecar handle parallelism internally.

**Impact**: Extra HTTP overhead (connection setup, headers, serialization). Missed opportunity to let the sidecar optimize execution order.

---

### B8: No Query Result Caching — LOW-MEDIUM

IndexedDB is used for preferences and comparison history (`indexed-db-manager.js`) but **not** for caching raw query results. Re-running the same comparison re-fetches all data from Oracle.

**Impact**: Repeated comparisons with the same parameters hit the database every time.

---

### B9: Python Row Conversion Loop — LOW

**Location**: `oracle_sidecar.py:310–322`

```python
for row in rows:
    result_row = []
    for val in row:
        if val is None: ...
        elif isinstance(val, (int, float, str, bool)): ...
        elif isinstance(val, datetime): ...
        else: result_row.append(str(val))
```

Pure Python iteration with `isinstance()` checks on every cell. For 10,000 rows x 20 columns = 200,000 type checks.

**Impact**: Marginal — Python overhead is small relative to network + DB time, but it adds up for large result sets.

---

### B10: Premature Full Data Fetch (`SELECT *`) in Table Mode — HIGH

**Location**: `unified-data-service.js:114` (passes `fields: null`), `service.js:368` (builds `SELECT *`)

In Oracle — By Table mode, `loadUnifiedData()` fetches **all rows with all columns** before the user has selected which fields to compare:

```js
// unified-data-service.js — fields is always null on initial load
const request = {
  ...
  fields: config.fields || null,   // ← null → SELECT *
  max_rows: config.maxRows || 1000,
};

// service.js — builds SELECT *
const fieldList = fields && fields.length > 0 ? fields.join(", ") : "*";
querySql = `SELECT ${fieldList} FROM ${owner}.${table_name}${whereClause}`;
```

For a table with 50 columns where the user only needs to compare 5, **90% of the fetched data is discarded**. The unused columns consume:

- **Oracle server resources**: Full table scan or wide index access instead of narrow index-only scan
- **Network bandwidth**: 10× more data transferred through sidecar JSON responses
- **Browser memory**: Row objects carry all 50 fields until comparison completes
- **Sidecar CPU**: Type conversion for every cell in every unused column (see B9)

Meanwhile, `fetchTableMetadataViaSidecar()` (`service.js:325`) already queries `all_tab_columns` and returns column names, types, and nullability in ~milliseconds — but is **never called** in the unified comparison flow.

**Impact**: Proportional to `(total_columns - compared_columns) / total_columns`. For wide tables (20–100+ columns), this is the single largest source of wasted work. Also makes the "Load Data" step feel slow when it could be near-instant.

> **Note**: This optimization applies **only** to `oracle-table` mode. For `oracle-sql` mode, columns aren't known until the query runs. For `excel` mode, the file is already local.

---

## 4. Enhancement Priority Matrix

| Priority | ID | Enhancement | Effort | Impact | Estimated Speedup | Status |
|:--------:|:--:|-------------|:------:|:------:|:------:|:------:|
| **P0** | B10 | Schema-first approach — defer data fetch until after field selection | Medium | Critical | Near-instant "Load Data"; fetch only needed columns | **Done** |
| **P0** | B1 | Parallel Oracle fetches (`Promise.all`) | Small | Critical | ~2x on fetch phase | **Done** |
| **P0** | B2 | `run_in_executor()` in sidecar endpoints | Small | Critical | Unblocks parallel fetches | **Done** |
| **P0** | B3 | Increase `POOL_MAX` to 5 | Trivial | Critical | Enables parallel connections | **Done** |
| **P1** | B4 | Use `DiffWorkerManager` for diffing | Small | High | UI stays responsive | **Done** |
| **P1** | B5 | Fix double `diffChars()` computation | Small | Medium | ~2x for diff phase on changed cells | **Done** |
| **P2** | B6 | Use `/query` array format + client-side dict conversion | Small | Medium | ~30–50% less JSON payload | |
| **P2** | B7 | Add `/query-batch` endpoint | Medium | Medium | Eliminates extra HTTP round-trip | |
| **P3** | B8 | Query result caching in IndexedDB | Medium | Low-Med | Instant on re-runs | |
| **P3** | B9 | `cursor.outputtypehandler` for row conversion | Small | Low | Faster Python serialization | |

**~~B10 should be implemented first~~** ✅ Done — "Load Data" now fetches only metadata for oracle-table mode; actual `SELECT` is deferred to "Compare" with only the user-selected columns.

**~~P0 items B1–B3 are interdependent~~** ✅ Done — all three applied together. Sidecar uses `run_in_executor` with a 4-worker thread pool, pool max raised to 5, and all frontend fetch sites use `Promise.all` (4 locations including bulk query with `Promise.allSettled`).

**~~P1 items B4–B5~~** ✅ Done — All 4 `compareDatasets()` call sites (Excel, Oracle Table, Raw SQL, Unified) now use `DiffWorkerManager` to run diffs on a Web Worker, keeping the UI responsive with progress reporting. `computeAdaptiveDiff()` now runs `Diff.diffChars()` once and reuses the result for both ratio calculation and segment generation.

---

## 5. Detailed Fixes

### Fix B10 — Schema-First Approach (Defer Data Fetch to Compare)

**Goal**: "Load Data" fetches only table metadata; actual row data is fetched at "Compare" time with only the selected columns.

**Scope**: Oracle — By Table mode only. Oracle SQL and Excel modes are unchanged.

#### Step 1: `loadUnifiedData()` — fetch schema instead of data

**File**: `main.js`

For Oracle Table sources, replace the data fetch with a metadata fetch:

```js
// BEFORE — fetches all rows with SELECT *
const dataA = await this.fetchUnifiedSourceData("A");
this.unified.sourceA.data = dataA;

// AFTER — fetches schema only (column names, types, nullability)
if (config.type === "oracle" && config.queryMode === "table") {
  const metadata = await CompareConfigService.fetchTableMetadataViaSidecar(
    config.connection.name, config.connection, config.schema, config.table
  );
  // Build a lightweight dataset with headers only (no rows)
  this.unified.sourceA.schema = metadata.columns;  // [{name, data_type, nullable}]
  this.unified.sourceA.data = {
    headers: metadata.columns.map(c => c.name),
    rows: [],
    metadata: {
      sourceName: `(${config.connection.name}) ${config.schema}.${config.table}`,
      rowCount: null,  // unknown until Compare
      columnCount: metadata.columns.length,
      sourceType: 'oracle-table',
    },
  };
  this.unified.sourceA.dataLoaded = false;  // data not yet loaded, only schema
  this.unified.sourceA.schemaLoaded = true;
} else {
  // Excel / Oracle SQL — fetch full data as before
  const dataA = await this.fetchUnifiedSourceData("A");
  this.unified.sourceA.data = dataA;
  this.unified.sourceA.dataLoaded = true;
}
```

Repeat for Source B. The reconciliation UI is then driven by the headers from the schema, not from fetched data.

#### Step 2: `executeUnifiedComparison()` — fetch data with selected fields

**File**: `main.js`

Before running the diff, fetch the actual data using only the selected columns:

```js
async executeUnifiedComparison() {
  const { selectedPkFields, selectedCompareFields } = this.unified;
  const fieldsToFetch = [...new Set([...selectedPkFields, ...selectedCompareFields])];

  // Fetch data for Oracle Table sources that only have schema loaded
  for (const sourceKey of ["sourceA", "sourceB"]) {
    const config = this.unified[sourceKey];
    if (config.schemaLoaded && !config.dataLoaded) {
      const sourceConfig = {
        type: SourceType.ORACLE_TABLE,
        connection: config.connection,
        schema: config.schema,
        table: config.table,
        whereClause: config.whereClause,
        maxRows: config.maxRows,
        fields: fieldsToFetch,  // ← only the needed columns
      };
      const data = await UnifiedDataService.fetchData(sourceConfig);
      this.unified[sourceKey].data = data;
      this.unified[sourceKey].dataLoaded = true;
    }
  }

  // ... proceed with comparison as before
}
```

#### Step 3: `fetchOracleTableData()` — pass fields through

**File**: `unified-data-service.js`

The `fields` parameter is already supported but always passed as `null`. Pass it through:

```js
const request = {
  ...
  fields: config.fields || null,  // now populated with selected columns
  ...
};
```

No change needed — just ensure the caller passes `fields` in the config.

#### Step 4: `fetchOracleDataViaSidecar()` — already handles field lists

**File**: `service.js`

The existing logic already builds `SELECT field1, field2 FROM ...` when `fields` is non-empty:

```js
const fieldList = fields && fields.length > 0 ? fields.join(", ") : "*";
```

No change needed.

#### Step 5: UI adjustments

- "Load Data" button label/progress should say "Loading schema..." instead of "Loading..." for Oracle Table sources
- Source preview after schema load should show column count instead of row count (rows are unknown)
- "Compare" button progress should show "Fetching data..." before "Comparing..."
- The field selection UI works identically — it receives headers from the schema instead of from fetched data

#### Scope exclusions

- **Oracle SQL mode**: Unchanged. The query must run to discover columns.
- **Excel mode**: Unchanged. The file is local and must be parsed to discover columns.
- **Mixed mode** (Oracle Table + Excel): The Oracle side uses schema-first; the Excel side loads fully. Reconciliation works the same since both produce `headers`.

---

### Fix B1 — Parallel Oracle Fetches

**Files**: `main.js` (3 locations)

Replace sequential awaits with `Promise.all`:

```js
// BEFORE (sequential)
const dataEnv1 = await CompareConfigService.fetchOracleDataViaSidecar({...});
const dataEnv2 = await CompareConfigService.fetchOracleDataViaSidecar({...});

// AFTER (parallel)
const [dataEnv1, dataEnv2] = await Promise.all([
  CompareConfigService.fetchOracleDataViaSidecar({/* Source A config */}),
  CompareConfigService.fetchOracleDataViaSidecar({/* Source B config */}),
]);
```

Apply in:
- `executeComparison()` (~line 2775)
- `executeRawSqlComparison()` (~line 2913)
- `loadUnifiedData()` (~line 6869)

---

### Fix B2 — Unblock the Sidecar Event Loop

**File**: `oracle_sidecar.py`

Offload blocking DB operations to a thread pool:

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=4)


def _execute_query_sync(request: QueryRequest, as_dict: bool = False):
    """Synchronous query execution — runs in thread pool."""
    import time
    start_time = time.perf_counter()

    pool = pool_manager.get_pool(request.connection)

    with pool.acquire() as conn:
        cursor = conn.cursor()
        cursor.arraysize = 500
        cursor.execute(request.sql)

        columns = [col[0] for col in cursor.description] if cursor.description else []

        if request.max_rows:
            rows = cursor.fetchmany(request.max_rows)
        else:
            rows = cursor.fetchall()

        # Convert rows (same logic as current)
        if as_dict:
            result_rows = [
                {columns[i]: _convert_value(val) for i, val in enumerate(row)}
                for row in rows
            ]
        else:
            result_rows = [
                [_convert_value(val) for val in row]
                for row in rows
            ]

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        return {
            "columns": columns,
            "rows": result_rows,
            "row_count": len(result_rows),
            "execution_time_ms": round(elapsed_ms, 2),
        }


def _convert_value(val):
    if val is None:
        return None
    if isinstance(val, (int, float, str, bool)):
        return val
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val)


@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(executor, _execute_query_sync, request, False)
        return QueryResponse(**result)
    except oracledb.Error as e:
        error = oracle_error_to_response(e)
        raise HTTPException(status_code=400, detail=error.model_dump())
    except Exception as e:
        logger.exception("Query execution failed")
        raise HTTPException(status_code=500, detail={"code": 0, "message": str(e)})


@app.post("/query-dict")
async def execute_query_dict(request: QueryRequest):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(executor, _execute_query_sync, request, True)
        return result
    except oracledb.Error as e:
        error = oracle_error_to_response(e)
        raise HTTPException(status_code=400, detail=error.model_dump())
    except Exception as e:
        logger.exception("Query execution failed")
        raise HTTPException(status_code=500, detail={"code": 0, "message": str(e)})
```

---

### Fix B3 — Increase Pool Max

**File**: `oracle_sidecar.py`

```python
# BEFORE
POOL_MIN = 1
POOL_MAX = 2

# AFTER
POOL_MIN = 1
POOL_MAX = 5
```

---

### Fix B4 — Use the Web Worker for Diffing

**File**: `main.js`

```js
import { getDiffWorkerManager } from './lib/diff-worker-manager.js';

// In executeComparison(), executeRawSqlComparison(), executeUnifiedComparison():
const workerManager = getDiffWorkerManager();
const jsResult = await workerManager.compareDatasets(dataEnv1.rows, dataEnv2.rows, {
  keyColumns: pkColumns,
  fields: this.selectedFields || dataEnv1.headers,
  normalize: false,
  matchMode: "key",
  onProgress: (progress) => {
    this.updateProgressStep("compare", "active",
      `Comparing rows... ${progress.percent}%`);
  },
});
```

---

### Fix B5 — Eliminate Redundant diffChars

**File**: `diff-engine.js`

```js
export function computeAdaptiveDiff(oldStr, newStr, options = {}) {
  const threshold = options.threshold ?? CHANGE_THRESHOLD;
  const oldVal = String(oldStr ?? '');
  const newVal = String(newStr ?? '');

  if (oldVal === newVal) {
    return { type: 'unchanged', changed: false, segments: null };
  }

  // Run diffChars ONCE
  const diffParts = Diff.diffChars(oldVal, newVal);

  // Calculate ratio from the same result
  let changedChars = 0;
  let totalChars = 0;
  for (const part of diffParts) {
    const len = part.value.length;
    if (part.added || part.removed) {
      changedChars += len;
    }
    totalChars += len;
  }
  const changeRatio = totalChars > 0 ? changedChars / totalChars : 0;

  if (changeRatio > threshold) {
    return {
      type: 'cell-diff',
      changed: true,
      changeRatio,
      oldValue: oldVal,
      newValue: newVal,
      segments: null,
    };
  }

  // Reuse diffParts — no second diffChars call
  return {
    type: 'char-diff',
    changed: true,
    changeRatio,
    segments: diffParts.map(part => ({
      type: part.added ? DiffType.INSERT : part.removed ? DiffType.DELETE : DiffType.EQUAL,
      value: part.value,
    })),
  };
}
```

---

### Fix B6 — Use Array Format + Client-Side Dict Conversion

**File**: `service.js`

```js
static async fetchOracleDataViaSidecar(request) {
  const { connection_name, config, mode, owner, table_name, where_clause, fields, sql, max_rows = 1000 } = request;

  let querySql;
  let sourceName;

  if (mode === "raw-sql") {
    querySql = sql.trim().replace(/;+$/, "");
    sourceName = "SQL Query";
  } else {
    const fieldList = fields && fields.length > 0 ? fields.join(", ") : "*";
    const whereClause = where_clause ? ` WHERE ${where_clause}` : "";
    querySql = `SELECT ${fieldList} FROM ${owner}.${table_name}${whereClause}`;
    sourceName = `${owner}.${table_name}`;
  }

  // Use /query (array format) instead of /query-dict — smaller payload
  const result = await this.queryViaSidecar(connection_name, config, querySql, max_rows);

  // Convert to dicts client-side (fast in JS, avoids repeated column names in JSON)
  const columns = result.columns;
  const rows = result.rows.map(row =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  );

  return {
    headers: columns,
    rows,
    row_count: result.row_count,
    source_name: sourceName,
  };
}
```

---

### Fix B7 — Batch Query Endpoint

**File**: `oracle_sidecar.py`

```python
class BatchQueryRequest(BaseModel):
    queries: list[QueryRequest]


@app.post("/query-batch")
async def execute_batch(request: BatchQueryRequest):
    """Execute multiple queries in parallel, return all results."""
    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(executor, _execute_query_sync, q, False)
        for q in request.queries
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    response = []
    for r in results:
        if isinstance(r, Exception):
            response.append({"error": str(r)})
        else:
            response.append(r)

    return {"results": response}
```

---

### Fix B8 — Query Result Caching

**File**: `indexed-db-manager.js` — add a new store; `service.js` — add cache logic.

Cache key: `SHA-256(connection_name + connect_string + sql + max_rows)`
TTL: 5 minutes (configurable).
Eviction: LRU or time-based, max 20 entries.

Expose a "Refresh" toggle in the UI to bypass cache when the user wants fresh data.

---

### Fix B9 — Output Type Handler

**File**: `oracle_sidecar.py`

```python
def output_type_handler(cursor, metadata):
    """Let oracledb handle type conversion at the C level."""
    if metadata.type_code == oracledb.DB_TYPE_CLOB:
        return cursor.var(str, arraysize=cursor.arraysize)
    if metadata.type_code in (oracledb.DB_TYPE_DATE, oracledb.DB_TYPE_TIMESTAMP):
        return cursor.var(str, arraysize=cursor.arraysize)

# Apply when acquiring connections:
with pool.acquire() as conn:
    conn.outputtypehandler = output_type_handler
    # ... execute query ...
```

This moves type conversion from Python loops into the oracledb driver's C layer.

---

## 6. Expected Outcome

### Before (Current State)

```
"Load Data":
  Schema A:  (not fetched separately)
  Schema B:  (not fetched separately)
  Fetch A:   ████████░░░░░░░░  3.0 s   SELECT * (all 50 columns)
  Fetch B:   ░░░░░░░░████████  3.0 s   SELECT * (all 50 columns, waits for A)
  Reconcile: ░░░░░░░░░░░░░░░░█  0.1 s
  Total:     ═════════════════  6.1 s

User selects 5 fields... (45 columns fetched for nothing)

"Compare":
  Diff:      ██████  2.0 s  (blocks UI)
  Total:     ══════  2.0 s

Overall:   8.1 s, UI frozen during diff.
```

### After (B10 + B1–B3 + P1 Applied)

```
"Load Data":
  Schema A:  █  0.05 s  ─┐
  Schema B:  █  0.05 s  ─┤ parallel metadata queries
  Reconcile: █  0.01 s  ◄┘
  Total:     ═  ~0.1 s   (near-instant)

User selects 5 fields...

"Compare":
  Fetch A:   ████░░░░  1.5 s  ─┐  SELECT pk, f1, f2, f3, f4 (5 columns only)
  Fetch B:   ████░░░░  1.5 s  ─┤  parallel fetches
                                │
  Diff:      ░░░░██░░  0.5 s  ◄┘  (worker thread, fewer fields to compare)
  Total:     ════════   2.0 s

Overall:   ~2.1 s, UI responsive throughout.
```

**~75% reduction in wall-clock time** for Oracle — By Table comparisons on wide tables. "Load Data" drops from ~6 s to ~0.1 s. The data fetch at "Compare" time is faster because it transfers only the needed columns, and the diff processes fewer fields.
