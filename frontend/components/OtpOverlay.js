// Reusable OTP overlay component for vanilla JS apps
// Usage: import { openOtpOverlay } from './OtpOverlay.js';
// const { token, kvValue } = await openOtpOverlay({ email, kvKey: 'default-config' });

function createElement(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function nowMs() {
  return Date.now();
}

import { SessionTokenStore } from "../core/SessionTokenStore.js";
import { UsageTracker } from "../core/UsageTracker.js";
import { isTauri } from "../core/Runtime.js";
import { fetchRegistrationAuthMode, REGISTRATION_AUTH_MODE } from "../core/RegistrationAuthMode.js";

export async function openOtpOverlay({
  email,
  requestEndpoint = "/register/request-otp",
  verifyEndpoint = "/register/verify",
  rateLimitMs = 60_000,
  storageScope = "default", // scope for localStorage cooldown
  kvKey, // optional: if provided, fetch KV after verification
  onClose,
  // Centralized behavior: prefer using cached session token before showing UI
  preferCachedToken = true,
  // Optional override for token TTL; defaults to 6 hours, or env value if provided
  tokenTtlMs,
} = {}) {
  // Early return with cached token if still valid, optionally fetching KV
  if (preferCachedToken) {
    try {
      const ttlDefault = Number(import.meta?.env?.VITE_SESSION_TTL_MS || 0) || 6 * 60 * 60 * 1000; // 6 hours
      const ttl = typeof tokenTtlMs === "number" && tokenTtlMs > 0 ? tokenTtlMs : ttlDefault;
      const token = SessionTokenStore.getToken();
      const issuedAt = SessionTokenStore.getIssuedAt();
      const isFresh = token && issuedAt && Date.now() - issuedAt < ttl;
      if (isFresh) {
        const BASE = (import.meta?.env?.VITE_WORKER_BASE || "").trim();
        if (kvKey) {
          const kvUrl = BASE ? `${BASE}/api/kv/get?key=${encodeURIComponent(kvKey)}` : `/api/kv/get?key=${encodeURIComponent(kvKey)}`;
          let accessDeniedError = null;
          try {
            const res = await fetch(kvUrl, { headers: { Authorization: `Bearer ${token}` } });
            const j = await res.json().catch(() => ({}));
            if (res.ok && j?.ok) {
              return { token, kvValue: j.value };
            }
            if (res.status === 403) {
              accessDeniedError = new Error(j?.error || "Config access denied");
              accessDeniedError.name = "ConfigAccessDeniedError";
            }
            // If unauthorized or token invalid, fall through to UI flow
            if (
              res.status === 401 ||
              String(j?.error || "")
                .toLowerCase()
                .includes("unauthorized")
            ) {
              // proceed to OTP overlay UI
            } else {
              // For other errors, still fall back to OTP UI rather than failing hard
            }
          } catch (_) {
            // Network or parsing error → fall through to OTP UI
          }
          if (accessDeniedError) throw accessDeniedError;
        } else {
          // No KV needed; return token directly
          return { token };
        }
      }
    } catch (e) {
      if (e?.name === "ConfigAccessDeniedError") throw e;
      // Ignore and fall through to OTP UI
    }
  }

  const authMode = await fetchRegistrationAuthMode();
  const manual = authMode === REGISTRATION_AUTH_MODE.MANUAL;

  return new Promise((resolve, reject) => {
    try {
      const overlay = createElement(`
        <div class="otp-modal" role="dialog" aria-modal="true" aria-label="Verify access">
          <div class="otp-dialog">
            <h3>Verify access</h3>
            <p class="otp-email-status"></p>
            <div class="otp-actions">
              ${
                manual
                  ? '<button type="button" class="btn btn-primary otp-manual-request">Request Manual Approval</button>'
                  : '<button type="button" class="btn btn-primary otp-request">Request OTP</button>'
              }
            </div>
            ${
              manual
                ? '<p class="otp-manual-status" role="status" hidden></p><button type="button" class="btn btn-secondary otp-manual-check" hidden>Check Approval Status</button>'
                : '<div class="otp-input-row"><input type="text" class="otp-code-input" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter 6-digit OTP" /><button type="button" class="btn btn-secondary otp-confirm">Confirm</button></div>'
            }
            <div class="otp-error" aria-live="polite"></div>
            <div class="otp-footer">
              <button type="button" class="btn otp-close">Close</button>
            </div>
          </div>
        </div>
      `);

      const status = overlay.querySelector(".otp-email-status");
      const err = overlay.querySelector(".otp-error");
      const input = overlay.querySelector(".otp-code-input");
      const btnReq = overlay.querySelector(".otp-request");
      const btnConfirm = overlay.querySelector(".otp-confirm");
      const btnClose = overlay.querySelector(".otp-close");
      const btnManual = overlay.querySelector(".otp-manual-request");
      const btnCheck = overlay.querySelector(".otp-manual-check");
      const manualStatus = overlay.querySelector(".otp-manual-status");
      const manualKey = "manual.approval.request";
      const deviceId = UsageTracker.getDeviceId();
      let manualRequest = null;
      if (manual) {
        try {
          const saved = JSON.parse(localStorage.getItem(manualKey) || "null");
          if (saved?.requestId && saved.email === email?.trim().toLowerCase() && saved.deviceId === deviceId) {
            manualRequest = saved;
          }
        } catch (_) {
          manualRequest = null;
        }
      }

      const lastKey = `otp.lastRequest.${storageScope}`;
      const cooldownLeft = () => {
        try {
          const last = Number(localStorage.getItem(lastKey) || 0);
          const left = rateLimitMs - (nowMs() - last);
          return left > 0 ? left : 0;
        } catch (_) {
          return 0;
        }
      };
      let countdownTimer = null;

      // Initialize status
      if (!email) {
        status.textContent = "";
        err.textContent = "No registered email found. Please register first.";
        if (btnReq) btnReq.disabled = true;
        if (btnConfirm) btnConfirm.disabled = true;
        if (btnManual) btnManual.disabled = true;
      } else if (manual) {
        status.textContent = `Request manual approval for ${email}, then contact Lolik directly for faster access.`;
        err.textContent = "";
        if (manualRequest) showManualStatus("Approval requested. Contact Lolik to review it.");
      } else {
        status.textContent = `Send a code to ${email}. Delivery takes around 1 minute. Contact Lolik directly for faster access.`;
        err.textContent = "";
        const left = cooldownLeft();
        if (left > 0) {
          disableWithCountdown(btnReq, left);
        }
      }

      function showManualStatus(message) {
        manualStatus.textContent = message;
        manualStatus.hidden = false;
        btnCheck.hidden = false;
      }

      async function postApproval(path, payload) {
        const base = (import.meta?.env?.VITE_WORKER_BASE || "").trim().replace(/\/$/, "");
        const response = await fetch(base ? `${base}${path}` : path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "omit",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) throw new Error(data?.error || `Approval request failed (${response.status})`);
        return data;
      }

      async function finishWithToken(token) {
        if (!token) throw new Error("Authorization token missing");
        let kvValue;
        if (kvKey) {
          const base = (import.meta?.env?.VITE_WORKER_BASE || "").trim().replace(/\/$/, "");
          const kvUrl = base ? `${base}/api/kv/get?key=${encodeURIComponent(kvKey)}` : `/api/kv/get?key=${encodeURIComponent(kvKey)}`;
          const response = await fetch(kvUrl, { headers: { Authorization: `Bearer ${token}` } });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data?.ok) throw new Error(data?.error || "KV access failure");
          kvValue = data.value;
        }
        SessionTokenStore.saveToken(token);
        cleanup();
        resolve({ token, kvValue });
      }

      async function checkManualApproval() {
        if (!manualRequest) return;
        btnCheck.disabled = true;
        err.textContent = "";
        try {
          const data = await postApproval("/register/manual-approval-status", manualRequest);
          if (data.status !== "approved") {
            showManualStatus("Still pending. Contact Lolik to review the request.");
            return;
          }
          await finishWithToken(data.token);
          try {
            localStorage.removeItem(manualKey);
          } catch (_) {
            // Approval succeeded even if local storage is unavailable.
          }
        } catch (error) {
          err.textContent = error.message || "Could not check approval status.";
        } finally {
          btnCheck.disabled = false;
        }
      }

      async function requestManualApproval() {
        if (!email) return;
        btnManual.disabled = true;
        err.textContent = "";
        try {
          const displayName = (localStorage.getItem("user.username") || email.split("@")[0]).trim().slice(0, 15);
          const identity = {
            displayName: displayName.length >= 2 ? displayName : "AD Tools User",
            email: email.trim().toLowerCase(),
            deviceId,
            platform: isTauri() ? "Desktop (Tauri)" : "Browser",
            locale: navigator.language || "",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
            screenSize: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
          };
          const data = await postApproval("/register/request-manual-approval", identity);
          manualRequest = { ...identity, requestId: data.requestId };
          localStorage.setItem(manualKey, JSON.stringify(manualRequest));
          showManualStatus(
            data.status === "approved" ? "Approval granted. Checking access..." : "Approval requested. Contact Lolik to review it.",
          );
          if (data.status === "approved") await checkManualApproval();
        } catch (error) {
          err.textContent = error.message || "Could not submit the approval request.";
        } finally {
          btnManual.disabled = false;
        }
      }

      function disableWithCountdown(button, ms) {
        clearInterval(countdownTimer);
        let remain = Math.ceil(ms / 1000);
        button.disabled = true;
        button.dataset.originalLabel = button.textContent;
        button.textContent = `Resend in ${remain}s`;
        countdownTimer = setInterval(() => {
          remain -= 1;
          if (remain <= 0) {
            clearInterval(countdownTimer);
            button.disabled = false;
            button.textContent = button.dataset.originalLabel || "Request OTP";
            return;
          }
          button.textContent = `Resend in ${remain}s`;
        }, 1000);
      }

      async function requestOtp() {
        if (!email) return;
        // Rate-limit immediately upon click
        try {
          localStorage.setItem(lastKey, String(nowMs()));
        } catch (_) {}
        disableWithCountdown(btnReq, rateLimitMs);
        err.textContent = "";
        try {
          const BASE = (import.meta?.env?.VITE_WORKER_BASE || "").trim();
          const reqUrl = BASE ? `${BASE}${requestEndpoint}` : requestEndpoint;
          const res = await fetch(reqUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error || `Network error (${res.status})`);
          status.textContent = `Code requested for ${email}. Delivery takes around 1 minute. Contact Lolik directly for faster access.`;
          // Dev-mode convenience: prefill OTP if provided by backend
          if (j?.devCode) {
            input.value = String(j.devCode);
            status.textContent = `${status.textContent} (Dev: OTP auto-filled)`;
          }
        } catch (e) {
          err.textContent = String(e?.message || e || "Failed to request OTP");
        }
      }

      async function verifyOtp() {
        err.textContent = "";
        const code = (input.value || "").trim();
        if (!/^[0-9]{6}$/.test(code)) {
          err.textContent = "Please enter a 6-digit OTP code.";
          return;
        }
        try {
          const BASE = (import.meta?.env?.VITE_WORKER_BASE || "").trim();
          const verUrl = BASE ? `${BASE}${verifyEndpoint}` : verifyEndpoint;
          const res = await fetch(verUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j?.ok) throw new Error(j?.error || "Invalid OTP");
          await finishWithToken(j.token);
        } catch (e) {
          err.textContent = String(e?.message || e || "Verification failed");
        }
      }

      function cleanup() {
        clearInterval(countdownTimer);
        overlay.remove();
        if (onClose) {
          try {
            onClose();
          } catch (_) {}
        }
      }

      btnReq?.addEventListener("click", requestOtp);
      btnManual?.addEventListener("click", requestManualApproval);
      btnCheck?.addEventListener("click", checkManualApproval);
      btnConfirm?.addEventListener("click", verifyOtp);
      btnClose.addEventListener("click", () => {
        cleanup();
        reject(new Error("Closed"));
      });

      document.body.appendChild(overlay);
    } catch (e) {
      reject(e);
    }
  });
}
