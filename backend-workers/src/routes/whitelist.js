/**
 * Whitelist route handler
 */

import { corsHeaders } from '../utils/cors.js';

/**
 * Handle GET /whitelist.json - fetch whitelisted emails
 */
export async function handleWhitelist(env) {
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
