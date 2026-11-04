/**
 * Analytics route handlers for usage tracking
 * Handles authenticated ingestion plus deliberately limited public overview/feedback endpoints.
 */

import { sendFeedbackEmail } from "../utils/feedbackEmail.js";
import { corsHeaders } from "../utils/cors.js";
import {
  ensureErrorEventsSchema,
  ensureEventsSchema,
  ensureLifetimeUsageBaselineSchema,
  ensureToolUsageSchema,
} from "../utils/analyticsSchema.js";
import { buildCanonicalToolUsageQuery, buildLifetimeUsageRollupQuery } from "../utils/analyticsUsageSql.js";
import { consumeRateLimit } from "../utils/rateLimit.js";
import { isBenignError } from "../utils/benignErrors.js";
import { tsGmt7, tsGmt7Plain, tsToGmt7Plain } from "../utils/timestamps.js";

/**
 * Handle GET /analytics/overview - authenticated personal and aggregate usage overview.
 * Cumulative totals and the seven-day pulse use the canonical, success-only Tool Use ledger.
 */
export async function handleAnalyticsOverviewGet(_request, env, session) {
  try {
    if (!env.DB) {
      return analyticsJson({ ok: false, error: "Analytics database unavailable" }, 503);
    }

    return analyticsJson(await loadOverviewData(env, String(session.email).trim().toLowerCase(), "analytics-api"));
  } catch (err) {
    console.error(JSON.stringify({ message: "analytics overview failed", error: String(err) }));
    return analyticsJson({ ok: false, error: "Analytics overview unavailable" }, 500);
  }
}

/**
 * Handle POST /analytics/public-overview - aggregate usage for the registered local identity.
 * The email is an attribution key, not authentication. This endpoint returns only aggregate
 * usage counters and never exposes raw usage rows, configuration, sessions, or dashboard data.
 */
export async function handlePublicAnalyticsOverviewPost(request, env) {
  try {
    if (!env.DB) return analyticsJson({ ok: false, error: "Analytics database unavailable" }, 503);

    let data;
    try {
      data = await request.json();
    } catch (_) {
      return analyticsJson({ ok: false, error: "A valid JSON body is required" }, 400);
    }

    const userEmail = normalizeIdentityEmail(data?.email);
    if (!userEmail) return analyticsJson({ ok: false, error: "A valid registered email is required" }, 400);

    const rateLimit = await checkPublicRateLimit(request, env, "overview", userEmail, 60, 10 * 60);
    if (rateLimit === null) return analyticsJson({ ok: false, error: "Public analytics temporarily unavailable" }, 503);
    if (rateLimit) return analyticsJson({ ok: false, error: "Too many analytics requests. Try again shortly." }, 429);

    return analyticsJson(await loadOverviewData(env, userEmail, "analytics-public-api"));
  } catch (err) {
    console.error(JSON.stringify({ message: "public analytics overview failed", error: String(err) }));
    return analyticsJson({ ok: false, error: "Analytics overview unavailable" }, 500);
  }
}

/**
 * Handle POST /feedback/improvement - store a low-friction improvement note.
 * Identity comes from the authenticated session; the client only supplies the note.
 */
