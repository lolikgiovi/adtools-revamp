import { RegisterTemplate } from "./template.js";
import "./styles.css";
import { UsageTracker } from "../../core/UsageTracker.js";

export class RegisterPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.root = null;
  }

  mount(container) {
    this.root = container;
    container.innerHTML = RegisterTemplate;

    const form = container.querySelector(".register-form");
    const errorEl = container.querySelector(".register-error");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";

      const usernameInput = container.querySelector("#reg-username");
      const emailInput = container.querySelector("#reg-email");
      const username = ((usernameInput.value || "").trim()).slice(0, 15);
      const email = (emailInput.value || "").trim();

      const emailOk = /.+@.+\..+/.test(email);
      if (username.length < 2) {
        errorEl.textContent = "Please enter a valid username (2+ characters).";
        return;
      }
      if (!emailOk) {
        errorEl.textContent = "Please enter a valid company email.";
        return;
      }

      try {
        // Fetch whitelist from same-origin Worker (with env-based fallback for Tauri)
        const baseEnv = (import.meta?.env?.VITE_WORKER_BASE || "").replace(/\/$/, "");
        const fallback = baseEnv ? `${baseEnv}/whitelist.json` : "https://adtools.lolik.workers.dev/whitelist.json";
        const WHITELIST_CANDIDATES = ["/whitelist.json", fallback];
        let whitelist = [];
        for (const url of WHITELIST_CANDIDATES) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
            clearTimeout(timeoutId);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data)) whitelist = data;
              else if (data && Array.isArray(data.whitelistEmails)) whitelist = data.whitelistEmails;
              else if (data && Array.isArray(data.allowedEmails)) whitelist = data.allowedEmails;
              else if (data && Array.isArray(data.emails)) whitelist = data.emails;
              else console.warn("Unexpected whitelist schema from URL");
              if (whitelist && whitelist.length) break;
            }
          } catch (err) {
            // Try next candidate
          }
        }

        // Normalize and cache whitelist locally
        try {
          const lower = (whitelist || [])
            .map((e) =>
              String(e || "")
                .trim()
                .toLowerCase()
            )
            .filter(Boolean);
          localStorage.setItem("config.whitelistEmails", JSON.stringify(lower));
          localStorage.setItem("config.whitelistFetchedAt", new Date().toISOString());
          whitelist = lower;
        } catch (_) {}

        // Fallback to cached whitelist when fetch failed
        if (!Array.isArray(whitelist) || !whitelist.length) {
          try {
            const cached = JSON.parse(localStorage.getItem("config.whitelistEmails") || "[]");
            if (Array.isArray(cached) && cached.length) whitelist = cached;
          } catch (_) {}
        }

        // Enforce whitelist when available; if none available, allow
        const allowed = whitelist.length ? whitelist.includes(email.toLowerCase()) : true;
        if (!allowed) {
          errorEl.textContent = "Email is not whitelisted. Please contact admin.";
          return;
        }

        // Persist locally after passing whitelist
        localStorage.setItem("user.username", username);
        localStorage.setItem("user.email", email);
        localStorage.setItem("user.registered", "true");

        // Try to register with same-origin Worker (best-effort), fallback to env base
        const endpointCandidates = ["/register", baseEnv ? `${baseEnv}/register` : ""];
        const installId =
          typeof UsageTracker?.getInstallId === "function"
            ? UsageTracker.getInstallId()
            : localStorage.getItem("usage.installId") || this._fallbackInstallId();

        const payload = {
          installId,
          displayName: username,
          email,
          timestamp: new Date().toISOString(),
        };
        let posted = false;
        for (const endpoint of endpointCandidates.filter(Boolean)) {
          try {
            await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              credentials: "omit",
            });
            posted = true;
            break;
          } catch (_) {}
        }
        if (!posted) {
          console.warn("Registration call failed, proceeding locally");
        }

        // Notify app and move to home
        this.eventBus?.emit?.("user:registered", { username, email });
        location.hash = "#home";
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
