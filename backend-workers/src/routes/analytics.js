/**
 * Analytics route handlers for usage tracking
 * Handles POST-only analytics ingestion endpoints
 */

import { corsHeaders } from '../utils/cors.js';
import { ensureErrorEventsSchema } from '../utils/analyticsSchema.js';
import { tsGmt7Plain, tsToGmt7Plain } from '../utils/timestamps.js';

/**
 * Handle POST /analytics/batch - batch insert events and upsert device_usage
 * IMPROVEMENTS:
 * - Uses env.DB.batch() for single transaction (performance)
 * - Removed legacy daily_usage and user_usage writes
 */
export async function handleAnalyticsBatchPost(request, env) {
  try {
    const data = await request.json();
    const deviceId = String(data.device_id || data.deviceId || "");
    const userEmail = String(data.user_email || "").trim().toLowerCase() || null;
    const events = Array.isArray(data.events) ? data.events : [];
    const deviceUsage = Array.isArray(data.device_usage) ? data.device_usage : [];

    let insertedEvents = 0;
    let upsertsDevice = 0;

    if (env.DB) {
      // Build batch statements for events
      const eventStatements = [];
      for (const ev of events) {
        const createdTime = String(ev.created_time || tsGmt7Plain());
        const featureId = normalizeFeatureId(ev.feature_id || ev.type || "unknown");
        const action = String(ev.action || ev.event || "unknown");
        const properties =
          ev.properties && typeof ev.properties === "object"
            ? {
                ...ev.properties,
                runtime: safeString(ev.runtime || data.runtime, 40),
                app_version: safeString(ev.app_version || data.app_version, 60),
              }
            : ev.properties;
        const props =
          typeof properties === "string" ? safeString(properties, 4000) : JSON.stringify(sanitizeObject(properties || {}, 4000));
        const dev = String(ev.device_id || deviceId || "") || null;
        
        eventStatements.push(
          env.DB.prepare("INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES (?, ?, ?, ?, ?)")
            .bind(dev, featureId, action, props, createdTime)
        );
      }

      // Build batch statements for device_usage (idempotent - replaces counts)
      const usageStatements = [];
      for (const du of deviceUsage) {
        const devId = String(du.device_id || deviceId || "");
        const email = String(du.user_email || userEmail || "").trim().toLowerCase() || null;
        const toolId = normalizeFeatureId(du.tool_id || "unknown");
        const action = String(du.action || "unknown");
        const count = Number(du.count || 0) || 0;
        const updatedTime = String(du.updated_time || tsGmt7Plain());
        
        usageStatements.push(
          env.DB.prepare(
            `INSERT INTO device_usage (device_id, user_email, tool_id, action, count, updated_time)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(device_id, tool_id, action) DO UPDATE SET
               user_email = excluded.user_email,
               count = excluded.count,
               updated_time = excluded.updated_time`
          ).bind(devId, email, toolId, action, count, updatedTime)
        );
      }

      // Execute all statements in a single batch transaction
      const allStatements = [...eventStatements, ...usageStatements];
      if (allStatements.length > 0) {
        try {
          await env.DB.batch(allStatements);
          // Count successful inserts
          insertedEvents = eventStatements.length;
          upsertsDevice = usageStatements.length;
        } catch (batchErr) {
          // Fallback to individual inserts if batch fails
          for (const stmt of eventStatements) {
            try {
              await stmt.run();
              insertedEvents++;
            } catch (_) {}
          }
          for (const stmt of usageStatements) {
            try {
              await stmt.run();
              upsertsDevice++;
            } catch (_) {}
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, inserted: { events: insertedEvents, device_usage: upsertsDevice } }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

/**
 * Handle POST /analytics/log - live usage log insert
 */
export async function handleAnalyticsLogPost(request, env) {
  try {
    // Check if live logging is enabled
    const enabled = String(env.SEND_LIVE_USER_LOG || "").toLowerCase() === "true";
    if (!enabled) {
      return new Response(
        JSON.stringify({ ok: false, message: "Live logging disabled" }),
        {
          status: 200, // Return 200 to avoid client errors
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        }
      );
    }

    const data = await request.json();
    const userEmail = String(data.user_email || "").trim().toLowerCase();
    const deviceId = String(data.device_id || "unknown");
    const toolId = normalizeFeatureId(data.tool_id || "unknown");
    const action = String(data.action || "unknown");
    const createdTime = String(data.created_time || tsGmt7Plain());

    if (!userEmail) {
      return new Response(JSON.stringify({ ok: false, error: "user_email required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    let inserted = 0;
    let dbError = null;
    if (env.DB) {
      try {
        await env.DB.prepare("INSERT INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES (?, ?, ?, ?, ?)")
          .bind(userEmail, deviceId, toolId, action, createdTime)
          .run();
        inserted = 1;
      } catch (err) {
        dbError = String(err);
      }
    }

    if (inserted === 1) {
      return new Response(
        JSON.stringify({ ok: true, inserted: 1, message: "Usage log recorded successfully" }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ ok: false, inserted: 0, error: dbError || "Database unavailable", message: "Failed to record usage log" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        }
      );
    }
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

/**
 * Handle POST /analytics/error - immediate uncaught error insert
 */
export async function handleAnalyticsErrorPost(request, env) {
  try {
    const data = await request.json();
    const userEmail = safeString(data.user_email || "", 160).trim().toLowerCase() || null;
    const deviceId = safeString(data.device_id || "unknown", 120);
    const runtime = safeString(data.runtime || "unknown", 40);
    const appVersion = safeString(data.app_version || "", 60) || null;
    const route = safeString(data.route || "", 160) || null;
    const toolId = normalizeFeatureId(data.tool_id || "");
    const processArea = safeString(data.process_area || "shell", 80);
    const errorKind = safeString(data.error_kind || "uncaught_error", 80);
    const errorName = safeString(data.error_name || "Error", 120);
    const message = safeString(data.message || "Unknown error", 300);
    const stack = safeString(data.stack || "", 1500) || null;
    const source = safeString(data.source || "", 500) || null;
    const lineno = Number.isFinite(Number(data.lineno)) ? Number(data.lineno) : null;
    const colno = Number.isFinite(Number(data.colno)) ? Number(data.colno) : null;
    const userAgent = safeString(data.user_agent || "", 300) || null;
    const metadata = JSON.stringify(sanitizeObject(data.metadata || {}, 300));
    const createdTime = tsToGmt7Plain(data.created_time) || tsGmt7Plain();

    if (!env.DB) {
      return new Response(JSON.stringify({ ok: false, error: "Database unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    await ensureErrorEventsSchema(env);

    await env.DB.prepare(
      `INSERT INTO error_events (
        user_email, device_id, runtime, app_version, route, tool_id, process_area,
        error_kind, error_name, message, stack, source, lineno, colno, user_agent,
        metadata, created_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        userEmail,
        deviceId,
        runtime,
        appVersion,
        route,
        toolId || null,
        processArea,
        errorKind,
        errorName,
        message,
        stack,
        source,
        lineno,
        colno,
        userAgent,
        metadata,
        createdTime
      )
      .run();

    return new Response(JSON.stringify({ ok: true, inserted: 1 }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

function normalizeFeatureId(value) {
  const id = safeString(value || "unknown", 80).trim();
  if (id === "master_lockey") return "master-lockey";
  if (id === "json_tools") return "json-tools";
  if (id === "jenkins-runner") return "run-query";
  return id || "unknown";
}

function safeString(value, limit = 120) {
  const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 120;
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|otp|code|password|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b\d{6}\b/g, "[redacted-code]")
    .slice(0, max);
}

function isAllowedMetaKey(key) {
  const normalized = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const denied = new Set([
    "sql",
    "rawsql",
    "query",
    "querytext",
    "token",
    "authtoken",
    "authorization",
    "password",
    "secret",
    "otp",
    "clipboard",
    "content",
    "input",
    "value",
    "payload",
    "body",
    "filecontent",
  ]);
  return normalized && !denied.has(normalized);
}

function sanitizeObject(value, stringLimit = 120) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (!isAllowedMetaKey(key)) continue;
    if (typeof item === "string") result[key] = safeString(item, stringLimit);
    else if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "boolean") result[key] = item;
  }
  return result;
}
