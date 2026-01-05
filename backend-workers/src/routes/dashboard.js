/**
 * Dashboard route handlers for analytics dashboard
 * Password-protected endpoints for viewing usage statistics
 * Tab configs stored in KV with fallback to defaults
 */

import { corsHeaders } from '../utils/cors.js';

// Default tab configurations (fallback when KV is empty)
const DEFAULT_TABS = [
  {
    id: 'tools',
    name: 'Tool Usage',
    query: `SELECT tool_id, action, SUM(count) AS total_count
      FROM device_usage
      WHERE user_email != 'fashalli.bilhaq@bankmandiri.co.id'
      GROUP BY tool_id, action
      ORDER BY total_count DESC`
  },
  {
    id: 'daily',
    name: 'Daily Logs',
    query: `SELECT u.user_email, d.platform, u.tool_id, u.action
      FROM usage_log u
      JOIN device d ON u.device_id = d.device_id
      WHERE DATE(u.created_time) = DATE('now')
      ORDER BY u.created_time DESC`
  },
  {
    id: 'devices',
    name: 'Devices',
    query: `SELECT u.email, d.platform
      FROM device d
      JOIN users u ON u.id = d.user_id
      ORDER BY u.email, d.platform`
  },
  {
    id: 'events',
    name: 'Events',
    query: `SELECT u.email, d.platform, e.feature_id, e.action, e.properties
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      ORDER BY e.created_time DESC
      LIMIT 100`
  },
  {
    id: 'quick-query',
    name: 'Quick Query',
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
      LIMIT 100`
  },
  {
    id: 'quick-query-errors',
    name: 'QQ Errors',
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
      WHERE e.feature_id = 'quick-query' AND e.action != 'query_generated'
      ORDER BY e.created_time DESC
      LIMIT 100`
  }
];

const KV_KEY = 'analytics-dashboard-config';

/**
 * Get tab configs from KV or fallback to defaults
 */
async function getTabConfigs(env) {
  try {
    if (env.adtools) {
      const stored = await env.adtools.get(KV_KEY, 'json');
      if (stored && Array.isArray(stored) && stored.length > 0) {
        return stored;
      }
    }
  } catch (err) {
    console.error('Error reading tab configs from KV:', err);
  }
  return DEFAULT_TABS;
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
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  
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
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
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
    const password = String(data.password || '');
    const expectedPassword = String(env.ANALYTICS_DASHBOARD_PASSWORD || '');
    
    if (!expectedPassword) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Dashboard password not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    if (password !== expectedPassword) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid password' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    const token = generateToken();
    return new Response(
      JSON.stringify({ ok: true, token }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }
}

/**
 * GET /dashboard/tabs - Get available tabs (from KV or defaults)
 */
export const handleDashboardTabs = withAuth(async (request, env) => {
  try {
    const tabs = await getTabConfigs(env);
    // Return only id and name (not the query)
    const tabList = tabs.map(({ id, name }) => ({ id, name }));
    
    return new Response(
      JSON.stringify({ ok: true, tabs: tabList }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }
});

/**
 * POST /dashboard/query - Execute query for a specific tab
 */
export const handleDashboardQuery = withAuth(async (request, env) => {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Database not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }

    const body = await request.json();
    const tabId = String(body.tabId || '');
    
    if (!tabId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'tabId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }

    const tabs = await getTabConfigs(env);
    const tab = tabs.find(t => t.id === tabId);
    
    if (!tab) {
      return new Response(
        JSON.stringify({ ok: false, error: `Tab not found: ${tabId}` }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }

    const result = await env.DB.prepare(tab.query).all();
    
    return new Response(
      JSON.stringify({ ok: true, data: result.results || [] }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }
});

// Legacy endpoints for backwards compatibility
export const handleStatsTools = withAuth(async (request, env) => {
  const tabs = await getTabConfigs(env);
  const tab = tabs.find(t => t.id === 'tools') || DEFAULT_TABS[0];
  return executeQuery(env, tab.query);
});

export const handleStatsDaily = withAuth(async (request, env) => {
  const tabs = await getTabConfigs(env);
  const tab = tabs.find(t => t.id === 'daily') || DEFAULT_TABS[1];
  return executeQuery(env, tab.query);
});

export const handleStatsDevices = withAuth(async (request, env) => {
  const tabs = await getTabConfigs(env);
  const tab = tabs.find(t => t.id === 'devices') || DEFAULT_TABS[2];
  return executeQuery(env, tab.query);
});

export const handleStatsEvents = withAuth(async (request, env) => {
  const tabs = await getTabConfigs(env);
  const tab = tabs.find(t => t.id === 'events') || DEFAULT_TABS[3];
  return executeQuery(env, tab.query);
});

export const handleStatsQuickQuery = withAuth(async (request, env) => {
  const tabs = await getTabConfigs(env);
  const tab = tabs.find(t => t.id === 'quick-query') || DEFAULT_TABS[4];
  return executeQuery(env, tab.query);
});

export const handleStatsQuickQueryErrors = withAuth(async (request, env) => {
  const tabs = await getTabConfigs(env);
  const tab = tabs.find(t => t.id === 'quick-query-errors') || DEFAULT_TABS[5];
  return executeQuery(env, tab.query);
});

/**
 * Helper to execute a query and return response
 */
async function executeQuery(env, query) {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Database not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    const result = await env.DB.prepare(query).all();
    
    return new Response(
      JSON.stringify({ ok: true, data: result.results || [] }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }
}
