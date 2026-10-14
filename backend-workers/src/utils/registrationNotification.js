// Admin alerts are best-effort and never change registration success.
export async function sendRegistrationNotification(env, details) {
  const to = String(env.REGISTRATION_ADMIN_EMAIL || "").trim();
  if (!to) return;
  try {
    const apiKey = String(env.RESEND_API_KEY || "").trim();
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
    const manual = details.mode !== "otp";
    const text = [
      manual ? "A new registration request is awaiting approval." : "A new user completed email OTP registration.",
      `Name: ${details.displayName || "Not provided"}`,
      `Email: ${details.email}`,
      `Department: ${details.department || "Not provided"}`,
      `Role: ${details.role || "Not provided"}`,
      `Platform: ${details.platform || "Not provided"}`,
      `Request ID: ${details.requestId}`,
      manual && details.approvalUrl ? `Review requests: ${details.approvalUrl}` : "",
      manual ? "Sign in to the approval dashboard to review this request." : "No manual approval is required.",
    ]
      .filter(Boolean)
      .join("\n");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `registration-${details.mode || "manual"}-${details.requestId}`,
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        from: `${env.MAIL_FROM_NAME || "AD Tools"} <${env.MAIL_FROM || "no-reply@adtools.local"}>`,
        to: [to],
        subject: `${env.MAIL_SUBJECT_PREFIX || "[AD Tools]"} ${manual ? "New registration request" : "New registered user"}`,
        text,
        tags: [{ name: "category", value: "registration_admin" }],
      }),
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  } catch (error) {
    // Do not log provider bodies, credentials, or applicant details.
    console.error("Registration admin notification failed", details.requestId, String(error));
  }
}
