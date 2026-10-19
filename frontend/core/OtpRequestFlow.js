// Shared delivery deadlines for registration and protected-action verification.
export class OtpRequestFlow {
  constructor({ identity, retry, manual, hint, endpoint = "/register/request-otp", manualMode = false, showInitial = false }) {
    Object.assign(this, { identity, retry, manual, hint, endpoint, manualMode, showInitial });
    this.busy = false;
    this.closed = false;
    this.render();
    this.timer = setInterval(() => this.render(), 1000);
  }

  key() {
    const { email, deviceId } = this.identity();
    return `otp.flow:${String(email || "")
      .trim()
      .toLowerCase()}:${deviceId || ""}`;
  }

  read() {
    try {
      const state = JSON.parse(localStorage.getItem(this.key()) || "null");
      return state?.savedAt > Date.now() - 30 * 60_000 ? state : null;
    } catch (_) {
      return null;
    }
  }

  save(key, state) {
    this.memoryKey = key;
    this.memoryState = { ...state, savedAt: Date.now() };
    try {
      localStorage.setItem(key, JSON.stringify(this.memoryState));
    } catch (_) {}
  }

  state() {
    return this.read() || (this.memoryKey === this.key() && this.memoryState?.savedAt > Date.now() - 30 * 60_000 ? this.memoryState : null);
  }

  render() {
    if (this.closed) return;
    const state = this.state();
    const missingEmail = !String(this.identity().email || "").trim();
    const retrySeconds = Math.max(0, Math.ceil(((state?.retryAt || 0) - Date.now()) / 1000));
    const manualSeconds = Math.max(0, Math.ceil(((state?.manualAvailableAt || 0) - Date.now()) / 1000));
    this.retry.hidden = this.manualMode || (!state && !this.showInitial);
    this.retry.disabled = missingEmail || this.busy || retrySeconds > 0;
    this.retry.textContent = this.busy
      ? "Sending code..."
      : retrySeconds
        ? `Retry email in ${retrySeconds}s`
        : state
          ? "Retry Email"
          : "Request OTP";
    this.manual.hidden = !this.manualMode && !state;
    this.manual.disabled =
      (missingEmail && this.showInitial) ||
      this.manualPending ||
      this.busy ||
      (!this.manualMode && !state?.manualApprovalAvailable && manualSeconds > 0);
    this.manual.textContent = "Request Manual Approval";
    this.hint.textContent =
      !this.manualMode && state && !state.manualApprovalAvailable && manualSeconds
        ? `Request Manual Approval available in ${Math.floor(manualSeconds / 60)}:${String(manualSeconds % 60).padStart(2, "0")}.`
        : "";
  }

  async request() {
    if (this.busy || this.closed || this.state()?.retryAt > Date.now()) return null;
    const key = this.key();
    const previous = this.state();
    this.busy = true;
    this.render();
    let receivedResponse = false;
    try {
      const base = (import.meta?.env?.VITE_WORKER_BASE || "").trim().replace(/\/$/, "");
      const response = await fetch(base ? `${base}${this.endpoint}` : this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.identity()),
        credentials: "omit",
      });
      const data = await response.json().catch(() => ({}));
      const accepted = response.status === 200 && data.ok === true;
      const state = {
        sent: accepted || previous?.sent === true,
        retryAt: data.retryAt || Date.now() + 60_000,
        manualAvailableAt: data.manualAvailableAt || previous?.manualAvailableAt || Date.now() + 180_000,
        manualApprovalAvailable: data.manualApprovalAvailable === true || previous?.manualApprovalAvailable === true,
      };
      // Validation and rate limits do not imply that Resend failed.
      if (!accepted && ![400, 403, 429].includes(response.status)) state.manualApprovalAvailable = true;
      this.save(key, state);
      receivedResponse = true;
      if (!accepted) throw new Error(data.error || "Email could not be sent. Request manual approval instead.");
      return this.closed || key !== this.key() ? null : data;
    } catch (error) {
      if (!receivedResponse) {
        this.save(key, { ...previous, retryAt: Date.now() + 60_000, manualApprovalAvailable: true });
      }
      throw error;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  destroy() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
