/**
 * Email utilities for domain validation and OTP sending
 */

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
 * @returns {Promise<{ok: boolean, status?: number, body?: string, messageId?: string, error?: string}>}
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
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>AD / Tools OTP</title>
  </head>
  <body style="margin:0;padding:0;background:#0e110f;color:#f2efe7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your AD Tools verification code is ${code}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#0e110f;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="width:100%;max-width:496px;background:#181c19;border:1px solid #384039;border-radius:16px;">
            <tr>
              <td style="padding:23px 28px 21px;border-bottom:1px dashed #384039;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="color:#f2efe7;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:14px;
                      line-height:1;font-weight:700;letter-spacing:2px;">AD / TOOLS</td>
                    <td align="right" style="color:#7f887e;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;
                      font-size:11px;line-height:1;letter-spacing:1.76px;">SIGN-IN RECEIPT</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:39px 28px 32px;">
                <h1 style="margin:0;color:#f2efe7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:32px;
                  line-height:1.08;font-weight:700;letter-spacing:-1.4px;">Here's your OTP.</h1>
                <p style="margin:12px 0 0;color:#a7ada4;font-size:15px;line-height:1.55;">Use it to finish signing in while it's still fresh.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                  style="width:100%;margin-top:31px;background:#101411;border:1px solid #384039;border-radius:12px;">
                  <tr>
                    <td style="padding:18px 18px 0;color:#7f887e;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;
                      font-size:11px;line-height:1;letter-spacing:1.76px;">ONE-TIME PASSCODE</td>
                    <td align="right" style="padding:18px 18px 0;color:#d2aa6e;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;
                      font-size:10px;line-height:1;font-weight:700;letter-spacing:0.8px;">SELECT TO COPY</td>
                  </tr>
                  <tr>
                    <td colspan="2" align="center" style="padding:24px 18px 27px;color:#f2efe7;font-family:'SFMono-Regular',Consolas,
                      'Liberation Mono',monospace;font-size:52px;line-height:1;font-weight:700;letter-spacing:8px;user-select:all;-webkit-user-select:all;">
                      ${code}
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" align="center" style="padding:0 18px 17px;color:#7f887e;font-size:12px;line-height:1.45;">
                      Select the code to copy.
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" align="center" style="padding:13px 16px 12px;background:#c49a5b;color:#17140f;font-family:'SFMono-Regular',Consolas,
                      'Liberation Mono',monospace;font-size:11px;line-height:1;font-weight:800;letter-spacing:1.76px;">
                      USE WITHIN ${OTP_EXPIRY_MINUTES} MINUTES
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:21px 28px 25px;border-top:1px dashed #384039;color:#7f887e;font-family:'SFMono-Regular',Consolas,
                'Liberation Mono',monospace;font-size:12px;line-height:1.7;letter-spacing:0.22px;">
                Not your request? Ignore this receipt.<br>
                Keep the code private.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const apiKey = String(env.RESEND_API_KEY || "").trim();
    if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not configured" };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "AD-Tools-OTP/1.0",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        subject,
        html,
        text,
        tags: [{ name: "category", value: "otp" }],
      }),
    });

    let responseBody = "";
    let responseData = null;
    try {
      responseBody = await res.text();
      responseData = responseBody ? JSON.parse(responseBody) : null;
    } catch (_) {}

    return {
      ok: res.ok,
      status: res.status,
      body: responseBody,
      messageId: responseData?.id,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
