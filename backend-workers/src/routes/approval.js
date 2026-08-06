import { corsHeaders } from "../utils/cors.js";
import { tsGmt7Plain } from "../utils/timestamps.js";
import { completeRegistration, detectRegistrationPlatform } from "./auth.js";
import { validateDashboardToken } from "./dashboard.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
  });
}

async function requireDashboardAuth(request, env) {
  return (await validateDashboardToken(request, env)) ? null : json({ ok: false, error: "Unauthorized" }, 401);
}

export async function handleManualApprovalRequest(request, env) {
  try {
    if (!env.DB) return json({ ok: false, error: "Database not available" }, 500);
    const data = await request.json();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const displayName = String(data.displayName || "")
      .trim()
      .slice(0, 15);
    const deviceId = String(data.deviceId || "").trim();
    if (!/.+@.+\..+/.test(email) || displayName.length < 2 || !deviceId) {
      return json({ ok: false, error: "Display name, valid email, and device identity are required" }, 400);
    }

    const existing = await env.DB.prepare(
      "SELECT id, status FROM manual_approval_requests WHERE email = ? AND device_id = ? ORDER BY requested_at DESC LIMIT 1",
    )
      .bind(email, deviceId)
      .first();
    if (existing) return json({ ok: true, requestId: existing.id, status: existing.status });

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO manual_approval_requests (
        id, email, display_name, device_id, platform, user_agent, ip_address, country, locale, timezone, screen_size, status, requested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        id,
        email,
        displayName,
        deviceId,
        detectRegistrationPlatform(data, request),
        String(request.headers.get("User-Agent") || "").slice(0, 500),
        String(request.headers.get("CF-Connecting-IP") || "").slice(0, 64),
        String(request.cf?.country || request.headers.get("CF-IPCountry") || "").slice(0, 8),
        String(data.locale || "").slice(0, 64),
        String(data.timezone || "").slice(0, 100),
        String(data.screenSize || "").slice(0, 32),
        tsGmt7Plain(),
      )
      .run();
    return json({ ok: true, requestId: id, status: "pending" }, 201);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 400);
  }
}

export async function handleManualApprovalStatus(request, env) {
  try {
    if (!env.DB) return json({ ok: false, error: "Database not available" }, 500);
    const data = await request.json();
    const requestId = String(data.requestId || "").trim();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const deviceId = String(data.deviceId || "").trim();
    if (!requestId || !email || !deviceId) return json({ ok: false, error: "Request identity is required" }, 400);

    const row = await env.DB.prepare(
      "SELECT id, email, display_name, device_id, platform, status FROM manual_approval_requests WHERE id = ? AND email = ? AND device_id = ?",
    )
      .bind(requestId, email, deviceId)
      .first();
    if (!row) return json({ ok: false, error: "Approval request not found" }, 404);
    if (row.status !== "approved") return json({ ok: true, status: "pending" });

    const registration = await completeRegistration(
      { email: row.email, displayName: row.display_name, deviceId: row.device_id, platform: row.platform },
      request,
      env,
    );
    await env.DB.prepare("UPDATE manual_approval_requests SET completed_at = ? WHERE id = ?").bind(tsGmt7Plain(), row.id).run();
    return json({ ok: true, status: "approved", userId: registration.userId, token: registration.token });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 400);
  }
}

export async function handleApprovalList(request, env) {
  const unauthorized = await requireDashboardAuth(request, env);
  if (unauthorized) return unauthorized;
  try {
    if (!env.DB) return json({ ok: false, error: "Database not available" }, 500);
    const result = await env.DB.prepare(
      `SELECT id, email, display_name, device_id, platform, user_agent, ip_address, country, locale, timezone, screen_size,
        status, requested_at, approved_at, completed_at
      FROM manual_approval_requests
      WHERE status IN ('pending', 'approved')
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, requested_at DESC
      LIMIT 500`,
    ).all();
    return json({ ok: true, requests: result.results || [] });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

export async function handleApprovalApprove(request, env) {
  const unauthorized = await requireDashboardAuth(request, env);
  if (unauthorized) return unauthorized;
  try {
    if (!env.DB) return json({ ok: false, error: "Database not available" }, 500);
    const data = await request.json();
    const id = String(data.id || "").trim();
    if (!id) return json({ ok: false, error: "Request id is required" }, 400);
    const row = await env.DB.prepare("SELECT id, status FROM manual_approval_requests WHERE id = ?").bind(id).first();
    if (!row) return json({ ok: false, error: "Approval request not found" }, 404);
    if (row.status !== "approved") {
      await env.DB.prepare("UPDATE manual_approval_requests SET status = 'approved', approved_at = ? WHERE id = ?")
        .bind(tsGmt7Plain(), id)
        .run();
    }
    return json({ ok: true, status: "approved" });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 400);
  }
}