export async function handleImprovementFeedbackPost(request, env, session) {
  try {
    if (!env.DB) return analyticsJson({ ok: false, error: "Feedback storage unavailable" }, 503);

    const data = await request.json();
    const message = String(data?.message || "").trim();
    const toolId = safeString(data?.tool_id || "", 80).trim() || null;
    if (!message) return analyticsJson({ ok: false, error: "A short note is required" }, 400);
    if (message.length > 4_000) return analyticsJson({ ok: false, error: "Keep the note under 4,000 characters" }, 413);

    await env.DB.prepare(
      `INSERT INTO improvement_feedback (user_email, device_id, tool_id, message, created_time)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(String(session.email).trim().toLowerCase(), String(session.deviceId), toolId, message, tsGmt7Plain())
      .run();

    const notificationSent = await sendFeedbackEmail(env, {
      email: String(session.email).trim().toLowerCase(), deviceId: String(session.deviceId), toolId, message,
    });
    return analyticsJson({ ok: true, message: "Improvement note received", notification_sent: notificationSent }, 201);
  } catch (err) {
    console.error(JSON.stringify({ message: "improvement feedback failed", error: String(err) }));
    return analyticsJson({ ok: false, error: "Could not save the improvement note" }, 500);
  }
}

/**
 * Handle POST /feedback/public-improvement - low-risk feedback from a registered local identity.
 * The submitted email/device are attribution fields only; this route does not grant access to
 * any authenticated resource. Rate limiting protects the write path from accidental abuse.
 */
export async function handlePublicImprovementFeedbackPost(request, env) {
  try {
    if (!env.DB) return analyticsJson({ ok: false, error: "Feedback storage unavailable" }, 503);

    let data;
    try {
      data = await request.json();
    } catch (_) {
      return analyticsJson({ ok: false, error: "A valid JSON body is required" }, 400);
    }

    const userEmail = normalizeIdentityEmail(data?.email);
    if (!userEmail) return analyticsJson({ ok: false, error: "A valid registered email is required" }, 400);

    const rawMessage = String(data?.message || "").trim();
    const rawToolId = safeString(data?.tool_id || "", 80).trim();
    const toolId = rawToolId ? normalizeFeatureId(rawToolId) : null;
    const deviceId = safeString(data?.device_id || data?.deviceId || "public-browser", 120).trim() || "public-browser";
    if (!rawMessage) return analyticsJson({ ok: false, error: "A short note is required" }, 400);
    if (rawMessage.length > 4_000) return analyticsJson({ ok: false, error: "Keep the note under 4,000 characters" }, 413);
    const message = safeString(rawMessage, 4_000);

    const rateLimit = await checkPublicRateLimit(request, env, "feedback", userEmail, 5, 60 * 60);
    if (rateLimit === null) return analyticsJson({ ok: false, error: "Public feedback temporarily unavailable" }, 503);
    if (rateLimit) return analyticsJson({ ok: false, error: "Too many feedback notes. Try again later." }, 429);

    await env.DB.prepare(
      `INSERT INTO improvement_feedback (user_email, device_id, tool_id, message, created_time)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(userEmail, deviceId, toolId, message, tsGmt7Plain())
      .run();

    const notificationSent = await sendFeedbackEmail(env, { email: userEmail, deviceId, toolId, message });
    return analyticsJson({ ok: true, message: "Improvement note received", notification_sent: notificationSent }, 201);
  } catch (err) {
    console.error(JSON.stringify({ message: "public improvement feedback failed", error: String(err) }));
    return analyticsJson({ ok: false, error: "Could not save the improvement note" }, 500);
  }
}

async function loadOverviewData(env, userEmail, source) {
  await ensureToolUsageSchema(env);
  await ensureLifetimeUsageBaselineSchema(env);
  const normalizedUsageSql = buildCanonicalToolUsageQuery();
  const lifetimeUsageSql = buildLifetimeUsageRollupQuery();
  const [userToolsResult, globalToolsResult, userSummary, globalSummary, userDailyResult, globalDailyResult] = await Promise.all([
    env.DB.prepare(
      `WITH lifetime_usage AS (${lifetimeUsageSql})
         SELECT tool_id, SUM(count) AS count
         FROM lifetime_usage
         WHERE user_email = ?
         GROUP BY tool_id
         ORDER BY count DESC, tool_id ASC
         LIMIT 100`,
    )
      .bind(userEmail)
      .all(),
    env.DB.prepare(
      `WITH lifetime_usage AS (${lifetimeUsageSql})
         SELECT tool_id, SUM(count) AS count
         FROM lifetime_usage
         GROUP BY tool_id
         ORDER BY count DESC, tool_id ASC
         LIMIT 100`,
    ).all(),
    env.DB.prepare(
      `WITH lifetime_usage AS (${lifetimeUsageSql})
         SELECT
           COALESCE(SUM(count), 0) AS total_activities,
           COUNT(DISTINCT tool_id) AS tools_used,
           MAX(last_updated) AS last_updated
         FROM lifetime_usage
         WHERE user_email = ?`,
    )
      .bind(userEmail)
      .first(),
    env.DB.prepare(
      `WITH lifetime_usage AS (${lifetimeUsageSql})
         SELECT
           COALESCE(SUM(count), 0) AS total_activities,
           COUNT(DISTINCT tool_id) AS tools_used,
           COUNT(DISTINCT CASE WHEN user_email != 'dev@localhost' THEN NULLIF(user_email, '') END)
             + CASE
               WHEN SUM(CASE WHEN user_email = 'dev@localhost' THEN count ELSE 0 END) > 0
               THEN MAX(1, (
                 SELECT COUNT(DISTINCT NULLIF(device_id, ''))
                 FROM tool_usage
                 WHERE LOWER(TRIM(user_email)) = 'dev@localhost'
                   AND source = 'client'
               ))
               ELSE 0
             END AS active_users,
           MAX(last_updated) AS last_updated
         FROM lifetime_usage`,
    ).first(),
    env.DB.prepare(
      `WITH normalized_usage AS (${normalizedUsageSql})
         SELECT SUBSTR(created_time, 1, 10) AS day, COUNT(*) AS count
         FROM normalized_usage
         WHERE created_time >= date('now', '+7 hours', '-6 days')
           AND user_email = ?
         GROUP BY day
         ORDER BY day ASC`,
    )
      .bind(userEmail)
      .all(),
    env.DB.prepare(
      `WITH normalized_usage AS (${normalizedUsageSql})
         SELECT SUBSTR(created_time, 1, 10) AS day, COUNT(*) AS count
         FROM normalized_usage
         WHERE created_time >= date('now', '+7 hours', '-6 days')
         GROUP BY day
         ORDER BY day ASC`,
    ).all(),
  ]);

  return {
    ok: true,
    source,
    generatedAt: tsGmt7(),
    period: { totals: "all-time", daily: "last-7-days" },
    user: buildOverviewScope(userSummary, userToolsResult?.results, userDailyResult?.results),
    global: buildOverviewScope(globalSummary, globalToolsResult?.results, globalDailyResult?.results),
  };
}

function normalizeIdentityEmail(value) {
  const email = safeString(value || "", 254)
    .trim()
    .toLowerCase();
  return email === "dev@localhost" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

async function checkPublicRateLimit(request, env, scope, email, limit, expirationTtl) {
  const clientKey = getPublicClientKey(request);
  try {
    return await consumeRateLimit(env.adtools, `public:${scope}:${clientKey}:${email}`, limit, expirationTtl);
  } catch (err) {
    console.error(JSON.stringify({ message: "public analytics rate limit unavailable", scope, error: String(err) }));
    return null;
  }
}

function getPublicClientKey(request) {
  const forwarded = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  return safeString(String(forwarded).split(",")[0], 80).replace(/[^a-zA-Z0-9:._-]/g, "_") || "unknown";
}

function buildOverviewScope(summary, toolRows = [], dailyRows = []) {
  const tools = (Array.isArray(toolRows) ? toolRows : [])
    .map((row) => ({ toolId: String(row?.tool_id || "unknown"), count: toCount(row?.count) }))
    .filter((row) => row.count > 0);
  const daily = (Array.isArray(dailyRows) ? dailyRows : [])
    .map((row) => ({ day: String(row?.day || ""), count: toCount(row?.count) }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day));
  const summaryTotal = toCount(summary?.total_activities);
  const summaryTools = Number(summary?.tools_used);

  return {
    totalActivities: summaryTotal || tools.reduce((sum, row) => sum + row.count, 0),
    toolsUsed: Number.isFinite(summaryTools) && summaryTools >= 0 ? summaryTools : tools.length,
    activeDays: daily.filter((row) => row.count > 0).length,
    activeUsers: toCount(summary?.active_users),
    lastUpdated: summary?.last_updated ? String(summary.last_updated) : null,
    tools,
    daily,
  };
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

function analyticsJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() },
  });
}

