import { SettingsTemplate } from "./template.js";
import "./styles.css";
import { SettingsService } from "./service.js";
import { openOtpOverlay } from "../../components/OtpOverlay.js";
import { invoke } from "@tauri-apps/api/core";

class SettingsPage {
  constructor({ eventBus, themeManager } = {}) {
    this.eventBus = eventBus;
    this.themeManager = themeManager;
    this.service = new SettingsService({ eventBus, themeManager });
    this.container = null;
    this.categoriesRoot = null;
    this.searchInput = null;
    this.currentConfig = null;
    this._runtimeRetrySettings = false;
  }

  async mount(root) {
    if (!root) {
      console.error("SettingsPage: root container not provided");
      return;
    }

    // Render base template
    root.innerHTML = SettingsTemplate;
    this.container = root.querySelector(".settings-page");
    this.categoriesRoot = root.querySelector(".settings-categories");
    this.searchInput = root.querySelector("#settings-search");

    // Populate runtime status badge (desktop arch-aware; include version when available)
    try {
      const { getRuntime } = await import("../../core/Runtime.js");
      const setBadge = (rt, arch, version) => {
        const badge = root.querySelector("#runtime-status");
        if (!badge) return;
        const isDesktop = rt === "tauri";
        let text = isDesktop ? "Desktop" : "Web App";
        if (isDesktop && typeof arch === "string") {
          const a = arch.toLowerCase();
          if (a.includes("aarch64") || a.includes("arm64")) text = "Desktop - Apple Silicon";
          else if (a.includes("x86_64") || a.includes("amd64") || a.includes("x64")) text = "Desktop - Intel";
        }
        if (isDesktop && typeof version === "string" && version.trim()) {
          text = `v.${version.trim()} - ${text}`;
        }
        badge.textContent = text;
        badge.setAttribute("data-state", isDesktop ? "desktop" : "web");
        const titleSuffix = isDesktop ? text : "Browser";
        badge.setAttribute("title", isDesktop ? `Running in Tauri (${titleSuffix})` : "Running in Browser");
      };
      const runtime = getRuntime();
      this.runtime = runtime;
      setBadge(runtime);
      // If desktop, try to get arch via Tauri backend and app version via Tauri API
      if (runtime === "tauri") {
        try {
          const archPromise = invoke("get_arch").catch(() => undefined);
          const { getVersion } = await import("@tauri-apps/api/app");
          const versionPromise = getVersion().catch(() => undefined);
          const [arch, version] = await Promise.all([archPromise, versionPromise]);
          setBadge(runtime, arch, version);
        } catch (_) {
          // silent fallback to generic Desktop
        }
      }
      // One-time delayed re-check in case Tauri globals arrive slightly later
      if (!this._runtimeRetrySettings && runtime !== "tauri") {
        this._runtimeRetrySettings = true;
        setTimeout(async () => {
          try {
            const rt2 = getRuntime();
            if (rt2 === "tauri") {
              try {
                const arch2Promise = invoke("get_arch").catch(() => undefined);
                const { getVersion } = await import("@tauri-apps/api/app");
                const version2Promise = getVersion().catch(() => undefined);
                const [arch2, version2] = await Promise.all([arch2Promise, version2Promise]);
                setBadge(rt2, arch2, version2);
              } catch (_) {
                setBadge(rt2);
              }
              this.runtime = rt2;
            }
          } catch (_) {}
        }, 200);
      }
    } catch (_) {}

    // Bind toolbar actions
    root.querySelector(".settings-load-defaults")?.addEventListener("click", () => this.openOtpModal());
    root.querySelector(".settings-check-update")?.addEventListener("click", () => this.handleManualCheckUpdate());
    await this.reloadConfig();
  }

  async openOtpModal() {
    const email = localStorage.getItem("user.email") || "";
    if (!email) {
      this.eventBus?.emit?.("notification:error", { message: "No registered email found. Please register first." });
      return;
    }
    try {
      const BASE = (import.meta?.env?.VITE_WORKER_BASE || "").trim();
      const kvUrl = BASE ? `${BASE}/api/kv/get?key=default-config` : "/api/kv/get?key=default-config";

      const { token, kvValue } = await openOtpOverlay({
        email,
        requestEndpoint: "/register/request-otp",
        verifyEndpoint: "/register/verify",
        rateLimitMs: 60_000,
        storageScope: "settings-defaults",
        kvKey: "default-config",
        // centralized overlay will try cached token first
        preferCachedToken: true,
      });

      let defaults = kvValue;
      if (defaults === undefined && token) {
        const res2 = await fetch(kvUrl, { headers: { Authorization: `Bearer ${token}` } });
        const j2 = await res2.json().catch(() => ({}));
        if (!res2.ok || !j2?.ok) throw new Error(j2?.error || "KV access failure");
        defaults = j2.value;
      }

      await this.applyDefaultsFromKv(defaults);
      await this.reloadConfig();
      this.eventBus?.emit?.("notification:success", { message: "Default settings loaded." });
    } catch (e) {
      // Closed or error
      if (String(e?.message || e) !== "Closed") {
        this.eventBus?.emit?.("notification:error", { message: String(e?.message || e || "Failed to load defaults") });
      }
    }
  }

