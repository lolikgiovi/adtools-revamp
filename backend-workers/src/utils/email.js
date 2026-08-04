/**
 * Email utilities for domain validation and OTP sending
 */

import { tsGmt7 } from "./timestamps.js";

/**
 * Parses allowed email domains from environment
 * @param {object} env - Environment bindings
 * @returns {string[]} - Array of lowercase domain strings
 */
export function allowedEmailDomains(env) {
  const raw = String(env.ALLOWED_EMAIL_DOMAINS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((d) =>
      String(d || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

/**
 * Checks if an email's domain is in the allowed list
 * @param {string} email - Email address to check
 * @param {object} env - Environment bindings
 * @returns {boolean} - True if allowed (or no restrictions configured)
 */
export function isEmailDomainAllowed(email, env) {
  const parts = String(email || "")
    .toLowerCase()
    .split("@");
  const domain = parts.length > 1 ? parts[1] : "";
  const allowed = allowedEmailDomains(env);
  if (!allowed.length) return true; // no restriction configured
  return allowed.includes(domain);
}

/**
 * Sends OTP verification email via Cloudflare's Send Email binding
 * @param {object} env - Environment bindings
 * @param {string} to - Recipient email address
 * @param {string} code - OTP code to send
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
export async function sendOtpEmail(env, to, code) {
  try {
    const subjectPrefix = String(env.MAIL_SUBJECT_PREFIX || "[AD Tools]");
    const subject = `${subjectPrefix} OTP for AD Tools`;
    const from = String(env.MAIL_FROM || "no-reply@adtools.local");
    const text = `Your verification code is ${code}. It expires in 10 minutes.`;
    const html = `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`;

    const response = await env.EMAIL.send({
      to,
      from,
      subject,
      html,
      text,
    });

    return { ok: true, messageId: response?.messageId };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
