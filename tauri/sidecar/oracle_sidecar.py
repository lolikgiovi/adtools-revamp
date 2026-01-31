#!/usr/bin/env python3
"""
Oracle Database Sidecar for AD Tools

A FastAPI server that provides Oracle database connectivity using connection pooling.
Designed to run as a Tauri sidecar, avoiding the need to bundle Oracle Instant Client.

Uses oracledb in THIN mode - no native Oracle client libraries required!
"""

import asyncio
import atexit
import logging
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from threading import Lock
from typing import Any, Optional

import oracledb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# =============================================================================
# Configuration
# =============================================================================

POOL_MIN = 1
POOL_MAX = 5
POOL_INCREMENT = 1
POOL_TIMEOUT = 120  # Close idle connections after 2 minutes
POOL_GETMODE = oracledb.POOL_GETMODE_WAIT
PORT = 21522  # Sidecar port (easy to remember: 2 + Oracle default 1521)


# =============================================================================
# Request/Response Models
# =============================================================================

class ConnectionConfig(BaseModel):
    name: str
    connect_string: str  # host:port/service_name
    username: str
    password: str


class QueryRequest(BaseModel):
    connection: ConnectionConfig
    sql: str
    max_rows: Optional[int] = 1000


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    execution_time_ms: float


class TestConnectionRequest(BaseModel):
    connection: ConnectionConfig


class HealthResponse(BaseModel):
    status: str
    active_pools: int
    timestamp: str


class ErrorResponse(BaseModel):
    code: int
    message: str
    hint: Optional[str] = None


# =============================================================================
# Connection Pool Manager
# =============================================================================

