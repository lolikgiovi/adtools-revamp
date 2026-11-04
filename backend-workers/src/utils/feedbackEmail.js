/** Notify the maintainer only after the feedback has been stored successfully. */
export async function sendFeedbackEmail(env, { email, deviceId, toolId, message }) {
  try {
    const apiKey = String(env.RESEND_API_KEY || "").trim();
    const recipient = String(env.FEEDBACK_EMAIL || env.REGISTRATION_ADMIN_EMAIL || "").trim();
    if (!apiKey || !recipient) {
      console.error(JSON.stringify({ message: "feedback notification unavailable", reason: "Missing email configuration" }));
      return false;
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        from: `${env.MAIL_FROM_NAME || "AD Tools"} <${env.MAIL_FROM || "otp-adtools@lolik.cloud"}>`,
        to: [recipient],
        subject: `${env.MAIL_SUBJECT_PREFIX || "[AD Tools]"} Feedback`,
        text: `Tool: ${toolId || "General feedback"}\nFrom (reported identity): ${email}\nDevice: ${deviceId}\n\n${message}`,
        tags: [{ name: "category", value: "feedback" }],
      }),
    });
    if (!response.ok) console.error(JSON.stringify({ message: "feedback notification rejected", status: response.status }));
    return response.ok;
  } catch (_) {
    console.error(JSON.stringify({ message: "feedback notification failed" }));
    return false;
  }
}
