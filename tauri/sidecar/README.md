# Oracle Sidecar

A Python-based Oracle database connector that runs as a Tauri sidecar. This approach avoids the complexity of bundling Oracle Instant Client with the app.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri App                              │
│  ┌──────────────┐     HTTP      ┌────────────────────────┐  │
│  │   Frontend   │ ──────────────▶  Python Sidecar       │  │
│  │   (Vite)     │  localhost    │  (FastAPI + oracledb) │  │
│  └──────────────┘   :21521      └──────────┬─────────────┘  │
│                                             │               │
│  ┌──────────────┐                          │               │
│  │ Rust Backend │ manages lifecycle        │               │
│  │   (Tauri)    │ (start/stop)             │               │
│  └──────────────┘                          ▼               │
└────────────────────────────────────────────────────────────┘
                                             │
                                    Oracle TNS (thin mode)
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │  Oracle Database │
                                    └─────────────────┘
```

**Key advantage**: The `oracledb` Python library has a "thin mode" that connects directly to Oracle without needing Oracle Instant Client libraries!

## Setup (Development)

### 1. Create Python virtual environment

```bash
cd tauri/sidecar
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Run the sidecar manually (for development)

```bash
python oracle_sidecar.py
```

The server starts on `http://127.0.0.1:21521`

### 3. Test the API

```bash
# Health check
curl http://127.0.0.1:21521/health

# Test connection
curl -X POST http://127.0.0.1:21521/test-connection \
  -H "Content-Type: application/json" \
  -d '{"connection": {"name": "DEV", "connect_string": "host:1521/service", "username": "user", "password": "pass"}}'

# Execute query
curl -X POST http://127.0.0.1:21521/query \
  -H "Content-Type: application/json" \
  -d '{"connection": {...}, "sql": "SELECT * FROM dual", "max_rows": 100}'
```

## Building for Distribution

### 1. Install PyInstaller

```bash
pip install pyinstaller
```

### 2. Build the executable

```bash
python build_sidecar.py
```

This creates `tauri/binaries/oracle-sidecar-{target-triple}` (e.g., `oracle-sidecar-aarch64-apple-darwin` on Apple Silicon Mac).

### 3. Build the Tauri app

```bash
cd ..  # Back to tauri/
cargo tauri build
```

The sidecar is automatically bundled with the app.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check, returns pool count |
| `/test-connection` | POST | Test database connection |
| `/query` | POST | Execute SQL, return rows as arrays |
| `/query-dict` | POST | Execute SQL, return rows as objects |
| `/pools` | GET | List active connection pools |

## Connection Pooling

The sidecar maintains connection pools per unique connection config:

- **min=1**: Keeps 1 connection warm
- **max=2**: Allows up to 2 concurrent connections
- **timeout=120**: Closes idle connections after 2 minutes

Pools are created lazily on first use and cleaned up automatically.

## Frontend Usage

```javascript
import { OracleSidecarClient } from './lib/oracle-sidecar-client.js';

const client = new OracleSidecarClient();
await client.start();

const result = await client.queryAsDict({
  connection: {
    name: 'DEV',
    connect_string: 'myhost:1521/myservice',
    username: 'myuser',
    password: 'mypass'
  },
  sql: 'SELECT * FROM my_table WHERE status = :1',
  max_rows: 1000
});

console.log(result.columns);  // ['ID', 'NAME', 'STATUS']
console.log(result.rows);     // [{ID: 1, NAME: 'foo', STATUS: 'active'}, ...]
console.log(result.row_count); // 42
console.log(result.execution_time_ms); // 123.45
```

## Troubleshooting

### Sidecar won't start
- Check if port 21521 is already in use
- Verify Python dependencies are installed

### Connection errors
- Ensure the database is reachable from your machine
- Check connect_string format: `host:port/service_name`
- Verify credentials

### Build errors with PyInstaller
- Make sure all hidden imports are specified in `build_sidecar.py`
- Try with `--debug=all` flag for more info
