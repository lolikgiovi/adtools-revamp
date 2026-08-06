import { ApprovalTemplate } from "./template.js";
import "./styles.css";

const API_BASE = import.meta.env.DEV ? "http://localhost:8787" : "";
const TOKEN_KEY = "analytics.dashboard.token";

export class ApprovalPage {
  constructor() {
    this.root = null;
    this.token = null;
    this.requests = [];
    this.status = "pending";
    this.query = "";
  }

  mount(root) {
    root.innerHTML = ApprovalTemplate;
    this.root = root.querySelector(".approval-dashboard");
    this.restoreSession();
    this.bindEvents();
  }

  restoreSession() {
    try {
      const token = sessionStorage.getItem(TOKEN_KEY);
      const payload = token ? JSON.parse(atob(token)) : null;
      if (payload?.exp > Date.now()) {
        this.token = token;
        this.showContent();
        this.loadRequests();
      }
    } catch (_) {
      // Ignore malformed or unavailable session storage and show the password gate.
    }
  }

  bindEvents() {
    this.root.querySelector("#approval-auth-form")?.addEventListener("submit", (event) => this.authenticate(event));
    this.root.querySelector("#approval-refresh")?.addEventListener("click", () => this.loadRequests());
    this.root.querySelector("#approval-logout")?.addEventListener("click", () => this.logout());
    this.root.querySelector("#approval-search")?.addEventListener("input", (event) => {
      this.query = event.target.value.trim().toLowerCase();
      this.render();
    });
    this.root.querySelectorAll(".approval-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        this.status = tab.dataset.status;
        this.root.querySelectorAll(".approval-tab").forEach((item) => {
          const active = item === tab;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
        });
        this.render();
      });
    });
    this.root.querySelector("#approval-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-approve-id]");
      if (button) this.approve(button.dataset.approveId, button);
    });
  }

  async authenticate(event) {
    event.preventDefault();
    const input = this.root.querySelector("#approval-password");
    const error = this.root.querySelector("#approval-auth-error");
    error.textContent = "";
    try {
      const response = await fetch(`${API_BASE}/dashboard/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input.value }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) throw new Error(data.error || "Invalid password");
      this.token = data.token;
      sessionStorage.setItem(TOKEN_KEY, data.token);
      this.showContent();
      await this.loadRequests();
    } catch (err) {
      error.textContent = err.message || "Could not unlock approvals.";
      input.focus();
    }
  }

  showContent() {
    this.root.querySelector("#approval-auth").hidden = true;
    this.root.querySelector("#approval-content").hidden = false;
  }

  logout() {
    this.token = null;
    this.requests = [];
    sessionStorage.removeItem(TOKEN_KEY);
    this.root.querySelector("#approval-auth").hidden = false;
    this.root.querySelector("#approval-content").hidden = true;
    this.root.querySelector("#approval-password").value = "";
  }

  async loadRequests() {
    const list = this.root.querySelector("#approval-list");
    list.innerHTML = '<div class="approval-state">Loading requests…</div>';
    this.setMessage("");
    try {
      const response = await fetch(`${API_BASE}/approval/requests`, { headers: { Authorization: `Bearer ${this.token}` } });
      if (response.status === 401) {
        this.logout();
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load requests");
      this.requests = Array.isArray(data.requests) ? data.requests : [];
      this.updateCounts();
      this.render();
    } catch (err) {
      list.innerHTML = '<div class="approval-state is-error">Unable to load approval requests.</div>';
      this.setMessage(err.message, "error");
    }
  }

  async approve(id, button) {
    button.disabled = true;
    button.textContent = "Approving…";
    this.setMessage("");
    try {
      const response = await fetch(`${API_BASE}/approval/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Approval failed");
      const request = this.requests.find((item) => item.id === id);
      if (request) {
        request.status = "approved";
        request.approved_at = new Date().toISOString();
      }
      this.updateCounts();
      this.render();
      this.setMessage("Account request approved. The user can now check their status.", "success");
    } catch (err) {
      button.disabled = false;
      button.textContent = "Approve account";
      this.setMessage(err.message || "Approval failed.", "error");
    }
  }

  updateCounts() {
    this.root.querySelector("#pending-count").textContent = this.requests.filter((item) => item.status === "pending").length;
    this.root.querySelector("#approved-count").textContent = this.requests.filter((item) => item.status === "approved").length;
  }

  render() {
    const filtered = this.requests.filter((item) => {
      if (item.status !== this.status) return false;
      if (!this.query) return true;
      return [item.email, item.display_name, item.device_id, item.platform, item.user_agent].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(this.query),
      );
    });
    const list = this.root.querySelector("#approval-list");
    if (!filtered.length) {
      list.innerHTML = `<div class="approval-state">${this.query ? "No matching requests" : `No ${this.status} requests`}</div>`;
      return;
    }
    list.innerHTML = filtered.map((item) => this.renderRequest(item)).join("");
  }

  renderRequest(item) {
    const approved = item.status === "approved";
    return `
      <article class="approval-request">
        <div class="approval-request-person">
          <div class="approval-avatar" aria-hidden="true">${this.escape(item.display_name?.charAt(0) || item.email?.charAt(0) || "?")}</div>
          <div>
            <h2>${this.escape(item.display_name || "Unknown user")}</h2>
            <a href="mailto:${this.escape(item.email)}">${this.escape(item.email)}</a>
          </div>
        </div>
        <div class="approval-request-identity">
          ${this.detail("Device", item.device_id)}
          ${this.detail("Platform", item.platform)}
          ${this.detail("Location", [item.country, item.timezone].filter(Boolean).join(" · "))}
          ${this.detail("Locale / screen", [item.locale, item.screen_size].filter(Boolean).join(" · "))}
          ${this.detail("IP address", item.ip_address)}
          ${this.detail("Browser identity", item.user_agent, true)}
        </div>
        <div class="approval-request-action">
          <span class="approval-status-pill ${approved ? "is-approved" : "is-pending"}">${approved ? "Approved" : "Pending"}</span>
          <time>${this.escape(this.formatDate(approved ? item.approved_at : item.requested_at))}</time>
          ${approved ? "" : `<button type="button" class="btn btn-primary" data-approve-id="${this.escape(item.id)}">Approve account</button>`}
        </div>
      </article>`;
  }

  detail(label, value, wide = false) {
    return `<div class="approval-detail${wide ? " is-wide" : ""}"><span>${label}</span><strong title="${this.escape(value || "—")}">${this.escape(value || "—")}</strong></div>`;
  }

  formatDate(value) {
    if (!value) return "Not recorded";
    const normalized = String(value).replace(" ", "T");
    const parsed = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}+07:00`);
    return Number.isNaN(parsed.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  }

  setMessage(message, tone = "") {
    const element = this.root.querySelector("#approval-message");
    element.textContent = message || "";
    element.className = `approval-message${tone ? ` is-${tone}` : ""}`;
  }

  escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}
