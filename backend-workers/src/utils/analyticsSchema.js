const readyDatabases = new WeakSet();
const deviceVersionReadyDatabases = new WeakSet();

const ERROR_EVENTS_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS error_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    device_id TEXT NOT NULL,
    runtime TEXT,
    app_version TEXT,
    route TEXT,
    tool_id TEXT,
    process_area TEXT NOT NULL DEFAULT 'shell',
    error_kind TEXT NOT NULL,
    error_name TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    source TEXT,
    lineno INTEGER,
    colno INTEGER,
    user_agent TEXT,
    metadata TEXT,
    created_time TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_error_events_time ON error_events(created_time DESC)",
  "CREATE INDEX IF NOT EXISTS idx_error_events_email_time ON error_events(user_email, created_time DESC)",
  "CREATE INDEX IF NOT EXISTS idx_error_events_device_time ON error_events(device_id, created_time DESC)",
  "CREATE INDEX IF NOT EXISTS idx_error_events_tool_time ON error_events(tool_id, created_time DESC)",
  "CREATE INDEX IF NOT EXISTS idx_error_events_process_time ON error_events(process_area, created_time DESC)",
  "CREATE INDEX IF NOT EXISTS idx_error_events_name_time ON error_events(error_name, created_time DESC)",
];

export async function ensureErrorEventsSchema(env) {
  if (!env?.DB || readyDatabases.has(env.DB)) return;

  for (const statement of ERROR_EVENTS_SCHEMA_STATEMENTS) {
    await env.DB.prepare(statement).run();
  }

  readyDatabases.add(env.DB);
}

export async function ensureDeviceAppVersionSchema(env) {
  if (!env?.DB || deviceVersionReadyDatabases.has(env.DB)) return;

  const result = await env.DB.prepare("PRAGMA table_info(device)").all();
  const columns = Array.isArray(result?.results) ? result.results : [];
  const hasAppVersion = columns.some((column) => column?.name === "app_version");

  if (!hasAppVersion) {
    try {
      await env.DB.prepare("ALTER TABLE device ADD COLUMN app_version TEXT NULL").run();
    } catch (err) {
      if (!String(err).toLowerCase().includes("duplicate column")) throw err;
    }
  }

  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_device_app_version ON device(app_version)").run();
  deviceVersionReadyDatabases.add(env.DB);
}
