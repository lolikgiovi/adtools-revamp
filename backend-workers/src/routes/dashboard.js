/**
 * Dashboard route handlers for analytics dashboard
 * Password-protected endpoints for viewing usage statistics
 * Tab configs stored in KV with fallback to defaults
 */

import { corsHeaders } from "../utils/cors.js";
import { ensureDeviceAppVersionSchema, ensureErrorEventsSchema } from "../utils/analyticsSchema.js";

// Default tab configurations (fallback when KV is empty)
const DEFAULT_TABS = [
  {
    id: "overview",
    name: "Overview",
    query: `WITH params AS (
  SELECT 'fashalli.bilhaq@bankmandiri.co.id' AS owner_email
)
SELECT 'Active users today' AS metric,
  CAST(COUNT(DISTINCT user_email) AS TEXT) AS value,
  'People with live usage today' AS context
  FROM usage_log, params
  WHERE user_email != owner_email
    AND created_time >= datetime('now', '+7 hours', 'start of day')
UNION ALL
SELECT 'Active users 7d',
  CAST(COUNT(DISTINCT user_email) AS TEXT),
  'People with live usage in the last 7 days'
  FROM usage_log, params
  WHERE user_email != owner_email
    AND created_time >= datetime('now', '+7 hours', '-7 days')
UNION ALL
SELECT 'Tool opens 7d',
  CAST(COUNT(*) AS TEXT),
  'Shell-level tool open events'
  FROM usage_log, params
  WHERE user_email != owner_email
    AND action = 'open'
    AND created_time >= datetime('now', '+7 hours', '-7 days')
UNION ALL
SELECT 'Tracked actions 7d',
  CAST(COALESCE(SUM(count), 0) AS TEXT),
  'Aggregated device usage counts'
  FROM device_usage, params
  WHERE user_email != owner_email
    AND updated_time >= datetime('now', '+7 hours', '-7 days')
UNION ALL
SELECT 'Uncaught errors 24h',
  CAST(COUNT(*) AS TEXT),
  'Immediate frontend error reports'
  FROM error_events, params
  WHERE COALESCE(user_email, '') != owner_email
    AND created_time >= datetime('now', '+7 hours', '-1 day')
UNION ALL
SELECT 'Affected users 7d',
  CAST(COUNT(DISTINCT user_email) AS TEXT),
  'Users with uncaught errors'
  FROM error_events, params
  WHERE COALESCE(user_email, '') != owner_email
    AND created_time >= datetime('now', '+7 hours', '-7 days')
UNION ALL
SELECT 'Most used tool 30d',
  COALESCE((
    SELECT tool_id || ' (' || SUM(count) || ')'
    FROM device_usage, params
    WHERE user_email != owner_email
      AND updated_time >= datetime('now', '+7 hours', '-30 days')
    GROUP BY tool_id
    ORDER BY SUM(count) DESC
    LIMIT 1
  ), '-'),
  'Tool with the largest aggregated action count'
UNION ALL
SELECT 'Noisiest error 7d',
  COALESCE((
    SELECT COALESCE(tool_id, route, 'unknown') || ' / ' || error_name || ' (' || COUNT(*) || ')'
    FROM error_events, params
    WHERE COALESCE(user_email, '') != owner_email
      AND created_time >= datetime('now', '+7 hours', '-7 days')
    GROUP BY COALESCE(tool_id, route, 'unknown'), error_name
    ORDER BY COUNT(*) DESC, MAX(created_time) DESC
    LIMIT 1
  ), '-'),
  'Top uncaught error cluster'`,
  },
  {
    id: "active-users",
    name: "Active Users",
    query: `WITH recent_usage AS (
  SELECT user_email, device_id, tool_id, action, created_time
  FROM usage_log
  WHERE user_email != 'fashalli.bilhaq@bankmandiri.co.id'
    AND created_time >= datetime('now', '+7 hours', '-30 days')
),
user_rollup AS (
  SELECT user_email,
    COUNT(*) AS actions_30d,
    SUM(CASE WHEN action = 'open' THEN 1 ELSE 0 END) AS opens_30d,
    COUNT(DISTINCT tool_id) AS tools_used,
    COUNT(DISTINCT device_id) AS devices_seen,
    GROUP_CONCAT(DISTINCT tool_id) AS tools,
    MAX(created_time) AS last_activity
  FROM recent_usage
  GROUP BY user_email
),
error_rollup AS (
  SELECT user_email,
    COUNT(*) AS errors_30d,
    MAX(created_time) AS last_error
  FROM error_events
  WHERE COALESCE(user_email, '') != 'fashalli.bilhaq@bankmandiri.co.id'
    AND created_time >= datetime('now', '+7 hours', '-30 days')
  GROUP BY user_email
)
SELECT SUBSTR(user_rollup.user_email, 1, INSTR(user_rollup.user_email, '@') - 1) AS user,
  user_rollup.actions_30d,
  user_rollup.opens_30d,
  user_rollup.tools_used,
  user_rollup.devices_seen,
  COALESCE(error_rollup.errors_30d, 0) AS errors_30d,
  user_rollup.last_activity,
  error_rollup.last_error,
  user_rollup.tools
FROM user_rollup
LEFT JOIN error_rollup ON error_rollup.user_email = user_rollup.user_email
ORDER BY user_rollup.last_activity DESC
LIMIT 200`,
  },
  {
    id: "tools",
    name: "Tool Usage",
    query: `WITH n AS (
  SELECT
    CASE WHEN tool_id IN ('jenkins-runner','run-query') THEN 'run-query' ELSE tool_id END AS tool_id,
    action,
    SUM(count) AS action_count
  FROM device_usage
  WHERE user_email != 'fashalli.bilhaq@bankmandiri.co.id'
  GROUP BY 1,2
),
t AS (
  SELECT tool_id, SUM(action_count) AS tool_total
  FROM n
  GROUP BY 1
)
SELECT tool_id, action, total_count
FROM (
  SELECT t.tool_id, 'TOTAL' AS action, t.tool_total AS total_count, t.tool_total AS tool_total, 0 AS row_type
  FROM t
  UNION ALL
  SELECT n.tool_id, n.action, n.action_count, t.tool_total, 1
  FROM n JOIN t USING (tool_id)
)
ORDER BY tool_total DESC, tool_id, row_type, total_count DESC`,
  },
  {
    id: "tool-adoption",
    name: "Tool Adoption",
    query: `WITH usage AS (
  SELECT
    CASE WHEN tool_id IN ('jenkins-runner','run-query') THEN 'run-query' ELSE tool_id END AS tool_id,
    action,
    device_id,
    user_email,
    count,
    updated_time
  FROM device_usage
  WHERE user_email != 'fashalli.bilhaq@bankmandiri.co.id'
),
totals AS (
  SELECT tool_id,
    SUM(count) AS total_actions,
    SUM(CASE WHEN action = 'open' THEN count ELSE 0 END) AS opens,
    COUNT(DISTINCT user_email) AS users,
    COUNT(DISTINCT device_id) AS devices,
    MAX(updated_time) AS last_used
  FROM usage
  GROUP BY tool_id
),
ranked_actions AS (
  SELECT tool_id,
    action,
    action_count,
    ROW_NUMBER() OVER (PARTITION BY tool_id ORDER BY action_count DESC) AS rank
  FROM (
    SELECT tool_id,
      action,
      SUM(count) AS action_count
    FROM usage
    GROUP BY tool_id, action
  )
),
errors AS (
  SELECT COALESCE(tool_id, route, 'unknown') AS tool_id,
    COUNT(*) AS errors_7d,
    MAX(created_time) AS last_error
  FROM error_events
  WHERE COALESCE(user_email, '') != 'fashalli.bilhaq@bankmandiri.co.id'
    AND created_time >= datetime('now', '+7 hours', '-7 days')
  GROUP BY COALESCE(tool_id, route, 'unknown')
)
SELECT totals.tool_id,
  totals.total_actions,
  totals.opens,
  totals.users,
  totals.devices,
  ranked_actions.action AS top_action,
  ranked_actions.action_count AS top_action_count,
  COALESCE(errors.errors_7d, 0) AS errors_7d,
  totals.last_used,
  errors.last_error
FROM totals
LEFT JOIN ranked_actions ON ranked_actions.tool_id = totals.tool_id AND ranked_actions.rank = 1
LEFT JOIN errors ON errors.tool_id = totals.tool_id
ORDER BY totals.total_actions DESC, totals.users DESC
LIMIT 100`,
  },
  {
    id: "daily",
    name: "Recent Activity",
    query: `SELECT STRFTIME('%m-%d / %H:%M', u.created_time) AS time,
      SUBSTR(u.user_email, 1, INSTR(u.user_email, '@') - 1) AS user,
      COALESCE(d.platform, 'unknown') AS platform,
      COALESCE(d.app_version, '-') AS app_version,
      u.tool_id,
      u.action
      FROM usage_log u
      LEFT JOIN device d ON u.device_id = d.device_id
      WHERE u.user_email != 'fashalli.bilhaq@bankmandiri.co.id'
      ORDER BY u.created_time DESC`,
  },
  {
    id: "devices",
    name: "Devices",
    query: `SELECT d.platform,
      COALESCE(d.app_version, '-') AS app_version,
      COUNT(DISTINCT u.email) AS user_count,
      COUNT(DISTINCT d.device_id) AS device_count,
      MAX(d.last_seen) AS last_seen
      FROM device d
      JOIN users u ON u.id = d.user_id
      WHERE d.platform != 'Unknown'
      AND u.email != 'fashalli.bilhaq@bankmandiri.co.id'
      GROUP BY d.platform, COALESCE(d.app_version, '-')
      ORDER BY last_seen DESC, user_count DESC, d.platform`,
  },
  {
    id: "events",
    name: "Events",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time, 
      u.email, d.platform, e.feature_id, e.action, e.properties
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE u.email != 'fashalli.bilhaq@bankmandiri.co.id'
      ORDER BY e.created_time DESC`,
  },
  {
    id: "friction",
    name: "Friction",
    query: `WITH instrumented AS (
  SELECT 'tracked_event' AS source,
    e.feature_id AS area,
    e.action AS issue,
    COUNT(*) AS count,
    COUNT(DISTINCT u.email) AS affected_users,
    MAX(e.created_time) AS last_seen,
    NULL AS latest_message
  FROM events e
  JOIN device d ON e.device_id = d.device_id
  JOIN users u ON d.user_id = u.id
  WHERE u.email != 'fashalli.bilhaq@bankmandiri.co.id'
    AND (
      LOWER(e.action) LIKE '%error%'
      OR LOWER(e.action) LIKE '%fail%'
      OR LOWER(e.action) LIKE '%invalid%'
      OR LOWER(e.action) LIKE '%timeout%'
      OR LOWER(e.action) LIKE '%reject%'
    )
  GROUP BY e.feature_id, e.action
),
uncaught AS (
  SELECT 'uncaught_error' AS source,
    COALESCE(tool_id, route, 'unknown') AS area,
    error_name AS issue,
    COUNT(*) AS count,
    COUNT(DISTINCT user_email) AS affected_users,
    MAX(created_time) AS last_seen,
    SUBSTR(message, 1, 180) AS latest_message
  FROM error_events
  WHERE COALESCE(user_email, '') != 'fashalli.bilhaq@bankmandiri.co.id'
  GROUP BY COALESCE(tool_id, route, 'unknown'), error_name, SUBSTR(message, 1, 180)
)
SELECT source, area, issue, count, affected_users, last_seen, latest_message
FROM instrumented
UNION ALL
SELECT source, area, issue, count, affected_users, last_seen, latest_message
FROM uncaught
ORDER BY count DESC, last_seen DESC
LIMIT 150`,
  },
  {
    id: "errors",
    name: "Error Details",
    query: `SELECT STRFTIME('%m-%d / %H:%M', created_time) AS time,
      SUBSTR(COALESCE(user_email, ''), 1, INSTR(COALESCE(user_email, ''), '@') - 1) AS user,
      runtime,
      app_version,
      COALESCE(tool_id, route) AS area,
      process_area,
      error_kind,
      error_name,
      message,
      stack,
      source,
      lineno,
      colno,
      metadata
      FROM error_events
      ORDER BY created_time DESC
      LIMIT 200`,
  },
  {
    id: "error-summary",
    name: "Error Summary",
    query: `SELECT
      COALESCE(tool_id, route, 'unknown') AS area,
      process_area,
      error_name,
      COUNT(*) AS count,
      COUNT(DISTINCT user_email) AS affected_users,
      COUNT(DISTINCT device_id) AS affected_devices,
      SUBSTR(MAX(created_time || '|' || message), 21) AS latest_message,
      MAX(created_time) AS last_seen
      FROM error_events
      WHERE COALESCE(user_email, '') != 'fashalli.bilhaq@bankmandiri.co.id'
      GROUP BY area, process_area, error_name
      ORDER BY count DESC, last_seen DESC
      LIMIT 100`,
  },
  {
    id: "versions",
    name: "Runtime Versions",
    query: `WITH devices AS (
  SELECT d.device_id,
    u.email,
    d.platform,
    COALESCE(d.app_version, '-') AS app_version,
    d.last_seen
  FROM device d
  JOIN users u ON u.id = d.user_id
  WHERE u.email != 'fashalli.bilhaq@bankmandiri.co.id'
),
version_errors AS (
  SELECT COALESCE(app_version, '-') AS app_version,
    runtime,
    COUNT(*) AS errors_30d,
    MAX(created_time) AS last_error
  FROM error_events
  WHERE COALESCE(user_email, '') != 'fashalli.bilhaq@bankmandiri.co.id'
    AND created_time >= datetime('now', '+7 hours', '-30 days')
  GROUP BY COALESCE(app_version, '-'), runtime
)
SELECT devices.platform,
  devices.app_version,
  COUNT(DISTINCT devices.email) AS users,
  COUNT(DISTINCT devices.device_id) AS devices,
  COALESCE(version_errors.runtime, '-') AS error_runtime,
  COALESCE(version_errors.errors_30d, 0) AS errors_30d,
  MAX(devices.last_seen) AS last_seen,
  version_errors.last_error
FROM devices
LEFT JOIN version_errors ON version_errors.app_version = devices.app_version
GROUP BY devices.platform, devices.app_version, version_errors.runtime
ORDER BY errors_30d DESC, last_seen DESC`,
  },
  {
    id: "quick-query",
    name: "Quick Query",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      d.platform,
      json_extract(e.properties, '$.queryType') AS type,
      json_extract(e.properties, '$.tableName') AS table_name,
      json_extract(e.properties, '$.rowCount') AS row_count,
      json_extract(e.properties, '$.hasAttachment') AS attachment
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'quick-query' AND e.action = 'query_generated'
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "quick-query-errors",
    name: "QQ Errors",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      d.platform,
      e.action,
      json_extract(e.properties, '$.tableName') AS table_name,
      json_extract(e.properties, '$.fieldName') AS field,
      json_extract(e.properties, '$.type') AS error
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'quick-query' 
        AND e.action NOT IN ('query_generated', 'schema_load', 'download_sql', 'split_complete')
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "qq-insights",
    name: "QQ Insights",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      e.action,
      json_extract(e.properties, '$.source') AS source,
      json_extract(e.properties, '$.table_name') AS table_name,
      json_extract(e.properties, '$.row_count') AS rows,
      json_extract(e.properties, '$.file_size') AS file_size,
      json_extract(e.properties, '$.query_type') AS query_type
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'quick-query' 
        AND e.action IN ('schema_load', 'download_sql')
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "qq-splits",
    name: "QQ Splits",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      json_extract(e.properties, '$.mode') AS mode,
      json_extract(e.properties, '$.chunk_count') AS chunks,
      json_extract(e.properties, '$.total_size') AS total_size,
      json_extract(e.properties, '$.table_name') AS table_name
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'quick-query' AND e.action = 'split_complete'
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "run-query",
    name: "Run Query",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      e.action,
      json_extract(e.properties, '$.template_name') AS template,
      json_extract(e.properties, '$.env') AS env,
      json_extract(e.properties, '$.sql_length') AS sql_len
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'run-query'
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "json-tools",
    name: "JSON Tools",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      e.action,
      json_extract(e.properties, '$.from_tab') AS from_tab,
      json_extract(e.properties, '$.to_tab') AS to_tab,
      json_extract(e.properties, '$.match_count') AS matches,
      json_extract(e.properties, '$.input_size') AS input_size
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'json-tools'
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "base64-tools",
    name: "Base64 Tools",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      e.action,
      json_extract(e.properties, '$.mode') AS mode,
      json_extract(e.properties, '$.file_count') AS files,
      json_extract(e.properties, '$.total_size') AS size,
      json_extract(e.properties, '$.format') AS format
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'base64-tools'
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "qr-tools",
    name: "QR Tools",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      e.action,
      json_extract(e.properties, '$.mode') AS mode,
      json_extract(e.properties, '$.content_length') AS len,
      json_extract(e.properties, '$.ratio') AS contrast,
      json_extract(e.properties, '$.foreground') AS fg,
      json_extract(e.properties, '$.background') AS bg
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'qr-tools'
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "image-checker",
    name: "Image Checker",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      e.action,
      json_extract(e.properties, '$.image_count') AS images,
      json_extract(e.properties, '$.env_count') AS envs,
      json_extract(e.properties, '$.success_count') AS success,
      json_extract(e.properties, '$.timeout_count') AS timeouts,
      json_extract(e.properties, '$.duration_ms') AS duration_ms
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id = 'check-image'
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "html-splunk",
    name: "HTML & Splunk",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      e.feature_id AS tool,
      e.action,
      json_extract(e.properties, '$.env') AS env
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id IN ('html-template', 'splunk-template')
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
  {
    id: "uuid-sql",
    name: "UUID & SQL IN",
    query: `SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
      SUBSTR(u.email, 1, INSTR(u.email, '@') - 1) AS user,
      e.feature_id AS tool,
      e.action,
      json_extract(e.properties, '$.quantity') AS quantity,
      json_extract(e.properties, '$.format') AS format,
      json_extract(e.properties, '$.line_count') AS lines
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      WHERE e.feature_id IN ('uuid-generator', 'sql-in-clause')
      ORDER BY e.created_time DESC
      LIMIT 100`,
  },
];

const KV_KEY = "analytics-dashboard-config";
const CACHE_TTL_MS = 60 * 1000;
let tabConfigCache = null;
const dashboardQueryCache = new Map();

function getDefaultTab(id) {
  return DEFAULT_TABS.find((tab) => tab.id === id) || DEFAULT_TABS[0];
}

function mergeStoredTabsWithDefaults(storedTabs) {
  const storedById = new Map(storedTabs.map((tab) => [tab.id, tab]));
  const merged = DEFAULT_TABS.map((defaultTab) => storedById.get(defaultTab.id) || defaultTab);
  const defaultIds = new Set(DEFAULT_TABS.map((tab) => tab.id));
  const customTabs = storedTabs.filter((tab) => tab?.id && !defaultIds.has(tab.id));
  return [...merged, ...customTabs];
}

/**
 * Get tab configs from KV or fallback to defaults
 * Returns { source: 'kv' | 'defaults', tabs: [] }
 */
async function getTabConfigs(env) {
  const now = Date.now();
  const kvBinding = env.adtools || null;
  if (tabConfigCache && tabConfigCache.expiresAt > now && tabConfigCache.kvBinding === kvBinding) {
    return tabConfigCache.value;
  }

  let value = { source: "defaults", tabs: DEFAULT_TABS };
  try {
    if (env.adtools) {
      const stored = await env.adtools.get(KV_KEY, "json");
      if (stored && Array.isArray(stored) && stored.length > 0) {
        value = { source: "kv+defaults", tabs: mergeStoredTabsWithDefaults(stored) };
      }
    }
  } catch (err) {
    console.error("Error reading tab configs from KV:", err);
  }
  tabConfigCache = {
    expiresAt: now + CACHE_TTL_MS,
    kvBinding,
    value,
  };
  return value;
}

/**
 * Simple token generation - base64 encoded timestamp with 24h validity
 */
function generateToken() {
  const payload = { exp: Date.now() + 24 * 60 * 60 * 1000 };
  return btoa(JSON.stringify(payload));
}

/**
 * Validate token from Authorization header
 */
function validateToken(request) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) return false;

  try {
    const payload = JSON.parse(atob(token));
    return payload.exp && payload.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * Auth middleware wrapper
 */
function withAuth(handler) {
  return async (request, env) => {
    if (!validateToken(request)) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    return handler(request, env);
  };
}

/**
 * POST /dashboard/verify - Verify password and return session token
 */
export async function handleDashboardVerify(request, env) {
  try {
    const data = await request.json();
    const password = String(data.password || "");
    const expectedPassword = String(env.ANALYTICS_DASHBOARD_PASSWORD || "");

    if (!expectedPassword) {
      return new Response(JSON.stringify({ ok: false, error: "Dashboard password not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    if (password !== expectedPassword) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid password" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const token = generateToken();
    return new Response(JSON.stringify({ ok: true, token }), { headers: { "Content-Type": "application/json", ...corsHeaders() } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

/**
 * GET /dashboard/tabs - Get available tabs (from KV or defaults)
 */
export const handleDashboardTabs = withAuth(async (request, env) => {
  try {
    const config = await getTabConfigs(env);
    // Return only id and name (not the query), plus the source
    const tabList = config.tabs.map(({ id, name }) => ({ id, name }));

    return new Response(JSON.stringify({ ok: true, tabs: tabList, source: config.source }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
});

/**
 * POST /dashboard/query - Execute query for a specific tab
 */
export const handleDashboardQuery = withAuth(async (request, env) => {
  try {
    if (!env.DB) {
      return new Response(JSON.stringify({ ok: false, error: "Database not available" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const body = await request.json();
    const tabId = String(body.tabId || "");

    if (!tabId) {
      return new Response(JSON.stringify({ ok: false, error: "tabId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const config = await getTabConfigs(env);
    const tab = config.tabs.find((t) => t.id === tabId);

    if (!tab) {
      return new Response(JSON.stringify({ ok: false, error: `Tab not found: ${tabId}` }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    return executeQuery(env, `tab:${tab.id}:${tab.query}`, tab.query);
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
});

// Legacy endpoints for backwards compatibility
export const handleStatsTools = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "tools") || getDefaultTab("tools");
  return executeQuery(env, `tab:${tab.id}:${tab.query}`, tab.query);
});

export const handleStatsDaily = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "daily") || getDefaultTab("daily");
  return executeQuery(env, `tab:${tab.id}:${tab.query}`, tab.query);
});

export const handleStatsDevices = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "devices") || getDefaultTab("devices");
  return executeQuery(env, `tab:${tab.id}:${tab.query}`, tab.query);
});

export const handleStatsEvents = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "events") || getDefaultTab("events");
  return executeQuery(env, `tab:${tab.id}:${tab.query}`, tab.query);
});

export const handleStatsQuickQuery = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "quick-query") || getDefaultTab("quick-query");
  return executeQuery(env, `tab:${tab.id}:${tab.query}`, tab.query);
});

export const handleStatsQuickQueryErrors = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "quick-query-errors") || getDefaultTab("quick-query-errors");
  return executeQuery(env, `tab:${tab.id}:${tab.query}`, tab.query);
});

/**
 * Helper to execute a query and return response
 */
function getCachedDashboardQueryBody(cacheKey) {
  const cached = dashboardQueryCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardQueryCache.delete(cacheKey);
    return null;
  }
  return cached.body;
}

function setCachedDashboardQueryBody(cacheKey, body) {
  dashboardQueryCache.set(cacheKey, {
    body,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function executeQuery(env, cacheKey, query) {
  try {
    if (!env.DB) {
      return new Response(JSON.stringify({ ok: false, error: "Database not available" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const cachedBody = getCachedDashboardQueryBody(cacheKey);
    if (cachedBody) {
      return new Response(cachedBody, {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    if (query.includes("error_events")) {
      await ensureErrorEventsSchema(env);
    }
    if (query.includes("d.app_version") || query.includes("devices.app_version")) {
      await ensureDeviceAppVersionSchema(env);
    }

    const result = await env.DB.prepare(query).all();
    const body = JSON.stringify({ ok: true, data: result.results || [] });
    setCachedDashboardQueryBody(cacheKey, body);

    return new Response(body, {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}
