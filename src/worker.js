// Cloudflare Worker to serve static SPA and provide KV-backed endpoints
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method || 'GET';

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // API routes
    if (url.pathname === '/whitelist.json') {
      return handleWhitelist(env);
    }

    // New OTP registration routes
    if (url.pathname === '/register/request-otp') {
      if (method !== 'POST') return methodNotAllowed();
      return handleRegisterRequestOtp(request, env);
    }
    if (url.pathname === '/register/verify') {
      if (method !== 'POST') return methodNotAllowed();
      return handleRegisterVerify(request, env);
    }

    if (url.pathname === '/register') {
      if (method !== 'POST') return methodNotAllowed();
      return handleRegister(request, env);
    }

    if (url.pathname === '/analytics') {
      if (method === 'POST') return handleAnalyticsPost(request, env);
      if (method === 'GET') return handleAnalyticsGet(request, env);
    }

    // Static assets via Wrangler assets binding with SPA fallback
    try {
      const res = await env.ASSETS.fetch(request);
      if (res && res.status !== 404) return res;
    } catch (_) {
      // Continue to SPA fallback below
    }

    // SPA fallback: always serve index.html for unknown GET routes
    if (method === 'GET') {
      const indexUrl = new URL('/index.html', url);
      try {
        return await env.ASSETS.fetch(new Request(indexUrl, request));
      } catch (err) {
        return new Response('Not Found', { status: 404 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function handleWhitelist(env) {
  try {
    const flag = String(env.WHITELIST_ENABLED ?? 'true').toLowerCase();
    const disabled = flag === 'false' || flag === '0' || flag === 'no' || flag === 'off';
    if (disabled) {
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    // Expect KV value as either an array JSON or object with emails key
    const raw = await env.WHITELIST?.get('emails');
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
    body = (body || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean);
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

async function handleRegister(request, env) {
  try {
    const data = await request.json();
    const deviceId = String(data.deviceId || data.device_id || data.installId || '');
    const key = `registrations:${deviceId || 'anon'}:${Date.now()}`;
    await env.ANALYTICS?.put(key, JSON.stringify({ ...data, receivedAt: new Date().toISOString() }), {
      expirationTtl: 90 * 24 * 60 * 60, // 90 days
    });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

// Timestamp helpers: store and compare using GMT+7 formatted strings
function tsGmt7(offsetMs = 0) {
  const base = Date.now() + 7 * 60 * 60 * 1000 + (offsetMs || 0);
  const d = new Date(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${y}-${m}-${day}T${hh}:${mi}:${ss}.${ms}+07:00`;
}
function parseTsFlexible(x) {
  if (typeof x === 'number') return x;
  const s = String(x || '');
  const num = Number(s);
  if (!Number.isNaN(num)) return num;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

// Request an OTP code for email verification
async function handleRegisterRequestOtp(request, env) {
  try {
    const { email } = await request.json();
    const normalized = String(email || '').trim().toLowerCase();
    if (!/.+@.+\..+/.test(normalized))
      return new Response(JSON.stringify({ ok: false, error: 'Invalid email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const nowTs = tsGmt7();
    const expiresTs = tsGmt7(10 * 60 * 1000); // +10 minutes

    if (env.DB) {
      try {
        await env.DB
          .prepare('INSERT INTO otps (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)')
          .bind(normalized, code, expiresTs, nowTs)
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

    const payload = String(env.DEV_MODE || '') === 'true'
      ? { ok: true, devCode: code, mailSent: sent, mailStatus: sendResult }
      : { ok: true };

    return new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

// Verify OTP and create/link user
async function handleRegisterVerify(request, env) {
  try {
    const data = await request.json();
    const email = String(data.email || '').trim().toLowerCase();
    const code = String(data.code || '').trim();
    const deviceIdRaw = String(data.deviceId || data.device_id || data.installId || '').trim();
    const ua = request.headers.get('User-Agent') || '';
    const payloadPlatform = String(data.platform || '').trim();
    const payloadBrowser = String(data.browser || '').trim();
    const tauriHint = /tauri/i.test(ua) || /tauri/i.test(payloadPlatform) || /tauri/i.test(payloadBrowser) || (payloadPlatform === 'Desktop' && (!payloadBrowser || /unknown/i.test(payloadBrowser)));
    let platform = tauriHint ? 'Desktop' : (payloadPlatform || 'Browser');
    const browserUA = (/Firefox\//i.test(ua)) ? 'Firefox' :
                     (/Edg\//i.test(ua)) ? 'Edge' :
                     ((/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) ? 'Chrome' :
                     ((/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) ? 'Safari' :
                     ((/Chromium\//i.test(ua)) ? 'Chromium' : 'Unknown')));
    const browserFromPayload = (payloadBrowser && !/unknown/i.test(payloadBrowser)) ? payloadBrowser : null;
    let browser = tauriHint ? 'Tauri' : (browserFromPayload || browserUA);
    if (!tauriHint && (!payloadBrowser || /unknown/i.test(payloadBrowser)) && (!payloadPlatform || /browser/i.test(payloadPlatform))) {
      platform = 'Desktop';
      browser = 'Tauri';
    }
    const deviceId = deviceIdRaw || (data.displayName ? `${String(data.displayName).trim()}-${crypto.randomUUID()}` : crypto.randomUUID());
    const displayName = String(data.displayName || '').trim();

    if (!email || !code) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing email or code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    if (!env.DB)
      return new Response(JSON.stringify({ ok: false, error: 'DB unavailable' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });

    const nowMs = Date.now();
    const row = await env.DB
      .prepare('SELECT id, expires_at, consumed_at FROM otps WHERE email = ? AND code = ? ORDER BY created_at DESC LIMIT 1')
      .bind(email, code)
      .first();

    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    if (row.consumed_at) {
      return new Response(JSON.stringify({ ok: false, error: 'Code already used' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    const expMs = parseTsFlexible(row.expires_at);
    if (expMs < nowMs) {
      return new Response(JSON.stringify({ ok: false, error: 'Code expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // Consume the code
    await env.DB.prepare('UPDATE otps SET consumed_at = ? WHERE id = ?').bind(tsGmt7(), row.id).run();

    const salt = String(env.SECRET_SALT || '');
    const emailHash = null; // email hash no longer stored

    // Upsert user (plain email as canonical identifier)
    let userId = null;
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing?.id) {
      userId = existing.id;
      await env.DB
        .prepare('UPDATE users SET display_name = ?, last_seen = ? WHERE id = ?')
        .bind(displayName || null, tsGmt7(), userId)
        .run();
    } else {
      userId = crypto.randomUUID();
      await env.DB
        .prepare(
          'INSERT INTO users (id, email, display_name, created_at, last_seen) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(userId, email, displayName || null, tsGmt7(), tsGmt7())
        .run();
    }

    try {
      await env.DB
        .prepare('INSERT OR IGNORE INTO user_device (user_id, device_id, platform, browser, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, deviceId, platform, browser, tsGmt7())
        .run();
    } catch (_) {
      try {
        await env.DB
          .prepare('INSERT OR IGNORE INTO user_installs (user_id, install_id, created_at) VALUES (?, ?, ?)')
          .bind(userId, deviceId, tsGmt7())
          .run();
      } catch (_) {}
    }

    return new Response(JSON.stringify({ ok: true, userId }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

async function handleAnalyticsPost(request, env) {
  try {
    const data = await request.json();
    const deviceId = String(data.deviceId || data.device_id || data.installId || '');
    const featureId = String(data.featureId || data.feature_id || data.type || 'unknown');
    const action = String(data.action || data.event || 'unknown');
    const ts = String(data.ts || tsGmt7());
    const meta = data.meta ? JSON.stringify(data.meta) : null;

    // New fields for upgraded schema
    const eventName = String(data.event_name || data.eventName || `${featureId}.${action}`);
    const tsEpochCandidate = Number(data.ts_epoch);
    const tsEpoch = Number.isFinite(tsEpochCandidate) ? Math.floor(tsEpochCandidate) : parseTsFlexible(ts);
    const properties = data.properties ? JSON.stringify(data.properties) : meta;

    let ok = false;
    if (env.DB) {
      try {
        const id = crypto.randomUUID();
        await env.DB
          .prepare(
            'INSERT INTO events (id, device_id, feature_id, action, ts, ts_epoch, event_name, meta, properties) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(id, deviceId || null, featureId, action, ts, tsEpoch, eventName, meta, properties)
          .run();
        await upsertDailyCount(env, ts.slice(0, 10), featureId, action);
        ok = true;
      } catch (_) {
        // Fallback to legacy schema if new columns are missing
        try {
          const id = crypto.randomUUID();
          await env.DB
            .prepare(
              'INSERT INTO events (id, device_id, feature_id, action, ts, meta) VALUES (?, ?, ?, ?, ?, ?)'
            )
            .bind(id, deviceId || null, featureId, action, ts, meta)
            .run();
          await upsertDailyCount(env, ts.slice(0, 10), featureId, action);
          ok = true;
        } catch (_) {
          ok = false;
        }
      }
    }

    // Fallback to KV when DB unavailable
    if (!ok && env.ANALYTICS) {
      const key = `events:${deviceId || crypto.randomUUID()}:${Date.now()}`;
      await env.ANALYTICS.put(key, JSON.stringify({ ...data, receivedAt: tsGmt7(), ts_epoch: tsEpoch, event_name: eventName, properties: data.properties || data.meta || null }), {
        expirationTtl: 90 * 24 * 60 * 60,
      });
      ok = true;
    }

    return new Response(JSON.stringify({ ok }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

async function handleAnalyticsGet(request, env) {
  try {
    if (env.DB) {
      try {
        const rs = await env.DB
          .prepare("SELECT id, device_id, feature_id, action, ts, ts_epoch, event_name, meta, properties FROM events ORDER BY COALESCE(ts_epoch, CAST(strftime('%s', replace(substr(ts, 1, 19), 'T', ' '), 'utc') AS INTEGER) * 1000, 0) DESC LIMIT 10")
          .all();
        const events = (rs?.results || []).map((row) => ({
          id: row.id,
          deviceId: row.device_id,
          installId: row.device_id, // legacy alias for compatibility
          featureId: row.feature_id,
          action: row.action,
          ts: row.ts,
          ts_epoch: row.ts_epoch ?? null,
          event_name: row.event_name ?? null,
          meta: row.meta ? JSON.parse(row.meta) : null,
          properties: row.properties ? JSON.parse(row.properties) : null,
        }));
        return new Response(JSON.stringify({ events }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      } catch (_) {
        const rs = await env.DB
          .prepare('SELECT id, device_id, feature_id, action, ts, meta FROM events ORDER BY ts DESC LIMIT 10')
          .all();
        const events = (rs?.results || []).map((row) => ({
          id: row.id,
          deviceId: row.device_id,
          installId: row.device_id, // legacy alias for compatibility
          featureId: row.feature_id,
          action: row.action,
          ts: row.ts,
          meta: row.meta ? JSON.parse(row.meta) : null,
        }));
        return new Response(JSON.stringify({ events }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
    }

    // Fallback to KV
    const list = await env.ANALYTICS?.list({ prefix: 'events:', limit: 10 });
    const items = (list && list.keys) || [];
    const events = [];
    for (const k of items) {
      const v = await env.ANALYTICS.get(k.name);
      try {
        events.push(JSON.parse(v || '{}'));
      } catch (_) {
        events.push({ raw: v });
      }
    }
    return new Response(JSON.stringify({ events }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ events: [] }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

async function hashEmail(email, salt) {
  const data = new TextEncoder().encode(`${salt}:${email}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendOtpEmail(env, to, code) {
  try {
    const subjectPrefix = String(env.MAIL_SUBJECT_PREFIX || '[AD Tools]');
    const subject = `${subjectPrefix} Verify your email`;
    const fromEmail = String(env.MAIL_FROM || 'no-reply@adtools.local');
    const body = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail },
      subject,
      content: [
        {
          type: 'text/plain',
          value: `Your verification code is ${code}. It expires in 10 minutes.`,
        },
      ],
    });
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = env.MAILCHANNELS_API_KEY || env.MAILCHANNELS_TOKEN || '';
    if (apiKey) headers['X-Api-Key'] = apiKey;

    const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers,
      body,
    });
    let text = '';
    try { text = await res.text(); } catch (_) {}
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function upsertDailyCount(env, day, featureId, action) {
  if (!env.DB) return false;
  try {
    await env.DB
      .prepare(
        'INSERT INTO counts_daily (day, feature_id, action, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, feature_id, action) DO UPDATE SET count = count + 1'
      )
      .bind(day, featureId, action)
      .run();
    return true;
  } catch (_) {
    return false;
  }
}

function detectBrowserFromUA(ua) {
  const s = String(ua || '');
  if (/Firefox\//i.test(s)) return 'Firefox';
  if (/Edg\//i.test(s)) return 'Edge';
  if (/Chrome\//i.test(s) && !/Chromium\//i.test(s)) return 'Chrome';
  if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) return 'Safari';
  if (/Chromium\//i.test(s)) return 'Chromium';
  return 'Unknown';
}