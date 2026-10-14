import { SessionTokenStore } from "./SessionTokenStore.js";
import { isRegistrationEmailAllowed } from "./RegistrationEmail.js";

const REQUEST_KEY = "manual.approval.request";
const POLL_INTERVAL_MS = 60_000;

function sameRequest(left, right) {
  return left?.requestId === right?.requestId && left?.email === right?.email && left?.deviceId === right?.deviceId;
}

export class ManualApprovalMonitor {
  constructor() {
    this.timer = null;
    this.inFlight = null;
    this.generation = 0;
    this.listeners = new Set();
    this.eventBus = null;
  }

  getRequest() {
    try {
      const request = JSON.parse(localStorage.getItem(REQUEST_KEY) || "null");
      return request?.requestId && request?.deviceId && isRegistrationEmailAllowed(request.email) ? request : null;
    } catch (_) {
      return null;
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(result) {
    for (const listener of this.listeners) {
      try {
        listener(result);
      } catch (error) {
        console.error("Approval status listener failed", error);
      }
    }
  }

  start({ eventBus } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (!this.getRequest()) return;
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.check().catch(() => {}), POLL_INTERVAL_MS);
    void this.check().catch(() => {});
  }

  stop({ clearEventBus = true } = {}) {
    clearInterval(this.timer);
    this.timer = null;
    this.generation += 1;
    this.inFlight = null;
    if (clearEventBus) this.eventBus = null;
  }

  check() {
    if (this.inFlight) return this.inFlight;
    const request = this.getRequest();
    if (!request) {
      this.stop({ clearEventBus: false });
      return Promise.resolve(null);
    }
    const generation = this.generation;
    const operation = this.checkRemote(request, generation);
    this.inFlight = operation;
    void operation
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
      })
      .catch(() => {});
    return operation;
  }

  async checkRemote(request, generation) {
    try {
      const base = (import.meta?.env?.VITE_WORKER_BASE || "").trim().replace(/\/$/, "");
      const path = "/register/manual-approval-status";
      let data;
      let lastError = "Could not check approval status.";
      for (const endpoint of [base ? `${base}${path}` : "", path].filter(Boolean)) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
            credentials: "omit",
            signal: AbortSignal.timeout(15_000),
          });
          const body = await response.json().catch(() => ({}));
          if (response.ok && body?.ok) {
            data = body;
            break;
          }
          lastError = body?.error || lastError;
          if (response.status < 500 && response.status !== 404) break;
        } catch (error) {
          lastError = error.message || lastError;
        }
      }
      if (generation !== this.generation || !sameRequest(request, this.getRequest())) return null;
      if (!data) throw new Error(lastError);
      if (data.status === "approved") {
        if (!data.token) throw new Error("Authorization token missing");
        SessionTokenStore.saveToken(data.token);
        localStorage.setItem("user.username", request.displayName || "AD Tools User");
        localStorage.setItem("user.email", request.email);
        localStorage.setItem("user.department", request.department || "");
        localStorage.setItem("user.role", request.role || "");
        if (data.userId) localStorage.setItem("user.id", data.userId);
        localStorage.setItem("user.registered", "true");
        localStorage.removeItem(REQUEST_KEY);
        const eventBus = this.eventBus;
        this.stop({ clearEventBus: false });
        eventBus?.emit?.("user:registered", {
          username: request.displayName || "AD Tools User",
          email: request.email,
          department: request.department,
          role: request.role,
          userId: data.userId,
        });
        if (location.hash.split("/")[0] === "#register") location.hash = "#home";
      }
      this.notify({ request, data });
      return data;
    } catch (error) {
      if (generation === this.generation && sameRequest(request, this.getRequest())) this.notify({ request, error });
      throw error;
    }
  }
}

export const manualApprovalMonitor = new ManualApprovalMonitor();
