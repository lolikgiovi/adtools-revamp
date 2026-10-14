import { corsHeaders } from "../utils/cors.js";
import { tsGmt7Plain } from "../utils/timestamps.js";
import { completeRegistration, detectRegistrationPlatform } from "./auth.js";
import { validateDashboardToken } from "./dashboard.js";
import { getRegistrationAuthMode } from "../utils/registrationAuthMode.js";

import { isRegistrationEmailAllowed } from "../utils/email.js";
import { registrationRole } from "../utils/registrationRole.js";
import { sendRegistrationNotification } from "../utils/registrationNotification.js";
import { registrationDepartment } from "../utils/registrationDepartment.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(), "Cache-Control": "no-store" },
  });
}

async function requireDashboardAuth(request, env) {
  return (await validateDashboardToken(request, env)) ? null : json({ ok: false, error: "Unauthorized" }, 401);
}

async function hasLiveSession(env, token) {
  if (!token || !env?.adtools?.get) return false;
  try {
    return Boolean(await env.adtools.get(`session:${token}`));
  } catch (_) {
    // Unreadable session storage counts as expired so the client is issued a new session.
    return false;
  }
}

export async function handleManualApprovalRequest(request, env) {
  try {
    if ((await getRegistrationAuthMode(env)) !== "manual") {
      return json({ ok: false, mode: "otp", error: "Manual approval is disabled. Request an email OTP." }, 409);
    }
    if (!env.DB) return json({ ok: false, error: "Database not available" }, 500);
    const data = await request.json();
    const department = registrationDepartment(data.department, true);
    const role = registrationRole(data.role, true);
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

    if (!isRegistrationEmailAllowed(email)) return json({ ok: false, error: "Use your @bankmandiri.co.id email." }, 403);

    const existing = await env.DB.prepare(
      "SELECT id, status FROM manual_approval_requests WHERE email = ? AND device_id = ? ORDER BY requested_at DESC LIMIT 1",
    )
      .bind(email, deviceId)
      .first();
    if (existing) return json({ ok: true, requestId: existing.id, status: existing.status });

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO manual_approval_requests (
        id, email, display_name, device_id, platform, user_agent, ip_address, country, locale, timezone, screen_size, department, role, status, requested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
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
        department,
        role,
        tsGmt7Plain(),
      )
      .run();
    await sendRegistrationNotification(env, {
      email,
      displayName,
      department,
      role,
      platform: detectRegistrationPlatform(data, request),
      requestId: id,
      mode: "manual",
      approvalUrl: `${new URL(request.url).origin}/#approval`,
    });
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
      "SELECT id, email, display_name, device_id, platform, department, role, status, completed_at, session_token FROM manual_approval_requests WHERE id = ? AND email = ? AND device_id = ?",
    )
      .bind(requestId, email, deviceId)
      .first();
    if (!row) return json({ ok: false, error: "Approval request not found" }, 404);
    // Sessions live in KV with a TTL, so the cached token can outlive it. Replay it only while it still resolves,
    // otherwise approve the caller with a fresh session instead of handing back a dead token.
    if (row.completed_at && (await hasLiveSession(env, row.session_token))) {
      return json({ ok: true, status: "approved", token: row.session_token });
    }
    if (row.status !== "approved") return json({ ok: true, status: "pending" });

    const claimId = crypto.randomUUID();
    const claim = await env.DB.prepare(
      "UPDATE manual_approval_requests SET claim_id = ?, claimed_at = ? WHERE id = ? AND (claim_id IS NULL OR claimed_at < ?)",
    )
      .bind(claimId, tsGmt7Plain(), row.id, tsGmt7Plain(-2 * 60 * 1000))
      .run();
    if (Number(claim?.meta?.changes || 0) !== 1) return json({ ok: true, status: "pending" }, 202);

    try {
      const registration = await completeRegistration(
        {
          email: row.email,
          displayName: row.display_name,
          deviceId: row.device_id,
          platform: row.platform,
          department: row.department,
          role: row.role,
        },
        request,
        env,
      );
      await env.DB.prepare(
        "UPDATE manual_approval_requests SET completed_at = ?, session_token = ?, claim_id = NULL, claimed_at = NULL WHERE id = ? AND claim_id = ?",
      )
        .bind(tsGmt7Plain(), registration.token, row.id, claimId)
        .run();
      return json({ ok: true, status: "approved", userId: registration.userId, token: registration.token });
    } catch (error) {
      await env.DB.prepare("UPDATE manual_approval_requests SET claim_id = NULL, claimed_at = NULL WHERE id = ? AND claim_id = ?")
        .bind(row.id, claimId)
        .run();
      throw error;
    }
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
      `SELECT id, email, display_name, device_id, platform, user_agent, ip_address, country, locale, timezone, screen_size, department, role,
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
