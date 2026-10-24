import { invoke } from "@tauri-apps/api/core";
import { mountEditDialog } from "./edit-dialog.js";

const tokenCommands = {
  jenkins: "set_jenkins_token",
  confluence: "set_confluence_pat",
  jira: "set_jira_pat",
};

export function mountIntegration(category, service) {
  const fields = category.items.filter((item) => service.shouldShowItem(item));
  const domainField = fields[0];
  const usernameField = fields.find((item) => item.key.endsWith(".username"));
  const tokenField = fields.find((item) => item.type === "secret");
  const projectField = fields.find((item) => item.type === "string-list");
  const read = (field) => (field ? service.getValue(field.storageKey || field.key, field.type, field.default) : "");
  const element = document.createElement("div");
  element.className = "setting-item setting-integration";
  element.dataset.setting = domainField.key;
  element.dataset.settingKeys = fields.flatMap((field) => [field.key, ...(field.aliases || [])]).join(" ");
  element.dataset.searchText = fields.map((field) => field.label).join(" ");
  const row = document.createElement("div");
  row.className = "setting-row";
  const name = document.createElement("div");
  name.className = "setting-name";
  name.textContent = category.label;
  const value = document.createElement("div");
  value.className = "setting-value";
  const summary = document.createElement("div");
  summary.className = "integration-summary";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn-ghost btn-sm setting-edit";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", `Edit ${category.label}`);
  edit.setAttribute("aria-haspopup", "dialog");
  value.append(summary, edit);
  row.append(name, value);
  element.append(row);
  const renderSummary = () => {
    summary.replaceChildren();
    const domain = document.createElement("span");
    domain.className = "integration-domain";
    domain.textContent = read(domainField) || "—";
    summary.append(domain);
    const account = document.createElement("div");
    account.className = "integration-account";
    const username = read(usernameField);
    if (username) {
      const user = document.createElement("span");
      user.textContent = username;
      account.append(user);
    }
    if (read(tokenField)) {
      const token = document.createElement("span");
      token.textContent = "••••••••";
      token.setAttribute("aria-label", "Token saved");
      account.append(token);
    }
    if (account.childNodes.length) summary.append(account);
    if (projectField) {
      const chips = document.createElement("div");
      chips.className = "string-list-preview";
      chips.setAttribute("aria-label", "Jira project keys");
      for (const key of read(projectField)) {
        const chip = document.createElement("span");
        chip.className = "string-list-chip";
        chip.textContent = key;
        chips.append(chip);
      }
      summary.append(chips);
    }
  };
  const form = document.createElement("form");
  form.className = "integration-form";
  form.noValidate = true;
  const controls = new Map();
  for (const [key, field] of [
    ["domain", domainField],
    ["username", usernameField],
    ["token", tokenField],
    ["projectKeys", projectField],
  ]) {
    if (!field) continue;
    const label = document.createElement("label");
    label.className = "integration-field";
    const text = document.createElement("span");
    text.textContent = { domain: "Domain", username: "Username", token: "Token", projectKeys: "Project keys" }[key];
    const input = document.createElement(key === "projectKeys" ? "textarea" : "input");
    input.className = "setting-input";
    input.name = key;
    if (key === "projectKeys") {
      input.rows = 4;
      input.placeholder = field.placeholder || "One project key per line";
    } else input.type = key === "token" ? "password" : "text";
    input.autocomplete = key === "token" ? "new-password" : "off";
    input.spellcheck = false;
    label.append(text, input);
    form.append(label);
    controls.set(key, input);
  }
  const status = document.createElement("p");
  status.className = "setting-error";
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "setting-actions";
  actions.innerHTML =
    '<button type="button" class="btn btn-secondary btn-sm setting-cancel">Cancel</button><button type="submit" class="btn btn-primary btn-sm">Save changes</button>';
  form.append(status, actions);
  const save = actions.querySelector('[type="submit"]');
  const cancel = actions.querySelector(".setting-cancel");
  let saving = false;
  let disposed = false;
  const close = () => {
    if (saving) return;
    if (tokenField) controls.get("token").value = "";
    modal.close();
  };
  const modal = mountEditDialog({ root: element, form, onCancel: close, isBusy: () => saving, wide: true });
  edit.addEventListener("click", () => {
    controls.get("domain").value = read(domainField);
    if (usernameField) controls.get("username").value = read(usernameField);
    if (tokenField) {
      controls.get("token").value = "";
      controls.get("token").placeholder = read(tokenField) ? "Leave blank to keep saved token" : "";
    }
    if (projectField) controls.get("projectKeys").value = read(projectField).join("\n");
    status.textContent = "";
    modal.open(`Edit ${category.label}`);
    controls.get("domain").focus();
  });
  cancel.addEventListener("click", close);
  const invalid = (key, message) => {
    status.textContent = message;
    controls.get(key).focus();
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    const domain = controls.get("domain").value.trim();
    const username = controls.get("username")?.value.trim() || "";
    const token = controls.get("token")?.value || "";
    const projectKeys = (controls.get("projectKeys")?.value || "")
      .split(/\r?\n/)
      .map((key) => key.trim())
      .filter(Boolean)
      .filter((key, index, keys) => keys.findIndex((entry) => entry.toLowerCase() === key.toLowerCase()) === index);
    if (projectField) {
      const result = service.validate(projectKeys, "string-list", projectField.validation);
      if (!result.valid) {
        invalid("projectKeys", result.message);
        return;
      }
    }
    try {
      const url = new URL(domain);
      if (!["http:", "https:"].includes(url.protocol) || (category.id === "jira" && url.protocol !== "https:")) throw new Error();
      if (url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      invalid(
        "domain",
        category.id === "jira"
          ? "Enter an HTTPS domain without credentials, query, or fragment."
          : "Enter an HTTP(S) domain without credentials, query, or fragment.",
      );
      return;
    }
    if (tokenField && (token || !read(tokenField))) {
      const result = service.validate(token, "secret", tokenField.validation);
      if (!result.valid) {
        invalid("token", result.message);
        return;
      }
    }
    if (category.id === "jenkins" && tokenField && (token || read(tokenField)) && !username) {
      invalid("username", "Username is required for Jenkins authentication.");
      return;
    }
    saving = true;
    save.disabled = cancel.disabled = true;
    save.textContent = "Saving…";
    for (const input of controls.values()) input.readOnly = true;
    status.textContent = "";
    try {
      if (token) {
        const payload = category.id === "jenkins" ? { username, token } : { pat: token };
        await invoke(tokenCommands[category.id], payload);
        if (disposed) return;
      }
      service.setValue(domainField.storageKey || domainField.key, domainField.type, domain, undefined, { notify: false });
      if (usernameField)
        service.setValue(usernameField.storageKey || usernameField.key, usernameField.type, username, undefined, { notify: false });
      if (token) service.setValue(tokenField.storageKey || tokenField.key, "secret", "set", undefined, { notify: false });
      if (projectField)
        service.setValue(projectField.storageKey || projectField.key, "string-list", projectKeys, undefined, { notify: false });
      service.eventBus?.emit?.("notification:success", { message: `${category.label} settings saved`, duration: 1000 });
      renderSummary();
      if (tokenField) controls.get("token").value = "";
      modal.close();
    } catch (error) {
      status.textContent = `Could not save changes: ${error.message || error}`;
    } finally {
      saving = false;
      save.disabled = cancel.disabled = false;
      save.textContent = "Save changes";
      for (const input of controls.values()) input.readOnly = false;
    }
  });
  renderSummary();
  return {
    element,
    dispose() {
      disposed = true;
      if (tokenField) controls.get("token").value = "";
      modal.dispose();
    },
  };
}
