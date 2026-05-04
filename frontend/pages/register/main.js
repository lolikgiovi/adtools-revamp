import { RegisterTemplate } from "./template.js";
import "./styles.css";
import { UsageTracker } from "../../core/UsageTracker.js";
import { SessionTokenStore } from "../../core/SessionTokenStore.js";
import { isTauri } from "../../core/Runtime.js";

export class RegisterPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.root = null;
    this.step = "email"; // "email" -> request OTP, "otp" -> verify
  }

  mount(container) {
    this.root = container;
    container.innerHTML = RegisterTemplate;

    const form = container.querySelector(".register-form");
    const errorEl = container.querySelector(".register-error");
    const otpField = container.querySelector(".otp-field");
    const submitBtn = container.querySelector('[data-role="submit-btn"]');

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";

      const usernameInput = container.querySelector("#reg-username");
      const emailInput = container.querySelector("#reg-email");
      const otpInput = container.querySelector("#reg-otp");
      const username = (usernameInput.value || "").trim().slice(0, 15);
      const email = (emailInput.value || "").trim();

      const emailOk = /.+@.+\..+/.test(email);
      if (username.length < 2) {
        errorEl.textContent = "Please enter a valid Display Name.";
        return;
      }
      if (!emailOk) {
        errorEl.textContent = "Please enter a valid email.";
        return;
      }

      try {
        const baseEnv = (import.meta?.env?.VITE_WORKER_BASE || "").replace(/\/$/, "");

        // Step 1: request OTP
        if (this.step === "email") {
          // Request OTP
          submitBtn.disabled = true;
          submitBtn.textContent = "Sending code...";
          const endpointCandidates = ["/register/request-otp", baseEnv ? `${baseEnv}/register/request-otp` : ""];
          let devCode = null;
          let requested = false;
          let blocked = false;
          for (const endpoint of endpointCandidates.filter(Boolean)) {
            try {
              const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
                credentials: "omit",
              });
              if (res.ok) {
                const resp = await res.json();
                devCode = resp?.devCode || null;
                requested = true;
                break;
              } else if (res.status === 403) {
                blocked = true;
                let msg = "Email domain not allowed";
                try {
                  const resp = await res.json();
                  if (resp && typeof resp.error === "string" && resp.error) msg = resp.error;
                } catch (_) {}
                errorEl.textContent = msg || "Email domain not allowed. Use your @bankmandiri.co.id email.";
                break;
              }
            } catch (_) {}
          }
          submitBtn.disabled = false;
          if (blocked) {
            submitBtn.textContent = "Continue";
            return;
          }
          if (!requested) {
            submitBtn.textContent = "Continue";
            errorEl.textContent = "Failed to send code. Please try again.";
            return;
          }

          // Progress UI to OTP step
          otpField.style.display = "block";
          this.step = "otp";
          submitBtn.textContent = "Verify & Continue";
          if (devCode) {
            otpInput.value = devCode;
          }
          errorEl.textContent = "We sent a verification code to your email.";
          return; // stop here; verification will happen on next submit
        }

        // Step 2: verify OTP and finalize registration
        if (this.step === "otp") {
          const code = (otpInput.value || "").trim();
          if (!/^[0-9]{6}$/.test(code)) {
            errorEl.textContent = "Enter the 6-digit verification code.";
            return;
          }

          const endpointCandidates = ["/register/verify", baseEnv ? `${baseEnv}/register/verify` : ""];
          const deviceId =
            typeof UsageTracker?.getDeviceId === "function"
              ? UsageTracker.getDeviceId()
              : localStorage.getItem("adtools.deviceId") || localStorage.getItem("usage.installId") || this._fallbackInstallId();

          const platform = isTauri() ? "Desktop (Tauri)" : "Browser";
          const payload = {
            deviceId,
            displayName: username,
            email,
            code,
            platform,
          };

          submitBtn.disabled = true;
          submitBtn.textContent = "Verifying...";
          let verified = false;
          let userId = null;
          let blockedVerify = false;
          let sessionToken = null;
          for (const endpoint of endpointCandidates.filter(Boolean)) {
            try {
              const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                credentials: "omit",
              });
              if (res.ok) {
                const resp = await res.json();
                if (resp?.ok) {
                  verified = true;
                  userId = resp?.userId || null;
                  sessionToken = resp?.token || null;
                  break;
                }
              } else if (res.status === 403) {
                blockedVerify = true;
                let msg = "Email domain not allowed";
                try {
                  const resp = await res.json();
                  if (resp && typeof resp.error === "string" && resp.error) msg = resp.error;
                } catch (_) {}
                errorEl.textContent = msg || "Email domain not allowed. Use your @bankmandiri.co.id email.";
                break;
              }
            } catch (_) {}
          }
          submitBtn.disabled = false;
          submitBtn.textContent = "Verify & Continue";

          if (blockedVerify) {
            return;
          }
          if (!verified) {
            errorEl.textContent = "Verification failed. Check the code and try again.";
            return;
          }

          // Persist session token for OTP-auth KV access while valid
          try {
            if (sessionToken) SessionTokenStore.saveToken(sessionToken);
          } catch (_) {}

          // Persist locally after verification
          try {
            localStorage.setItem("user.username", username);
            localStorage.setItem("user.email", email);
            if (userId) localStorage.setItem("user.id", userId);
            localStorage.setItem("user.registered", "true");
          } catch (_) {}

          // Notify app and move to home
          this.eventBus?.emit?.("user:registered", { username, email, userId });
          location.hash = "#home";
          return;
        }
      } catch (err) {
        console.error(err);
        errorEl.textContent = "Unexpected error. Please try again.";
      }
    });
  }

  _fallbackInstallId() {
    let id = localStorage.getItem("usage.installId");
    if (!id) {
      id = "inst_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("usage.installId", id);
    }
    return id;
  }
}
