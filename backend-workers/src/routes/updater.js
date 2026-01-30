/**
 * Updater route handlers
 * Handles /update/* manifest requests and /releases/* artifact streaming
 */

import { corsHeaders } from '../utils/cors.js';

/**
 * Handle GET/HEAD /update/*.json - serve update manifests
 */
export async function handleManifestRequest(request, env) {
  try {
    const url = new URL(request.url);
    const channelFile = url.pathname.split("/").pop() || "";
    if (!/^[a-z]+\.json$/i.test(channelFile)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid manifest path" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    // Dynamic channel routing: manifest.json reads X-Update-Channel header (default: stable)
    let key;
    if (channelFile === "manifest.json") {
      const channel = (request.headers.get("X-Update-Channel") || "stable").toLowerCase().replace(/[^a-z]/g, "") || "stable";
      key = `update/${channel}.json`;
    } else {
      key = `update/${channelFile}`;
    }
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

/**
 * Handle GET/HEAD /releases/* - stream update artifacts with range support
 */
export async function handleArtifactRequest(request, env) {
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

/**
 * Handle POST /dev/seed-update - seed R2 with test manifest (dev mode only)
 */
export async function handleDevSeedUpdate(request, env) {
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
    const arch = "darwin-aarch64";
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
          installer: `${origin}/releases/${version}/${channel}/${arch}/ADTools-${version}-mac-arm64.dmg`,
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

/**
 * Parse Range header for partial content requests
 */
export function parseRange(header, size) {
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

/**
 * Determine content type for R2 artifact key
 */
export function contentTypeForKey(key, head) {
  const hinted = head?.httpMetadata?.contentType || head?.httpMetadata?.content_type || "";
  if (hinted) return hinted;
  if (/\.json$/i.test(key)) return "application/json";
  if (/\.gz$/i.test(key)) return "application/gzip";
  if (/\.tar$/i.test(key)) return "application/x-tar";
  if (/\.dmg$/i.test(key)) return "application/x-apple-diskimage";
  return "application/octet-stream";
}