/**
 * Handle POST /analytics/batch - store queued events, error events, usage logs, and tool uses.
 * Every insert is retry-safe (row id or identity index) and every stored row is acknowledged by id,
 * so the client only drops rows the database actually holds. device_usage counters from older
 * clients are accepted and ignored: lifetime totals come from the frozen baseline plus tool_usage.
 */
export async function handleAnalyticsBatchPost(request, env, session) {
  try {
    const data = await request.json();
    const deviceId = String(session.deviceId);
    const userEmail = String(session.email).trim().toLowerCase();
    const events = Array.isArray(data.events) ? data.events : [];
    const usageLogs = Array.isArray(data.usage_log) ? data.usage_log : Array.isArray(data.usage_logs) ? data.usage_logs : [];
    const errorEvents = Array.isArray(data.error_events) ? data.error_events : [];
    const toolUsage = Array.isArray(data.tool_usage) ? data.tool_usage : Array.isArray(data.tool_uses) ? data.tool_uses : [];
    if (events.length + usageLogs.length + errorEvents.length + toolUsage.length > 500) {
      return new Response(JSON.stringify({ ok: false, error: "Analytics batch exceeds 500 items" }), {
        status: 413,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const inserted = { events: 0, error_events: 0, usage_log: 0, tool_usage: 0 };
    const acknowledged = { events: [], error_events: [], usage_log: [], tool_usage: [] };

    if (env.DB) {
      /** @type {{ key: keyof typeof inserted, id: string | null, statement: any }[]} */
      const rows = [];
      if (events.length > 0) await ensureEventsSchema(env);
      for (const ev of events) {
        const createdTime = tsToGmt7Plain(ev.created_time) || tsGmt7Plain();
        const featureId = normalizeFeatureId(ev.feature_id || ev.type || "unknown");
        // Clients before page_hidden sent a hidden-window pause as page_leave {reason: "hidden"}.
        const pausedVisit = ev.action === "page_leave" && ev.properties?.reason === "hidden";
        const action = pausedVisit ? "page_hidden" : String(ev.action || ev.event || "unknown");
        const { reason: _pauseReason, ...pauseProperties } = pausedVisit ? ev.properties : {};
        const properties =
          ev.properties && typeof ev.properties === "object"
            ? {
                ...(pausedVisit ? pauseProperties : ev.properties),
                runtime: safeString(ev.runtime || data.runtime, 40),
                app_version: safeString(ev.app_version || data.app_version, 60),
              }
            : ev.properties;
        let props = typeof properties === "string" ? safeString(properties, 4000) : JSON.stringify(sanitizeObject(properties || {}, 4000));
        if (
          action.startsWith("capability_") ||
          [
            "excel_import_result",
            "oracle_import_result",
            "oracle_schema_import_result",
            "schema_file_import_result",
            "import_sql_result",
          ].includes(action)
        ) {
          let details = properties;
          if (typeof details === "string") {
            try {
              details = JSON.parse(details);
            } catch (_) {
              details = {};
            }
          }
          props = JSON.stringify({ ...sanitizeObject(details || {}, 4000), actor_email: userEmail });
        }
        const eventId = rowId(ev);
        rows.push({
          key: "events",
          id: eventId,
          statement: env.DB.prepare(
            "INSERT OR IGNORE INTO events (event_id, device_id, feature_id, action, properties, created_time) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(eventId, deviceId, featureId, action, props, createdTime),
        });
      }

      if (errorEvents.length > 0) await ensureErrorEventsSchema(env);
      for (const err of errorEvents) {
        const eventId = rowId(err);
        if (isBenignError(err)) {
          if (eventId) acknowledged.error_events.push(eventId);
          continue;
        }
        rows.push({ key: "error_events", id: eventId, statement: errorEventStatement(env, err, data, userEmail, deviceId, eventId) });
      }

      for (const log of usageLogs) {
        const toolId = normalizeFeatureId(log.tool_id || "unknown");
        const action = String(log.action || "unknown");
        const createdTime = tsToGmt7Plain(log.created_time, { milliseconds: true }) || tsGmt7Plain();
        rows.push({
          key: "usage_log",
          id: rowId(log),
          statement: env.DB.prepare(
            "INSERT OR IGNORE INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES (?, ?, ?, ?, ?)",
          ).bind(userEmail, deviceId, toolId, action, createdTime),
        });
      }

      if (toolUsage.length > 0) await ensureToolUsageSchema(env);
      for (const item of toolUsage) {
        const eventId = safeString(item.event_id || item.eventId || "", 160).trim();
        const toolId = normalizeFeatureId(item.tool_id || item.toolId || "");
        const action = safeString(item.action || "", 80).trim();
        if (!eventId || !toolId || toolId === "unknown" || !action) continue;
        const properties = JSON.stringify(sanitizeObject(item.properties || item.meta || {}, 4000));
        const createdTime = tsToGmt7Plain(item.created_time || item.ts) || tsGmt7Plain();
        rows.push({
          key: "tool_usage",
          id: eventId,
          statement: env.DB.prepare(
            `INSERT OR IGNORE INTO tool_usage
             (event_id, user_email, device_id, tool_id, action, properties, source, created_time)
             VALUES (?, ?, ?, ?, ?, ?, 'client', ?)`,
          ).bind(eventId, userEmail, deviceId, toolId, action, properties, createdTime),
        });
      }

      const stored = (row) => {
        inserted[row.key]++;
        if (row.id) acknowledged[row.key].push(row.id);
      };
      if (rows.length > 0) {
        try {
          await env.DB.batch(rows.map((row) => row.statement));
          rows.forEach(stored);
        } catch (batchErr) {
          // The transaction rolled back; store what can be stored and acknowledge only those rows.
          console.error(JSON.stringify({ message: "analytics batch fell back to single inserts", error: String(batchErr) }));
          for (const row of rows) {
            try {
              await row.statement.run();
              stored(row);
            } catch (_) {}
          }
        }
      }
      if (rows.length > 0) await touchUserLastSeen(env, userEmail);
    }

    return new Response(JSON.stringify({ ok: true, inserted, acknowledged }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

// last_seen is the latest time the Worker received activity from the user; compare wall time so legacy offset-free values still order.
async function touchUserLastSeen(env, email) {
  const now = tsGmt7Plain();
  try {
    await env.DB.prepare("UPDATE users SET last_seen = ? WHERE email = ? AND substr(last_seen, 1, 19) < substr(?, 1, 19)")
      .bind(now, email, now)
      .run();
  } catch (_) {}
}

function rowId(row) {
  return safeString(row?.event_id || "", 160).trim() || null;
}

function errorEventStatement(env, err, defaults, userEmail, deviceId, eventId) {
  const lineno = Number.isFinite(Number(err.lineno)) ? Number(err.lineno) : null;
  const colno = Number.isFinite(Number(err.colno)) ? Number(err.colno) : null;
  return env.DB.prepare(
    `INSERT OR IGNORE INTO error_events (
      event_id, user_email, device_id, runtime, app_version, route, tool_id, process_area,
      error_kind, error_name, message, stack, source, lineno, colno, user_agent,
      metadata, created_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    eventId,
    userEmail,
    deviceId,
    safeString(err.runtime || defaults?.runtime || "unknown", 40),
    safeString(err.app_version || defaults?.app_version || "", 60) || null,
    safeString(err.route || "", 160) || null,
    normalizeFeatureId(err.tool_id || "") || null,
    safeString(err.process_area || "shell", 80),
    safeString(err.error_kind || "uncaught_error", 80),
    safeString(err.error_name || "Error", 120),
    safeString(err.message || "Unknown error", 300),
    safeString(err.stack || "", 1500) || null,
    safeString(err.source || "", 500) || null,
    lineno,
    colno,
    safeString(err.user_agent || "", 300) || null,
    JSON.stringify(sanitizeObject(err.metadata || {}, 300)),
    tsToGmt7Plain(err.created_time) || tsGmt7Plain(),
  );
}

/**
 * Handle POST /analytics/log - live usage log insert
 */
export async function handleAnalyticsLogPost(request, env, session) {
  try {
    // Check if live logging is enabled
    const enabled = String(env.SEND_LIVE_USER_LOG || "").toLowerCase() === "true";
    if (!enabled) {
      return new Response(JSON.stringify({ ok: false, message: "Live logging disabled" }), {
        status: 200, // Return 200 to avoid client errors
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const data = await request.json();
    const userEmail = String(session.email).trim().toLowerCase();
    const deviceId = String(session.deviceId);
    const toolId = normalizeFeatureId(data.tool_id || "unknown");
    const action = String(data.action || "unknown");
    const createdTime = tsToGmt7Plain(data.created_time, { milliseconds: true }) || tsGmt7Plain();

    let inserted = 0;
    let dbError = null;
    if (env.DB) {
      try {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES (?, ?, ?, ?, ?)",
        )
          .bind(userEmail, deviceId, toolId, action, createdTime)
          .run();
        inserted = 1;
      } catch (err) {
        dbError = String(err);
      }
    }

    if (inserted === 1) {
      return new Response(JSON.stringify({ ok: true, inserted: 1, message: "Usage log recorded successfully" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    } else {
      return new Response(
        JSON.stringify({ ok: false, inserted: 0, error: dbError || "Database unavailable", message: "Failed to record usage log" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        },
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
export async function handleAnalyticsErrorPost(request, env, session) {
  try {
    const data = await request.json();
    if (!env.DB) {
      return new Response(JSON.stringify({ ok: false, error: "Database unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    await ensureErrorEventsSchema(env);
    const userEmail = String(session.email).trim().toLowerCase();
    await errorEventStatement(env, data, data, userEmail, String(session.deviceId), rowId(data)).run();

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
  const normalized = String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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
    if (typeof item === "string")
      result[key] =
        key === "file_name"
          ? item
              .split(/[\\/]/)
              .pop()
              .replace(/\p{Cc}/gu, "")
              .slice(0, 255)
          : safeString(item, stringLimit);
    else if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "boolean") result[key] = item;
  }
  return result;
}
