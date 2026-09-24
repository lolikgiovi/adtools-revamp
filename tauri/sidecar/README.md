# Oracle Sidecar

A Python-based Oracle database connector that runs as a Tauri sidecar. This approach avoids the complexity of bundling Oracle Instant Client with the app.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri App                              │
│  ┌──────────────┐     HTTP      ┌────────────────────────┐  │
│  │   Frontend   │ ──────────────▶  Python Sidecar       │  │
│  │   (Vite)     │  localhost    │  (FastAPI + oracledb) │  │
│  └──────────────┘   :21522      └──────────┬─────────────┘  │
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

The server starts on `http://127.0.0.1:21522`

### 3. Test the API

```bash
# Health check
curl http://127.0.0.1:21522/health

# Test connection
curl -X POST http://127.0.0.1:21522/test-connection \
  -H "Content-Type: application/json" \
  -d '{"connection": {"name": "DEV", "connect_string": "host:1521/service", "username": "user", "password": "pass"}}'

# Execute query
curl -X POST http://127.0.0.1:21522/query \
  -H "Content-Type: application/json" \
  -d '{"connection": {...}, "sql": "SELECT * FROM dual", "max_rows": 100}'
```

## Building for Distribution

### 1. Install PyInstaller

```bash
pip install pyinstaller
```

### 2. Build both macOS architectures

```bash
cd ../..  # Repository root
npm run sidecar:build
```

This creates `tauri/oracle-sidecar-{target-triple}` and the matching support files under `tauri/sidecar-dist/`. The executable and support files must stay together. PyInstaller's one-directory layout avoids unpacking the Python runtime on every Oracle start. On the development Mac, repeated `/health` readiness checks took about 9.5–10.2 seconds with the one-file build and about 1.2 seconds with the one-directory build. The latter uses roughly 40 MB on disk instead of 15 MB per architecture.

`npm run tauri:dev` also links the native support files beside Tauri's copied executable in `tauri/target/debug`, where the PyInstaller bootloader expects them.

### 3. Build the Tauri app

Use `npm run tauri:build` for a native build. The release script selects the matching Tauri sidecar config for each architecture, places the Python runtime in app resources, signs the app, and creates the DMG.

The sidecar is automatically bundled with the app.

## API Endpoints

| Endpoint           | Method | Description                         |
| ------------------ | ------ | ----------------------------------- |
| `/health`          | GET    | Health check, returns pool count    |
| `/test-connection` | POST   | Test database connection            |
| `/query`           | POST   | Execute SQL, return rows as arrays  |
| `/query-dict`      | POST   | Execute SQL, return rows as objects |
| `/pools`           | GET    | List active connection pools        |

## Connection Pooling

The sidecar maintains connection pools per unique connection config:

- **min=1**: Keeps 1 connection warm
- **max=5**: Allows up to 5 pooled connections per configured database
- **timeout=120**: Closes idle connections after 2 minutes

Pools are created lazily on first use and cleaned up automatically.

## Frontend Usage

```javascript
import { OracleSidecarClient } from "./lib/oracle-sidecar-client.js";

const client = new OracleSidecarClient();
await client.start();

const result = await client.queryAsDict({
  connection: {
    name: "DEV",
    connect_string: "myhost:1521/myservice",
    username: "myuser",
    password: "mypass",
  },
  sql: "SELECT * FROM my_table WHERE status = :1",
  max_rows: 1000,
});

console.log(result.columns); // ['ID', 'NAME', 'STATUS']
console.log(result.rows); // [{ID: 1, NAME: 'foo', STATUS: 'active'}, ...]
console.log(result.row_count); // 42
console.log(result.execution_time_ms); // 123.45
```

## Troubleshooting

### Sidecar won't start

- Check if port 21522 is already in use
- Verify Python dependencies are installed

### Connection errors

- Ensure the database is reachable from your machine
- Check connect_string format: `host:port/service_name`
- Verify credentials

### Build errors with PyInstaller

- Make sure all hidden imports are specified in `build_sidecar.py`
- Try with `--debug=all` flag for more info
