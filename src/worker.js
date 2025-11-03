// Cloudflare Worker to serve static SPA and provide KV-backed endpoints
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method || "GET";

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Dev-only: seed local R2 with a sample manifest and artifact
    if (url.pathname === "/dev/seed-update") {
      if (String(env.DEV_MODE || "") !== "true") {
        return new Response("Not Found", { status: 404, headers: corsHeaders() });
      }
      if (method !== "POST") return methodNotAllowed();
      return handleDevSeedUpdate(request, env);
    }

    // Updater: static manifest by channel under /update/*
    if (url.pathname.startsWith("/update/")) {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed();
      return handleManifestRequest(request, env);
    }

    // Updater: immutable artifact streaming with range support under /releases/*
    if (url.pathname.startsWith("/releases/")) {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed();
      return handleArtifactRequest(request, env);
    }

    // API routes
    if (url.pathname === "/whitelist.json") {
      return handleWhitelist(env);
    }

    // New OTP registration routes
    if (url.pathname === "/register/request-otp") {
      if (method !== "POST") return methodNotAllowed();
      return handleRegisterRequestOtp(request, env);
    }
    if (url.pathname === "/register/verify") {
      if (method !== "POST") return methodNotAllowed();
      return handleRegisterVerify(request, env);
    }

    if (url.pathname === "/register") {
      if (method !== "POST") return methodNotAllowed();
      return handleRegister(request, env);
    }

    if (url.pathname === "/analytics") {
      if (method === "POST") return handleAnalyticsPost(request, env);
      if (method === "GET") return handleAnalyticsGet(request, env);
    }
    if (url.pathname === "/analytics/batch") {
      if (method !== "POST") return methodNotAllowed();
      return handleAnalyticsBatchPost(request, env);
    }

    // Static assets via Wrangler assets binding with SPA fallback
    try {
      const res = await env.ASSETS.fetch(request);
      if (res && res.status !== 404) return res;
    } catch (_) {
      // Continue to SPA fallback below
    }

    // SPA fallback: always serve index.html for unknown GET routes
    if (method === "GET") {
      const indexUrl = new URL("/index.html", url);
      try {
        return await env.ASSETS.fetch(new Request(indexUrl, request));
      } catch (err) {
        return new Response("Not Found", { status: 404 });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range, If-None-Match, If-Range, X-ADTOOLS-Update-Channel, X-Device-Id, Authorization",
    "Access-Control-Expose-Headers": "ETag, Content-Length, Accept-Ranges, Content-Range",
    Vary: "Origin",
  };
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

async function handleWhitelist(env) {
  try {
    const flag = String(env.WHITELIST_ENABLED ?? "true").toLowerCase();
    const disabled = flag === "false" || flag === "0" || flag === "no" || flag === "off";
    if (disabled) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    // Expect KV value as either an array JSON or object with emails key
    const raw = await env.WHITELIST?.get("emails");
    let body = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) body = parsed;
        else if (parsed && Array.isArray(parsed.emails)) body = parsed.emails;
        else if (parsed && Array.isArray(parsed.whitelistEmails)) body = parsed.whitelistEmails;
        else if (parsed && Array.isArray(parsed.allowedEmails)) body = parsed.allowedEmails;
      } catch (_) {
        body = [];
      }
    }
    // Normalize to lowercase
    body = (body || [])
      .map((e) =>
        String(e || "")
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

async function handleRegister(request, env) {
  try {
    const data = await request.json();
    const deviceId = String(data.deviceId || data.device_id || data.installId || "");
    const key = `registrations:${deviceId || "anon"}:${Date.now()}`;
    await env.ANALYTICS?.put(key, JSON.stringify({ ...data, receivedAt: new Date().toISOString() }), {
      expirationTtl: 90 * 24 * 60 * 60, // 90 days
    });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

// Timestamp helpers: store and compare using GMT+7 formatted strings
function tsGmt7(offsetMs = 0) {
  const base = Date.now() + 7 * 60 * 60 * 1000 + (offsetMs || 0);
  const d = new Date(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${y}-${m}-${day}T${hh}:${mi}:${ss}.${ms}+07:00`;
}
function tsGmt7Plain(offsetMs = 0) {
  const base = Date.now() + 7 * 60 * 60 * 1000 + (offsetMs || 0);
  const d = new Date(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mi}:${ss}+07:00`;
}
function dayGmt7(offsetMs = 0) {
  const base = Date.now() + 7 * 60 * 60 * 1000 + (offsetMs || 0);
  const d = new Date(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseTsFlexible(x) {
  if (typeof x === "number") return x;
  const s = String(x || "");
  const num = Number(s);
  if (!Number.isNaN(num)) return num;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

// Request an OTP code for email verification
async function handleRegisterRequestOtp(request, env) {
  try {
    const { email } = await request.json();
    const normalized = String(email || "")
      .trim()
      .toLowerCase();
    if (!/.+@.+\..+/.test(normalized))
      return new Response(JSON.stringify({ ok: false, error: "Invalid email" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const nowTs = tsGmt7();
    const expiresTs = tsGmt7(10 * 60 * 1000); // +10 minutes

    if (env.DB) {
      try {
        await env.DB.prepare("INSERT INTO otp (email, code, expires_at) VALUES (?, ?, ?)")
          .bind(normalized, code, tsGmt7Plain(10 * 60 * 1000))
          .run();
      } catch (_) {}
    }

    // Try to send via MailChannels; capture status for dev
    let sendResult = null;
    try {
      sendResult = await sendOtpEmail(env, normalized, code);
    } catch (e) {
      sendResult = { ok: false, error: String(e) };
    }
    const sent = !!(sendResult && sendResult.ok);

    const payload =
      String(env.DEV_MODE || "") === "true" ? { ok: true, devCode: code, mailSent: sent, mailStatus: sendResult } : { ok: true };

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

// Verify OTP and create/link user
async function handleRegisterVerify(request, env) {
  try {
    const data = await request.json();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const code = String(data.code || "").trim();
    const deviceIdRaw = String(data.deviceId || data.device_id || data.installId || "").trim();
    const ua = request.headers.get("User-Agent") || "";
    const payloadPlatform = String(data.platform || "").trim();
    const payloadBrowser = String(data.browser || "").trim();
    const tauriHint =
      /tauri/i.test(ua) ||
      /tauri/i.test(payloadPlatform) ||
      /tauri/i.test(payloadBrowser) ||
      (payloadPlatform === "Desktop" && (!payloadBrowser || /unknown/i.test(payloadBrowser)));
    let platform = tauriHint ? "Desktop" : payloadPlatform || "Browser";
    const browserUA = /Firefox\//i.test(ua)
      ? "Firefox"
      : /Edg\//i.test(ua)
      ? "Edge"
      : /Chrome\//i.test(ua) && !/Chromium\//i.test(ua)
      ? "Chrome"
      : /Safari\//i.test(ua) && !/Chrome\//i.test(ua)
      ? "Safari"
      : /Chromium\//i.test(ua)
      ? "Chromium"
      : "Unknown";
    const browserFromPayload = payloadBrowser && !/unknown/i.test(payloadBrowser) ? payloadBrowser : null;
    let browser = tauriHint ? "Tauri" : browserFromPayload || browserUA;
    if (!tauriHint && (!payloadBrowser || /unknown/i.test(payloadBrowser)) && (!payloadPlatform || /browser/i.test(payloadPlatform))) {
      platform = "Desktop";
      browser = "Tauri";
    }
    const deviceId = deviceIdRaw || (data.displayName ? `${String(data.displayName).trim()}-${crypto.randomUUID()}` : crypto.randomUUID());
    const displayName = String(data.displayName || "").trim();

    if (!email || !code) {
      return new Response(JSON.stringify({ ok: false, error: "Missing email or code" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    if (!env.DB)
      return new Response(JSON.stringify({ ok: false, error: "DB unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });

    const nowMs = Date.now();
    const row = await env.DB.prepare("SELECT id, expires_at, consumed_at FROM otp WHERE email = ? AND code = ? ORDER BY id DESC LIMIT 1")
      .bind(email, code)
      .first();

    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid code" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    if (row.consumed_at) {
      return new Response(JSON.stringify({ ok: false, error: "Code already used" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    const expMs = parseTsFlexible(row.expires_at);
    if (expMs < nowMs) {
      return new Response(JSON.stringify({ ok: false, error: "Code expired" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // Consume the code
    await env.DB.prepare("UPDATE otp SET consumed_at = ? WHERE id = ?").bind(tsGmt7Plain(), row.id).run();

    const salt = String(env.SECRET_SALT || "");

    // Upsert user (unique by email)
    await env.DB.prepare(
      "INSERT INTO users (email, created_time, last_seen) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen"
    )
      .bind(email, tsGmt7Plain(), tsGmt7Plain())
      .run();
    const userRow = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    const userId = userRow?.id || null;

    await env.DB.prepare(
      "INSERT INTO device (device_id, user_id, platform, created_time, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen = excluded.last_seen"
    )
      .bind(deviceId, userId, platform, tsGmt7Plain(), tsGmt7Plain())
      .run();

    return new Response(JSON.stringify({ ok: true, userId }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

async function handleAnalyticsPost(request, env) {
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

async function handleAnalyticsGet(request, env) {
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

async function sendOtpEmail(env, to, code) {
  try {
    const subjectPrefix = String(env.MAIL_SUBJECT_PREFIX || "[AD Tools]");
    const subject = `${subjectPrefix} Verify your email`;
    const fromEmail = String(env.MAIL_FROM || "no-reply@adtools.local");
    const body = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail },
      subject,
      content: [
        {
          type: "text/plain",
          value: `Your verification code is ${code}. It expires in 10 minutes.`,
        },
      ],
    });
    const headers = { "Content-Type": "application/json" };
    const apiKey = env.MAILCHANNELS_API_KEY || env.MAILCHANNELS_TOKEN || "";
    if (apiKey) headers["X-Api-Key"] = apiKey;

    const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers,
      body,
    });
    let text = "";
    try {
      text = await res.text();
    } catch (_) {}
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Batch analytics: insert events and upsert daily_usage
async function handleAnalyticsBatchPost(request, env) {
  try {
    const data = await request.json();
    const deviceId = String(data.device_id || data.deviceId || "");
    const events = Array.isArray(data.events) ? data.events : [];
    const daily = Array.isArray(data.daily_usage) ? data.daily_usage : [];

    let insertedEvents = 0;
    let upsertsDaily = 0;
    if (env.DB) {
      for (const ev of events) {
        try {
          const createdTime = String(ev.created_time || tsGmt7Plain());
          const featureId = String(ev.feature_id || ev.type || "unknown");
          const action = String(ev.action || ev.event || "unknown");
          const props = typeof ev.properties === "string" ? ev.properties : JSON.stringify(ev.properties || {});
          const dev = String(ev.device_id || deviceId || "") || null;
          await env.DB.prepare("INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES (?, ?, ?, ?, ?)")
            .bind(dev, featureId, action, props, createdTime)
            .run();
          insertedEvents++;
        } catch (_) {}
      }
      for (const du of daily) {
        try {
          const day = String(du.day || dayGmt7());
          const userId = Number(du.user_id);
          const toolId = String(du.tool_id || du.feature_id || "unknown");
          const action = String(du.action || "unknown");
          const count = Number(du.count || 0) || 0;
          const updatedTime = String(du.updated_time || tsGmt7Plain());
          await env.DB.prepare(
            "INSERT INTO daily_usage (day, user_id, tool_id, action, count, updated_time) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(day, user_id, tool_id, action) DO UPDATE SET count = daily_usage.count + excluded.count, updated_time = excluded.updated_time"
          )
            .bind(day, userId, toolId, action, count, updatedTime)
            .run();
          upsertsDaily++;
        } catch (_) {}
      }
    }

    return new Response(JSON.stringify({ ok: true, inserted: { events: insertedEvents, daily_usage: upsertsDaily } }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

function tsToGmt7Plain(s) {
  try {
    const t = Date.parse(String(s || ""));
    if (Number.isNaN(t)) return null;
    const d = new Date(t + 7 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mi}:${ss}+07:00`;
  } catch (_) {
    return null;
  }
}

// =========================
// Updater endpoints (Phase 1)
// =========================

async function handleManifestRequest(request, env) {
  try {
    const url = new URL(request.url);
    const channelFile = url.pathname.split("/").pop() || "";
    if (!/^[a-z]+\.json$/i.test(channelFile)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid manifest path" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    const key = `update/${channelFile}`;
    const head = await env.UPDATES?.head(key);
    if (!head) {
      return new Response(JSON.stringify({ ok: false, error: "Manifest not found", key }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() },
      });
    }
    const etag = head.httpEtag || head.etag || undefined;
    const baseHeaders = {
      "Cache-Control": "public, max-age=60",
      ETag: etag,
      "Accept-Ranges": "bytes",
      ...corsHeaders(),
    };

    // Conditional: If-None-Match -> 304 Not Modified
    const inm = request.headers.get("If-None-Match");
    const inmMatch =
      inm &&
      etag &&
      inm
        .split(",")
        .map((s) => s.trim())
        .some((t) => t === "*" || t === etag);
    if (inmMatch) {
      return new Response(null, { status: 304, headers: { ...baseHeaders } });
    }

    // HEAD with no conditional match
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { ...baseHeaders, "Content-Type": "application/json", "Content-Length": String(head.size || "") },
      });
    }
    const obj = await env.UPDATES.get(key);
    if (!obj || !obj.body) {
      return new Response(JSON.stringify({ ok: false, error: "Manifest missing" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() },
      });
    }
    return new Response(obj.body, {
      status: 200,
      headers: { ...baseHeaders, "Content-Type": "application/json", "Content-Length": String(head.size || "") },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}

async function handleArtifactRequest(request, env) {
  const url = new URL(request.url);
  const key = url.pathname.replace(/^\/+/, ""); // releases/...
  try {
    const head = await env.UPDATES?.head(key);
    if (!head) {
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
    }
    const total = head.size || 0;
    const etag = head.httpEtag || head.etag || undefined;
    const ct = contentTypeForKey(key, head);

    const rangeHeader = request.headers.get("Range");
    const range = parseRange(rangeHeader, total);
    const common = {
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Content-Type": ct,
      "Cache-Control": "public, max-age=31536000, immutable",
      ...corsHeaders(),
    };

    if (request.method === "HEAD" && !range) {
      return new Response(null, { status: 200, headers: { ...common, "Content-Length": String(total) } });
    }

    // If a Range header is present but unsatisfiable/invalid, return 416 with size
    if (rangeHeader && !range) {
      return new Response("Requested Range Not Satisfiable", {
        status: 416,
        headers: { ...common, "Content-Range": `bytes */${total}` },
      });
    }

    if (range) {
      const { start, end } = range;
      if (start >= total) {
        return new Response("Requested Range Not Satisfiable", {
          status: 416,
          headers: { ...common, "Content-Range": `bytes */${total}` },
        });
      }
      const length = end - start + 1;
      const obj = await env.UPDATES.get(key, { range: { offset: start, length } });
      if (!obj || !obj.body) {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
      }
      return new Response(request.method === "HEAD" ? null : obj.body, {
        status: 206,
        headers: {
          ...common,
          "Content-Length": String(length),
          "Content-Range": `bytes ${start}-${end}/${total}`,
        },
      });
    }

    const obj = await env.UPDATES.get(key);
    if (!obj || !obj.body) {
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
    }
    return new Response(obj.body, { status: 200, headers: { ...common, "Content-Length": String(total) } });
  } catch (err) {
    return new Response("Server Error", { status: 500, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
  }
}

function parseRange(header, size) {
  if (!header || !/^bytes=/.test(header)) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  let start = m[1] === "" ? null : Number(m[1]);
  let end = m[2] === "" ? null : Number(m[2]);
  if (Number.isNaN(start)) start = null;
  if (Number.isNaN(end)) end = null;
  if (start === null && end === null) return null;
  if (start === null) {
    const length = Math.min(Number(end), size);
    return { start: size - length, end: size - 1 };
  }
  if (end === null || end >= size) end = size - 1;
  if (start > end) return null;
  return { start, end };
}

function contentTypeForKey(key, head) {
  const hinted = head?.httpMetadata?.contentType || head?.httpMetadata?.content_type || "";
  if (hinted) return hinted;
  if (/\.json$/i.test(key)) return "application/json";
  if (/\.gz$/i.test(key)) return "application/gzip";
  if (/\.tar$/i.test(key)) return "application/x-tar";
  if (/\.dmg$/i.test(key)) return "application/x-apple-diskimage";
  return "application/octet-stream";
}

async function handleDevSeedUpdate(request, env) {
  try {
    if (!env.UPDATES || typeof env.UPDATES.put !== "function") {
      return new Response(JSON.stringify({ ok: false, error: "R2 not bound as UPDATES" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    const origin = new URL(request.url).origin;
    const version = "0.0.1";
    const channel = "stable";
    const arch = "aarch64";
    const artifactKey = `releases/${version}/${channel}/${arch}/test.bin`;
    const manifestKey = `update/${channel}.json`;
    const artifactBody = new TextEncoder().encode("hello world");
    await env.UPDATES.put(artifactKey, artifactBody, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const manifest = {
      version,
      minVersion: "0.0.0",
      notes: "Seeded manifest",
      pub_date: new Date().toISOString(),
      platforms: {
        [arch]: {
          signature: "TEST_SIGNATURE",
          url: `${origin}/releases/${version}/${channel}/${arch}/test.bin`,
        },
      },
    };
    await env.UPDATES.put(manifestKey, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    });
    return new Response(JSON.stringify({ ok: true, manifestKey, artifactKey }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}