  async applyDefaultsFromKv(val) {
    if (!val) return;

    // Normalize KV value: it may be a JSON string or a structured object/array
    let data = val;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (_) {
        return; // invalid JSON payload
      }
    }

    // Helper to sanitize simple string values (trim stray backticks/spaces)
    const sanitize = (s) => {
      try {
        let x = String(s ?? "").trim();
        x = x.replace(/^`+|`+$/g, "");
        return x;
      } catch (_) {
        return String(s ?? "");
      }
    };

    // If KV value is an array of objects, store each entry by its key.
    // If the value itself is an array, store it directly (JSON) under the parent key.
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (!entry || typeof entry !== "object") continue;
        for (const [k, v] of Object.entries(entry)) {
          if (Array.isArray(v)) {
            try {
              localStorage.setItem(k, JSON.stringify(v));
            } catch (_) {}
          } else if (v && typeof v === "object") {
            try {
              localStorage.setItem(k, JSON.stringify(v));
            } catch (_) {}
          } else {
            try {
              localStorage.setItem(k, sanitize(v));
            } catch (_) {}
          }
        }
      }
      return;
    }

    // Fallback: object mapping { key: value } -> persist via SettingsService with type awareness
    if (data && typeof data === "object") {
      const getType = (key) => {
        const findInCats = (cats) => {
          for (const cat of cats || []) {
            for (const item of cat.items || []) {
              if (item.key === key) return item.type || "string";
            }
            const t = findInCats(cat.categories || []);
            if (t) return t;
          }
          return null;
        };
        return findInCats(this.currentConfig?.categories || []) || "string";
      };
      for (const [key, value] of Object.entries(data)) {
        const type = getType(key);
        if (type === "secret") continue;
        try {
          this.service.setValue(key, type, value);
        } catch (_) {}
      }
    }
  }

  async handleManualCheckUpdate() {
    // Desktop-only: short-circuit on web runtime
    const rt0 = this.runtime || "web";
    if (rt0 !== "tauri") {
      this.eventBus?.emit?.("notification:info", { message: "Updates are available on Desktop only." });
      return;
    }
    const btn = this.container?.querySelector(".settings-check-update");
    const original = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Checking…";
    }
    try {
      const { checkUpdate, getCurrentVersionSafe, evaluatePolicy, performUpdate } = await import("../../core/Updater.js");
      const current = await getCurrentVersionSafe();

      // First, evaluate forced-update policy; if required, run the forced path
      try {
        const policy = await evaluatePolicy();
        if (policy?.mustForce) {
          const { isTauri } = await import("../../core/Runtime.js");
          if (!isTauri()) {
            this.eventBus?.emit?.("update:forced", { policy, unsupported: true });
            this.eventBus?.emit?.("notification:error", { message: "A forced update is required, but desktop runtime is not available." });
          } else {
            this.eventBus?.emit?.("update:forced", { policy, unsupported: false });
            const ok = await performUpdate(
              (loaded, total) => this.eventBus?.emit?.("update:progress", { loaded, total }),
              (stage) => this.eventBus?.emit?.("update:stage", { stage })
            );
            if (!ok) {
              this.eventBus?.emit?.("update:error", { message: "Update not available or install failed" });
            }
          }
          return; // do not proceed to optional check when forced path is evaluated
        }
      } catch (_) {
        // If policy evaluation fails, fall through to optional check
      }

      // Optional update check path
      const result = await checkUpdate();
      if (result?.error) {
        this.eventBus?.emit?.("notification:error", { message: `Update check failed: ${result.error}` });
      } else if (result?.available) {
        this.eventBus?.emit?.("notification:success", { message: `Update available: v${result.version}` });
        // Request UI to show the optional update banner
        this.eventBus?.emit?.("update:show-banner", { result });
      } else {
        this.eventBus?.emit?.("notification:info", { message: `You're up to date (v${current})` });
        this.eventBus?.emit?.("update:hide-banner");
      }
    } catch (err) {
      this.eventBus?.emit?.("notification:error", { message: `Update check failed: ${String(err)}` });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original || "Check for Update";
      }
    }
  }

  async reloadConfig() {
    const cfg = await this.service.loadConfig();
    this.currentConfig = cfg;
    const rt = this.runtime || "web";
    // Filter categories dynamically based on requiresTauri flag
    const cats = (cfg.categories || []).filter((c) => !(c && c.requiresTauri && rt !== "tauri"));
    this.renderCategories(cats);
  }

  filterConfig(config, q) {
    const matchItem = (item) => {
      const hay = `${item.label} ${item.key} ${item.description || ""}`.toLowerCase();
      return hay.includes(q);
    };
    const recurseCats = (cats) => {
      const result = [];
      for (const cat of cats || []) {
        if (!this.service.shouldShowCategory(cat)) continue;
        const items = (cat.items || []).filter((i) => this.service.shouldShowItem(i) && matchItem(i));
        const subcats = recurseCats(cat.categories || []);
        if (items.length || subcats.length) {
          result.push({ ...cat, items, categories: subcats });
        }
      }
      return result;
    };
    return { ...config, categories: recurseCats(config.categories || []) };
  }

  renderCategories(categories) {
    if (!this.categoriesRoot) return;
    this.categoriesRoot.innerHTML = "";

    const frag = document.createDocumentFragment();
    for (const cat of categories) {
      if (!this.service.shouldShowCategory(cat)) continue;
      const el = this.renderCategory(cat);
      frag.appendChild(el);
    }
    this.categoriesRoot.appendChild(frag);
  }

  renderCategory(cat) {
    const catId = cat.id || Math.random().toString(36).slice(2);
    const expandedKey = `settings.ui.expanded.${catId}`;
    const initiallyExpanded = localStorage.getItem(expandedKey) ?? (cat.initiallyExpanded ? "true" : "false");
    const wrapper = document.createElement("section");
    wrapper.className = "settings-category";
    wrapper.setAttribute("aria-expanded", initiallyExpanded === "true" ? "true" : "false");

    const header = document.createElement("div");
    header.className = "settings-category-header";
    header.innerHTML = `<h3>${cat.label}</h3><button type="button" class="settings-category-toggle" aria-label="Toggle">${
      initiallyExpanded === "true" ? "Collapse" : "Expand"
    }</button>`;
    header.addEventListener("click", () => {
      const isExpanded = wrapper.getAttribute("aria-expanded") === "true";
      const next = !isExpanded;
      wrapper.setAttribute("aria-expanded", next ? "true" : "false");
      header.querySelector(".settings-category-toggle").textContent = next ? "Collapse" : "Expand";
      localStorage.setItem(expandedKey, next ? "true" : "false");
    });

    const content = document.createElement("div");
    content.className = "settings-category-content";

    // Items
    for (const item of cat.items || []) {
      if (!this.service.shouldShowItem(item)) continue;
      content.appendChild(this.renderItem(item));
    }

    // Nested categories
    for (const sub of cat.categories || []) {
      if (!this.service.shouldShowCategory(sub)) continue;
      content.appendChild(this.renderCategory(sub));
    }

    wrapper.appendChild(header);
    wrapper.appendChild(content);
    return wrapper;
  }

  renderItem(item) {
    const storageKey = item.storageKey || item.key;
    const current = this.service.getValue(storageKey, item.type, item.default);

    const wrapper = document.createElement("div");
    wrapper.className = "setting-item";
    wrapper.setAttribute("data-setting", item.key);
    wrapper.setAttribute("data-type", item.type);
    wrapper.setAttribute("data-editing", "false");

    const row = document.createElement("div");
    row.className = "setting-row";

    // Inline, immediate toggles for boolean settings
    if (item.type === "boolean") {
      row.innerHTML = `
        <div class="setting-name">${item.label}</div>
        <div class="setting-control">${this.service.inputForType("boolean", item)}</div>
      `;
      const input = row.querySelector(".setting-input");
      this.applyInitialInputValue(input, "boolean", current);
      input.addEventListener("change", () => {
        const newVal = !!input.checked;
        this.service.setValue(storageKey, "boolean", newVal, item.apply);
      });
      wrapper.appendChild(row);
      return wrapper;
    }

    // Action-type items render as a button that performs the action
    if (item.type === "action") {
      row.innerHTML = `
        <div class="setting-name">${item.label}</div>
        <div class="setting-control"><button type="button" class="btn btn-primary setting-action-btn">${
          item.buttonLabel || "Run"
        }</button></div>
      `;
      const btn = row.querySelector(".setting-action-btn");
      btn.addEventListener("click", async () => {
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Running…";
        try {
          // Currently only known action: update.check
          if (item.key === "update.check") {
            await this.handleManualCheckUpdate();
          } else {
            this.eventBus?.emit?.("notification:info", { message: "Action executed" });
          }
        } catch (err) {
          this.eventBus?.emit?.("notification:error", { message: String(err) || "Action failed" });
        } finally {
          btn.disabled = false;
          btn.textContent = original || "Run";
        }
      });
      wrapper.appendChild(row);
      return wrapper;
    }

    // Display value
    let displayValue = "";
    const isRequired = !!(item.validation && item.validation.required);
    if (item.type === "secret") {
      displayValue = current ? "••••••••" : "—";
    } else if (item.type === "kvlist") {
      displayValue = this.#kvPreviewHTML(Array.isArray(current) ? current : []);
    } else {
      displayValue = this.formatValueForDisplay(current, item.type);
    }

    // Non-boolean: direct inline editing when clicking the value
    row.innerHTML = `
      <div class="setting-name">${item.label}${
      isRequired ? ' <span class="setting-required" title="Required" aria-hidden="true">*</span>' : ""
    }</div>
      <div class="setting-value editable" data-value tabindex="0" role="button" aria-label="Edit ${item.label}">
        ${displayValue}
      </div>
    `;

    const panel = document.createElement("div");
    panel.className = "setting-edit-panel";
    panel.style.display = "none";
    // Custom editor for Oracle connections (form-based), replacing raw JSON kvlist editing
    if (item.type === "kvlist" && storageKey === "config.oracle.connections") {
      panel.innerHTML = `
        <div class="connections-editor">
          <div class="connections-rows"></div>
          <div class="connections-actions">
            <button type="button" class="btn kv-add" data-action="conn-add">Add Connection</button>
          </div>
          <div class="setting-actions">
            <button class="btn btn-primary btn-sm setting-confirm" data-action="confirm" disabled>Confirm</button>
            <button class="btn btn-secondary btn-sm setting-cancel" data-action="cancel">Cancel</button>
          </div>
        </div>
        <div class="setting-error" aria-live="polite"></div>
      `;
    } else if (item.type === "kvlist" && storageKey === "secure.oracle.credentials") {
      panel.innerHTML = `
        <div class="credentials-editor">
          <div class="cred-rows"></div>
          <div class="cred-actions">
            <button type="button" class="btn kv-add" data-action="cred-add">Add Credential</button>
          </div>
          <div class="setting-actions">
            <button class="btn btn-primary btn-sm setting-confirm" data-action="confirm" disabled>Confirm</button>
            <button class="btn btn-secondary btn-sm setting-cancel" data-action="cancel">Cancel</button>
          </div>
        </div>
        <div class="setting-error" aria-live="polite"></div>
      `;
    } else {
      panel.innerHTML = `
        <div class="setting-edit-row">
          ${this.service.inputForType(item.type, item)}
          <div class="setting-actions">
            <button class="btn btn-primary btn-sm setting-confirm" data-action="confirm" disabled>Confirm</button>
            <button class="btn btn-secondary btn-sm setting-cancel" data-action="cancel">Cancel</button>
          </div>
        </div>
        <div class="setting-error" aria-live="polite"></div>
      `;
    }

    const confirmBtn = panel.querySelector(".setting-confirm");
    const errorEl = panel.querySelector(".setting-error");

    // Special handling per type
    let input = null;
    let kvContainer = null;
    let connContainer = null;
    let credContainer = null;
    if (item.type === "kvlist" && storageKey === "config.oracle.connections") {
      connContainer = panel.querySelector(".connections-editor");
      // Populate existing rows from kvlist pairs
      const arr = Array.isArray(current) ? current : [];
      const rowsRoot = connContainer.querySelector(".connections-rows");
      rowsRoot.innerHTML = "";
      if (!arr.length) {
        this.#connAddRow(connContainer, item);
      } else {
        for (const pair of arr) {
          let valObj = pair?.value;
          try { if (typeof valObj === "string") valObj = JSON.parse(valObj); } catch (_) {}
          const rowData = {
            key: String(pair?.key || ""),
            username: String(valObj?.username || ""),
            password: "",
            host: String(valObj?.host || ""),
            port: valObj?.port !== undefined ? Number(valObj.port) : "",
            service_name: String(valObj?.service_name || valObj?.serviceName || ""),
          };
          this.#connAddRow(connContainer, item, rowData);
        }
      }
    } else if (item.type === "kvlist" && storageKey === "secure.oracle.credentials") {
      credContainer = panel.querySelector(".credentials-editor");
      const arr = Array.isArray(current) ? current : [];
      const rowsRoot = credContainer.querySelector(".cred-rows");
      rowsRoot.innerHTML = "";
      if (!arr.length) {
        this.#credAddRow(credContainer, item);
      } else {
        for (const pair of arr) {
          let valObj = pair?.value;
          try { if (typeof valObj === "string") valObj = JSON.parse(valObj); } catch (_) {}
          const rowData = {
            key: String(pair?.key || ""),
            username: String(valObj?.username || ""),
            password: "",
          };
          this.#credAddRow(credContainer, item, rowData);
        }
      }
    } else if (item.type === "kvlist") {
      kvContainer = panel.querySelector(".kvlist");
      this.applyInitialInputValue(kvContainer, "kvlist", current, item);
    } else {
      input = panel.querySelector(".setting-input");
      if (item.type === "secret") {
        input.type = current === undefined || current === null || current === "" ? "text" : "password";
      } else {
        this.applyInitialInputValue(input, item.type, current);
      }
    }

    const getCurrentEditValue = () => {
      if (item.type === "kvlist" && storageKey === "config.oracle.connections") {
        // Extract structured rows into kvlist pairs with JSON objects
        const rows = connContainer?.querySelectorAll?.(".conn-row") || [];
        const result = [];
        rows.forEach((row) => {
          const key = row.querySelector(".conn-key")?.value?.trim() || "";
          const username = row.querySelector(".conn-user")?.value?.trim() || "";
          const password = row.querySelector(".conn-pass")?.value?.trim() || "";
          const host = row.querySelector(".conn-host")?.value?.trim() || "";
          const portStr = row.querySelector(".conn-port")?.value?.trim() || "";
          const port = portStr === "" ? undefined : Number(portStr);
          const service_name = row.querySelector(".conn-service")?.value?.trim() || "";
          // Allow empty row while editing; validator will handle required checks
          result.push({ key, value: { host, port, service_name, username, password } });
        });
        return result;
      }
      if (item.type === "kvlist" && storageKey === "secure.oracle.credentials") {
        const rows = credContainer?.querySelectorAll?.(".cred-row") || [];
        const result = [];
        rows.forEach((row) => {
          const key = row.querySelector(".cred-key")?.value?.trim() || "";
          const username = row.querySelector(".cred-user")?.value?.trim() || "";
          result.push({ key, value: { username } });
        });
        return result;
      }
      if (item.type === "kvlist") return this.extractInputValue(kvContainer, "kvlist", item);
      return this.extractInputValue(input, item.type);
    };

    const validateAndToggle = () => {
      const value = getCurrentEditValue();
      let { valid, message } = this.service.validate(value, item.type, item.validation || {});
      // Additional validation: secure oracle credentials must have key and username
      if (item.type === "kvlist" && storageKey === "secure.oracle.credentials") {
        const rows = credContainer?.querySelectorAll?.(".cred-row") || [];
        for (const row of rows) {
          const key = row.querySelector(".cred-key")?.value?.trim() || "";
          const user = row.querySelector(".cred-user")?.value?.trim() || "";
          const pass = row.querySelector(".cred-pass")?.value?.trim() || "";
          if (!key && !user && !pass) continue; // allow empty row
          if (!key) { valid = false; message = "Connection ID is required"; break; }
          if (!user) { valid = false; message = "Username is required"; break; }
        }
      } else if (item.type === "kvlist" && storageKey === "config.oracle.connections") {
        // All fields mandatory: name, username, password, host, port, service
        const rows = connContainer?.querySelectorAll?.(".conn-row") || [];
        for (const row of rows) {
          const key = row.querySelector(".conn-key")?.value?.trim() || "";
          const user = row.querySelector(".conn-user")?.value?.trim() || "";
          const pass = row.querySelector(".conn-pass")?.value?.trim() || "";
          const host = row.querySelector(".conn-host")?.value?.trim() || "";
          const portStr = row.querySelector(".conn-port")?.value?.trim() || "";
          const svc = row.querySelector(".conn-service")?.value?.trim() || "";
          if (!key && !user && !pass && !host && !portStr && !svc) continue; // allow empty row
          const port = Number(portStr);
          if (!key) { valid = false; message = "Connection Name is required"; break; }
          if (!user) { valid = false; message = "Username is required"; break; }
          if (!pass) { valid = false; message = "Password is required"; break; }
          if (!host) { valid = false; message = "Host is required"; break; }
          if (!portStr || Number.isNaN(port) || port <= 0) { valid = false; message = "Valid port is required"; break; }
          if (!svc) { valid = false; message = "Service is required"; break; }
        }
      }
      errorEl.textContent = valid ? "" : message;
      confirmBtn.disabled = !valid;
    };

    // Bind actions for editors
    if (item.type === "kvlist" && storageKey === "config.oracle.connections") {
      panel.addEventListener("click", (e) => {
        const action = e.target.getAttribute("data-action");
        if (action === "conn-add") {
          this.#connAddRow(connContainer, item);
          validateAndToggle();
        }
        if (e.target.getAttribute("data-role") === "conn-remove") {
          const rowEl = e.target.closest(".conn-row");
          rowEl?.remove();
          validateAndToggle();
        }
      });
      panel.addEventListener("input", validateAndToggle);
    } else if (item.type === "kvlist" && storageKey === "secure.oracle.credentials") {
      panel.addEventListener("click", (e) => {
        const action = e.target.getAttribute("data-action");
        if (action === "cred-add") {
          this.#credAddRow(credContainer, item);
          validateAndToggle();
        }
        if (e.target.getAttribute("data-role") === "cred-remove") {
          const rowEl = e.target.closest(".cred-row");
          rowEl?.remove();
          validateAndToggle();
        }
      });
      panel.addEventListener("input", validateAndToggle);
    } else if (item.type === "kvlist") {
      panel.addEventListener("click", (e) => {
        const action = e.target.getAttribute("data-action");
        if (action === "kv-add") {
          this.#kvAddRow(kvContainer, item);
          validateAndToggle();
        }
        if (e.target.getAttribute("data-role") === "kv-remove") {
          const rowEl = e.target.closest(".kv-row");
          rowEl?.remove();
          validateAndToggle();
        }
      });
      panel.addEventListener("input", validateAndToggle);
    } else {
      input.addEventListener("input", validateAndToggle);
    }
    validateAndToggle();

    const openInline = () => {
      wrapper.dataset.editing = "true";
      panel.style.display = "flex";
      if (item.type === "kvlist") {
        const firstConn = panel.querySelector(".conn-key");
        const firstCred = panel.querySelector(".cred-key");
        if (firstConn) {
          firstConn.focus();
        } else if (firstCred) {
          firstCred.focus();
        } else {
          const firstKey = panel.querySelector(".kv-key");
          firstKey?.focus();
        }
      } else {
        input?.focus();
      }
    };

    const closeInline = () => {
      wrapper.dataset.editing = "false";
      panel.style.display = "none";
    };

    const valueEl = row.querySelector(".setting-value.editable");
    valueEl.addEventListener("click", openInline);
    valueEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openInline();
      }
    });

    panel.addEventListener("click", async (e) => {
      const action = e.target.getAttribute("data-action");
      if (!action) return;

      if (action === "cancel") {
        if (item.type === "kvlist" && storageKey === "config.oracle.connections") {
          // Reset connections editor to stored value
          const storedArr = this.service.getValue(storageKey, item.type, item.default);
          const rowsRoot = connContainer.querySelector(".connections-rows");
          rowsRoot.innerHTML = "";
          const arr = Array.isArray(storedArr) ? storedArr : [];
          if (!arr.length) {
            this.#connAddRow(connContainer, item);
          } else {
            for (const pair of arr) {
              let valObj = pair?.value;
              try { if (typeof valObj === "string") valObj = JSON.parse(valObj); } catch (_) {}
              const rowData = {
                key: String(pair?.key || ""),
                username: String(valObj?.username || ""),
                password: "",
                host: String(valObj?.host || ""),
                port: valObj?.port !== undefined ? Number(valObj.port) : "",
                service_name: String(valObj?.service_name || valObj?.serviceName || ""),
              };
              this.#connAddRow(connContainer, item, rowData);
            }
          }
        } else if (item.type === "kvlist" && storageKey === "secure.oracle.credentials") {
          const storedArr = this.service.getValue(storageKey, item.type, item.default);
          const rowsRoot = credContainer.querySelector(".cred-rows");
          rowsRoot.innerHTML = "";
          const arr = Array.isArray(storedArr) ? storedArr : [];
          if (!arr.length) {
            this.#credAddRow(credContainer, item);
          } else {
            for (const pair of arr) {
              let valObj = pair?.value;
              try { if (typeof valObj === "string") valObj = JSON.parse(valObj); } catch (_) {}
              const rowData = {
                key: String(pair?.key || ""),
                username: String(valObj?.username || ""),
                password: "",
              };
              this.#credAddRow(credContainer, item, rowData);
            }
          }
        } else if (item.type === "kvlist") {
          this.applyInitialInputValue(kvContainer, "kvlist", this.service.getValue(storageKey, item.type, item.default), item);
        } else {
          const resetVal = this.service.getValue(storageKey, item.type, item.default);
          this.applyInitialInputValue(input, item.type, resetVal);
          if (item.type === "secret") {
            input.type = resetVal === undefined || resetVal === null || resetVal === "" ? "text" : "password";
          }
        }
        validateAndToggle();
        closeInline();
      }
      if (action === "confirm") {
        const value = getCurrentEditValue();
        const { valid } = this.service.validate(value, item.type, item.validation || {});
        if (!valid) return;

        let stored;
        if (storageKey === "secure.jenkins.token") {
          try {
            await invoke("set_jenkins_token", { token: value });
          } catch (err) {
            errorEl.textContent = String(err);
            return;
          }
          // Store a marker only, not the token itself
          stored = this.service.setValue(storageKey, "secret", "set", item.apply);
        } else if (storageKey === "secure.jenkins.username") {
          try {
            await invoke("set_jenkins_username", { username: value });
          } catch (err) {
            errorEl.textContent = String(err);
            return;
          }
          // Persist username for display
          stored = this.service.setValue(storageKey, "string", value, item.apply);
        } else if (storageKey === "config.jenkins.url") {
          // Strong URL validation via URL parser
          try {
            const u = new URL(String(value));
            if (!u.protocol.startsWith("http")) throw new Error("URL must be http(s)");
          } catch (err) {
            errorEl.textContent = "Invalid URL format";
            return;
          }
          stored = this.service.setValue(storageKey, "string", value, item.apply);
        } else if (item.type === "kvlist" && storageKey === "config.oracle.connections") {
          // Store connection details (including username) and save passwords via Keychain
          try {
            const rt = this.runtime || "web";
            const sanitized = (Array.isArray(value) ? value : []).map(({ key, value: v }) => {
              let obj = v;
              try { if (typeof obj === "string") obj = JSON.parse(obj); } catch (_) {}
              const { host = "", port, service_name = "", username = "" } = obj || {};
              return { key, value: { host, port, service_name, username } };
            });
            // Persist without passwords
            stored = this.service.setValue(storageKey, "kvlist", sanitized, item.apply);
            // Set credentials in keychain per non-empty row
            if (rt === "tauri") {
              const rows = connContainer?.querySelectorAll?.(".conn-row") || [];
              for (const row of rows) {
                const connectionId = row.querySelector(".conn-key")?.value?.trim() || "";
                const username = row.querySelector(".conn-user")?.value?.trim() || "";
                const password = row.querySelector(".conn-pass")?.value?.trim() || "";
                if (!connectionId && !username && !password) continue; // skip empty
                if (!connectionId || !username || !password) { errorEl.textContent = "All fields are required"; return; }
                try {
                  await invoke("set_oracle_credentials", { connection_id: connectionId, username, password });
                } catch (err) {
                  const msg = String(err || "");
                  if (msg.includes("missing required key connectionId") || msg.includes("connectionId")) {
                    try {
                      await invoke("set_oracle_credentials", { connectionId: connectionId, username, password });
                    } catch (err2) {
                      errorEl.textContent = String(err2);
                      return;
                    }
                  } else {
                    errorEl.textContent = String(err);
                    return;
                  }
                }
              }
            } else {
              // In web runtime, inform user but continue storing non-secret details
              errorEl.textContent = "Passwords can only be saved on the Desktop app.";
            }
          } catch (err) {
            errorEl.textContent = String(err);
            return;
          }
        } else if (item.type === "kvlist" && storageKey === "secure.oracle.credentials") {
          // Persist usernames (without passwords). Only set secrets via Tauri when available.
          try {
            // Save usernames for display
            stored = this.service.setValue(storageKey, "kvlist", value, item.apply);
            const rows = credContainer?.querySelectorAll?.(".cred-row") || [];
            const rt = this.runtime || "web";
            for (const row of rows) {
              const connectionId = row.querySelector(".cred-key")?.value?.trim() || "";
              const username = row.querySelector(".cred-user")?.value?.trim() || "";
              const password = row.querySelector(".cred-pass")?.value?.trim() || "";
              if (!connectionId && !username && !password) continue; // skip empty
              if (!connectionId || !username) continue; // enforce required fields
              if (password) {
                if (rt === "tauri") {
                  try {
                    await invoke("set_oracle_credentials", { connection_id: connectionId, username, password });
                  } catch (err) {
                    const msg = String(err || "");
                    if (msg.includes("missing required key connectionId") || msg.includes("connectionId")) {
                      try {
                        await invoke("set_oracle_credentials", { connectionId: connectionId, username, password });
                      } catch (err2) {
                        errorEl.textContent = String(err2);
                      }
                    } else {
                      // Show error but continue updating display
                      errorEl.textContent = String(err);
                    }
                  }
                } else {
                  // Web runtime: cannot store secrets; inform user but do not block
                  errorEl.textContent = "Passwords can only be saved on the Desktop app.";
                }
              }
            }
          } catch (err) {
            errorEl.textContent = String(err);
            // Do not block display update for username persistence
          }
        } else {
          stored = this.service.setValue(storageKey, item.type, value, item.apply);
        }

        let display = "";
        if (item.type === "secret") {
          display = stored ? "••••••••" : "—";
        } else if (item.type === "kvlist") {
          display = this.#kvPreviewHTML(Array.isArray(stored) ? stored : []);
        } else {
          display = this.formatValueForDisplay(stored, item.type);
        }
        row.querySelector("[data-value]").innerHTML = display;
        closeInline();
      }
    });

    wrapper.appendChild(row);
    wrapper.appendChild(panel);
    return wrapper;
  }

  #connAddRow(container, item, rowData = { key: "", username: "", password: "", host: "", port: "", service_name: "" }) {
    const rows = container.querySelector(".connections-rows");
    const row = document.createElement("div");
    row.className = "conn-row";
    row.innerHTML = `
      <div class="conn-grid">
        <label class="conn-cell"><span>Name</span><input type="text" class="conn-key" placeholder="${item.keyPlaceholder || "Connection Name"}" aria-label="Connection Name"></label>
        <label class="conn-cell"><span>Username</span><input type="text" class="conn-user" placeholder="db_user" aria-label="Username"></label>
        <label class="conn-cell"><span>Password</span><input type="password" class="conn-pass" placeholder="Set to update" aria-label="Password"></label>
        <label class="conn-cell"><span>Host</span><input type="text" class="conn-host" placeholder="db.example.com" aria-label="Host"></label>
        <label class="conn-cell"><span>Port</span><input type="number" class="conn-port" placeholder="1521" aria-label="Port" min="1"></label>
        <label class="conn-cell"><span>Service</span><input type="text" class="conn-service" placeholder="ORCLPDB1" aria-label="Service Name"></label>
      </div>
      <div class="conn-actions">
        <button type="button" class="btn btn-outline btn-sm conn-remove" data-role="conn-remove" aria-label="Remove">Remove</button>
      </div>
    `;
    row.querySelector(".conn-key").value = rowData.key || "";
    row.querySelector(".conn-user").value = rowData.username || "";
    row.querySelector(".conn-pass").value = rowData.password || "";
    row.querySelector(".conn-host").value = rowData.host || "";
    row.querySelector(".conn-port").value = rowData.port === undefined || rowData.port === null ? "" : String(rowData.port);
    row.querySelector(".conn-service").value = rowData.service_name || "";
    rows.appendChild(row);
  }
  #credAddRow(container, item, rowData = { key: "", username: "", password: "" }) {
    const rows = container.querySelector(".cred-rows");
    const row = document.createElement("div");
    row.className = "cred-row";
    row.innerHTML = `
      <div class="cred-grid">
        <label class="cred-cell"><span>Connection ID</span><input type="text" class="cred-key" placeholder="${item.keyPlaceholder || "Connection ID"}" aria-label="Connection ID"></label>
        <label class="cred-cell"><span>Username</span><input type="text" class="cred-user" placeholder="db_user" aria-label="Username"></label>
        <label class="cred-cell"><span>Password</span><input type="password" class="cred-pass" placeholder="Set to update" aria-label="Password"></label>
      </div>
      <div class="cred-actions">
        <button type="button" class="btn btn-outline btn-sm cred-remove" data-role="cred-remove" aria-label="Remove">Remove</button>
      </div>
    `;
    row.querySelector(".cred-key").value = rowData.key || "";
    row.querySelector(".cred-user").value = rowData.username || "";
    row.querySelector(".cred-pass").value = rowData.password || "";
    rows.appendChild(row);
  }
  #kvAddRow(container, item, rowData = { key: "", value: "" }) {
    const rows = container.querySelector(".kv-rows");
    const row = document.createElement("div");
    row.className = "kv-row";
    const isJson = !!(item?.validation && item.validation.jsonValue);
    const valueType = isJson ? "text" : "url";
    const valueAria = isJson ? "Connection JSON" : "Base URL";
    row.innerHTML = `
      <input type="text" class="kv-key" placeholder="${item.keyPlaceholder || (isJson ? "Connection Name" : "Environment")}" aria-label="${isJson ? "Connection Name" : "Environment"}"/>
      <input type="${valueType}" class="kv-value" placeholder="${item.valuePlaceholder || (isJson ? "Connection JSON" : "Base URL")}" aria-label="${valueAria}"/>
      <button type="button" class="btn btn-outline btn-sm kv-remove" data-role="kv-remove" aria-label="Remove">Remove</button>
    `;
    row.querySelector(".kv-key").value = rowData.key || "";
    row.querySelector(".kv-value").value = rowData.value || "";
    rows.appendChild(row);
  }

  applyInitialInputValue(inputOrContainer, type, value, item) {
    if (!inputOrContainer) return;
    switch (type) {
      case "boolean":
        inputOrContainer.checked = value === true || value === "true";
        break;
      case "kvlist": {
        const container = inputOrContainer;
        const rows = container.querySelector(".kv-rows");
        rows.innerHTML = "";
        const arr = Array.isArray(value) ? value : [];
        if (arr.length === 0) {
          this.#kvAddRow(container, item);
        } else {
          for (const pair of arr) {
            this.#kvAddRow(container, item, pair);
          }
        }
        break;
      }
      default:
        inputOrContainer.value = value ?? "";
        break;
    }
  }

  extractInputValue(inputOrContainer, type) {
    if (!inputOrContainer) return undefined;
    switch (type) {
      case "number":
        return inputOrContainer.value === "" ? undefined : Number(inputOrContainer.value);
      case "boolean":
        return !!inputOrContainer.checked;
      case "kvlist": {
        const rows = inputOrContainer.querySelectorAll(".kv-row");
        const result = [];
        rows.forEach((row) => {
          const key = row.querySelector(".kv-key")?.value?.trim() || "";
          const value = row.querySelector(".kv-value")?.value?.trim() || "";
          result.push({ key, value });
        });
        return result;
      }
      default:
        return inputOrContainer.value;
    }
  }

  formatValueForDisplay(value, type) {
    if (type === "kvlist") {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) return "(Empty, add new one)";
      // non-empty handled via kv preview to avoid [object Object]
      return this.#kvPreviewHTML(arr);
    }
    if (value === undefined || value === null || value === "") return "—";
    switch (type) {
      case "boolean":
        return value === true || value === "true" ? "On" : "Off";
      case "color":
        return String(value);
      case "date":
      case "time":
      case "datetime":
      default:
        return String(value);
    }
  }

  #kvPreviewHTML(pairs) {
    if (!pairs || pairs.length === 0) return "(Empty, add new one)";
    const esc = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
    const formatVal = (val) => {
      // Support object values directly or JSON strings
      if (val && typeof val === "object") {
        const host = String(val.host || "").trim();
        const port = val.port !== undefined ? Number(val.port) : undefined;
        const svc = String(val.service_name || val.serviceName || "").trim();
        const user = String(val.username || "").trim();
        const portStr = port && !Number.isNaN(port) ? `:${port}` : "";
        if (host && svc) {
          const prefix = user ? `${esc(user)}@` : "";
          return `${prefix}${esc(host)}${esc(portStr)}/${esc(svc)}`;
        }
        if (user) return esc(user);
      } else {
        const s = String(val ?? "").trim();
        if (s.startsWith("{") && s.endsWith("}")) {
          try {
            const o = JSON.parse(s);
            const host = String(o.host || "").trim();
            const port = o.port !== undefined ? Number(o.port) : undefined;
            const svc = String(o.service_name || o.serviceName || "").trim();
            const user = String(o.username || "").trim();
            const portStr = port && !Number.isNaN(port) ? `:${port}` : "";
            if (host && svc) {
              const prefix = user ? `${esc(user)}@` : "";
              return `${prefix}${esc(host)}${esc(portStr)}/${esc(svc)}`;
            }
            if (user) return esc(user);
          } catch (_) {}
        }
        // fallback to raw, truncated for readability
        return esc(s.length > 120 ? s.slice(0, 117) + "…" : s);
      }
    };
    return `
      <div class="kvlist-preview">
        ${pairs
          .map(
            (p) => `
          <div class="kvlist-preview-row">
            <span class="kvlist-env">${esc(p.key)}</span>
            <span class="kvlist-arrow">→</span>
            <span class="kvlist-url">${formatVal(p.value)}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;
  }

  deactivate() {
    this.container = null;
    this.categoriesRoot = null;
    this.searchInput = null;
    this.currentConfig = null;
    this._runtimeRetrySettings = false;
  }
}

export { SettingsPage };
