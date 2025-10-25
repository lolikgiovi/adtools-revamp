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
    const installId = String(data.installId || '');
    const key = `registrations:${installId || 'anon'}:${Date.now()}`;
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
    const nowMs = Date.now();
    const expiresAt = nowMs + 10 * 60 * 1000; // 10 minutes

    if (env.DB) {
      try {
        await env.DB
          .prepare('INSERT INTO otps (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)')
          .bind(normalized, code, expiresAt, nowMs)
          .run();
      } catch (_) {}
    }

    // Try to send via MailChannels; fall back silently if unavailable
    let sent = false;
    try {
      sent = await sendOtpEmail(env, normalized, code);
    } catch (_) {}

    const payload = String(env.DEV_MODE || '') === 'true' ? { ok: true, devCode: code } : { ok: true };
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
    const installId = String(data.installId || '').trim();
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

    const now = Date.now();
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
    if (Number(row.expires_at) < now) {
      return new Response(JSON.stringify({ ok: false, error: 'Code expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // Consume the code
    await env.DB.prepare('UPDATE otps SET consumed_at = ? WHERE id = ?').bind(now, row.id).run();

    const salt = String(env.SECRET_SALT || '');
    const emailHash = salt ? await hashEmail(email, salt) : null;

    // Upsert user (plain email as canonical identifier)
    let userId = null;
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing?.id) {
      userId = existing.id;
      await env.DB
        .prepare('UPDATE users SET display_name = ?, last_seen = ? WHERE id = ?')
        .bind(displayName || null, new Date().toISOString(), userId)
        .run();
    } else {
      userId = crypto.randomUUID();
      await env.DB
        .prepare(
          'INSERT INTO users (id, email, email_hash, display_name, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(userId, email, emailHash, displayName || null, new Date().toISOString(), new Date().toISOString())
        .run();
    }

    if (installId) {
      await env.DB
        .prepare('INSERT OR IGNORE INTO user_installs (user_id, install_id, created_at) VALUES (?, ?, ?)')
        .bind(userId, installId, new Date().toISOString())
        .run();
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
    const installId = String(data.installId || '');
    const featureId = String(data.featureId || data.feature_id || data.type || 'unknown');
    const action = String(data.action || data.event || 'unknown');
    const ts = String(data.ts || new Date().toISOString());
    const meta = data.meta ? JSON.stringify(data.meta) : null;

    let ok = false;
    if (env.DB) {
      try {
        const id = crypto.randomUUID();
        await env.DB
          .prepare(
            'INSERT INTO events (id, install_id, user_id, feature_id, action, ts, meta) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(id, installId || null, data.userId || null, featureId, action, ts, meta)
          .run();
        await upsertDailyCount(env, ts.slice(0, 10), featureId, action);
        ok = true;
      } catch (_) {
        ok = false;
      }
    }

    // Fallback to KV when DB unavailable
    if (!ok && env.ANALYTICS) {
      const key = `events:${installId || 'anon'}:${Date.now()}`;
      await env.ANALYTICS.put(key, JSON.stringify({ ...data, receivedAt: new Date().toISOString() }), {
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
      const rs = await env.DB
        .prepare('SELECT id, install_id, user_id, feature_id, action, ts, meta FROM events ORDER BY ts DESC LIMIT 10')
        .all();
      const events = (rs?.results || []).map((row) => ({
        id: row.id,
        installId: row.install_id,
        userId: row.user_id,
        featureId: row.feature_id,
        action: row.action,
        ts: row.ts,
        meta: row.meta ? JSON.parse(row.meta) : null,
      }));
      return new Response(JSON.stringify({ events }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
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
    const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return res.ok;
  } catch (_) {
    return false;
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