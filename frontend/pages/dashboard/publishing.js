import { DEPARTMENTS, PUBLISHABLE_SETTINGS, validatePublication } from "../../../shared/published-settings.js";
import { SETTINGS_API_BASE } from "../../core/PublishedSettings.js";

const TOKEN_KEY = "analytics.dashboard.token";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
function initialValue(item) {
  const raw = localStorage.getItem(item.storageKey);
  if (raw === null) return item.default ?? [];
  if (["boolean", "number", "environments", "oracle-connections", "kafka-brokers", "string-list"].includes(item.type)) {
    try {
      return JSON.parse(raw);
    } catch {
      return item.default ?? [];
    }
  }
  return raw;
}

export class SettingsPublisher {
  mount(root) {
    this.root = root;
    this.disposed = false;
    this.root.innerHTML = `<div class="publish-session-actions" data-dashboard-session-actions hidden>
      <button type="button" class="btn btn-secondary btn-sm" data-action="refresh">Refresh</button></div>
      <form class="publish-auth">
        <label for="publish-password">Dashboard password</label>
        <div class="publish-actions"><input id="publish-password" type="password" autocomplete="current-password" required>
          <button type="submit" class="btn btn-primary">Unlock publishing</button></div>
      </form>
      <div class="publish-workspace" hidden>
        <form class="publish-form">
          <label for="publish-title">Publication name</label>
          <input id="publish-title" maxlength="120" required autocomplete="off">
          <fieldset><legend>Recipients</legend>
            <label for="publish-audience">Select by</label>
            <select id="publish-audience"><option value="emails">Email</option><option value="departments">Department</option></select>
            <div class="publish-emails"><label for="publish-emails">User emails</label>
              <textarea id="publish-emails" rows="3" placeholder="One email per line" spellcheck="false"></textarea></div>
            <div class="publish-departments" hidden>${DEPARTMENTS.map(
              (department) => `<label class="publish-choice">
              <input type="checkbox" value="${department}">${department}</label>`,
            ).join("")}</div>
          </fieldset>
          <fieldset><legend>Settings</legend>
            <p class="publish-note">Only selected settings change. Selected lists replace the recipient’s list. Theme, Updates and credentials stay personal.</p>
            <div class="publish-setting-list">${PUBLISHABLE_SETTINGS.map(
              (item, index) => `<div class="publish-setting">
              <label class="publish-choice"><input type="checkbox" data-setting="${escape(item.storageKey)}" data-index="${index}">
                ${escape(item.label)}</label><div class="publish-value" id="publish-value-${index}" hidden></div></div>`,
            ).join("")}</div>
          </fieldset>
          <button type="submit" class="btn btn-secondary">Preview publication</button>
        </form>
        <section class="publish-preview" hidden aria-label="Publication preview"></section>
        <section class="publish-history"><div class="publish-heading"><h3>Publication history</h3></div>
          <div class="publish-history-list"></div></section>
      </div>
      <p class="publish-message" role="status" aria-live="polite"></p>`;
    this.sessionActions = this.root.querySelector("[data-dashboard-session-actions]");
    this.sessionActions.querySelector('[data-action="refresh"]').addEventListener("click", () => void this.history());
    this.root.querySelector(".publish-auth").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.unlock();
    });
    this.root.querySelector(".publish-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.preview();
    });
    this.root.addEventListener("input", () => this.invalidate());
    this.root.addEventListener("change", (event) => {
      this.invalidate();
      if (event.target.id === "publish-audience") {
        this.root.querySelector(".publish-emails").hidden = event.target.value !== "emails";
        this.root.querySelector(".publish-departments").hidden = event.target.value !== "departments";
      }
      if (event.target.matches("[data-setting]")) this.editSetting(event.target);
    });
    this.root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      if (action.dataset.action === "publish") void this.publish();
      if (action.dataset.action === "revoke") void this.revoke(Number(action.dataset.id));
      if (action.dataset.action === "reuse") this.reuse(Number(action.dataset.id));
    });
    this.token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    if (this.token) {
      this.showWorkspace();
      void this.history();
    }
  }

  message(text, error = false) {
    if (this.disposed) return;
    const el = this.root.querySelector(".publish-message");
    el.textContent = text;
    el.classList.toggle("is-error", error);
  }

  async request(path, body) {
    const response = await fetch(`${SETTINGS_API_BASE}/api/settings/admin/${path}`, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (response.status === 401) this.lock();
    if (!response.ok || !data.ok) throw new Error(data.error || "Publishing request failed.");
    if (this.disposed) throw new Error("Settings closed.");
    return data;
  }

  async unlock() {
    const button = this.root.querySelector(".publish-auth button");
    button.disabled = true;
    this.message("");
    try {
      const response = await fetch(`${SETTINGS_API_BASE}/dashboard/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: this.root.querySelector("#publish-password").value }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) throw new Error(data.error || "Unable to unlock publishing.");
      if (this.disposed) return;
      this.token = data.token;
      sessionStorage.setItem(TOKEN_KEY, data.token);
      this.root.querySelector("#publish-password").value = "";
      this.showWorkspace();
      await this.history();
    } catch (error) {
      this.message(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  showWorkspace() {
    this.root.querySelector(".publish-auth").hidden = true;
    this.root.querySelector(".publish-workspace").hidden = false;
    this.sessionActions.hidden = false;
  }

  lock() {
    this.token = null;
    this.invalidate();
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    this.root.querySelector(".publish-auth").hidden = false;
    this.root.querySelector(".publish-workspace").hidden = true;
    this.sessionActions.hidden = true;
  }

  editSetting(checkbox, value = undefined) {
    const index = Number(checkbox.dataset.index);
    const item = PUBLISHABLE_SETTINGS[index];
    const editor = this.root.querySelector(`#publish-value-${index}`);
    editor.hidden = !checkbox.checked;
    if (!checkbox.checked) {
      editor.replaceChildren();
      return;
    }
    value ??= initialValue(item);
    const id = `publish-input-${index}`;
    let html;
    if (item.type === "boolean")
      html = `<select id="${id}"><option value="true">Enabled</option><option value="false">Disabled</option></select>`;
    else if (item.type === "enum")
      html = `<select id="${id}">${item.options
        .map((option) => `<option value="${escape(option.value)}">${escape(option.label)}</option>`)
        .join("")}</select>`;
    else if (["string-list", "environments", "oracle-connections", "kafka-brokers"].includes(item.type)) {
      html = `<textarea id="${id}" rows="5" spellcheck="false" aria-describedby="${id}-hint"></textarea>
        <span id="${id}-hint" class="publish-note">${item.type === "string-list" ? "One value per line." : "JSON list; connection addresses only, without credentials."}</span>`;
    } else html = `<input id="${id}" type="${item.type === "number" ? "number" : "text"}" autocomplete="off">`;
    editor.innerHTML = html;
    const input = editor.querySelector("input, textarea, select");
    input.setAttribute("aria-label", item.label);
    input.dataset.valueKey = item.storageKey;
    input.value =
      item.type === "string-list" ? value.join("\n") : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  }

  draft() {
    const settings = {};
    for (const input of this.root.querySelectorAll("[data-value-key]")) {
      const item = PUBLISHABLE_SETTINGS.find((item) => item.storageKey === input.dataset.valueKey);
      let value = input.value;
      if (item.type === "number") value = value.trim() ? Number(value) : NaN;
      else if (item.type === "boolean") value = value === "true";
      else if (item.type === "string-list")
        value = value
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean);
      else if (["environments", "oracle-connections", "kafka-brokers"].includes(item.type)) {
        try {
          value = JSON.parse(value);
        } catch {
          throw new Error(`${item.label}: invalid JSON.`);
        }
      }
      settings[item.storageKey] = value;
    }
    const type = this.root.querySelector("#publish-audience").value;
    const values =
      type === "emails"
        ? this.root
            .querySelector("#publish-emails")
            .value.split(/[\s,;]+/)
            .filter(Boolean)
        : [...this.root.querySelectorAll(".publish-departments input:checked")].map((input) => input.value);
    return validatePublication({ title: this.root.querySelector("#publish-title").value, target: { type, values }, settings });
  }

  invalidate() {
    this.revision = (this.revision || 0) + 1;
    this.previewData = null;
    this.root.querySelector(".publish-preview").hidden = true;
  }

  async preview() {
    if (this.busy) return;
    this.busy = true;
    const button = this.root.querySelector('.publish-form button[type="submit"]');
    button.disabled = true;
    const revision = this.revision;
    this.message("Preparing preview…");
    try {
      const draft = this.draft();
      const result = await this.request("preview", draft);
      if (revision !== this.revision) {
        this.message("Settings changed. Preview again.");
        return;
      }
      this.previewData = { ...draft, audienceHash: result.audienceHash, requestId: crypto.randomUUID() };
      const preview = this.root.querySelector(".publish-preview");
      preview.innerHTML = `<h3>Review publication</h3><p>${result.recipients.length} registered user${result.recipients.length === 1 ? "" : "s"}</p>
        <ul class="publish-recipients">${result.recipients.map((row) => `<li>${escape(row.email)}</li>`).join("")}</ul>
        <dl>${Object.entries(draft.settings)
          .map(
            ([key, value]) => `<dt>${escape(PUBLISHABLE_SETTINGS.find((item) => item.storageKey === key).label)}</dt>
          <dd><pre>${escape(typeof value === "object" ? JSON.stringify(value, null, 2) : value)}</pre></dd>`,
          )
          .join("")}</dl>
        <button type="button" class="btn btn-primary" data-action="publish">Publish to ${result.recipients.length} user${result.recipients.length === 1 ? "" : "s"}</button>`;
      preview.hidden = false;
      this.message("");
      preview.querySelector("button").focus();
    } catch (error) {
      this.message(error.message, true);
    } finally {
      this.busy = false;
      button.disabled = false;
    }
  }

  async publish() {
    if (!this.previewData || this.busy) return;
    this.busy = true;
    const button = this.root.querySelector('[data-action="publish"]');
    button.disabled = true;
    // Freeze the draft while the publication is in flight.
    const controls = [
      ...this.root.querySelectorAll(".publish-form input, .publish-form textarea, .publish-form select, .publish-form button"),
    ];
    controls.forEach((control) => {
      control.disabled = true;
    });
    try {
      const result = await this.request("publications", this.previewData);
      this.invalidate();
      this.message(
        `Published to ${result.recipientCount} user${result.recipientCount === 1 ? "" : "s"}. Devices receive settings when AD Tools is open and online.`,
      );
      await this.history();
    } catch (error) {
      this.message(error.message, true);
      button.disabled = false;
    } finally {
      this.busy = false;
      controls.forEach((control) => {
        control.disabled = false;
      });
    }
  }

  async history() {
    try {
      const result = await this.request("publications");
      this.publications = result.publications;
      this.root.querySelector(".publish-history-list").innerHTML = result.publications.length
        ? result.publications
            .map(
              (row) =>
                `<article class="publish-history-row"><div><strong>${escape(row.title)}</strong>
          <p>${escape(new Date(row.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))} · ${row.recipientCount} user${row.recipientCount === 1 ? "" : "s"} · ${row.appliedDevices} device${row.appliedDevices === 1 ? "" : "s"} applied${row.revokedAt ? " · Stopped" : ""}</p>
          <p>${escape(row.target.values.join(", "))}</p></div><div class="publish-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-action="reuse" data-id="${row.id}">Use as draft</button>
          ${row.revokedAt ? "" : `<button type="button" class="btn btn-secondary btn-sm" data-action="revoke" data-id="${row.id}">Stop delivery</button>`}</div></article>`,
            )
            .join("")
        : '<p class="publish-note">No publications yet.</p>';
    } catch (error) {
      this.message(error.message, true);
    }
  }

  async revoke(id) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.request("revoke", { id });
      this.message("Delivery stopped. Settings already applied on devices are kept.");
      await this.history();
    } catch (error) {
      this.message(error.message, true);
    } finally {
      this.busy = false;
    }
  }

  reuse(id) {
    const publication = this.publications.find((row) => row.id === id);
    if (!publication || this.busy) return;
    this.invalidate();
    this.root.querySelector("#publish-title").value = publication.title;
    this.root.querySelector("#publish-audience").value = publication.target.type;
    this.root.querySelector(".publish-emails").hidden = publication.target.type !== "emails";
    this.root.querySelector(".publish-departments").hidden = publication.target.type !== "departments";
    this.root.querySelector("#publish-emails").value = publication.target.type === "emails" ? publication.target.values.join("\n") : "";
    for (const input of this.root.querySelectorAll(".publish-departments input"))
      input.checked = publication.target.values.includes(input.value);
    for (const input of this.root.querySelectorAll("[data-setting]")) {
      input.checked = Object.hasOwn(publication.settings, input.dataset.setting);
      this.editSetting(input, publication.settings[input.dataset.setting]);
    }
    this.root.querySelector("#publish-title").focus();
    this.message("Draft loaded. Review recipients and preview before publishing.");
  }

  destroy() {
    this.disposed = true;
    this.token = null;
  }
}
