// Device-bound OTP delivery state. KV has the same eventual consistency limits as existing rate limits.
export const OTP_RETRY_MS = 60_000;
export const OTP_MANUAL_WAIT_MS = 180_000;
export function otpFlowKey(email, deviceId = "") {
  return `otp:flow:${email}:${String(deviceId).slice(0, 200)}`;
}
export async function readOtpFlow(env, email, deviceId) {
  const raw = await env.adtools?.get(otpFlowKey(email, deviceId));
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}
export async function saveOtpFlow(env, email, deviceId, state) {
  await env.adtools.put(otpFlowKey(email, deviceId), JSON.stringify(state), { expirationTtl: 1800 });
}
