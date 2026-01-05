/**
 * CORS utilities for Cloudflare Workers
 */

/**
 * Returns standard CORS headers for all responses
 */
export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range, If-None-Match, If-Range, X-ADTOOLS-Update-Channel, X-Device-Id, Authorization",
    "Access-Control-Expose-Headers": "ETag, Content-Length, Accept-Ranges, Content-Range",
    Vary: "Origin",
  };
}

/**
 * Validates if the request origin is allowed
 * @param {Request} request - The incoming request
 * @param {object} env - Environment bindings
 * @returns {boolean} - Whether the origin is allowed
 */
export function isOriginAllowed(request, env) {
  try {
    const origin = request.headers.get("Origin");
    if (!origin) return true; // curl and many CLIs don't send Origin
    const allowedRaw = String(env.ALLOWED_ORIGINS || "").trim();
    if (!allowedRaw) return true;
    const allowed = allowedRaw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return allowed.includes(origin);
  } catch (_) {
    return true;
  }
}

/**
 * Returns a 405 Method Not Allowed response
 */
export function methodNotAllowed() {
  return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
