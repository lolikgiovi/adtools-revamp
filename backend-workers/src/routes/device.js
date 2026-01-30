/**
 * Device route handlers
 * Handles device-related API endpoints
 */

import { corsHeaders } from '../utils/cors.js';
import { tsGmt7Plain } from '../utils/timestamps.js';

/**
 * Handle PATCH /device/version - update device app version
 * Body: { device_id: string, app_version: string }
 */
export async function handleDeviceVersionUpdate(request, env) {
  try {
    const data = await request.json();
    const deviceId = String(data.device_id || data.deviceId || '').trim();
    const appVersion = String(data.app_version || data.appVersion || '').trim();

    if (!deviceId) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing device_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    if (!appVersion) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing app_version' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ ok: false, error: 'DB unavailable' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // Check if device exists
    const device = await env.DB.prepare('SELECT device_id FROM device WHERE device_id = ?').bind(deviceId).first();

    if (!device) {
      return new Response(JSON.stringify({ ok: false, error: 'Device not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // Update device app_version and last_seen
    await env.DB.prepare('UPDATE device SET app_version = ?, last_seen = ? WHERE device_id = ?')
      .bind(appVersion, tsGmt7Plain(), deviceId)
      .run();

    return new Response(JSON.stringify({ ok: true, device_id: deviceId, app_version: appVersion }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}
