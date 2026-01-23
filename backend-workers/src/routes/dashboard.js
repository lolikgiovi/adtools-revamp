/**
 * Dashboard route handlers for analytics dashboard
 * Password-protected endpoints for viewing usage statistics
 * Tab configs stored in KV with fallback to defaults
 */

import { corsHeaders } from "../utils/cors.js";

// Default tab configurations (fallback when KV is empty)
const DEFAULT_TABS = [
  {
    id: "tools",
    name: "Tool Usage",
    query: `SELECT tool_id, action, SUM(count) AS total_count
      FROM device_usage
      WHERE user_email != 'fashalli.bilhaq@bankmandiri.co.id'
      GROUP BY tool_id, action
      ORDER BY total_count DESC`,
  },
  {
    id: "daily",
    name: "Daily Logs",
    query: `SELECT u.user_email, d.platform, u.tool_id, u.action
      FROM usage_log u
      JOIN device d ON u.device_id = d.device_id
      WHERE DATE(u.created_time) = DATE('now')
      ORDER BY u.created_time DESC`,
  },
  {
    id: "devices",
    name: "Devices",
    query: `SELECT u.email, d.platform
      FROM device d
      JOIN users u ON u.id = d.user_id
      ORDER BY u.email, d.platform`,
  },
  {
    id: "events",
    name: "Events",
    query: `SELECT u.email, d.platform, e.feature_id, e.action, e.properties
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      ORDER BY e.created_time DESC
      LIMIT 100`,
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

/**
 * Get tab configs from KV or fallback to defaults
 * Returns { source: 'kv' | 'defaults', tabs: [] }
 */
async function getTabConfigs(env) {
  try {
    if (env.adtools) {
      const stored = await env.adtools.get(KV_KEY, "json");
      if (stored && Array.isArray(stored) && stored.length > 0) {
        return { source: "kv", tabs: stored };
      }
    }
  } catch (err) {
    console.error("Error reading tab configs from KV:", err);
  }
  return { source: "defaults", tabs: DEFAULT_TABS };
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

    const result = await env.DB.prepare(tab.query).all();

    return new Response(JSON.stringify({ ok: true, data: result.results || [] }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
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
  const tab = config.tabs.find((t) => t.id === "tools") || DEFAULT_TABS[0];
  return executeQuery(env, tab.query);
});

export const handleStatsDaily = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "daily") || DEFAULT_TABS[1];
  return executeQuery(env, tab.query);
});

export const handleStatsDevices = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "devices") || DEFAULT_TABS[2];
  return executeQuery(env, tab.query);
});

export const handleStatsEvents = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "events") || DEFAULT_TABS[3];
  return executeQuery(env, tab.query);
});

export const handleStatsQuickQuery = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "quick-query") || DEFAULT_TABS[4];
  return executeQuery(env, tab.query);
});

export const handleStatsQuickQueryErrors = withAuth(async (request, env) => {
  const config = await getTabConfigs(env);
  const tab = config.tabs.find((t) => t.id === "quick-query-errors") || DEFAULT_TABS[5];
  return executeQuery(env, tab.query);
});

/**
 * Helper to execute a query and return response
 */
async function executeQuery(env, query) {
  try {
    if (!env.DB) {
      return new Response(JSON.stringify({ ok: false, error: "Database not available" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const result = await env.DB.prepare(query).all();

    return new Response(JSON.stringify({ ok: true, data: result.results || [] }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}
