import { validatePublication } from "../../../shared/published-settings.js";
import { getSession } from "./auth.js";
import { validateDashboardToken } from "./dashboard.js";
import { corsHeaders } from "../utils/cors.js";

const MAX_BYTES = 128 * 1024;
const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
function error(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
async function digest(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function readBody(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BYTES) error("Publication is too large (maximum 128 KB).", 413);
  const reader = request.body?.getReader();
  if (!reader) error("A JSON body is required.");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      error("Publication is too large (maximum 128 KB).", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    error("Invalid JSON body.");
  }
}

async function audience(env, target) {
  const column = target.type === "emails" ? "LOWER(email)" : "department";
  const recipients = (
    await env.DB.prepare(
      `SELECT id, email, department FROM users WHERE ${column} IN (${target.values.map(() => "?").join(",")}) ORDER BY email LIMIT 501`,
    )
      .bind(...target.values)
      .all()
  ).results;
  if (!recipients.length) error("No registered users match this audience.");
  if (recipients.length > 500) error("Select a smaller audience (maximum 500 users).");
  const matched = new Set(recipients.map((row) => (target.type === "emails" ? row.email.toLowerCase() : row.department)));
  if (target.values.some((value) => !matched.has(value))) error("Some emails or departments have no registered users.");
  return { recipients, audienceHash: await digest(JSON.stringify(recipients)) };
}

async function identity(request, env) {
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  return env.DB.prepare(
    `SELECT sd.user_id AS userId, sd.device_id AS deviceId, u.email
    FROM settings_devices sd JOIN device d ON d.device_id=sd.device_id AND d.user_id=sd.user_id
    JOIN users u ON u.id=sd.user_id WHERE sd.token_hash=? AND sd.expires_at>?`,
  )
    .bind(await digest(token), Date.now())
    .first();
}

export async function handleSettings(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/settings/", "");
  const method = request.method;
  try {
    if (path.startsWith("admin/")) {
      if (!env.ANALYTICS_DASHBOARD_PASSWORD || !(await validateDashboardToken(request, env))) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      if (!env.DB) return json({ ok: false, error: "Settings database is unavailable." }, 503);
      if (path === "admin/publications" && method === "GET") {
        const result = await env.DB.prepare(
          `SELECT p.*,
          (SELECT COUNT(*) FROM settings_recipients r WHERE r.publication_id=p.id) AS recipientCount,
          (SELECT COUNT(*) FROM settings_deliveries d WHERE d.publication_id=p.id) AS appliedDevices
          FROM settings_publications p ORDER BY id DESC LIMIT 100`,
        ).all();
        return json({
          ok: true,
          publications: result.results.map((row) => ({
            id: row.id,
            title: row.title,
            target: JSON.parse(row.target_json),
            settings: JSON.parse(row.settings_json),
            createdAt: row.created_at,
            revokedAt: row.revoked_at,
            recipientCount: row.recipientCount,
            appliedDevices: row.appliedDevices,
          })),
        });
      }
      if (path === "admin/revoke" && method === "POST") {
        const data = await readBody(request);
        if (!Number.isSafeInteger(data.id) || data.id < 1) error("Invalid publication.");
        await env.DB.prepare("UPDATE settings_publications SET revoked_at=COALESCE(revoked_at, ?) WHERE id=?")
          .bind(new Date().toISOString(), data.id)
          .run();
        return json({ ok: true });
      }
      if (["admin/preview", "admin/publications"].includes(path) && method === "POST") {
        const raw = await readBody(request);
        const data = validatePublication(raw);
        const preview = await audience(env, data.target);
        if (path === "admin/preview") return json({ ok: true, ...preview });
        if (raw.audienceHash !== preview.audienceHash) error("The audience changed. Preview again before publishing.", 409);
        if (typeof raw.requestId !== "string" || !/^[a-f\d-]{36}$/i.test(raw.requestId)) error("Preview again before publishing.");
        const existing = await env.DB.prepare("SELECT * FROM settings_publications WHERE request_id=?").bind(raw.requestId).first();
        if (
          existing &&
          (existing.title !== data.title ||
            existing.audience_hash !== raw.audienceHash ||
            existing.target_json !== JSON.stringify(data.target) ||
            existing.settings_json !== JSON.stringify(data.settings))
        )
          error("Publication changed. Preview again.", 409);
        // D1 batch is transactional. The recipient snapshot and immutable publication commit together.
        await env.DB.batch([
          env.DB.prepare(
            "INSERT OR IGNORE INTO settings_publications (request_id,audience_hash,title,target_json,settings_json) VALUES (?,?,?,?,?)",
          ).bind(raw.requestId, raw.audienceHash, data.title, JSON.stringify(data.target), JSON.stringify(data.settings)),
          env.DB.prepare(
            `INSERT OR IGNORE INTO settings_recipients (publication_id,user_id)
            SELECT p.id, j.value FROM settings_publications p, json_each(?) j WHERE p.request_id=? AND p.audience_hash=?`,
          ).bind(JSON.stringify(preview.recipients.map((recipient) => recipient.id)), raw.requestId, raw.audienceHash),
        ]);
        const saved = await env.DB.prepare("SELECT id FROM settings_publications WHERE request_id=?").bind(raw.requestId).first();
        return json({ ok: true, id: saved.id, recipientCount: preview.recipients.length });
      }
    } else if (path === "enroll" && method === "POST") {
      const session = await getSession(request, env);
      if (!session?.email || !session.deviceId) return json({ ok: false, error: "Verify your account to receive settings." }, 401);
      const user = await env.DB.prepare(
        `SELECT u.id, u.email FROM users u JOIN device d ON d.user_id=u.id
        WHERE LOWER(u.email)=? AND d.device_id=?`,
      )
        .bind(session.email.toLowerCase(), session.deviceId)
        .first();
      if (!user) return json({ ok: false, error: "Registered device not found." }, 401);
      const credential = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const expiresAt = Date.now() + DEVICE_TTL_MS;
      await env.DB.prepare(
        `INSERT INTO settings_devices (token_hash,user_id,device_id,expires_at) VALUES (?,?,?,?)
        ON CONFLICT(user_id,device_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at`,
      )
        .bind(await digest(credential), user.id, session.deviceId, expiresAt)
        .run();
      return json({ ok: true, credential, userId: user.id, email: user.email, deviceId: session.deviceId, expiresAt });
    } else if ((path === "sync" && method === "GET") || (path === "ack" && method === "POST")) {
      const user = await identity(request, env);
      if (!user) return json({ ok: false, error: "Verify your account to receive settings." }, 401);
      if (path === "sync") {
        const after = Number(url.searchParams.get("after") || 0);
        if (!Number.isSafeInteger(after) || after < 0) error("Invalid publication cursor.");
        const rows = (
          await env.DB.prepare(
            `SELECT p.id,p.title,p.settings_json FROM settings_publications p
          JOIN settings_recipients r ON r.publication_id=p.id WHERE r.user_id=? AND p.id>? AND p.revoked_at IS NULL
          ORDER BY p.id LIMIT 50`,
          )
            .bind(user.userId, after)
            .all()
        ).results;
        return json({
          ok: true,
          publications: rows.map((row) => ({ id: row.id, title: row.title, settings: JSON.parse(row.settings_json) })),
          cursor: rows.at(-1)?.id ?? after,
        });
      }
      const data = await readBody(request);
      if (
        !Array.isArray(data.ids) ||
        data.ids.length > 50 ||
        !data.ids.length ||
        data.ids.some((id) => !Number.isSafeInteger(id) || id < 1)
      ) {
        error("Invalid acknowledgement.");
      }
      const ids = [...new Set(data.ids)];
      const allowed = (
        await env.DB.prepare(
          `SELECT publication_id FROM settings_recipients WHERE user_id=?
        AND publication_id IN (${ids.map(() => "?").join(",")})`,
        )
          .bind(user.userId, ...ids)
          .all()
      ).results;
      if (allowed.length !== ids.length) error("Publication does not belong to this account.", 403);
      await env.DB.batch(
        ids.map((id) =>
          env.DB.prepare("INSERT OR IGNORE INTO settings_deliveries (publication_id,user_id,device_id) VALUES (?,?,?)").bind(
            id,
            user.userId,
            user.deviceId,
          ),
        ),
      );
      return json({ ok: true });
    }
    return json({ ok: false, error: "Method or endpoint not supported." }, 405);
  } catch (err) {
    // Never echo payloads, SQL, or storage diagnostics into responses.
    if (err.status) return json({ ok: false, error: err.message }, err.status);
    return json({ ok: false, error: "Settings service unavailable. Try again later." }, 503);
  }
}
