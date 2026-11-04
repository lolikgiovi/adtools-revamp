import { getActiveProject, listProjects, projectSettingsStorage, isProjectSetting, readJiraProjectKey } from "../../core/Projects.js";
import config from "../settings/config.json";
import { readProjectConnections, readEnvironments } from "../../core/Environments.js";
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
function initialValue(item, storage) {
  if (item.storageKey === "config.jira.projectKey") return readJiraProjectKey(storage);
  if (item.storageKey === "config.oracle.environment.catalog")
    return readProjectConnections(storage).map(({ id, environmentId, name, connect_string }) => ({
      id,
      environmentId,
      name,
      connect_string,
    }));
  if (item.storageKey === "config.environments") {
    readProjectConnections(storage);
    return readEnvironments(storage);
  }
  const raw = storage.getItem(item.storageKey);
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

const legacyKeys = new Set(["config.oracle.connections", "config.jira.projectKeys"]);
const publishableGroups = (categories) =>
  categories.flatMap((category) => {
    const items = (category.items || []).filter(
      (item) => PUBLISHABLE_SETTINGS.some((setting) => setting.storageKey === item.storageKey) && !legacyKeys.has(item.storageKey),
    );
    if (category.id === "environments")
      items.push(PUBLISHABLE_SETTINGS.find((item) => item.storageKey === "config.oracle.environment.catalog"));
    return [
      ...(items.length ? [{ label: category.id === "project-settings" ? "Jira project" : category.label, items }] : []),
      ...publishableGroups(category.categories || []),
    ];
  });
const groups = publishableGroups([
  ...config.categories.filter((category) => category.id === "project-settings"),
  ...config.categories.filter((category) => category.id !== "project-settings"),
]);
const fieldLabels = {
  name: "Name",
  environmentId: "Environment",
  connect_string: "Connection address",
  username: "Username",
  password: "Password",
  brokers: "Brokers",
  criticalConnection: "Critical database",
  complementaryConnection: "Complementary database",
  cdnPublicUrl: "CDN public URL",
  cdnDirectUrl: "CDN direct URL",
};
function displayValue(value, item) {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (item.options) return item.options.find((option) => option.value === value)?.label || value;
  return value === "" ? "Empty" : String(value);
}
function renderValue(value, item, settings = {}) {
  if (!Array.isArray(value)) return `<span>${escape(displayValue(value, item))}</span>`;
  if (!value.length) return '<span class="publish-note">Empty list — clears the recipient’s list</span>';
  if (item.type === "string-list") return `<ul>${value.map((entry) => `<li>${escape(entry)}</li>`).join("")}</ul>`;
  const environments = settings["config.environments"] || [];
  const connections = settings["config.oracle.environment.catalog"] || [];
  return value
    .map(
      (row) =>
        `<div class="publish-record"><strong>${escape(row.name)}</strong><dl>${Object.entries(row)
          .filter(([key, val]) => fieldLabels[key] && key !== "name" && val)
          .map(([key, val]) => {
            const resolved =
              key === "environmentId"
                ? environments.find((env) => env.id === val)?.name
                : key.endsWith("Connection")
                  ? connections.find((connection) => connection.id === val)?.name
                  : null;
            const shown = key === "password" ? "••••••••" : resolved || val;
            return `<dt>${escape(fieldLabels[key])}</dt><dd>${escape(shown)}</dd>`;
          })
          .join("")}</dl></div>`,
    )
    .join("");
}

export class SettingsPublisher {
  mount(root) {
    this.root = root;
    this.disposed = false;
    this.sourceProject = getActiveProject();
    this.storage = projectSettingsStorage(localStorage, this.sourceProject.id);
    this.root.innerHTML = `<div class="publish-session-actions" data-dashboard-session-actions hidden>
      <button type="button" class="btn btn-secondary btn-sm" data-action="refresh">Refresh</button></div>
      <form class="publish-auth">
        <label for="publish-password">Dashboard password</label>
        <div class="publish-actions"><input id="publish-password" type="password" autocomplete="current-password" required>
          <button type="submit" class="btn btn-primary">Unlock publishing</button></div>
      </form>
      <div class="publish-workspace" hidden>
        <form class="publish-form">
          <fieldset class="publish-project-fields"><legend>Project defaults</legend>
            <div><label for="publish-source">Copy settings from</label>
              <select id="publish-source">${listProjects()
                .map(
                  (project) => `<option value="${escape(project.id)}"
                ${project.id === this.sourceProject.id ? "selected" : ""}>${escape(project.name)}</option>`,
                )
                .join("")}</select></div>
            <div><label for="publish-project">Project name on other devices</label>
              <input id="publish-project" maxlength="80" value="${escape(this.sourceProject.name)}" required autocomplete="off"></div>
            <div><label for="publish-title">Publication name</label>
              <input id="publish-title" maxlength="120" value="${escape(this.sourceProject.name)} defaults" required autocomplete="off"></div>
            <label class="publish-choice"><input id="publish-replace" type="checkbox">Replace Default project</label>
          </fieldset>
          <fieldset><legend>Share with</legend>
            <label for="publish-audience">Recipients</label>
            <select id="publish-audience"><option value="departments">Departments</option><option value="emails">Specific people</option></select>
            <div class="publish-emails" hidden><label for="publish-emails">User emails</label>
              <textarea id="publish-emails" rows="3" placeholder="One email per line" spellcheck="false"></textarea></div>
            <div class="publish-departments">${DEPARTMENTS.map(
              (department) => `<label class="publish-choice">
              <input type="checkbox" value="${department}" ${department === this.sourceProject.department ? "checked" : ""}>${department}</label>`,
            ).join("")}</div>
            <p class="publish-note">Only registered users in the selected audience receive these settings. New members need a new publication.</p>
          </fieldset>
          <fieldset><legend>Include settings</legend>
            <div class="publish-heading"><span class="publish-selection-count" role="status"></span><div class="publish-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-action="use-project">Use project settings</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="clear">Clear selection</button></div></div>
            <div class="publish-setting-list">${groups
              .map(
                (group) => `<section class="publish-group"><h3>${escape(group.label)}</h3>
              ${group.items.map((item) => this.settingRow(item)).join("")}</section>`,
              )
              .join("")}
              <section class="publish-group publish-legacy" hidden><h3>Legacy settings</h3>${PUBLISHABLE_SETTINGS.filter((item) =>
                legacyKeys.has(item.storageKey),
              )
                .map((item) => this.settingRow(item))
                .join("")}</section></div>
            <p class="publish-note">Theme, updates and app logins stay personal. Quick Query schemas are not included.</p>
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
      if (event.target.id === "publish-source") this.changeSource(event.target.value);
      if (event.target.id === "publish-audience") {
        this.root.querySelector(".publish-emails").hidden = event.target.value !== "emails";
        this.root.querySelector(".publish-departments").hidden = event.target.value !== "departments";
      }
      if (event.target.matches("[data-setting]")) this.editSetting(event.target);
    });
    this.root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      if (action.dataset.action === "use-project") this.useProject();
      if (action.dataset.action === "clear") this.clearSelection();
      if (action.dataset.action === "publish") void this.publish();
      if (action.dataset.action === "revoke") void this.revoke(Number(action.dataset.id));
      if (action.dataset.action === "reuse") this.reuse(Number(action.dataset.id));
    });
    this.updateSelection();
    this.token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    if (this.token) {
      this.showWorkspace();
      void this.history();
    }
  }

  settingRow(item) {
    const index = PUBLISHABLE_SETTINGS.findIndex((entry) => entry.storageKey === item.storageKey);
    return `<div class="publish-setting"><label class="publish-choice">
      <input type="checkbox" data-setting="${escape(item.storageKey)}" data-index="${index}">${escape(item.storageKey === "config.oracle.environment.catalog" ? "Database Connections" : item.label)}</label>
      <div class="publish-value" id="publish-value-${index}" hidden></div></div>`;
  }

  updateSelection() {
    const count = this.root.querySelectorAll("[data-setting]:checked").length;
    this.root.querySelector(".publish-selection-count").textContent = `${count} setting${count === 1 ? "" : "s"} selected`;
  }

  clearSelection() {
    this.invalidate();
    for (const input of this.root.querySelectorAll("[data-setting]")) {
      input.checked = false;
      this.editSetting(input);
    }
    this.root.querySelector(".publish-legacy").hidden = true;
  }

  changeSource(id) {
    this.sourceProject = listProjects().find((project) => project.id === id);
    this.storage = projectSettingsStorage(localStorage, id);
    this.clearSelection();
    this.root.querySelector("#publish-project").value = this.sourceProject.name;
    this.root.querySelector("#publish-title").value = `${this.sourceProject.name} defaults`;
    this.message("");
  }

  useProject() {
    this.invalidate();
    try {
      for (const input of this.root.querySelectorAll("[data-setting]")) {
        const item = PUBLISHABLE_SETTINGS[Number(input.dataset.index)];
        if (!isProjectSetting(item.storageKey) || legacyKeys.has(item.storageKey)) continue;
        const value = initialValue(item, this.storage);
        input.checked = Array.isArray(value) ? value.length > 0 : value !== "";
        this.editSetting(input, value);
      }
      this.message("Project values loaded. Select any additional settings to include.");
    } catch (error) {
      this.message(error.message, true);
    }
  }

  message(text, error = false) {
    if (this.disposed) return;
    const el = this.root.querySelector(".publish-message");
    el.textContent = text;
    el.classList.toggle("is-error", error);
    if (error) el.scrollIntoView?.({ block: "nearest" });
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
    this.root.querySelector(".publish-preview").before(this.root.querySelector(".publish-message"));
    this.root.querySelector(".publish-auth").hidden = true;
    this.root.querySelector(".publish-workspace").hidden = false;
    this.sessionActions.hidden = false;
  }

  lock() {
    this.root.querySelector(".publish-auth").after(this.root.querySelector(".publish-message"));
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
    this.updateSelection();
    if (!checkbox.checked) {
      editor.replaceChildren();
      return;
    }
    value ??= initialValue(item, this.storage);
    const id = `publish-input-${index}`;
    let html;
    if (item.type === "boolean")
      html = `<select id="${id}"><option value="true">Enabled</option><option value="false">Disabled</option></select>`;
    else if (item.type === "enum")
      html = `<select id="${id}">${item.options
        .map((option) => `<option value="${escape(option.value)}">${escape(option.label)}</option>`)
        .join("")}</select>`;
    else if (["string-list", "environments", "oracle-connections", "kafka-brokers"].includes(item.type)) {
      html =
        item.type === "string-list"
          ? `<textarea id="${id}" rows="4" spellcheck="false" placeholder="One value per line" aria-label="${escape(item.label)}"></textarea>`
          : `<div class="publish-saved-values">${renderValue(value, item, this.sourceValues())}</div>
          <details class="publish-json"><summary>Edit values as JSON</summary>
            <textarea id="${id}" rows="5" spellcheck="false"></textarea></details>`;
    } else html = `<input id="${id}" type="${item.type === "number" ? "number" : "text"}" autocomplete="off">`;
    editor.innerHTML = html;
    const input = editor.querySelector("input, textarea, select");
    input.setAttribute("aria-label", item.label);
    input.dataset.valueKey = item.storageKey;
    if (editor.querySelector(".publish-saved-values"))
      input.addEventListener("input", () => {
        const summary = editor.querySelector(".publish-saved-values");
        try {
          summary.innerHTML = renderValue(JSON.parse(input.value), item, this.sourceValues());
        } catch {
          summary.textContent = "Invalid JSON. Fix the values before previewing.";
        }
      });
    input.value =
      item.type === "string-list" ? value.join("\n") : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  }

  sourceValues() {
    return {
      "config.oracle.environment.catalog": initialValue(
        PUBLISHABLE_SETTINGS.find((item) => item.storageKey === "config.oracle.environment.catalog"),
        this.storage,
      ),
      "config.environments": readEnvironments(this.storage),
    };
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
    if (Object.keys(settings).some(isProjectSetting)) {
      const name = this.root.querySelector("#publish-project").value.trim();
      if (!name) throw new Error("Enter the destination project name.");
      settings["project.name"] = name;
      if (this.root.querySelector("#publish-replace").checked) settings["project.replaceDefault"] = true;
    }
    const type = this.root.querySelector("#publish-audience").value;
    const values =
      type === "emails"
        ? this.root
            .querySelector("#publish-emails")
            .value.split(/[\s,;]+/)
            .filter(Boolean)
        : [...this.root.querySelectorAll(".publish-departments input:checked")].map((input) => input.value);
    if (!values.length)
      throw new Error(type === "departments" ? "Choose at least one department." : "Enter at least one registered user email.");
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
      preview.innerHTML = `<h3>Review ${escape(draft.title)}</h3>
        <p class="publish-review-audience">${escape(draft.target.values.join(", "))} · ${result.recipients.length} registered user${result.recipients.length === 1 ? "" : "s"}</p>
        <p class="publish-note">${draft.settings["project.name"] ? "Project settings apply once to the named project." : "App integrations apply once on each recipient device."} Selected lists replace existing lists. Later local edits are kept.</p>
        <ul class="publish-recipients">${result.recipients.map((row) => `<li>${escape(row.email)}</li>`).join("")}</ul>
        <dl>${Object.entries(draft.settings)
          .map(
            ([key, value]) => `<dt>${escape(PUBLISHABLE_SETTINGS.find((item) => item.storageKey === key).label)}</dt>
          <dd>${renderValue(
            value,
            PUBLISHABLE_SETTINGS.find((item) => item.storageKey === key),
            draft.settings,
          )}</dd>`,
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
    this.root.querySelector(".publish-legacy").hidden = !Object.keys(publication.settings).some((key) => legacyKeys.has(key));
    this.root.querySelector("#publish-title").value = publication.title;
    this.root.querySelector("#publish-project").value = publication.settings["project.name"] || getActiveProject().name;
    this.root.querySelector("#publish-replace").checked = publication.settings["project.replaceDefault"] === true;
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
