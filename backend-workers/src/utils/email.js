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
  <body style="margin:0;padding:0;background:#e9e6de;color:#1c1c1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your AD Tools verification code is ${code}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#e9e6de;">
      <tr>
        <td align="center" style="padding:36px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="max-width:440px;background:#fffdf6;border:1px solid #bdb9ae;">
            <tr>
              <td style="padding:22px 28px;border-bottom:1px dashed #aaa69c;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="color:#1c1c1a;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:13px;
                      line-height:1;font-weight:700;letter-spacing:1.5px;">AD / TOOLS</td>
                    <td align="right" style="color:#77736b;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;
                      font-size:10px;line-height:1;letter-spacing:1px;">SIGN-IN RECEIPT</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 24px;">
                <h1 style="margin:0 0 7px;color:#1c1c1a;font-size:25px;line-height:1.25;font-weight:700;letter-spacing:-0.35px;">
                  Here's your OTP.
                </h1>
                <p style="margin:0;color:#68645d;font-size:14px;line-height:1.55;">Use it to finish signing in while it's still fresh.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 30px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                  style="background:#ffffff;border:2px solid #1c1c1a;">
                  <tr>
                    <td align="center" style="padding:20px 16px 8px;color:#77736b;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;
                      font-size:10px;line-height:1;letter-spacing:1.4px;">ONE-TIME PASSCODE</td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:10px 12px 22px;color:#1c1c1a;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;
                      font-size:42px;line-height:1;font-weight:700;letter-spacing:8px;user-select:all;">${code}</td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:11px 16px;background:#e24a35;color:#ffffff;font-family:'SFMono-Regular',Consolas,
                      'Liberation Mono',monospace;font-size:11px;line-height:1;font-weight:700;letter-spacing:1.1px;">
                      USE WITHIN ${OTP_EXPIRY_MINUTES} MINUTES
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 22px;border-top:1px dashed #aaa69c;color:#706c64;font-family:'SFMono-Regular',Consolas,
                'Liberation Mono',monospace;font-size:11px;line-height:1.65;">
                NOT YOUR REQUEST? IGNORE THIS RECEIPT.<br>
                KEEP THE CODE PRIVATE.
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
