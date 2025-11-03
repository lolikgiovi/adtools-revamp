// Reusable OTP overlay component for vanilla JS apps
// Usage: import { openOtpOverlay } from './OtpOverlay.js';
// const { token, kvValue } = await openOtpOverlay({ email, kvKey: 'settings/defaults' });

function createElement(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function nowMs() { return Date.now(); }

export async function openOtpOverlay({
  email,
  requestEndpoint = '/register/request-otp',
  verifyEndpoint = '/register/verify',
  rateLimitMs = 60_000,
  storageScope = 'default', // scope for localStorage cooldown
  kvKey, // optional: if provided, fetch KV after verification
  onClose,
} = {}) {
  return new Promise((resolve, reject) => {
    try {
      const overlay = createElement(`
        <div class="otp-modal" role="dialog" aria-modal="true" aria-label="OTP Verification">
          <div class="otp-dialog">
            <h3>One-Time Password</h3>
            <p class="otp-email-status"></p>
            <div class="otp-actions">
              <button type="button" class="btn btn-primary otp-request">Request OTP</button>
            </div>
            <div class="otp-input-row">
              <input type="text" class="otp-code-input" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter 6-digit OTP" />
              <button type="button" class="btn btn-secondary otp-confirm">Confirm</button>
            </div>
            <div class="otp-error" aria-live="polite"></div>
            <div class="otp-footer">
              <button type="button" class="btn otp-close">Close</button>
            </div>
          </div>
        </div>
      `);

      const status = overlay.querySelector('.otp-email-status');
      const err = overlay.querySelector('.otp-error');
      const input = overlay.querySelector('.otp-code-input');
      const btnReq = overlay.querySelector('.otp-request');
      const btnConfirm = overlay.querySelector('.otp-confirm');
      const btnClose = overlay.querySelector('.otp-close');

      const lastKey = `otp.lastRequest.${storageScope}`;
      const cooldownLeft = () => {
        try {
          const last = Number(localStorage.getItem(lastKey) || 0);
          const left = rateLimitMs - (nowMs() - last);
          return left > 0 ? left : 0;
        } catch (_) { return 0; }
      };

      // Initialize status
      if (!email) {
        status.textContent = '';
        err.textContent = 'No registered email found. Please register first.';
        btnReq.disabled = true;
        btnConfirm.disabled = true;
      } else {
        status.textContent = `We will send an OTP to: ${email}`;
        err.textContent = '';
        const left = cooldownLeft();
        if (left > 0) {
          disableWithCountdown(btnReq, left);
        }
      }

      let countdownTimer = null;
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
            button.textContent = button.dataset.originalLabel || 'Request OTP';
            return;
          }
          button.textContent = `Resend in ${remain}s`;
        }, 1000);
      }

      async function requestOtp() {
        if (!email) return;
        // Rate-limit immediately upon click
        try { localStorage.setItem(lastKey, String(nowMs())); } catch (_) {}
        disableWithCountdown(btnReq, rateLimitMs);
        err.textContent = '';
        try {
          const res = await fetch(requestEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error || `Network error (${res.status})`);
          // Dev-mode convenience: prefill OTP if provided by backend
          if (j?.devCode) {
            input.value = String(j.devCode);
            status.textContent = `${status.textContent} (Dev: OTP auto-filled)`;
          }
        } catch (e) {
          err.textContent = String(e?.message || e || 'Failed to request OTP');
        }
      }

      async function verifyOtp() {
        err.textContent = '';
        const code = (input.value || '').trim();
        if (!/^[0-9]{6}$/.test(code)) {
          err.textContent = 'Please enter a 6-digit OTP code.';
          return;
        }
        try {
          const res = await fetch(verifyEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j?.ok) throw new Error(j?.error || 'Invalid OTP');
          if (!j?.token) throw new Error('Authorization token missing');

          let kvValue = undefined;
          if (kvKey) {
            const res2 = await fetch(`/api/kv/get?key=${encodeURIComponent(kvKey)}`, {
              headers: { Authorization: `Bearer ${j.token}` },
            });
            const j2 = await res2.json().catch(() => ({}));
            if (!res2.ok || !j2?.ok) throw new Error(j2?.error || 'KV access failure');
            kvValue = j2.value;
          }

          cleanup();
          resolve({ token: j.token, kvValue });
        } catch (e) {
          err.textContent = String(e?.message || e || 'Verification failed');
        }
      }

      function cleanup() {
        clearInterval(countdownTimer);
        overlay.remove();
        if (onClose) { try { onClose(); } catch (_) {} }
      }

      btnReq.addEventListener('click', requestOtp);
      btnConfirm.addEventListener('click', verifyOtp);
      btnClose.addEventListener('click', () => {
        cleanup();
        reject(new Error('Closed'));
      });

      document.body.appendChild(overlay);
    } catch (e) {
      reject(e);
    }
  });
}