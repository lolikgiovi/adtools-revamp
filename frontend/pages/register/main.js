import { OtpRequestFlow } from "../../core/OtpRequestFlow.js";
import { manualApprovalMonitor } from "../../core/ManualApprovalMonitor.js";
import { isRegistrationEmailAllowed } from "../../core/RegistrationEmail.js";
import { RegisterTemplate } from "./template.js";
import "./styles.css";
import { UsageTracker } from "../../core/UsageTracker.js";
import { SessionTokenStore } from "../../core/SessionTokenStore.js";
import { isTauri } from "../../core/Runtime.js";
import { fetchRegistrationAuthMode, REGISTRATION_AUTH_MODE } from "../../core/RegistrationAuthMode.js";

export class RegisterPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.root = null;
    this.step = "email"; // "email" -> request OTP, "otp" -> verify
    this.authMode = null;
    this.manualRequest = null;
  }

  mount(container) {
    this.root = container;
    container.innerHTML = RegisterTemplate;

    const form = container.querySelector(".register-form");
    const errorEl = container.querySelector(".register-error");
    const otpField = container.querySelector(".otp-field");
    const submitBtn = container.querySelector('[data-role="submit-btn"]');
    const manualBtn = container.querySelector('[data-role="manual-approval-btn"]');
    const checkApprovalBtn = container.querySelector('[data-role="check-approval-btn"]');

    try {
      const saved = JSON.parse(localStorage.getItem("manual.approval.request") || "null");
      if (saved?.requestId && saved?.email && saved?.deviceId) {
        this.manualRequest = saved;
        container.querySelector("#reg-username").value = saved.displayName || "";
        container.querySelector("#reg-email").value = saved.email;
        container.querySelector("#reg-department").value = saved.department || "";
        container.querySelector("#reg-role").value = saved.role || "";
      }
    } catch (_) {}

    manualBtn?.addEventListener("click", () => this.requestManualApproval());
    checkApprovalBtn?.addEventListener("click", () => this.checkManualApproval());
    this.unsubscribeApproval = manualApprovalMonitor.subscribe(({ request, data, error }) => {
      if (!this.root || request.requestId !== this.manualRequest?.requestId) return;
      if (error) this.setMessage(error.message || "Could not check approval status.");
      else if (data.status === "approved") this.manualRequest = null;
      else this.setMessage("Still pending. Approval status is checked automatically every minute.", "info");
    });
    manualApprovalMonitor.start({ eventBus: this.eventBus });
    this.otpFlow = new OtpRequestFlow({
      identity: () => this.getRegistrationIdentity(),
      retry: container.querySelector('[data-role="retry-email-btn"]'),
      manual: manualBtn,
      hint: container.querySelector('[data-role="fallback-countdown"]'),
    });
    container.querySelector('[data-role="retry-email-btn"]').addEventListener("click", () => this.requestOtp());
    container.querySelector("#reg-email").addEventListener("input", () => {
      this.step = "email";
      otpField.style.display = "none";
      submitBtn.textContent = "Request OTP";
      submitBtn.hidden = false;
      container.querySelector("#reg-otp").value = "";
      if (this.otpFlow.state()?.sent) {
        this.step = "otp";
        otpField.style.display = "block";
        submitBtn.textContent = "Verify & Continue";
      }
      this.otpFlow.render();
    });
    void this.loadAuthMode();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";
      errorEl.classList.remove("is-info");

      if (this.authMode !== REGISTRATION_AUTH_MODE.OTP) {
        errorEl.textContent = "Email OTP is currently disabled. Request manual approval instead.";
        return;
      }

      const usernameInput = container.querySelector("#reg-username");
      const emailInput = container.querySelector("#reg-email");
      const otpInput = container.querySelector("#reg-otp");
      const username = (usernameInput.value || "").trim().slice(0, 15);
      const email = (emailInput.value || "").trim();
      const department = container.querySelector("#reg-department").value;
      const role = container.querySelector("#reg-role").value;

      const emailOk = isRegistrationEmailAllowed(email);
      if (username.length < 2) {
        errorEl.textContent = "Please enter a valid Display Name.";
        return;
      }
      if (!emailOk) {
        errorEl.textContent = "Use your @bankmandiri.co.id email.";
        return;
      }

      if (!department || !role) {
        errorEl.textContent = !department ? "Please select a department." : "Please select a role.";
        return;
      }

      try {
        const baseEnv = (import.meta?.env?.VITE_WORKER_BASE || "").replace(/\/$/, "");

        // Step 1: request OTP
        if (this.step === "email") {
          await this.requestOtp();
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
            department,
            role,
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
            localStorage.setItem("user.department", department || "");
            localStorage.setItem("user.role", role || "");
            if (userId) localStorage.setItem("user.id", userId);
            localStorage.setItem("user.registered", "true");
          } catch (_) {}

          // Notify app and move to home
          this.eventBus?.emit?.("user:registered", { username, email, userId, department, role });
          location.hash = "#home";
          return;
        }
      } catch (err) {
        console.error(err);
        errorEl.textContent = "Unexpected error. Please try again.";
      }
    });
  }

  async loadAuthMode() {
    const mode = await fetchRegistrationAuthMode();
    if (!this.root) return;
    this.authMode = mode;

    const manual = mode === REGISTRATION_AUTH_MODE.MANUAL;
    const title = this.root.querySelector('[data-role="method-title"]');
    const copy = this.root.querySelector('[data-role="method-copy"]');
    const otpButton = this.root.querySelector('[data-role="submit-btn"]');
    const approvalStatus = this.root.querySelector('[data-role="approval-status"]');
    const otpField = this.root.querySelector(".otp-field");

    title.textContent = manual ? "Manual approval is enabled." : "Verify your email with an OTP.";
    copy.textContent = manual
      ? "Request approval, then contact Lolik directly for faster access."
      : "Please allow 1–3 minutes for delivery and check your spam folder.";
    this.otpFlow.manualMode = manual;
    this.otpFlow.render();
    if (!manual && this.otpFlow.state()?.sent) {
      this.step = "otp";
      otpField.style.display = "block";
      otpButton.textContent = "Verify & Continue";
    }
    otpButton.hidden = manual || (this.otpFlow.state() !== null && !this.otpFlow.state()?.sent);
    approvalStatus.hidden = !this.manualRequest;
    if (manual) {
      this.step = "email";
      otpField.style.display = "none";
    }
  }

  async requestOtp() {
    if (!this.root || this.authMode !== REGISTRATION_AUTH_MODE.OTP) return;
    const identity = this.getRegistrationIdentity();
    if (!this.validateIdentity(identity)) return;
    const button = this.root.querySelector('[data-role="submit-btn"]');
    button.disabled = true;
    try {
      const data = await this.otpFlow.request();
      if (!data || !this.root) return;
      this.step = "otp";
      button.hidden = false;
      this.root.querySelector(".otp-field").style.display = "block";
      button.textContent = "Verify & Continue";
      if (data.devCode) this.root.querySelector("#reg-otp").value = data.devCode;
      this.setMessage("Code requested. Please allow 1–3 minutes for delivery and check your spam folder.", "info");
    } catch (error) {
      if (this.root) {
        button.hidden = !this.otpFlow.state()?.sent;
        this.setMessage(error.message);
      }
    } finally {
      button.disabled = false;
    }
  }

  getRegistrationIdentity() {
    const displayName = (this.root.querySelector("#reg-username")?.value || "").trim().slice(0, 15);
    const email = (this.root.querySelector("#reg-email")?.value || "").trim().toLowerCase();
    const trackedDeviceId = typeof UsageTracker?.getDeviceId === "function" ? UsageTracker.getDeviceId() : null;
    const deviceId =
      trackedDeviceId || localStorage.getItem("adtools.deviceId") || localStorage.getItem("usage.installId") || this._fallbackInstallId();
    return {
      displayName,
      email,
      department: this.root.querySelector("#reg-department").value,
      role: this.root.querySelector("#reg-role").value,
      deviceId,
      platform: isTauri() ? "Desktop (Tauri)" : "Browser",
      locale: navigator.language || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      screenSize: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    };
  }

  setMessage(message, tone = "error") {
    const element = this.root?.querySelector(".register-error");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-info", tone === "info");
    element.classList.toggle("is-success", tone === "success");
  }

  validateIdentity(identity) {
    if (identity.displayName.length < 2) {
      this.setMessage("Please enter a valid Display Name.");
      return false;
    }
    if (!isRegistrationEmailAllowed(identity.email)) {
      this.setMessage("Use your @bankmandiri.co.id email.");
      return false;
    }
    if (!identity.department || !identity.role) {
      this.setMessage(!identity.department ? "Please select a department." : "Please select a role.");
      return false;
    }
    return true;
  }

  async postRegistrationEndpoint(path, payload) {
    const baseEnv = (import.meta?.env?.VITE_WORKER_BASE || "").replace(/\/$/, "");
    let lastError = "Request failed";
    for (const endpoint of [baseEnv ? `${baseEnv}${path}` : "", path].filter(Boolean)) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "omit",
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.ok) return data;
        lastError = data?.error || lastError;
        if (response.status < 500 && response.status !== 404) break;
      } catch (_) {}
    }
    throw new Error(lastError);
  }

  async requestManualApproval() {
    const identity = this.getRegistrationIdentity();
    if (!this.validateIdentity(identity)) return;
    const button = this.root.querySelector('[data-role="manual-approval-btn"]');
    button.disabled = true;
    button.textContent = "Requesting...";
    this.otpFlow.manualPending = true;
    this.setMessage("");
    try {
      const data = await this.postRegistrationEndpoint("/register/request-manual-approval", identity);
      this.manualRequest = { ...identity, requestId: data.requestId };
      localStorage.setItem("manual.approval.request", JSON.stringify(this.manualRequest));
      manualApprovalMonitor.start({ eventBus: this.eventBus });
      if (!this.root) return;
      this.root.querySelector('[data-role="approval-status"]').hidden = false;
      this.setMessage(
        data.status === "approved" ? "This request is approved. Checking access..." : "Manual approval request submitted.",
        "info",
      );
      if (data.status === "approved") await this.checkManualApproval();
    } catch (error) {
      this.setMessage(error.message || "Could not submit the approval request.");
    } finally {
      button.disabled = false;
      button.textContent = "Request Manual Approval";
      this.otpFlow.manualPending = false;
    }
  }

  async checkManualApproval() {
    if (!this.manualRequest) return;
    const button = this.root.querySelector('[data-role="check-approval-btn"]');
    button.disabled = true;
    button.textContent = "Checking...";
    this.setMessage("");
    try {
      await manualApprovalMonitor.check();
    } catch (error) {
      this.setMessage(error.message || "Could not check approval status.");
    } finally {
      button.disabled = false;
      button.textContent = "Check Status";
    }
  }

  unmount() {
    this.otpFlow?.destroy();
    this.unsubscribeApproval?.();
    this.unsubscribeApproval = null;
    this.root = null;
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
