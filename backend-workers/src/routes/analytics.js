/**
 * Analytics route handlers for usage tracking
 * Handles authenticated ingestion plus deliberately limited public overview/feedback endpoints.
 */

import { corsHeaders } from "../utils/cors.js";
import { ensureErrorEventsSchema } from "../utils/analyticsSchema.js";
import { consumeRateLimit } from "../utils/rateLimit.js";
import { tsGmt7, tsGmt7Plain, tsToGmt7Plain } from "../utils/timestamps.js";

const OVERVIEW_DAILY_SQL = `
  SELECT SUBSTR(created_time, 1, 10) AS day, COUNT(*) AS count
  FROM (
    SELECT DISTINCT
      LOWER(user_email) AS user_email,
      device_id,
      CASE
        WHEN tool_id IN ('jenkins-runner', 'run-query') THEN 'run-query'
        WHEN tool_id IN ('master_lockey', 'master-lockey') THEN 'master-lockey'
        WHEN tool_id IN ('json_tools', 'json-tools') THEN 'json-tools'
        ELSE tool_id
      END AS tool_id,
      action,
      created_time
    FROM usage_log
    WHERE created_time >= datetime('now', '+7 hours', '-6 days')
      AND LOWER(TRIM(tool_id)) != 'velocity-template'
      {{USER_FILTER}}
  )
  GROUP BY day
  ORDER BY day ASC
`;

const LEGACY_DEVICE_USAGE_TOOL_IDS = "'jenkins-runner', 'master_lockey', 'json_tools'";
const IGNORED_ANALYTICS_TOOL_ID = "velocity-template";

/**
 * Return one absolute snapshot per device/action/tool identity. Older clients wrote a few
 * non-canonical tool IDs, while newer clients migrate those local counts into the canonical row.
 * When both rows exist, the canonical row is authoritative; an alias is retained only when no
 * canonical snapshot exists for the same device/action.
 */
function buildCanonicalDeviceUsageSql() {
  return `
    SELECT device_id, user_email, tool_id, action, count, updated_time
    FROM device_usage
    WHERE tool_id NOT IN (${LEGACY_DEVICE_USAGE_TOOL_IDS})
      AND LOWER(TRIM(tool_id)) != '${IGNORED_ANALYTICS_TOOL_ID}'
    UNION ALL
    SELECT legacy.device_id, legacy.user_email,
      CASE legacy.tool_id
        WHEN 'jenkins-runner' THEN 'run-query'
        WHEN 'master_lockey' THEN 'master-lockey'
        WHEN 'json_tools' THEN 'json-tools'
      END AS tool_id,
      legacy.action, legacy.count, legacy.updated_time
    FROM device_usage AS legacy
    WHERE legacy.tool_id IN (${LEGACY_DEVICE_USAGE_TOOL_IDS})
      AND NOT EXISTS (
        SELECT 1
        FROM device_usage AS canonical
        WHERE canonical.device_id = legacy.device_id
          AND canonical.action = legacy.action
          AND canonical.tool_id = CASE legacy.tool_id
            WHEN 'jenkins-runner' THEN 'run-query'
            WHEN 'master_lockey' THEN 'master-lockey'
            WHEN 'json_tools' THEN 'json-tools'
          END
      )
  `;
}