class PoolManager:
    """
    Manages multiple Oracle connection pools, one per unique connection config.
    Pools are created lazily and cleaned up after idle timeout.
    """

    def __init__(self):
        self._pools: dict[str, oracledb.ConnectionPool] = {}
        self._last_used: dict[str, datetime] = {}
        self._lock = Lock()
        self._cleanup_task: Optional[asyncio.Task] = None

    def _pool_key(self, config: ConnectionConfig) -> str:
        """Generate unique key for a connection config."""
        return f"{config.username}@{config.connect_string}"

    def get_pool(self, config: ConnectionConfig) -> oracledb.ConnectionPool:
        """Get or create a connection pool for the given config."""
        key = self._pool_key(config)

        with self._lock:
            if key not in self._pools:
                logger.info(f"Creating new pool for: {key}")
                pool = oracledb.create_pool(
                    user=config.username,
                    password=config.password,
                    dsn=config.connect_string,
                    min=POOL_MIN,
                    max=POOL_MAX,
                    increment=POOL_INCREMENT,
                    timeout=POOL_TIMEOUT,
                    getmode=POOL_GETMODE,
                )
                self._pools[key] = pool

            self._last_used[key] = datetime.now()
            return self._pools[key]

    def close_pool(self, key: str) -> None:
        """Close and remove a specific pool."""
        with self._lock:
            if key in self._pools:
                logger.info(f"Closing pool: {key}")
                try:
                    self._pools[key].close()
                except Exception as e:
                    logger.warning(f"Error closing pool {key}: {e}")
                del self._pools[key]
                del self._last_used[key]

    def close_all(self) -> None:
        """Close all pools (called on shutdown)."""
        with self._lock:
            for key, pool in list(self._pools.items()):
                logger.info(f"Shutting down pool: {key}")
                try:
                    pool.close()
                except Exception as e:
                    logger.warning(f"Error closing pool {key}: {e}")
            self._pools.clear()
            self._last_used.clear()

    async def cleanup_idle_pools(self) -> None:
        """Periodically close pools that haven't been used recently."""
        while True:
            await asyncio.sleep(60)  # Check every minute
            now = datetime.now()
            idle_threshold = timedelta(seconds=POOL_TIMEOUT)

            keys_to_close = []
            with self._lock:
                for key, last_used in self._last_used.items():
                    if now - last_used > idle_threshold:
                        keys_to_close.append(key)

            for key in keys_to_close:
                self.close_pool(key)

    def start_cleanup_task(self) -> None:
        """Start the background cleanup task."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self.cleanup_idle_pools())

    def stop_cleanup_task(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            self._cleanup_task = None

    @property
    def pool_count(self) -> int:
        """Return number of active pools."""
        with self._lock:
            return len(self._pools)


# Global pool manager
pool_manager = PoolManager()

# Thread pool for offloading blocking DB operations from the asyncio event loop
_db_executor = ThreadPoolExecutor(max_workers=4)


# =============================================================================
# Oracle Error Handling
# =============================================================================

def oracle_error_to_response(e: oracledb.Error) -> ErrorResponse:
    """Convert Oracle error to structured response with hints."""
    error_obj = e.args[0] if e.args else None
    code = getattr(error_obj, 'code', 0) if error_obj else 0
    message = str(e)

    hints = {
        1017: "Check your username and password.",
        12154: "Verify connection string format: host:port/service_name",
        12170: "Connection timed out. Check network and firewall.",
        12541: "No listener at specified host:port. Verify the address.",
        12545: "Target host or object does not exist.",
        942: "Table or view does not exist, or you lack permissions.",
        1031: "Insufficient privileges. Contact your DBA.",
        3136: "Query exceeded timeout. Try a simpler query.",
        3114: "Connection to database lost. Check network connectivity.",
    }

    return ErrorResponse(
        code=code,
        message=message,
        hint=hints.get(code)
    )


# =============================================================================
# FastAPI Application
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info(f"Oracle Sidecar starting on port {PORT}...")
    logger.info(f"oracledb version: {oracledb.__version__}")
    logger.info("Using THIN mode (no Oracle Instant Client required)")

    pool_manager.start_cleanup_task()

    yield

    logger.info("Shutting down Oracle Sidecar...")
    pool_manager.stop_cleanup_task()
    pool_manager.close_all()


app = FastAPI(
    title="Oracle Sidecar",
    version="1.0.0",
    lifespan=lifespan
)

# Allow requests from Vite dev server and Tauri webview
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tauri webview uses tauri://localhost or file://
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        active_pools=pool_manager.pool_count,
        timestamp=datetime.now().isoformat()
    )


@app.post("/test-connection")
async def test_connection(request: TestConnectionRequest):
    """Test database connection without executing queries."""
    try:
        pool = pool_manager.get_pool(request.connection)
        with pool.acquire() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM DUAL")
            cursor.fetchone()
        return {"success": True, "message": "Connection successful"}
    except oracledb.Error as e:
        error = oracle_error_to_response(e)
        raise HTTPException(status_code=400, detail=error.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": 0, "message": str(e)})


def _convert_value(val):
    """Convert a single DB cell value to a JSON-safe type."""
    if val is None:
        return None
    if isinstance(val, (int, float, str, bool)):
        return val
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val)


def _execute_query_sync(request: QueryRequest, as_dict: bool = False):
    """Synchronous query execution — runs in thread pool to avoid blocking the event loop."""
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


@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    """Execute a SQL query and return results."""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _db_executor, _execute_query_sync, request, False
        )
        return QueryResponse(**result)
    except oracledb.Error as e:
        error = oracle_error_to_response(e)
        raise HTTPException(status_code=400, detail=error.model_dump())
    except Exception as e:
        logger.exception("Query execution failed")
        raise HTTPException(status_code=500, detail={"code": 0, "message": str(e)})


@app.post("/query-dict")
async def execute_query_dict(request: QueryRequest):
    """
    Execute a SQL query and return results as list of dictionaries.
    More convenient for frontend consumption.
    """
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _db_executor, _execute_query_sync, request, True
        )
        return result
    except oracledb.Error as e:
        error = oracle_error_to_response(e)
        raise HTTPException(status_code=400, detail=error.model_dump())
    except Exception as e:
        logger.exception("Query execution failed")
        raise HTTPException(status_code=500, detail={"code": 0, "message": str(e)})


@app.get("/pools")
async def list_pools():
    """List active connection pools (for debugging)."""
    with pool_manager._lock:
        pools = []
        for key, pool in pool_manager._pools.items():
            pools.append({
                "key": key,
                "busy": pool.busy,
                "opened": pool.opened,
                "min": pool.min,
                "max": pool.max,
                "last_used": pool_manager._last_used[key].isoformat()
            })
        return {"pools": pools}


# =============================================================================
# Main Entry Point
# =============================================================================

def handle_shutdown(signum, frame):
    """Handle graceful shutdown on SIGTERM/SIGINT."""
    logger.info(f"Received signal {signum}, shutting down...")
    pool_manager.close_all()
    sys.exit(0)


if __name__ == "__main__":
    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    # Also register atexit for cleanup
    atexit.register(pool_manager.close_all)

    # Run the server
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=PORT,
        log_level="info",
        access_log=False,  # Reduce noise
    )
