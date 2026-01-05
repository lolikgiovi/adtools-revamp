/**
 * Dashboard route handlers for analytics dashboard
 * Password-protected endpoints for viewing usage statistics
 */

import { corsHeaders, methodNotAllowed } from '../utils/cors.js';

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
 * Auth middleware wrapper for stats endpoints
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
 * GET /dashboard/stats/tools - Tool usage aggregation
 */
export const handleStatsTools = withAuth(async (request, env) => {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Database not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    const result = await env.DB.prepare(`
      SELECT tool_id, action, SUM(count) AS total_count
      FROM device_usage
      WHERE user_email != 'fashalli.bilhaq@bankmandiri.co.id'
      GROUP BY tool_id, action
      ORDER BY total_count DESC
    `).all();
    
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

/**
 * GET /dashboard/stats/daily - Daily usage logs
 */
export const handleStatsDaily = withAuth(async (request, env) => {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Database not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    const result = await env.DB.prepare(`
      SELECT u.user_email, d.platform, u.tool_id, u.action
      FROM usage_log u
      JOIN device d ON u.device_id = d.device_id
      WHERE DATE(u.created_time) = DATE('now')
      ORDER BY u.created_time DESC
    `).all();
    
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

/**
 * GET /dashboard/stats/devices - Device list with users
 */
export const handleStatsDevices = withAuth(async (request, env) => {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Database not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    const result = await env.DB.prepare(`
      SELECT u.email, d.platform
      FROM device d
      JOIN users u ON u.id = d.user_id
      ORDER BY u.email, d.platform
    `).all();
    
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

/**
 * GET /dashboard/stats/events - Recent events with user/platform context
 */
export const handleStatsEvents = withAuth(async (request, env) => {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Database not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    const result = await env.DB.prepare(`
      SELECT u.email, d.platform, e.feature_id, e.action, e.properties
      FROM events e
      JOIN device d ON e.device_id = d.device_id
      JOIN users u ON d.user_id = u.id
      ORDER BY e.created_time DESC
      LIMIT 100
    `).all();
    
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

/**
 * GET /dashboard/stats/quick-query - Quick Query success stats
 */
export const handleStatsQuickQuery = withAuth(async (request, env) => {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Database not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    const result = await env.DB.prepare(`
      SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
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
      LIMIT 100
    `).all();
    
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

/**
 * GET /dashboard/stats/quick-query-errors - Quick Query errors
 */
export const handleStatsQuickQueryErrors = withAuth(async (request, env) => {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Database not available' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    
    const result = await env.DB.prepare(`
      SELECT STRFTIME('%m-%d / %H:%M', e.created_time) AS time,
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
      LIMIT 100
    `).all();
    
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