/**
 * Handle GET /analytics/overview - authenticated personal and aggregate usage overview.
 * Cumulative totals come from device_usage; the seven-day pulse comes from usage_log.
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

    return analyticsJson({ ok: true, message: "Improvement note received" }, 201);
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

    return analyticsJson({ ok: true, message: "Improvement note received" }, 201);
  } catch (err) {
    console.error(JSON.stringify({ message: "public improvement feedback failed", error: String(err) }));
    return analyticsJson({ ok: false, error: "Could not save the improvement note" }, 500);
  }
}

async function loadOverviewData(env, userEmail, source) {
  const canonicalDeviceUsageSql = buildCanonicalDeviceUsageSql();
  const [userToolsResult, globalToolsResult, userSummary, globalSummary, userDailyResult, globalDailyResult] = await Promise.all([
    env.DB
      .prepare(
        `WITH canonical_device_usage AS (${canonicalDeviceUsageSql})
         SELECT tool_id, SUM(CASE WHEN count > 0 THEN count ELSE 0 END) AS count
         FROM canonical_device_usage
         WHERE LOWER(COALESCE(user_email, '')) = ?
         GROUP BY tool_id
         HAVING SUM(CASE WHEN count > 0 THEN count ELSE 0 END) > 0
         ORDER BY count DESC, tool_id ASC
         LIMIT 100`,
      )
      .bind(userEmail)
      .all(),
    env.DB
      .prepare(
        `WITH canonical_device_usage AS (${canonicalDeviceUsageSql})
         SELECT tool_id, SUM(CASE WHEN count > 0 THEN count ELSE 0 END) AS count
         FROM canonical_device_usage
         GROUP BY tool_id
         HAVING SUM(CASE WHEN count > 0 THEN count ELSE 0 END) > 0
         ORDER BY count DESC, tool_id ASC
         LIMIT 100`,
      )
      .all(),
    env.DB
      .prepare(
        `WITH canonical_device_usage AS (${canonicalDeviceUsageSql})
         SELECT
           COALESCE(SUM(CASE WHEN count > 0 THEN count ELSE 0 END), 0) AS total_activities,
           COUNT(DISTINCT CASE WHEN count > 0 THEN tool_id END) AS tools_used,
           MAX(updated_time) AS last_updated
         FROM canonical_device_usage
         WHERE LOWER(COALESCE(user_email, '')) = ?`,
      )
      .bind(userEmail)
      .first(),
    env.DB
      .prepare(
        `WITH canonical_device_usage AS (${canonicalDeviceUsageSql})
         SELECT
           COALESCE(SUM(CASE WHEN count > 0 THEN count ELSE 0 END), 0) AS total_activities,
           COUNT(DISTINCT CASE WHEN count > 0 THEN tool_id END) AS tools_used,
           COUNT(DISTINCT CASE WHEN count > 0 THEN LOWER(user_email) END) AS active_users,
           MAX(updated_time) AS last_updated
         FROM canonical_device_usage`,
      )
      .first(),
    env.DB.prepare(OVERVIEW_DAILY_SQL.replace("{{USER_FILTER}}", "AND LOWER(user_email) = ?")).bind(userEmail).all(),
    env.DB.prepare(OVERVIEW_DAILY_SQL.replace("{{USER_FILTER}}", "")).all(),
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
  const email = safeString(value || "", 254).trim().toLowerCase();
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
 * Handle POST /analytics/batch - batch insert events/usage logs and upsert device_usage
 * IMPROVEMENTS:
 * - Uses env.DB.batch() for single transaction (performance)
 * - Removed legacy daily_usage and user_usage writes
 */
