/**
 * Authentication route handlers
 * Handles /register, /register/request-otp, /register/verify, and /api/kv/get
 */

import { corsHeaders, isOriginAllowed } from "../utils/cors.js";
import { tsGmt7, tsGmt7Plain, parseTsFlexible } from "../utils/timestamps.js";
import { allowedEmailDomains, OTP_EXPIRY_MINUTES, sendOtpEmail } from "../utils/email.js";
import { clearRateLimit, consumeRateLimit } from "../utils/rateLimit.js";

const OTP_EXPIRY_MS = OTP_EXPIRY_MINUTES * 60 * 1000;

export function detectRegistrationPlatform(data, request) {
  const ua = request.headers.get("User-Agent") || "";
  const payloadPlatform = String(data.platform || "").trim();
  if (/^desktop\s*\(tauri\)$/i.test(payloadPlatform) || /tauri/i.test(payloadPlatform)) {
    return payloadPlatform || "Desktop (Tauri)";
  }
  return /Firefox\//i.test(ua)
    ? "Firefox"
    : /Edg\//i.test(ua)
      ? "Edge"
      : /Chrome\//i.test(ua) && !/Chromium\//i.test(ua)
        ? "Chrome"
        : /Safari\//i.test(ua) && !/Chrome\//i.test(ua)
          ? "Safari"
          : /Chromium\//i.test(ua)
            ? "Chromium"
            : payloadPlatform || "Unknown";
}

export async function completeRegistration(data, request, env) {
  const email = String(data.email || "")
    .trim()
    .toLowerCase();
  const deviceIdRaw = String(data.deviceId || data.device_id || data.installId || "").trim();
  const deviceId = deviceIdRaw || (data.displayName ? `${String(data.displayName).trim()}-${crypto.randomUUID()}` : crypto.randomUUID());
  const platform = detectRegistrationPlatform(data, request);

  const existingUser = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  const newUserId = existingUser?.id || crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, created_time, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen",
  )
    .bind(newUserId, email, tsGmt7Plain(), tsGmt7Plain())
    .run();
  const userRow = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  const userId = userRow?.id || newUserId;

  await env.DB.prepare(
    "INSERT INTO device (device_id, user_id, platform, created_time, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen = excluded.last_seen",
  )
    .bind(deviceId, userId, platform, tsGmt7Plain(), tsGmt7Plain())
    .run();

  const token = crypto.randomUUID();
  if (!env.adtools) throw new Error("Session storage unavailable");
  await env.adtools.put(`session:${token}`, JSON.stringify({ email, userId, deviceId, createdAt: tsGmt7() }), {
    expirationTtl: 6 * 60 * 60,
  });

  return { userId, token, deviceId, platform };
}

function isConfigEmailAllowed(email, env) {
  const domain = String(email || "")
    .trim()
    .toLowerCase()
    .split("@")
    .pop();
  const allowed = allowedEmailDomains(env);
  return allowed.length > 0 && allowed.includes(domain);
}

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

    if (await consumeRateLimit(env.adtools, `otp:request:${normalized}`, 3, 10 * 60)) {
      return new Response(JSON.stringify({ ok: false, error: "Too many OTP requests. Try later." }), {
        status: 429,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const expiresTs = tsGmt7(OTP_EXPIRY_MS);

    if (!env.DB) throw new Error("OTP storage unavailable");
    await env.DB.prepare("INSERT INTO otp (email, code, expires_at) VALUES (?, ?, ?)")
      .bind(normalized, code, tsGmt7Plain(OTP_EXPIRY_MS))
      .run();

    // Try to send via Postmark; capture the result for dev
    let sendResult = null;
    try {
      sendResult = await sendOtpEmail(env, normalized, code);
    } catch (e) {
      sendResult = { ok: false, error: String(e) };
    }
    const sent = !!(sendResult && sendResult.ok);
    if (!sent && String(env.DEV_MODE || "") !== "true") throw new Error("OTP delivery unavailable");

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
    const requester = String(request.headers.get("CF-Connecting-IP") || data.deviceId || data.device_id || "unknown").slice(0, 120);
    const verifyLimitKey = `otp:verify:${email}:${requester}`;

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

    if (await consumeRateLimit(env.adtools, verifyLimitKey, 5, 10 * 60)) {
      return new Response(JSON.stringify({ ok: false, error: "Too many verification attempts. Try later." }), {
        status: 429,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

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
    const consumedAt = tsGmt7Plain();
    const consumed = await env.DB.prepare("UPDATE otp SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .bind(consumedAt, row.id)
      .run();
    if (Number(consumed?.meta?.changes || 0) !== 1) {
      return new Response(JSON.stringify({ ok: false, error: "Code already used" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    let registration;
    try {
      registration = await completeRegistration(data, request, env);
    } catch (error) {
      await env.DB.prepare("UPDATE otp SET consumed_at = NULL WHERE id = ? AND consumed_at = ?").bind(row.id, consumedAt).run();
      throw error;
    }
    const { userId, token } = registration;
    await clearRateLimit(env.adtools, verifyLimitKey);

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

export async function getSession(request, env) {
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !env.adtools) return null;
  try {
    return JSON.parse((await env.adtools.get(`session:${token}`)) || "null");
  } catch (_) {
    return null;
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
    const session = await getSession(request, env);
    if (!session) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
      });
    }
    if (!isConfigEmailAllowed(session?.email, env)) {
      return new Response(JSON.stringify({ ok: false, error: "Config access restricted to @bankmandiri.co.id email" }), {
        status: 403,
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
