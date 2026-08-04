/**
 * Email utilities for domain validation and OTP sending
 */

import { tsGmt7 } from "./timestamps.js";

export const OTP_EXPIRY_MINUTES = 30;

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
 * Sends OTP verification email via Resend
 * @param {object} env - Environment bindings
 * @param {string} to - Recipient email address
 * @param {string} code - OTP code to send
 * @returns {Promise<{ok: boolean, status?: number, body?: string, error?: string}>}
 */
export async function sendOtpEmail(env, to, code) {
  try {
    const subjectPrefix = String(env.MAIL_SUBJECT_PREFIX || "[AD Tools]");
    const subject = `${subjectPrefix} OTP for AD Tools`;
    const fromEmail = String(env.MAIL_FROM || "no-reply@adtools.local");
    const fromName = String(env.MAIL_FROM_NAME || "AD Tools");
    const text = `Your AD Tools verification code is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes. If you did not request this code, ignore this email.`;
    const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f5f8;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your AD Tools verification code is ${code}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f5f8;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="max-width:560px;background:#ffffff;border:1px solid #dfe4ec;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="height:6px;background:#3157d5;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:36px 40px 12px;">
                <p style="margin:0 0 12px;color:#3157d5;font-size:13px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">
                  AD Tools · Secure sign-in
                </p>
                <h1 style="margin:0;color:#172033;font-size:28px;line-height:1.25;font-weight:700;">Your verification code</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 40px 24px;">
                <div style="padding:22px 16px;background:#f5f7ff;border:1px solid #ccd6ff;border-radius:12px;text-align:center;">
                  <span style="color:#173489;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:36px;
                    line-height:1;font-weight:700;letter-spacing:8px;user-select:all;">${code}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 40px 36px;">
                <p style="margin:0;color:#38445a;font-size:15px;line-height:1.65;">
                  This code expires in <strong>${OTP_EXPIRY_MINUTES} minutes</strong>. If you did not request it, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px;background:#f8f9fb;border-top:1px solid #e7eaf0;color:#7b8495;font-size:12px;line-height:1.5;">
                Sent automatically by AD Tools. Never share your verification code with anyone.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    let responseBody = "";
    try {
      responseBody = await res.text();
    } catch (_) {}
    return { ok: res.ok, status: res.status, body: responseBody };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
