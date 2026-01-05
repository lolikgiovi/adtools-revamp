/**
 * Analytics route handlers for usage tracking
 * Handles /analytics, /analytics/batch, and /analytics/log endpoints
 */

import { corsHeaders } from '../utils/cors.js';
import { tsGmt7, tsGmt7Plain, tsToGmt7Plain } from '../utils/timestamps.js';

/**
 * Handle POST /analytics - single event insert
 */
export async function handleAnalyticsPost(request, env) {
  try {
    const data = await request.json();
    const deviceId = String(data.deviceId || data.device_id || data.installId || "");
    const featureId = String(data.featureId || data.feature_id || data.type || "unknown");
    const action = String(data.action || data.event || "unknown");
    const createdTime = String(data.created_time || tsToGmt7Plain(String(data.ts || "")) || tsGmt7Plain());
    const properties = data.properties ? JSON.stringify(data.properties) : data.meta ? JSON.stringify(data.meta) : "{}";

    let ok = false;
    if (env.DB) {
      try {
        await env.DB.prepare("INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES (?, ?, ?, ?, ?)")
          .bind(deviceId || null, featureId, action, properties, createdTime)
          .run();
        ok = true;
      } catch (_) {
        ok = false;
      }
    }

    // Fallback to KV when DB unavailable
    if (!ok && env.ANALYTICS) {
      const key = `events:${deviceId || crypto.randomUUID()}:${Date.now()}`;
      // FIX: Use computed event_name instead of undefined eventName
      const eventName = `${featureId}.${action}`;
      await env.ANALYTICS.put(
        key,
        JSON.stringify({ ...data, receivedAt: tsGmt7(), event_name: eventName, properties: data.properties || data.meta || null }),
        {
          expirationTtl: 90 * 24 * 60 * 60,
        }
      );
      ok = true;
    }

    return new Response(JSON.stringify({ ok }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

/**
 * Handle GET /analytics - fetch recent events
 */
export async function handleAnalyticsGet(request, env) {
  try {
    if (env.DB) {
      try {
        const rs = await env.DB.prepare(
          "SELECT id, device_id, feature_id, action, properties, created_time FROM events ORDER BY created_time DESC LIMIT 10"
        ).all();
        const events = (rs?.results || []).map((row) => ({
          id: row.id,
          deviceId: row.device_id,
          featureId: row.feature_id,
          action: row.action,
          created_time: row.created_time,
          properties: row.properties ? JSON.parse(row.properties) : null,
        }));
        return new Response(JSON.stringify({ events }), {
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      } catch (_) {
        // Fallback query on parse error
        const rs = await env.DB.prepare(
          "SELECT id, device_id, feature_id, action, properties, created_time FROM events ORDER BY created_time DESC LIMIT 10"
        ).all();
        const events = (rs?.results || []).map((row) => ({
          id: row.id,
          deviceId: row.device_id,
          featureId: row.feature_id,
          action: row.action,
          created_time: row.created_time,
          properties: row.properties ? JSON.parse(row.properties) : null,
        }));
        return new Response(JSON.stringify({ events }), {
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }
    }

    // Fallback to KV
    const list = await env.ANALYTICS?.list({ prefix: "events:", limit: 10 });
    const items = (list && list.keys) || [];
    const events = [];
    for (const k of items) {
      const v = await env.ANALYTICS.get(k.name);
      try {
        events.push(JSON.parse(v || "{}"));
      } catch (_) {
        events.push({ raw: v });
      }
    }
    return new Response(JSON.stringify({ events }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ events: [] }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

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
        const featureId = String(ev.feature_id || ev.type || "unknown");
        const action = String(ev.action || ev.event || "unknown");
        const props = typeof ev.properties === "string" ? ev.properties : JSON.stringify(ev.properties || {});
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
        const toolId = String(du.tool_id || "unknown");
        const action = String(du.action || "unknown");
        const count = Number(du.count || 0) || 0;
        const updatedTime = String(du.updated_time || tsGmt7Plain());
        
        usageStatements.push(
          env.DB.prepare(
            "INSERT INTO device_usage (device_id, user_email, tool_id, action, count, updated_time) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id, tool_id, action) DO UPDATE SET user_email = excluded.user_email, count = excluded.count, updated_time = excluded.updated_time"
          ).bind(devId, email, toolId, action, count, updatedTime)
        );
      }

      // Execute all statements in a single batch transaction
      const allStatements = [...eventStatements, ...usageStatements];
      if (allStatements.length > 0) {
        try {
          const results = await env.DB.batch(allStatements);
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
 * Handle GET /analytics/batch - upsert device_usage via query params
 */
export async function handleAnalyticsBatchGet(request, env) {
  try {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device_id") || "unknown";
    const userEmail = (url.searchParams.get("user_email") || "").trim().toLowerCase() || null;
    const toolId = url.searchParams.get("tool_id") || "unknown";
    const action = url.searchParams.get("action") || "unknown";
    const count = Number(url.searchParams.get("count") || 0) || 0;
    const updatedTime = url.searchParams.get("updated_time") || tsGmt7Plain();

    let inserted = 0;
    let dbError = null;
    if (env.DB && count > 0) {
      try {
        await env.DB.prepare(
          "INSERT INTO get_device_usage (device_id, user_email, tool_id, action, count, updated_time) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id, tool_id, action) DO UPDATE SET user_email = excluded.user_email, count = excluded.count, updated_time = excluded.updated_time"
        )
          .bind(deviceId, userEmail, toolId, action, count, updatedTime)
          .run();
        inserted = 1;
      } catch (err) {
        dbError = String(err);
      }
    }

    if (count === 0) {
      return new Response(
        JSON.stringify({ ok: false, inserted: 0, method: "GET", error: "count must be greater than 0", message: "Invalid count value" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        }
      );
    }

    if (inserted === 1) {
      return new Response(
        JSON.stringify({ ok: true, inserted: 1, method: "GET", message: "Device usage recorded successfully" }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ ok: false, inserted: 0, method: "GET", error: dbError || "Database unavailable", message: "Failed to record device usage" }),
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
    const toolId = String(data.tool_id || "unknown");
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
 * Handle GET /analytics/log - live usage log insert via query params
 */
export async function handleAnalyticsLogGet(request, env) {
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

    const url = new URL(request.url);
    const userEmail = (url.searchParams.get("user_email") || "").trim().toLowerCase();
    const deviceId = url.searchParams.get("device_id") || "unknown";
    const toolId = url.searchParams.get("tool_id") || "unknown";
    const action = url.searchParams.get("action") || "unknown";
    const createdTime = url.searchParams.get("created_time") || tsGmt7Plain();

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
        await env.DB.prepare("INSERT INTO get_usage_log (user_email, device_id, tool_id, action, created_time) VALUES (?, ?, ?, ?, ?)")
          .bind(userEmail, deviceId, toolId, action, createdTime)
          .run();
        inserted = 1;
      } catch (err) {
        dbError = String(err);
      }
    }

    if (inserted === 1) {
      return new Response(
        JSON.stringify({ ok: true, inserted: 1, method: "GET", message: "Usage log recorded successfully" }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ ok: false, inserted: 0, method: "GET", error: dbError || "Database unavailable", message: "Failed to record usage log" }),
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
