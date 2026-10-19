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

// Registration is restricted to this exact domain, independently of config access settings.
export function isRegistrationEmailAllowed(email) {
  return typeof email === "string" && /^[^@\s]+@bankmandiri\.co\.id$/i.test(email.trim());
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
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>AD Tools verification code</title>
    <style>
      body {
        color: #20251f;
        margin: 0;
        padding: 0;
        font-family: Arial, Helvetica, sans-serif;
      }
      @media (max-width: 480px) {
        .pad {
          padding: 28px 22px !important;
        }
        .digits {
          font-size: 42px !important;
          letter-spacing: 6px !important;
        }
        .outer {
          padding: 20px 12px !important;
        }
        h1 {
          font-size: 28px !important;
        }
      }
      @media (prefers-color-scheme: dark) {
        .ground:not([class^="x_"]) {
          background-color: #101410 !important;
        }
        .sheet:not([class^="x_"]) {
          background-color: #1b211b !important;
        }
        .panel:not([class^="x_"]) {
          background-color: #111711 !important;
        }
        .ink:not([class^="x_"]) {
          color: #f5f2e9 !important;
        }
        .muted:not([class^="x_"]) {
          color: #bec7ba !important;
        }
        .accent:not([class^="x_"]) {
          color: #e3bd79 !important;
        }
        .expiry:not([class^="x_"]) {
          background-color: #303124 !important;
          color: #f5f2e9 !important;
        }
        .digits:not([class^="x_"]) {
          color: #f5f2e9 !important;
        }
      }
      [data-ogsb] .ground {
        background-color: #101410 !important;
      }
      [data-ogsb] .sheet {
        background-color: #1b211b !important;
      }
      [data-ogsb] .panel {
        background-color: #111711 !important;
      }
      [data-ogsb] .ink {
        color: #f5f2e9 !important;
      }
      [data-ogsb] .muted {
        color: #bec7ba !important;
      }
      [data-ogsb] .accent {
        color: #e3bd79 !important;
      }
      [data-ogsb] .expiry {
        background-color: #303124 !important;
        color: #f5f2e9 !important;
      }
      [data-ogsb] .digits {
        color: #f5f2e9 !important;
      }
    </style>
  </head>
  <body class="ground" style="margin: 0; background-color: #f0f0ec">
    <div data-email-theme-wrapper style="background-color: #ffffff; color: #20251f">
    <div style="display: none; max-height: 0; overflow: hidden">Your AD Tools verification code is ${code}. Expires in ${OTP_EXPIRY_MINUTES} minutes.</div>
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      class="ground"
      bgcolor="#f0f0ec"
      style="width: 100%; background-color: #f0f0ec"
    >
      <tr>
        <td class="outer" align="center" style="padding: 40px 20px">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            class="sheet"
            bgcolor="#ffffff"
            style="width: 100%; max-width: 480px; background-color: #ffffff; border-radius: 16px"
          >
            <tr>
              <td class="pad" style="padding: 36px">
                <p class="accent" style="margin: 0 0 36px; color: #846021; font-size: 19px; line-height: 24px; font-weight: 700">
                  AD / Tools
                </p>
                <h1
                  class="ink"
                  style="margin: 0 0 14px; color: #20251f; font-size: 30px; line-height: 1.15; letter-spacing: -0.8px; font-weight: 700"
                >
                  Here’s your OTP.
                </h1>
                <p class="muted" style="margin: 0 0 28px; color: #50594f; font-size: 16px; line-height: 1.6">
                  Enter this code to verify your email<br />and continue to AD Tools.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td
                      class="panel"
                      align="center"
                      bgcolor="#f1eee5"
                      style="background-color: #f1eee5; padding: 26px 12px; border-radius: 12px"
                    >
                      <div
                        class="digits"
                        style="
                          color: #20251f;
                          font-family: Arial, Helvetica, sans-serif;
                          font-size: 48px;
                          line-height: 1.2;
                          font-weight: 700;
                          letter-spacing: 8px;
                          font-variant-numeric: tabular-nums;
                          user-select: all;
                          -webkit-user-select: all;
                        "
                      >
                        ${code}
                      </div>
                    </td>
                  </tr>
                </table>
                <p class="ink" style="margin: 18px 0 0; color: #20251f; font-size: 15px; line-height: 24px">
                  Use within <strong>${OTP_EXPIRY_MINUTES} minutes.</strong>
                </p>
                <p class="muted" style="margin: 4px 0 0; color: #50594f; font-size: 14px; line-height: 23px">Select the code to copy it.</p>
                <p class="muted" style="margin: 34px 0 0; color: #50594f; font-size: 14px; line-height: 23px">
                  Didn’t request this code? You can ignore this email. Keep your code private.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    </div>
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
