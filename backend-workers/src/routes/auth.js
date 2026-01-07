/**
 * Authentication route handlers
 * Handles /register, /register/request-otp, /register/verify, and /api/kv/get
 */

import { corsHeaders, isOriginAllowed } from '../utils/cors.js';
import { tsGmt7, tsGmt7Plain, parseTsFlexible } from '../utils/timestamps.js';
import { isEmailDomainAllowed, sendOtpEmail } from '../utils/email.js';

/**
 * Handle POST /register - legacy registration
 */
export async function handleRegister(request, env) {
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

/**
 * Handle POST /register/request-otp - request OTP code for email verification
 */
export async function handleRegisterRequestOtp(request, env) {
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

    if (!isEmailDomainAllowed(normalized, env)) {
      return new Response(JSON.stringify({ ok: false, error: "Email domain not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // Rate-limit OTP requests per email using KV (10 min window, max 3)
    try {
      if (env.adtools) {
        const rlKey = `otp:rl:${normalized}`;
        const rlRaw = await env.adtools.get(rlKey);
        const rl = rlRaw ? JSON.parse(rlRaw) : { count: 0 };
        if (rl.count >= 3) {
          return new Response(JSON.stringify({ ok: false, error: "Too many OTP requests. Try later." }), {
            status: 429,
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        }
        await env.adtools.put(rlKey, JSON.stringify({ count: rl.count + 1, updatedAt: tsGmt7() }), { expirationTtl: 10 * 60 });
      }
    } catch (_) {}

    const code = String(Math.floor(100000 + Math.random() * 900000));
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
      String(env.DEV_MODE || "") === "true"
        ? { ok: true, devCode: code, mailSent: sent, mailStatus: sendResult, expiresAt: expiresTs }
        : { ok: true, expiresAt: expiresTs };

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

/**
 * Handle POST /register/verify - verify OTP and create/link user
 */
export async function handleRegisterVerify(request, env) {
  try {
    const data = await request.json();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const code = String(data.code || "").trim();
    const deviceIdRaw = String(data.deviceId || data.device_id || data.installId || "").trim();
    const ua = request.headers.get("User-Agent") || "";
    const payloadPlatform = String(data.platform || "").trim();
    
    // Decide platform label
    let platform;
    if (/^desktop\s*\(tauri\)$/i.test(payloadPlatform) || /tauri/i.test(payloadPlatform)) {
      platform = payloadPlatform || "Desktop (Tauri)";
    } else {
      platform = /Firefox\//i.test(ua)
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
    }
    const deviceId = deviceIdRaw || (data.displayName ? `${String(data.displayName).trim()}-${crypto.randomUUID()}` : crypto.randomUUID());

    if (!email || !code) {
      return new Response(JSON.stringify({ ok: false, error: "Missing email or code" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    if (!isEmailDomainAllowed(email, env)) {
      return new Response(JSON.stringify({ ok: false, error: "Email domain not allowed" }), {
        status: 403,
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

    // Upsert user (unique by email) with UUID id
    const existingUser = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    const newUserId = existingUser?.id || crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, created_time, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen"
    )
      .bind(newUserId, email, tsGmt7Plain(), tsGmt7Plain())
      .run();
    const userRow = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    const userId = userRow?.id || newUserId;

    await env.DB.prepare(
      "INSERT INTO device (device_id, user_id, platform, created_time, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen = excluded.last_seen"
    )
      .bind(deviceId, userId, platform, tsGmt7Plain(), tsGmt7Plain())
      .run();

    // Create short-lived session token to authorize KV access (6-hour TTL)
    let token = crypto.randomUUID();
    try {
      if (env.adtools) {
        await env.adtools.put(`session:${token}`, JSON.stringify({ email, userId, createdAt: tsGmt7() }), { expirationTtl: 6 * 60 * 60 });
      }
    } catch (_) {}

    return new Response(JSON.stringify({ ok: true, userId, token }), {
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
 * Handle GET /api/kv/get - secure KV getter
 */
export async function handleKvGet(request, env) {
  try {
    if (!isOriginAllowed(request, env)) {
      return new Response(JSON.stringify({ ok: false, error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const token = m ? m[1] : "";
    if (!token || !env.adtools) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
      });
    }
    const session = await env.adtools.get(`session:${token}`);
    if (!session) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
      });
    }
    const url = new URL(request.url);
    let key = url.searchParams.get("key") || "";
    // Block access to reserved internal keys
    if (/^(session:|otp:)/.test(key)) {
      return new Response(JSON.stringify({ ok: false, error: "Key not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
      });
    }
    let val;
    try {
      // Try exact key first
      val = await env.adtools.get(key);
      // Compatibility fallback: try prefixed/unprefixed variants
      if (val == null) {
        if (/^settings\//.test(key)) {
          const alternate = key.replace(/^settings\//, "");
          if (alternate) {
            val = await env.adtools.get(alternate);
          }
          if (val == null && key === "settings/defaults") {
            val = await env.adtools.get("default-config");
          }
        } else {
          const alternate = `settings/${key}`;
          val = await env.adtools.get(alternate);
          if (val == null && key === "default-config") {
            val = await env.adtools.get("settings/defaults");
          }
          if (val == null && key === "quick-query-default-schema") {
            val = await env.adtools.get("settings/quick-query-default-schema");
          }
        }
      }
    } catch (_) {
      return new Response(JSON.stringify({ ok: false, error: "KV access failure" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
      });
    }
    if (val == null) {
      return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(val);
    } catch (_) {
      parsed = val;
    }
    return new Response(JSON.stringify({ ok: true, key, value: parsed }), {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
    });
  }
}