export async function handleAnalyticsBatchPost(request, env, session) {
  try {
    const data = await request.json();
    const deviceId = String(session.deviceId);
    const userEmail = String(session.email).trim().toLowerCase();
    const events = Array.isArray(data.events) ? data.events : [];
    const usageLogs = Array.isArray(data.usage_log) ? data.usage_log : Array.isArray(data.usage_logs) ? data.usage_logs : [];
    const errorEvents = Array.isArray(data.error_events) ? data.error_events : [];
    const deviceUsage = Array.isArray(data.device_usage) ? data.device_usage : [];
    if (events.length + usageLogs.length + errorEvents.length + deviceUsage.length > 500) {
      return new Response(JSON.stringify({ ok: false, error: "Analytics batch exceeds 500 items" }), {
        status: 413,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    let insertedEvents = 0;
    let insertedUsageLogs = 0;
    let insertedErrorEvents = 0;
    let upsertsDevice = 0;

    if (env.DB) {
      // Build batch statements for events
      const eventStatements = [];
      for (const ev of events) {
        const createdTime = String(ev.created_time || tsGmt7Plain());
        const featureId = normalizeFeatureId(ev.feature_id || ev.type || "unknown");
        if (isIgnoredAnalyticsTool(featureId)) continue;
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
        const dev = deviceId;

        eventStatements.push(
          env.DB.prepare("INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES (?, ?, ?, ?, ?)").bind(
            dev,
            featureId,
            action,
            props,
            createdTime,
          ),
        );
      }

      const errorStatements = [];
      if (errorEvents.length > 0) {
        await ensureErrorEventsSchema(env);
      }
      for (const err of errorEvents) {
        const userEmailForError = userEmail;
        const deviceIdForError = deviceId;
        const runtime = safeString(err.runtime || data.runtime || "unknown", 40);
        const appVersion = safeString(err.app_version || data.app_version || "", 60) || null;
        const route = safeString(err.route || "", 160) || null;
        const toolId = normalizeFeatureId(err.tool_id || "");
        if (isIgnoredAnalyticsTool(toolId)) continue;
        const processArea = safeString(err.process_area || "shell", 80);
        const errorKind = safeString(err.error_kind || "uncaught_error", 80);
        const errorName = safeString(err.error_name || "Error", 120);
        const message = safeString(err.message || "Unknown error", 300);
        const stack = safeString(err.stack || "", 1500) || null;
        const source = safeString(err.source || "", 500) || null;
        const lineno = Number.isFinite(Number(err.lineno)) ? Number(err.lineno) : null;
        const colno = Number.isFinite(Number(err.colno)) ? Number(err.colno) : null;
        const userAgent = safeString(err.user_agent || "", 300) || null;
        const metadata = JSON.stringify(sanitizeObject(err.metadata || {}, 300));
        const createdTime = tsToGmt7Plain(err.created_time) || tsGmt7Plain();

        errorStatements.push(
          env.DB.prepare(
            `INSERT INTO error_events (
              user_email, device_id, runtime, app_version, route, tool_id, process_area,
              error_kind, error_name, message, stack, source, lineno, colno, user_agent,
              metadata, created_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            userEmailForError,
            deviceIdForError,
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
            createdTime,
          ),
        );
      }

      const usageLogStatements = [];
      for (const log of usageLogs) {
        const email = userEmail;
        const dev = deviceId;
        const toolId = normalizeFeatureId(log.tool_id || "unknown");
        if (isIgnoredAnalyticsTool(toolId)) continue;
        const action = String(log.action || "unknown");
        const createdTime = String(log.created_time || tsGmt7Plain());

        usageLogStatements.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES (?, ?, ?, ?, ?)",
          ).bind(email, dev, toolId, action, createdTime),
        );
      }

      // Build batch statements for device_usage (idempotent - replaces counts)
      const usageStatements = [];
      for (const du of deviceUsage) {
        const devId = deviceId;
        const email = userEmail;
        const toolId = normalizeFeatureId(du.tool_id || "unknown");
        if (isIgnoredAnalyticsTool(toolId)) continue;
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
               updated_time = excluded.updated_time`,
          ).bind(devId, email, toolId, action, count, updatedTime),
        );
      }

      // Execute all statements in a single batch transaction
      const allStatements = [...eventStatements, ...errorStatements, ...usageLogStatements, ...usageStatements];
      if (allStatements.length > 0) {
        try {
          await env.DB.batch(allStatements);
          // Count successful inserts
          insertedEvents = eventStatements.length;
          insertedErrorEvents = errorStatements.length;
          insertedUsageLogs = usageLogStatements.length;
          upsertsDevice = usageStatements.length;
        } catch (batchErr) {
          // Fallback to individual inserts if batch fails
          for (const stmt of eventStatements) {
            try {
              await stmt.run();
              insertedEvents++;
            } catch (_) {}
          }
          for (const stmt of errorStatements) {
            try {
              await stmt.run();
              insertedErrorEvents++;
            } catch (_) {}
          }
          for (const stmt of usageLogStatements) {
            try {
              await stmt.run();
              insertedUsageLogs++;
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
      JSON.stringify({
        ok: true,
        inserted: { events: insertedEvents, error_events: insertedErrorEvents, usage_log: insertedUsageLogs, device_usage: upsertsDevice },
      }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      },
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
    if (isIgnoredAnalyticsTool(toolId)) {
      return new Response(JSON.stringify({ ok: true, inserted: 0, ignored: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    const action = String(data.action || "unknown");
    const createdTime = String(data.created_time || tsGmt7Plain());

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
    const userEmail = String(session.email).trim().toLowerCase();
    const deviceId = String(session.deviceId);
    const runtime = safeString(data.runtime || "unknown", 40);
    const appVersion = safeString(data.app_version || "", 60) || null;
    const route = safeString(data.route || "", 160) || null;
    const toolId = normalizeFeatureId(data.tool_id || "");
    if (isIgnoredAnalyticsTool(toolId)) {
      return new Response(JSON.stringify({ ok: true, inserted: 0, ignored: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        createdTime,
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

function isIgnoredAnalyticsTool(toolId) {
  return String(toolId || "").trim().toLowerCase() === IGNORED_ANALYTICS_TOOL_ID;
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
    if (typeof item === "string") result[key] = safeString(item, stringLimit);
    else if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "boolean") result[key] = item;
  }
  return result;
}
