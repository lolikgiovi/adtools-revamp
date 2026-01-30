/**
 * Cloudflare Worker - Main Entry Point
 * Modular architecture: routes are split into separate files under src/routes/
 */

// Utils
import { corsHeaders, methodNotAllowed } from './src/utils/cors.js';

// Routes
import { handleAnalyticsBatchPost, handleAnalyticsBatchGet, handleAnalyticsLogPost, handleAnalyticsLogGet } from './src/routes/analytics.js';
import { handleRegister, handleRegisterRequestOtp, handleRegisterVerify, handleKvGet } from './src/routes/auth.js';
import { handleDashboardVerify, handleDashboardTabs, handleDashboardQuery, handleStatsTools, handleStatsDaily, handleStatsDevices, handleStatsEvents, handleStatsQuickQuery, handleStatsQuickQueryErrors } from './src/routes/dashboard.js';
import { handleInstallScript, handleInstallOracleScript, handleUninstallScript, handleLatestRelease } from './src/routes/installer.js';
import { handleManifestRequest, handleArtifactRequest, handleDevSeedUpdate } from './src/routes/updater.js';
import { handleWhitelist } from './src/routes/whitelist.js';
import { handleDeviceVersionUpdate } from './src/routes/device.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method || "GET";

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Dev-only: seed local R2 with a sample manifest and artifact
    if (url.pathname === "/dev/seed-update") {
      if (String(env.DEV_MODE || "") !== "true") {
        return new Response("Not Found", { status: 404, headers: corsHeaders() });
      }
      if (method !== "POST") return methodNotAllowed();
      return handleDevSeedUpdate(request, env);
    }

    // Updater: static manifest by channel under /update/*
    if (url.pathname.startsWith("/update/")) {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed();
      return handleManifestRequest(request, env);
    }

    // Installer script endpoint
    if (url.pathname === "/install.sh") {
      if (method !== "GET") return methodNotAllowed();
      return handleInstallScript(request, env);
    }

    // Oracle Instant Client installer script endpoint
    if (url.pathname === "/install-oracle.sh") {
      if (method !== "GET") return methodNotAllowed();
      return handleInstallOracleScript(request, env);
    }

    // Uninstaller script endpoint
    if (url.pathname === "/uninstall.sh") {
      if (method !== "GET") return methodNotAllowed();
      return handleUninstallScript(request, env);
    }

    // Latest release resolver (redirects to DMG based on arch, stable-only)
    if (url.pathname === "/releases/latest") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed();
      return handleLatestRelease(request, env);
    }

    // Updater: immutable artifact streaming with range support under /releases/*
    if (url.pathname.startsWith("/releases/")) {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed();
      return handleArtifactRequest(request, env);
    }

    // API routes
    if (url.pathname === "/whitelist.json") {
      return handleWhitelist(env);
    }

    // New OTP registration routes
    if (url.pathname === "/register/request-otp") {
      if (method !== "POST") return methodNotAllowed();
      return handleRegisterRequestOtp(request, env);
    }
    if (url.pathname === "/register/verify") {
      if (method !== "POST") return methodNotAllowed();
      return handleRegisterVerify(request, env);
    }

    // Secure KV fetch (requires OTP session token)
    if (url.pathname === "/api/kv/get") {
      if (method !== "GET") return methodNotAllowed();
      return handleKvGet(request, env);
    }

    if (url.pathname === "/register") {
      if (method !== "POST") return methodNotAllowed();
      return handleRegister(request, env);
    }

    // Analytics routes (batch and live log only)
    // Device routes
    if (url.pathname === "/device/version") {
      if (method !== "PATCH") return methodNotAllowed();
      return handleDeviceVersionUpdate(request, env);
    }

    if (url.pathname === "/analytics/batch") {
      if (method === "POST") return handleAnalyticsBatchPost(request, env);
      if (method === "GET") return handleAnalyticsBatchGet(request, env);
      return methodNotAllowed();
    }
    if (url.pathname === "/analytics/log") {
      if (method === "POST") return handleAnalyticsLogPost(request, env);
      if (method === "GET") return handleAnalyticsLogGet(request, env);
      return methodNotAllowed();
    }

    // Dashboard routes (password-protected analytics dashboard)
    if (url.pathname === "/dashboard/verify") {
      if (method !== "POST") return methodNotAllowed();
      return handleDashboardVerify(request, env);
    }
    if (url.pathname === "/dashboard/tabs") {
      if (method !== "GET") return methodNotAllowed();
      return handleDashboardTabs(request, env);
    }
    if (url.pathname === "/dashboard/query") {
      if (method !== "POST") return methodNotAllowed();
      return handleDashboardQuery(request, env);
    }
    if (url.pathname === "/dashboard/stats/tools") {
      if (method !== "GET") return methodNotAllowed();
      return handleStatsTools(request, env);
    }
    if (url.pathname === "/dashboard/stats/daily") {
      if (method !== "GET") return methodNotAllowed();
      return handleStatsDaily(request, env);
    }
    if (url.pathname === "/dashboard/stats/devices") {
      if (method !== "GET") return methodNotAllowed();
      return handleStatsDevices(request, env);
    }
    if (url.pathname === "/dashboard/stats/events") {
      if (method !== "GET") return methodNotAllowed();
      return handleStatsEvents(request, env);
    }
    if (url.pathname === "/dashboard/stats/quick-query") {
      if (method !== "GET") return methodNotAllowed();
      return handleStatsQuickQuery(request, env);
    }
    if (url.pathname === "/dashboard/stats/quick-query-errors") {
      if (method !== "GET") return methodNotAllowed();
      return handleStatsQuickQueryErrors(request, env);
    }

    // Static assets via Wrangler assets binding with SPA fallback
    try {
      const res = await env.ASSETS.fetch(request);
      if (res && res.status !== 404) return res;
    } catch (_) {
      // Continue to SPA fallback below
    }

    // SPA fallback: always serve index.html for unknown GET routes
    if (method === "GET") {
      const indexUrl = new URL("/index.html", url);
      try {
        return await env.ASSETS.fetch(new Request(indexUrl, request));
      } catch (err) {
        return new Response("Not Found", { status: 404 });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
};
