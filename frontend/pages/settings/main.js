import { getActiveProject } from "../../core/Projects.js";
import { renderProjectManager, renderProjectSchemaLink } from "./projects.js";
import { SettingsTemplate } from "./template.js";
import { buildOracleJsonPlan, applyOracleJsonPlan } from "./oracle-json.js";
import { mountBulkEditor } from "./bulk-editor.js";
import { mountEditDialog } from "./edit-dialog.js";
import { mountIntegration } from "./integration.js";
import { buildListPlan, buildKafkaPlan, applyListPlan } from "./bulk-list.js";
import "./styles.css";
import { SettingsService } from "./service.js";
import { SettingsSearch } from "./search.js";
import { clearConnectionReference, mergeLegacyBaseUrls, updateConnectionReference } from "../../core/Environments.js";
import { confirmAction } from "../../components/ConfirmationDialog.js";
import { openOtpOverlay } from "../../components/OtpOverlay.js";
import { invoke } from "@tauri-apps/api/core";
import { ensureUnifiedKeychain } from "../../core/KeychainMigration.js";
import { OracleConnectionService } from "../../core/OracleConnectionService.js";
import { readKafkaBrokerProfiles, saveKafkaBrokerProfiles } from "../../tools/kafka/service.js";
import { publishedSettingsSync } from "../../core/PublishedSettings.js";

const SETTINGS_FOCUS_STORAGE_KEY = "settings.focus";

class SettingsPage {
  constructor({ eventBus, themeManager } = {}) {
    this.eventBus = eventBus;
    this.themeManager = themeManager;
    this.service = new SettingsService({ eventBus, themeManager });
    this.container = null;
    this.categoriesRoot = null;
    this.searchInput = null;
    this.searchStatus = null;
    this.searchEmpty = null;
    this.settingsSearch = null;
    this.currentConfig = null;
    this._runtimeRetrySettings = false;
    this.settingDisposers = new Set();
    this.oracleConnectionEditor = null;
  }

  async mount(root, routeData = null) {
    if (!root) {
      console.error("SettingsPage: root container not provided");
      return;
    }

    // Render base template
    root.innerHTML = SettingsTemplate;
    this.container = root.querySelector(".settings-page");
    this.categoriesRoot = root.querySelector(".settings-categories");
    this.searchInput = root.querySelector("#settings-search");
    this.searchStatus = root.querySelector("#settings-search-status");
    this.searchEmpty = root.querySelector("#settings-search-empty");
    this.settingsSearch = new SettingsSearch(this.categoriesRoot);
    this.searchInput?.addEventListener("input", () => this.applySearch());
    this.searchInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.searchInput.value) return;
      event.preventDefault();
      this.searchInput.value = "";
      this.applySearch();
    });

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
    const showSyncStatus = () => {
      const status = root.querySelector(".settings-sync-status");
      status.textContent = publishedSettingsSync.status === "error" ? publishedSettingsSync.message : "";
    };
    const showPublished = () => {
      root.querySelector(".settings-sync-status").textContent = "Published settings applied.";
      root.querySelector(".settings-sync-refresh").hidden = false;
    };
    window.addEventListener("adtools:settings-sync-status", showSyncStatus);
    window.addEventListener("adtools:settings-published", showPublished);
    this.syncDisposers = [
      () => window.removeEventListener("adtools:settings-sync-status", showSyncStatus),
      () => window.removeEventListener("adtools:settings-published", showPublished),
    ];
    root.querySelector(".settings-sync-refresh").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      await this.reloadConfig();
      button.hidden = true;
      showSyncStatus();
    });
    showSyncStatus();

    // Migrate Jenkins username from keychain to localStorage (one-time)
    await this.#migrateJenkinsUsername();

    // Migrate to unified keychain (reduces password prompts after app updates)
    await ensureUnifiedKeychain();

    await this.reloadConfig();
    this.focusRequestedSetting(routeData?.setting);
  }

  focusRequestedSetting(requestedKey = null) {
    let settingKey = requestedKey;
    if (!settingKey) {
      try {
        settingKey = localStorage.getItem(SETTINGS_FOCUS_STORAGE_KEY);
        if (settingKey) localStorage.removeItem(SETTINGS_FOCUS_STORAGE_KEY);
      } catch (_) {}
    }
    if (!settingKey || !this.categoriesRoot) return;

    const setting = Array.from(this.categoriesRoot.querySelectorAll(".setting-item")).find(
      (item) => item.dataset.setting === settingKey || item.dataset.settingKeys?.split(" ").includes(settingKey),
    );
    if (!setting) return;

    let category = setting.closest(".settings-category");
    while (category) {
      if (category.getAttribute("aria-expanded") !== "true") {
        category.querySelector(".settings-category-header")?.click();
      }
      category = category.parentElement?.closest(".settings-category");
    }

    setting.classList.add("settings-focus-highlight");
    setting.scrollIntoView?.({ behavior: "smooth", block: "center" });
    const groupedControl = Array.from(setting.querySelectorAll("[data-setting-key]")).find(
      (control) => control.dataset.settingKey === settingKey,
    );
    (
      groupedControl ||
      setting.querySelector(".setting-edit, .kafka-broker-add, .setting-input") ||
      setting.closest(".settings-category")?.querySelector(".settings-category-actions button")
    )?.focus();
    window.setTimeout(() => setting.classList.remove("settings-focus-highlight"), 3000);
  }

  /**
   * One-time migration: read Jenkins username from macOS Keychain and store to localStorage.
   * After migration, the username is read from localStorage, token stays in keychain.
   */
  async #migrateJenkinsUsername() {
    // Skip if already migrated (username exists in localStorage)
    const existingUsername = localStorage.getItem("config.jenkins.username");
    if (existingUsername) return;

    // Skip if not running in Tauri
    if (this.runtime !== "tauri") return;

    try {
      // Read username from keychain via Tauri command
      const keychainUsername = await invoke("get_jenkins_username");
      if (keychainUsername && typeof keychainUsername === "string" && keychainUsername.trim()) {
        // Store to localStorage
        localStorage.setItem("config.jenkins.username", keychainUsername.trim());
        console.log("[Settings] Migrated Jenkins username from keychain to localStorage");
      }
    } catch (err) {
      // Silent fail - user may not have any credentials yet
      console.debug("[Settings] No Jenkins username in keychain to migrate:", err);
    }
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
          if (k === "config.baseUrls") {
            let pairs = v;
            if (typeof pairs === "string") {
              try {
                pairs = JSON.parse(pairs);
              } catch (_) {
                pairs = [];
              }
            }
            mergeLegacyBaseUrls(Array.isArray(pairs) ? pairs : []);
            continue;
          }
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
        if (key === "config.baseUrls") {
          mergeLegacyBaseUrls(Array.isArray(value) ? value : []);
          continue;
        }
        if (key === "config.lockeyDomains") {
          let domains = value;
          if (typeof domains === "string") {
            try {
              domains = JSON.parse(domains);
            } catch (_) {
              domains = [];
            }
          }
          try {
            localStorage.setItem(key, JSON.stringify(Array.isArray(domains) ? domains : []));
          } catch (_) {}
          continue;
        }
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
          // Fetch manifest to get release notes
          let manifest = null;
          try {
            const { fetchManifest } = await import("../../core/Updater.js");
            const result = await fetchManifest?.(policy.channel);
            manifest = result?.manifest || null;
          } catch (_) {}

          if (!isTauri()) {
            this.eventBus?.emit?.("update:forced", { policy, unsupported: true, manifest });
            this.eventBus?.emit?.("notification:error", { message: "A forced update is required, but desktop runtime is not available." });
          } else {
            this.eventBus?.emit?.("update:forced", { policy, unsupported: false, manifest });
            const ok = await performUpdate(
              (loaded, total) => this.eventBus?.emit?.("update:progress", { loaded, total }),
              (stage) => this.eventBus?.emit?.("update:stage", { stage }),
              policy.channel,
              { manifest, version: manifest?.version || policy.forceMinVersion, channel: policy.channel },
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
    this.applySearch();
  }

  applySearch() {
    const query = this.searchInput?.value || "";
    const result = this.settingsSearch?.apply(query) || { active: false, matches: 0, total: 0 };
    const message = result.active
      ? result.matches
        ? `${result.matches} of ${result.total} settings`
        : `No settings match “${query.trim()}”`
      : "";

    if (this.searchEmpty) {
      this.searchEmpty.hidden = !(result.active && !result.matches);
      if (!this.searchEmpty.hidden) this.searchEmpty.textContent = message;
    }
    if (this.searchStatus) this.searchStatus.textContent = message;
  }

  renderCategories(categories) {
    if (!this.categoriesRoot) return;
    for (const dispose of this.settingDisposers) dispose();
    this.settingDisposers.clear();
    this.categoriesRoot.innerHTML = "";

    const frag = document.createDocumentFragment();
    const activeProject = getActiveProject();
    const environmentCategory = categories.find((category) => category.id === "environments");
    const projectCategory = {
      id: "project-settings",
      label: activeProject.name,
      initiallyExpanded: true,
      items: [
        { key: "config.projects", type: "project-manager" },
        { key: "project.schema", type: "project-schema" },
      ],
      categories: environmentCategory ? [{ ...environmentCategory, label: "Testing Environments" }] : [],
    };
    const projectCategories = categories.map((category) => (category.id === "environments" ? projectCategory : category));
    for (const cat of projectCategories) {
      if (!this.service.shouldShowCategory(cat)) continue;
      const el = this.renderCategory(cat);
      frag.appendChild(el);
    }
    this.categoriesRoot.appendChild(frag);
    this.settingsSearch?.clear();
  }

  renderCategory(cat, headingLevel = 3) {
    if (cat.integration) {
      const { element, dispose } = mountIntegration(cat, this.service);
      this.settingDisposers.add(dispose);
      return element;
    }
    const catId = cat.id || Math.random().toString(36).slice(2);
    const expandedKey = `settings.ui.expanded.${catId}`;
    const initiallyExpanded = localStorage.getItem(expandedKey) ?? (cat.initiallyExpanded ? "true" : "false");
    const wrapper = document.createElement("section");
    wrapper.className = "settings-category";
    wrapper.setAttribute("aria-expanded", initiallyExpanded === "true" ? "true" : "false");

    const heading = document.createElement(`h${Math.min(headingLevel, 6)}`);
    heading.className = "settings-category-heading";
    const header = document.createElement("button");
    header.type = "button";
    header.className = "settings-category-header";
    header.setAttribute("aria-expanded", initiallyExpanded);
    header.setAttribute("aria-controls", `settings-category-${catId}`);
    header.innerHTML = `<span>${cat.label}</span>
      <svg class="settings-category-toggle" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7" /></svg>`;
    heading.appendChild(header);
    header.addEventListener("click", () => {
      const isExpanded = wrapper.getAttribute("aria-expanded") === "true";
      const next = !isExpanded;
      wrapper.setAttribute("aria-expanded", next ? "true" : "false");
      header.setAttribute("aria-expanded", String(next));
      localStorage.setItem(expandedKey, next ? "true" : "false");
    });

    const content = document.createElement("div");
    content.className = "settings-category-content";
    content.id = `settings-category-${catId}`;

    // Items
    let updatesRendered = false;
    for (const item of cat.items || []) {
      if (!this.service.shouldShowItem(item)) continue;
      if (item.group === "updates") {
        if (!updatesRendered) {
          content.appendChild(
            this.renderUpdatesItem(cat.items.filter((entry) => entry.group === "updates" && this.service.shouldShowItem(entry))),
          );
          updatesRendered = true;
        }
        continue;
      }
      content.appendChild(this.renderItem(item));
    }

    // Nested categories
    for (const sub of cat.categories || []) {
      if (!this.service.shouldShowCategory(sub)) continue;
      content.appendChild(this.renderCategory(sub, headingLevel + 1));
    }

    let actions = content.querySelector(":scope > .setting-item-oracle > .oracle-connections-header");
    const kafkaHeader = content.querySelector(":scope > .setting-item-kafka-brokers > .kafka-brokers-header");
    if (kafkaHeader) {
      actions = kafkaHeader.querySelector(".setting-row-actions");
      kafkaHeader.remove();
    }
    if (actions) {
      actions.classList.add("settings-category-actions");
      heading.classList.add("settings-category-heading-with-actions");
      heading.setAttribute("aria-label", cat.label);
      actions.addEventListener(
        "click",
        () => {
          if (wrapper.getAttribute("aria-expanded") !== "true") header.click();
        },
        { capture: true },
      );
      heading.append(actions);
    }
    wrapper.appendChild(heading);
    wrapper.appendChild(content);
    return wrapper;
  }

  renderUpdatesItem(items) {
    const wrapper = document.createElement("div");
    wrapper.className = "setting-item";
    wrapper.dataset.setting = "update.check";
    wrapper.dataset.settingKeys = items.map((item) => item.key).join(" ");
    wrapper.dataset.searchText = items.map((item) => item.label).join(" ");
    wrapper.innerHTML = '<div class="setting-row"><div class="setting-name">Update</div><div class="settings-update-controls"></div></div>';
    const controls = wrapper.querySelector(".settings-update-controls");
    const action = items.find((item) => item.type === "action");
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-primary btn-sm settings-check-update";
      button.textContent = action.buttonLabel;
      button.dataset.settingKey = action.key;
      button.addEventListener("click", () => this.handleManualCheckUpdate());
      controls.append(button);
    }
    for (const item of items.filter((item) => item.type === "boolean")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "qq-contained-toggle";
      button.setAttribute("role", "switch");
      button.dataset.settingKey = item.key;
      const label = document.createElement("span");
      label.textContent = item.label;
      button.append(label);
      button.insertAdjacentHTML(
        "beforeend",
        '<span class="qq-contained-toggle-track" aria-hidden="true"><span class="qq-contained-toggle-thumb"></span></span>',
      );
      const storageKey = item.storageKey || item.key;
      let checked = !!this.service.getValue(storageKey, item.type, item.default);
      const refresh = () => {
        button.setAttribute("aria-checked", String(checked));
        button.classList.toggle("is-on", checked);
      };
      refresh();
      button.addEventListener("click", () => {
        this.service.setValue(storageKey, item.type, !checked, item.apply);
        checked = !checked;
        refresh();
      });
      controls.append(button);
    }
    return wrapper;
  }

  renderKafkaBrokersItem(item) {
    const wrapper = document.createElement("div");
    wrapper.className = "setting-item setting-item-kafka-brokers";
    wrapper.dataset.setting = item.key;
    wrapper.dataset.type = item.type;
    wrapper.dataset.searchText = item.label;
    wrapper.innerHTML = `
      <div class="kafka-brokers-header">
        <div>
          <div class="setting-name">${item.label}</div>
        </div>
        <span class="setting-row-actions">
          <button class="btn btn-secondary btn-sm kafka-broker-add" type="button">Add broker</button>
          <button class="btn btn-outline btn-sm settings-bulk-edit" type="button">Bulk Edit</button>
        </span>
      </div>
      <div class="kafka-brokers-list"></div>
      <form class="kafka-broker-form" hidden>
        <label for="kafkaBrokerName">Connection name</label>
        <input id="kafkaBrokerName" name="broker-name" class="kafka-broker-input" type="text" maxlength="48" placeholder="e.g. UAT" autocomplete="off" />
        <label for="kafkaBrokerAddresses">Bootstrap servers</label>
        <input id="kafkaBrokerAddresses" name="bootstrap-servers" class="kafka-broker-input" type="text" placeholder="broker-1:9092,broker-2:9092" autocomplete="off" spellcheck="false" />
        <div class="kafka-broker-form-footer">
          <p class="kafka-broker-form-status" role="status" aria-live="polite"></p>
          <div>
            <button class="btn btn-secondary btn-sm kafka-broker-cancel" type="button">Cancel</button>
            <button class="btn btn-primary btn-sm kafka-broker-save" type="submit">Save broker</button>
          </div>
        </div>
      </form>
    `;

    const list = wrapper.querySelector(".kafka-brokers-list");
    const form = wrapper.querySelector(".kafka-broker-form");
    const nameInput = wrapper.querySelector("#kafkaBrokerName");
    const addressesInput = wrapper.querySelector("#kafkaBrokerAddresses");
    const formStatus = wrapper.querySelector(".kafka-broker-form-status");
    const addButton = wrapper.querySelector(".kafka-broker-add");
    let editingId = "";
    const modal = mountEditDialog({
      root: wrapper,
      form,
      onCancel: () => wrapper.querySelector(".kafka-broker-cancel").click(),
      fallbackFocus: (trigger) => wrapper.querySelector(`.kafka-broker-edit[data-profile-id="${trigger?.dataset.profileId}"]`) || addButton,
    });
    this.settingDisposers.add(() => modal.dispose());

    const renderList = () => {
      const profiles = readKafkaBrokerProfiles();
      list.replaceChildren();
      if (!profiles.length) {
        const empty = document.createElement("p");
        empty.className = "kafka-brokers-empty";
        empty.textContent = "No broker connections saved.";
        list.appendChild(empty);
        return;
      }
      for (const profile of profiles) {
        const row = document.createElement("div");
        row.className = "kafka-broker-row";
        const identity = document.createElement("div");
        identity.className = "kafka-broker-identity";
        const name = document.createElement("strong");
        name.textContent = profile.name;
        const addresses = document.createElement("span");
        addresses.textContent = profile.brokers;
        identity.append(name, addresses);

        const actions = document.createElement("div");
        actions.className = "kafka-broker-actions";
        const edit = document.createElement("button");
        edit.className = "btn btn-outline btn-sm kafka-broker-edit";
        edit.type = "button";
        edit.dataset.profileId = profile.id;
        edit.textContent = "Edit";
        const remove = document.createElement("button");
        remove.className = "btn btn-outline btn-sm btn-danger kafka-broker-delete";
        remove.type = "button";
        remove.dataset.profileId = profile.id;
        remove.textContent = "Delete";
        actions.append(edit, remove);
        row.append(identity, actions);
        list.appendChild(row);
      }
    };

    const showForm = (profile = null) => {
      bulk.close();
      editingId = profile?.id || "";
      nameInput.value = profile?.name || "";
      addressesInput.value = profile?.brokers || "";
      formStatus.textContent = "";
      formStatus.dataset.state = "";
      wrapper.querySelector(".kafka-broker-save").textContent = profile ? "Save changes" : "Save broker";
      form.hidden = false;
      modal.open(profile ? "Edit broker" : "Add broker");
      nameInput.focus();
    };

    const bulk = mountBulkEditor({
      root: wrapper,
      button: wrapper.querySelector(".settings-bulk-edit"),
      label: item.label,
      hint: "Match by name. Omitted broker connections stay unchanged.",
      onOpen: () => {
        form.hidden = true;
        modal.close();
      },
      load: () => ({ value: readKafkaBrokerProfiles().map(({ name, brokers }) => ({ name, brokers })) }),
      plan: (text) => buildKafkaPlan(text, readKafkaBrokerProfiles()),
      apply: (plan) => applyListPlan(plan, readKafkaBrokerProfiles, saveKafkaBrokerProfiles),
      onBusy: (busy) => {
        addButton.disabled = busy;
        if (busy)
          list.querySelectorAll("button").forEach((button) => {
            button.disabled = true;
          });
        else renderList();
      },
      onSaved: () => this.eventBus?.emit?.("notification:success", { message: "Kafka connections saved" }),
    });
    this.settingDisposers.add(() => bulk.dispose());

    addButton.addEventListener("click", () => showForm());
    wrapper.querySelector(".kafka-broker-cancel").addEventListener("click", () => {
      form.hidden = true;
      modal.close();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      const brokers = addressesInput.value.trim();
      if (!name || !brokers) {
        formStatus.textContent = "Enter a name and at least one bootstrap server.";
        formStatus.dataset.state = "error";
        (!name ? nameInput : addressesInput).focus();
        return;
      }
      const profiles = readKafkaBrokerProfiles();
      if (profiles.some((profile) => profile.id !== editingId && profile.name.toLowerCase() === name.toLowerCase())) {
        formStatus.textContent = "That connection name is already in use.";
        formStatus.dataset.state = "error";
        nameInput.focus();
        return;
      }
      const id = editingId || globalThis.crypto?.randomUUID?.() || `kafka-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const next = editingId
        ? profiles.map((profile) => (profile.id === editingId ? { id, name, brokers } : profile))
        : [...profiles, { id, name, brokers }];
      saveKafkaBrokerProfiles(next);
      form.hidden = true;
      modal.close();
      renderList();
      this.eventBus?.emit?.("notification:success", { message: `Broker "${name}" saved` });
    });

    list.addEventListener("click", async (event) => {
      const edit = event.target.closest(".kafka-broker-edit");
      if (edit) {
        const profile = readKafkaBrokerProfiles().find((entry) => entry.id === edit.dataset.profileId);
        if (profile) showForm(profile);
        return;
      }
      const remove = event.target.closest(".kafka-broker-delete");
      if (!remove) return;
      const profiles = readKafkaBrokerProfiles();
      const profile = profiles.find((entry) => entry.id === remove.dataset.profileId);
      if (!profile) return;
      const confirmed = await confirmAction({
        title: "Delete broker?",
        description: `Delete the saved ${profile.name} broker connection?`,
        confirmLabel: "Delete broker",
      });
      if (!confirmed) return;
      saveKafkaBrokerProfiles(profiles.filter((entry) => entry.id !== profile.id));
      renderList();
      this.eventBus?.emit?.("notification:success", { message: `Broker "${profile.name}" deleted` });
    });

    renderList();
    return wrapper;
  }

  renderEnvironmentsItem(item) {
    const wrapper = document.createElement("div");
    wrapper.className = "setting-item setting-item-environments";
    wrapper.dataset.setting = item.key;
    wrapper.dataset.type = item.type;
    const uid = Math.random().toString(36).slice(2, 8);
    wrapper.innerHTML = `
      <div class="environments-header">
        <button type="button" class="btn btn-secondary btn-sm environment-add-btn">Add Environment</button>
      </div>
      <div class="environments-list"></div>
      <form class="environment-form" hidden>
        <h4 class="environment-form-title">Add Environment</h4>
        <div class="environment-form-row">
          <label for="environment-name-${uid}">Environment</label>
          <input id="environment-name-${uid}" class="environment-name" type="text" maxlength="48" autocomplete="off" spellcheck="false" placeholder="e.g. UAT1" />
        </div>
        <div class="environment-form-row" data-db-row>
          <label for="environment-critical-${uid}">Critical Database</label>
          <select id="environment-critical-${uid}" class="environment-critical"></select>
        </div>
        <div class="environment-form-row" data-db-row>
          <label for="environment-complementary-${uid}">Complementary Database</label>
          <select id="environment-complementary-${uid}" class="environment-complementary"></select>
        </div>
        <p class="environment-desktop-note" hidden>Database bindings need the Desktop app. CDN URLs still apply on Web.</p>
        <div class="environment-form-row">
          <label for="environment-public-url-${uid}">CDN Public URL</label>
          <input id="environment-public-url-${uid}" class="environment-public-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://public.example.com/" />
        </div>
        <div class="environment-form-row">
          <label for="environment-direct-url-${uid}">CDN Direct URL</label>
          <input id="environment-direct-url-${uid}" class="environment-direct-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://10.0.0.0:5501/" />
        </div>
        <div class="environment-form-status" role="status" aria-live="polite"></div>
        <div class="environment-form-actions">
          <button type="button" class="btn btn-secondary btn-sm environment-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm environment-save">Save Environment</button>
        </div>
      </form>
    `;

    const list = wrapper.querySelector(".environments-list");
    const form = wrapper.querySelector(".environment-form");
    const formTitle = wrapper.querySelector(".environment-form-title");
    const nameInput = wrapper.querySelector(".environment-name");
    const criticalSelect = wrapper.querySelector(".environment-critical");
    const complementarySelect = wrapper.querySelector(".environment-complementary");
    const publicInput = wrapper.querySelector(".environment-public-url");
    const directInput = wrapper.querySelector(".environment-direct-url");
    const status = wrapper.querySelector(".environment-form-status");
    const saveButton = wrapper.querySelector(".environment-save");
    const addButton = wrapper.querySelector(".environment-add-btn");
    const isDesktop = this.runtime === "tauri";
    let editingId = "";

    const readList = () => {
      const value = this.service.getValue(item.storageKey || item.key, "environments", []);
      return Array.isArray(value) ? value : [];
    };
    const saveList = (environments) => this.service.setValue(item.storageKey || item.key, "environments", environments);

    if (!isDesktop) {
      form.querySelectorAll("[data-db-row]").forEach((row) => {
        row.hidden = true;
      });
      form.querySelector(".environment-desktop-note").hidden = false;
    }

    const connections = () => {
      const value = this.service.getValue("config.oracle.connections", "oracle-connections", []);
      return Array.isArray(value) ? value.filter((entry) => entry?.name) : [];
    };

    const selectedConnections = new Map();
    const fillConnectionOptions = (select, selected) => {
      const options = connections();
      select.replaceChildren(new Option("None", ""));
      for (const connection of options) select.appendChild(new Option(connection.name, connection.name));
      if (selected && !options.some((connection) => connection.name === selected)) {
        select.appendChild(new Option(`${selected} (not configured)`, selected));
      }
      if (isDesktop) {
        const add = new Option("Add connection…", `add-oracle-${uid}`);
        add.dataset.action = "add-connection";
        select.append(add);
      }
      select.value = selected || "";
      selectedConnections.set(select, select.value);
    };

    const renderList = () => {
      const environments = readList();
      list.replaceChildren();
      if (!environments.length) {
        const empty = document.createElement("p");
        empty.className = "environments-empty";
        empty.textContent = "No environments configured.";
        list.appendChild(empty);
        return;
      }
      for (const environment of environments) {
        const row = document.createElement("div");
        row.className = "environment-row";
        const identity = document.createElement("div");
        identity.className = "environment-identity";
        const name = document.createElement("strong");
        name.textContent = environment.name;
        identity.appendChild(name);
        const database = document.createElement("span");
        database.className = "environment-meta";
        database.textContent = `Critical: ${environment.criticalConnection || "—"} · Complementary: ${
          environment.complementaryConnection || "—"
        }`;
        identity.appendChild(database);
        if (environment.cdnPublicUrl) {
          const publicUrl = document.createElement("span");
          publicUrl.className = "environment-meta";
          publicUrl.textContent = `Public: ${environment.cdnPublicUrl}`;
          identity.appendChild(publicUrl);
        }
        if (environment.cdnDirectUrl) {
          const directUrl = document.createElement("span");
          directUrl.className = "environment-meta";
          directUrl.textContent = `Direct: ${environment.cdnDirectUrl}`;
          identity.appendChild(directUrl);
        }

        const actions = document.createElement("div");
        actions.className = "environment-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "btn btn-outline btn-sm environment-edit";
        edit.dataset.environmentId = environment.id;
        edit.textContent = "Edit";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-outline btn-sm btn-danger environment-delete";
        remove.dataset.environmentId = environment.id;
        remove.textContent = "Delete";
        actions.append(edit, remove);
        row.append(identity, actions);
        list.appendChild(row);
      }
    };

    const modal = mountEditDialog({
      root: wrapper,
      form,
      wide: true,
      onCancel: () => hideForm(),
      fallbackFocus: (trigger) =>
        list.querySelector(`.environment-edit[data-environment-id="${trigger?.dataset.environmentId}"]`) || addButton,
    });
    formTitle.hidden = true;
    this.settingDisposers.add(() => modal.dispose());

    for (const select of [criticalSelect, complementarySelect]) {
      select.addEventListener("change", () => {
        if (select.selectedOptions[0]?.dataset.action !== "add-connection") {
          selectedConnections.set(select, select.value);
          return;
        }
        select.value = selectedConnections.get(select) || "";
        const resume = () => {
          modal.resume();
          select.focus();
        };
        if (!this.oracleConnectionEditor) {
          status.textContent = "Oracle connection editor is unavailable. Reopen Settings and try again.";
          select.focus();
          return;
        }
        modal.suspend();
        const opened = this.oracleConnectionEditor.openCreate({
          onSaved: (name) => {
            fillConnectionOptions(criticalSelect, select === criticalSelect ? name : criticalSelect.value);
            fillConnectionOptions(complementarySelect, select === complementarySelect ? name : complementarySelect.value);
            resume();
          },
          onCancel: resume,
        });
        if (!opened) resume();
      });
    }

    const showForm = (environment = null) => {
      editingId = environment?.id || "";
      formTitle.textContent = environment ? "Edit Environment" : "Add Environment";
      nameInput.value = environment?.name || "";
      fillConnectionOptions(criticalSelect, environment?.criticalConnection || "");
      fillConnectionOptions(complementarySelect, environment?.complementaryConnection || "");
      publicInput.value = environment?.cdnPublicUrl || "";
      directInput.value = environment?.cdnDirectUrl || "";
      status.textContent = "";
      status.dataset.state = "";
      saveButton.textContent = environment ? "Save changes" : "Save Environment";
      form.hidden = false;
      modal.open(formTitle.textContent);
      nameInput.focus();
    };

    const hideForm = () => {
      form.hidden = true;
      editingId = "";
      modal.close();
    };

    addButton.addEventListener("click", () => showForm());
    wrapper.querySelector(".environment-cancel").addEventListener("click", hideForm);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        status.textContent = "Environment name is required.";
        status.dataset.state = "error";
        nameInput.focus();
        return;
      }

      const environments = readList();
      if (environments.some((environment) => environment.id !== editingId && environment.name.toLowerCase() === name.toLowerCase())) {
        status.textContent = "That environment name is already in use.";
        status.dataset.state = "error";
        nameInput.focus();
        return;
      }

      for (const [label, input] of [
        ["CDN Public URL", publicInput],
        ["CDN Direct URL", directInput],
      ]) {
        const value = input.value.trim();
        if (!value) continue;
        try {
          const url = new URL(value);
          if (!url.protocol.startsWith("http") || !url.host || url.search || url.hash) throw new Error("invalid");
        } catch (_) {
          status.textContent = `${label} must be an http(s) URL without a query or fragment.`;
          status.dataset.state = "error";
          input.focus();
          return;
        }
      }

      const existing = environments.find((environment) => environment.id === editingId);
      const next = {
        name,
        criticalConnection: isDesktop ? criticalSelect.value : existing?.criticalConnection || "",
        complementaryConnection: isDesktop ? complementarySelect.value : existing?.complementaryConnection || "",
        cdnPublicUrl: publicInput.value.trim(),
        cdnDirectUrl: directInput.value.trim(),
      };
      const updated = editingId
        ? environments.map((environment) => (environment.id === editingId ? { ...environment, ...next } : environment))
        : [...environments, next];

      saveList(updated);
      form.hidden = true;
      editingId = "";
      renderList();
      modal.close();
      this.eventBus?.emit?.("notification:success", { message: `Environment "${name}" saved` });
    });

    list.addEventListener("click", async (event) => {
      const edit = event.target.closest(".environment-edit");
      if (edit) {
        const environment = readList().find((entry) => entry.id === edit.dataset.environmentId);
        if (environment) showForm(environment);
        return;
      }

      const remove = event.target.closest(".environment-delete");
      if (!remove) return;
      const environment = readList().find((entry) => entry.id === remove.dataset.environmentId);
      if (!environment) return;
      const confirmed = await confirmAction({
        title: "Delete environment?",
        description: `Delete the ${environment.name} environment? Tools will no longer see its database or CDN URLs.`,
        confirmLabel: "Delete environment",
      });
      if (!confirmed) return;
      saveList(readList().filter((entry) => entry.id !== environment.id));
      renderList();
      this.eventBus?.emit?.("notification:success", { message: `Environment "${environment.name}" deleted` });
    });

    renderList();
    return wrapper;
  }

  renderItem(item) {
    if (item.type === "project-manager") {
      return renderProjectManager({ eventBus: this.eventBus, refresh: () => this.renderCategories(this.currentConfig.categories) });
    }
    if (item.type === "project-schema") return renderProjectSchemaLink();
    if (item.type === "kafka-brokers") return this.renderKafkaBrokersItem(item);
    if (item.type === "environments") return this.renderEnvironmentsItem(item);
    const storageKey = item.storageKey || item.key;
    const current = this.service.getValue(storageKey, item.type, item.default);

    const wrapper = document.createElement("div");
    wrapper.className = "setting-item";
    wrapper.setAttribute("data-setting", item.key);
    wrapper.setAttribute("data-type", item.type);
    wrapper.setAttribute("data-editing", "false");

    const row = document.createElement("div");
    row.className = "setting-row";
    const fieldId = `setting-${item.key.replace(/[^a-z0-9-]/gi, "-")}`;
    const decorateRow = () => {
      const name = row.querySelector(".setting-name");
      if (!name) return;
      name.id = `${fieldId}-label`;
      const control = row.querySelector(".setting-input");
      if (control) {
        control.id = fieldId;
        control.name = item.key;
        control.setAttribute("aria-labelledby", name.id);
        const label = document.createElement("label");
        label.className = name.className;
        label.id = name.id;
        label.htmlFor = fieldId;
        label.textContent = name.textContent;
        name.replaceWith(label);
      }
    };

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
      decorateRow();
      wrapper.appendChild(row);
      return wrapper;
    }

    // Inline enum dropdown - immediate save on change
    if (item.type === "enum") {
      row.innerHTML = `
        <div class="setting-name">${item.label}</div>
        <div class="setting-control">${this.service.inputForType("enum", item)}</div>
      `;
      const select = row.querySelector(".setting-input");
      // Set initial value
      select.value = current || item.default || "";
      select.addEventListener("change", () => {
        this.service.setValue(storageKey, "enum", select.value, item.apply);
      });
      decorateRow();
      wrapper.appendChild(row);
      return wrapper;
    }

    // Action-type items render as a button that performs the action
    if (item.type === "action") {
      row.innerHTML = `
        <div class="setting-name">${item.label}</div>
        <div class="setting-control"><button type="button" class="btn btn-primary btn-sm setting-action-btn">${
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
      decorateRow();
      wrapper.appendChild(row);
      return wrapper;
    }

    // Oracle Connections custom type - connection management UI
    if (item.type === "oracle-connections") {
      wrapper.className = "setting-item setting-item-oracle";
      wrapper.innerHTML = `
        <span class="oracle-connections-header">
          <button type="button" class="btn btn-secondary btn-sm oracle-add-btn">Add Connection</button>
          <button type="button" class="btn btn-outline btn-sm settings-bulk-edit">Bulk Edit</button>
        </span>
        <div class="oracle-connections-list"></div>
        <form class="oracle-connection-form" style="display:none">
          <h4 class="oracle-form-title">Add Connection</h4>
          <div class="oracle-form-row">
            <label for="oracle-name">Connection Name</label>
            <input type="text" id="oracle-name" name="name" autocomplete="off" spellcheck="false" class="oracle-input oracle-name" placeholder="e.g., DEV, UAT, PROD" />
          </div>
          <div class="oracle-form-row">
            <label for="oracle-connect-string">Database Address</label>
            <input type="text" id="oracle-connect-string" name="connect-string" autocomplete="off" spellcheck="false" class="oracle-input oracle-connect-string" placeholder="host:port/service_name" />
          </div>
          <div class="oracle-form-row">
            <label for="oracle-username">Username</label>
            <input type="text" id="oracle-username" name="username" autocomplete="off" spellcheck="false" class="oracle-input oracle-username" placeholder="Oracle username" />
          </div>
          <div class="oracle-form-row">
            <label for="oracle-password">Password</label>
            <input type="password" id="oracle-password" name="password" autocomplete="new-password" spellcheck="false" class="oracle-input oracle-password" placeholder="Oracle password" />
          </div>
          <div class="oracle-form-status" role="status" aria-live="polite"></div>
          <div class="oracle-form-actions">
            <button type="button" class="btn btn-outline btn-sm oracle-test-btn">Test Connection</button>
            <button type="button" class="btn btn-secondary btn-sm oracle-cancel-btn">Cancel</button>
            <button type="submit" class="btn btn-primary btn-sm oracle-save-btn">Save Connection</button>
          </div>
        </form>
      `;

      const listEl = wrapper.querySelector(".oracle-connections-list");
      const formEl = wrapper.querySelector(".oracle-connection-form");
      const addBtn = wrapper.querySelector(".oracle-add-btn");
      const cancelBtn = wrapper.querySelector(".oracle-cancel-btn");
      const testBtn = wrapper.querySelector(".oracle-test-btn");
      const statusEl = wrapper.querySelector(".oracle-form-status");
      let editingIndex = -1;
      let formGeneration = 0;
      let connectionFlow = null;
      const modal = mountEditDialog({
        root: wrapper,
        form: formEl,
        wide: true,
        onCancel: () => cancelBtn.click(),
        isBusy: () => cancelBtn.disabled,
        fallbackFocus: (trigger) => listEl.querySelector(`.oracle-edit-conn[data-index="${trigger?.dataset.index}"]`) || addBtn,
      });
      formEl.querySelector(".oracle-form-title").hidden = true;
      this.settingDisposers.add(() => modal.dispose());

      // Local escape function for HTML content
      const esc = (s) =>
        String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);

      const renderList = () => {
        const conns = this.service.getValue(storageKey, "oracle-connections", []);
        if (!conns || conns.length === 0) {
          listEl.innerHTML = '<div class="oracle-empty">No connections configured</div>';
          return;
        }
        listEl.innerHTML = conns
          .map(
            (c, i) => `
          <div class="oracle-connection-row" data-index="${i}">
            <div class="oracle-conn-info">
              <span class="oracle-conn-name">${esc(c.name)}</span>
              <span class="oracle-conn-string">${esc(c.connect_string)}</span>
              <span class="oracle-conn-status" id="oracle-conn-status-${i}"></span>
            </div>
            <div class="oracle-conn-actions">
              <button class="btn btn-outline btn-sm oracle-check-conn" data-index="${i}" data-name="${esc(c.name)}" title="Test connection">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                Check
              </button>
              <button class="btn btn-outline btn-sm oracle-edit-conn" data-index="${i}">Edit</button>
              <button class="btn btn-outline btn-sm btn-danger oracle-delete-conn" data-index="${i}">Delete</button>
            </div>
          </div>
        `,
          )
          .join("");
      };

      const showForm = (conn = null, index = -1) => {
        bulk.close();
        editingIndex = index;
        formEl.querySelector(".oracle-form-title").textContent = conn ? "Edit Connection" : "Add Connection";
        formEl.querySelector(".oracle-name").value = conn?.name || "";
        formEl.querySelector(".oracle-connect-string").value = conn?.connect_string || "";
        formEl.querySelector(".oracle-username").value = "";
        formEl.querySelector(".oracle-password").value = "";
        statusEl.textContent = "";
        statusEl.className = "oracle-form-status";
        formEl.style.display = "block";
        const generation = ++formGeneration;
        modal.open(conn ? "Edit Connection" : "Add Connection");
        formEl.querySelector(".oracle-name").focus();
        // If editing, show only the non-secret username. A blank password retains the saved value.
        if (conn) {
          (async () => {
            try {
              const user = await OracleConnectionService.getOracleUsername(conn.name);
              if (generation === formGeneration && !formEl.querySelector(".oracle-username").value) {
                formEl.querySelector(".oracle-username").value = user || "";
              }
            } catch (_) {}
          })();
        }
      };

      const hideForm = (savedName = null) => {
        formEl.style.display = "none";
        formEl.querySelector(".oracle-password").value = "";
        formGeneration += 1;
        modal.close();
        editingIndex = -1;
        const flow = connectionFlow;
        connectionFlow = null;
        for (const category of flow?.expandedCategories || []) {
          category.setAttribute("aria-expanded", "false");
          category.querySelector(".settings-category-header")?.setAttribute("aria-expanded", "false");
        }
        if (savedName) flow?.onSaved(savedName);
        else flow?.onCancel();
      };

      const controller = {
        openCreate: ({ onSaved, onCancel }) => {
          if (formEl.querySelector(".oracle-save-btn").disabled) return false;
          const expandedCategories = [];
          let category = wrapper.closest(".settings-category");
          while (category) {
            if (category.getAttribute("aria-expanded") !== "true") {
              expandedCategories.push(category);
              category.setAttribute("aria-expanded", "true");
              category.querySelector(".settings-category-header")?.setAttribute("aria-expanded", "true");
            }
            category = category.parentElement?.closest(".settings-category");
          }
          connectionFlow = { onSaved, onCancel, expandedCategories };
          showForm();
          return true;
        },
      };
      this.oracleConnectionEditor = controller;
      this.settingDisposers.add(() => {
        connectionFlow = null;
        if (this.oracleConnectionEditor === controller) this.oracleConnectionEditor = null;
      });

      const bulk = mountBulkEditor({
        root: wrapper,
        button: wrapper.querySelector(".settings-bulk-edit"),
        label: "Oracle connections",
        hint: "Match by name. Omitted connections and passwords stay unchanged.",
        onOpen: () => {
          if (formEl.querySelector(".oracle-save-btn").disabled) return false;
          hideForm();
        },
        load: async () => {
          const connections = this.service.getValue(storageKey, "oracle-connections", []);
          const users = new Map(
            await Promise.all(
              connections.map(async (connection) => [connection.name, await OracleConnectionService.getOracleUsername(connection.name)]),
            ),
          );
          return {
            value: connections.map((connection) => ({
              name: connection.name,
              address: connection.connect_string,
              username: users.get(connection.name) || "",
            })),
            context: users,
          };
        },
        plan: (text, users) => buildOracleJsonPlan(text, this.service.getValue(storageKey, "oracle-connections", []), users),
        apply: (plan) =>
          applyOracleJsonPlan(plan, {
            getConnections: () => this.service.getValue(storageKey, "oracle-connections", []),
            setConnections: (connections) => this.service.setValue(storageKey, "oracle-connections", connections),
            setCredentials: (name, username, password) => OracleConnectionService.setOracleCredentials(name, username, password),
          }),
        onBusy: (busy) => {
          addBtn.disabled = busy;
          if (busy)
            listEl.querySelectorAll("button").forEach((button) => {
              button.disabled = true;
            });
          else {
            renderList();
          }
        },
        onSaved: () => this.eventBus?.emit?.("notification:success", { message: "Oracle connections saved" }),
      });
      this.settingDisposers.add(() => bulk.dispose());

      addBtn.addEventListener("click", () => showForm());
      cancelBtn.addEventListener("click", () => hideForm());

      formEl.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = formEl.querySelector(".oracle-name").value.trim();
        const connectString = formEl.querySelector(".oracle-connect-string").value.trim();
        const username = formEl.querySelector(".oracle-username").value.trim();
        const password = formEl.querySelector(".oracle-password").value;

        if (!name || !connectString || !username) {
          statusEl.textContent = "Name, Database Address, and Username are required";
          statusEl.className = "oracle-form-status error";
          [...formEl.querySelectorAll(".oracle-name, .oracle-connect-string, .oracle-username")]
            .find((input) => !input.value.trim())
            ?.focus();
          return;
        }
        const savedConnections = this.service.getValue(storageKey, "oracle-connections", []);
        const oldName = editingIndex >= 0 && Array.isArray(savedConnections) ? savedConnections[editingIndex]?.name : null;
        if ((!oldName || oldName !== name) && !password) {
          statusEl.textContent = oldName ? "Password is required when renaming a connection" : "Password is required for a new connection";
          statusEl.className = "oracle-form-status error";
          return;
        }

        if (savedConnections.some((connection, index) => index !== editingIndex && connection.name === name)) {
          statusEl.textContent = "A connection with this name already exists. Choose another name.";
          statusEl.className = "oracle-form-status error";
          formEl.querySelector(".oracle-name").focus();
          return;
        }
        const saveButton = formEl.querySelector(".oracle-save-btn");
        if (saveButton.disabled) return;
        saveButton.disabled = true;
        cancelBtn.disabled = true;
        testBtn.disabled = true;
        saveButton.textContent = "Saving…";
        try {
          // Save credentials to keychain
          try {
            await OracleConnectionService.setOracleCredentials(name, username, password);
          } catch (err) {
            statusEl.textContent = `Failed to save credentials: ${err}`;
            statusEl.className = "oracle-form-status error";
            return;
          }

          // Update connections list in localStorage
          let conns = this.service.getValue(storageKey, "oracle-connections", []);
          if (!Array.isArray(conns)) conns = [];

          const connData = { name, connect_string: connectString };
          if (editingIndex >= 0) {
            // If name changed, delete old credentials
            const previousName = conns[editingIndex]?.name;
            if (previousName && previousName !== name) {
              try {
                await invoke("delete_oracle_credentials", { name: previousName });
              } catch (_) {}
              updateConnectionReference(previousName, name);
            }
            conns[editingIndex] = connData;
          } else {
            // Check for duplicate name
            if (conns.some((c) => c.name === name)) {
              statusEl.textContent = "A connection with this name already exists";
              statusEl.className = "oracle-form-status error";
              return;
            }
            conns.push(connData);
          }

          this.service.setValue(storageKey, "oracle-connections", conns);
          hideForm(name);
          renderList();
          this.eventBus?.emit?.("notification:success", { message: `Connection "${name}" saved` });
        } finally {
          saveButton.disabled = false;
          cancelBtn.disabled = false;
          testBtn.disabled = false;
          saveButton.textContent = "Save Connection";
        }
      });

      testBtn.addEventListener("click", async () => {
        const name = formEl.querySelector(".oracle-name").value.trim();
        const connectString = formEl.querySelector(".oracle-connect-string").value.trim();
        const username = formEl.querySelector(".oracle-username").value.trim();
        const password = formEl.querySelector(".oracle-password").value;

        if (!connectString || !username || (editingIndex < 0 && !password)) {
          statusEl.textContent = "Database Address, Username, and a saved or entered Password are required for testing";
          statusEl.className = "oracle-form-status error";
          return;
        }

        statusEl.textContent = "Testing connection…";
        statusEl.className = "oracle-form-status";
        testBtn.disabled = true;

        try {
          const connName = name || "test";
          await OracleConnectionService.testConnectionWithCredentials({
            name: connName,
            connect_string: connectString,
            username,
            password,
          });
          statusEl.textContent = "✓ Connection successful";
          statusEl.className = "oracle-form-status success";
        } catch (err) {
          statusEl.textContent = `✗ Connection failed: ${err.message || err}`;
          statusEl.className = "oracle-form-status error";
        } finally {
          testBtn.disabled = false;
        }
      });

      // Event delegation for check/edit/delete
      listEl.addEventListener("click", async (e) => {
        const checkBtn = e.target.closest(".oracle-check-conn");
        const editBtn = e.target.closest(".oracle-edit-conn");
        const deleteBtn = e.target.closest(".oracle-delete-conn");

        if (checkBtn) {
          const idx = parseInt(checkBtn.dataset.index, 10);
          const connName = checkBtn.dataset.name;
          const statusEl = document.getElementById(`oracle-conn-status-${idx}`);

          // Disable button during check
          checkBtn.disabled = true;
          checkBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; animation: spin 1s linear infinite;">
              <circle cx="12" cy="12" r="10" opacity="0.3"/>
              <path d="M12 2 a10 10 0 0 1 0 20"/>
            </svg>
            Checking…
          `;
          if (statusEl) {
            statusEl.textContent = "";
            statusEl.className = "oracle-conn-status";
          }

          try {
            // Get connection config
            const conns = this.service.getValue(storageKey, "oracle-connections", []);
            const conn = conns[idx];
            if (!conn) throw new Error("Connection not found");

            await OracleConnectionService.testConnectionViaSidecar(connName, conn);
            if (statusEl) {
              statusEl.textContent = "✓ Connection test passed";
              statusEl.className = "oracle-conn-status success";
            }
          } catch (err) {
            const errMsg = String(err.message || err);
            if (statusEl) {
              statusEl.textContent = `✗ ${errMsg.length > 50 ? errMsg.substring(0, 50) + "..." : errMsg}`;
              statusEl.className = "oracle-conn-status error";
            }
          } finally {
            checkBtn.disabled = false;
            checkBtn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              Check
            `;
          }
        }

        if (editBtn) {
          const idx = parseInt(editBtn.dataset.index, 10);
          const conns = this.service.getValue(storageKey, "oracle-connections", []);
          if (conns[idx]) showForm(conns[idx], idx);
        }

        if (deleteBtn) {
          const idx = parseInt(deleteBtn.dataset.index, 10);
          let conns = this.service.getValue(storageKey, "oracle-connections", []);
          const conn = conns[idx];
          if (
            conn &&
            (await confirmAction({
              title: "Delete connection?",
              description: `Delete connection "${conn.name}" and its saved credentials?`,
              confirmLabel: "Delete connection",
            }))
          ) {
            // Delete credentials from keychain
            try {
              await invoke("delete_oracle_credentials", { name: conn.name });
            } catch (_) {}
            clearConnectionReference(conn.name);
            conns.splice(idx, 1);
            this.service.setValue(storageKey, "oracle-connections", conns);
            renderList();
            this.eventBus?.emit?.("notification:success", { message: `Connection "${conn.name}" deleted` });
          }
        }
      });

      renderList();
      return wrapper;
    }

    // Display value
    let displayValue = "";
    const isRequired = !!(item.validation && item.validation.required);
    if (item.type === "secret") {
      displayValue = current ? "••••••••" : "—";
    } else if (item.type === "kvlist") {
      displayValue = this.#kvPreviewHTML(Array.isArray(current) ? current : []);
    } else if (item.type === "string-list") {
      displayValue = this.#stringListPreviewHTML(Array.isArray(current) ? current : []);
    } else if (item.type === "json") {
      displayValue = this.#jsonPreviewHTML(current);
    } else {
      displayValue = this.escapeText(this.formatValueForDisplay(current, item.type));
    }

    // Explicit editing uses a modal; immediate controls stay in the row.
    row.innerHTML = `
      <div class="setting-name">${item.label}${
        isRequired ? ' <span class="setting-required" title="Required" aria-hidden="true">*</span>' : ""
      }</div>
      <div class="setting-value">
        <div data-value>${displayValue}</div>
        <button type="button" class="btn btn-ghost btn-sm setting-edit" aria-label="Edit ${item.label}">Edit</button>
      </div>
    `;

    decorateRow();
    const panel = document.createElement("form");
    panel.className = "setting-edit-panel";
    panel.noValidate = true;
    panel.style.display = "none";
    panel.innerHTML = `
      <div class="setting-edit-row">
        ${this.service.inputForType(item.type, item)}
      </div>
      <div class="setting-error" id="${fieldId}-error" aria-live="polite"></div>
      <div class="setting-actions">
        <button type="button" class="btn btn-secondary btn-sm setting-cancel" data-action="cancel">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm setting-confirm" data-action="confirm">Save changes</button>
      </div>
    `;

    const confirmBtn = panel.querySelector(".setting-confirm");
    const errorEl = panel.querySelector(".setting-error");

    // Special handling per type
    let input = null;
    let kvContainer = null;
    if (item.type === "kvlist") {
      kvContainer = panel.querySelector(".kvlist");
      this.applyInitialInputValue(kvContainer, "kvlist", current, item);
    } else {
      input = panel.querySelector(".setting-input");
      input.id = fieldId;
      input.name = item.key;
      if (item.type === "number") input.type = "number";
      input.autocomplete = item.type === "secret" ? "new-password" : "off";
      input.setAttribute("aria-label", item.label);
      input.setAttribute("aria-describedby", `${fieldId}-error`);
      if (item.validation?.required) input.setAttribute("aria-required", "true");
      if (item.type === "secret") {
        // Credentials remain masked while replacing them.
        input.type = "password";
      } else {
        this.applyInitialInputValue(input, item.type, current);
      }
    }

    const getCurrentEditValue = () => {
      if (item.type === "kvlist") return this.extractInputValue(kvContainer, "kvlist", item);
      return this.extractInputValue(input, item.type);
    };

    const validateAndToggle = () => {
      const value = getCurrentEditValue();
      const { valid, message } = this.service.validate(value, item.type, item.validation || {});
      errorEl.textContent = valid ? "" : message;
      input?.setAttribute("aria-invalid", String(!valid));
    };

    // Bind kvlist actions
    if (item.type === "kvlist") {
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

    let bulk = null;
    const modal = mountEditDialog({
      root: wrapper,
      form: panel,
      onCancel: () => panel.querySelector(".setting-cancel").click(),
      isBusy: () => confirmBtn.disabled,
      wide: ["kvlist", "string-list", "json"].includes(item.type),
    });
    this.settingDisposers.add(() => modal.dispose());
    const openEditor = () => {
      bulk?.close();
      wrapper.dataset.editing = "true";
      errorEl.textContent = "";
      input?.removeAttribute("aria-invalid");
      panel.style.display = "flex";
      modal.open(`Edit ${item.label}`);
      if (item.type === "kvlist") {
        const firstKey = panel.querySelector(".kv-key");
        firstKey?.focus();
      } else {
        input?.focus();
      }
    };

    const closeEditor = () => {
      wrapper.dataset.editing = "false";
      panel.style.display = "none";
      if (item.type === "secret") input.value = "";
      modal.close();
    };

    const valueEl = row.querySelector(".setting-edit");
    valueEl.setAttribute("aria-haspopup", "dialog");
    valueEl.addEventListener("click", openEditor);
    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      confirmBtn.click();
    });

    panel.addEventListener("click", async (e) => {
      const action = e.target.getAttribute("data-action");
      if (!action) return;
      e.preventDefault();

      if (action === "cancel") {
        if (item.type === "kvlist") {
          this.applyInitialInputValue(kvContainer, "kvlist", this.service.getValue(storageKey, item.type, item.default), item);
        } else {
          const resetVal = this.service.getValue(storageKey, item.type, item.default);
          this.applyInitialInputValue(input, item.type, resetVal);
          if (item.type === "secret") {
            input.type = "password";
          }
        }
        validateAndToggle();
        closeEditor();
      }
      if (action === "confirm") {
        const value = getCurrentEditValue();
        const { valid } = this.service.validate(value, item.type, item.validation || {});
        if (!valid) {
          validateAndToggle();
          (input || panel.querySelector(".kv-key"))?.focus();
          return;
        }

        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Saving…";
        panel.querySelector(".setting-cancel").disabled = true;
        try {
          let stored;
          if (storageKey === "secure.redis.password") {
            try {
              if (value) {
                const username = localStorage.getItem("config.redis.username") || "";
                await invoke("set_redis_credentials", { username, password: value });
              } else {
                await invoke("clear_redis_credentials");
              }
            } catch (err) {
              errorEl.textContent = String(err);
              return;
            }
            stored = this.service.setValue(storageKey, "secret", value ? "set" : "", item.apply);
          } else {
            stored = this.service.setValue(storageKey, item.type, value, item.apply);
          }

          let display = "";
          if (item.type === "secret") {
            display = stored ? "••••••••" : "—";
          } else if (item.type === "kvlist") {
            display = this.#kvPreviewHTML(Array.isArray(stored) ? stored : []);
          } else if (item.type === "string-list") {
            display = this.#stringListPreviewHTML(Array.isArray(stored) ? stored : []);
          } else if (item.type === "json") {
            display = this.#jsonPreviewHTML(stored);
          } else {
            display = this.escapeText(this.formatValueForDisplay(stored, item.type));
          }
          row.querySelector("[data-value]").innerHTML = display;
          closeEditor();
        } catch (error) {
          errorEl.textContent = `Could not save changes: ${error.message || error}`;
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "Save changes";
          panel.querySelector(".setting-cancel").disabled = false;
          if (wrapper.dataset.editing === "true") input?.focus();
        }
      }
    });

    wrapper.appendChild(row);

    if (item.type === "kvlist" || item.type === "string-list") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline btn-sm settings-bulk-edit";
      button.textContent = "Bulk Edit";
      button.setAttribute("aria-label", `Bulk Edit ${item.label}`);
      const actions = document.createElement("div");
      actions.className = "setting-row-actions";
      actions.append(valueEl, button);
      row.querySelector(".setting-value").appendChild(actions);
      const read = () => this.service.getValue(storageKey, item.type, item.default);
      bulk = mountBulkEditor({
        root: wrapper,
        button,
        label: item.label,
        hint: "Replaces this list. Review removals before applying.",
        onOpen: closeEditor,
        load: () => ({ value: read() }),
        plan: (text) => buildListPlan(text, read(), item.type, (value) => this.service.validate(value, item.type, item.validation || {})),
        apply: (plan) => applyListPlan(plan, read, (value) => this.service.setValue(storageKey, item.type, value, item.apply)),
        onBusy: (busy) => {
          valueEl.disabled = busy;
        },
        onSaved: () => {
          const value = read();
          row.querySelector("[data-value]").innerHTML = this.formatValueForDisplay(value, item.type);
          this.applyInitialInputValue(kvContainer || input, item.type, value, item);
          this.eventBus?.emit?.("notification:success", { message: `${item.label} saved` });
        },
      });
      this.settingDisposers.add(() => bulk.dispose());
    }
    return wrapper;
  }

  escapeText(value) {
    const element = document.createElement("span");
    element.textContent = String(value ?? "");
    return element.innerHTML;
  }

  #kvAddRow(container, item, rowData = { key: "", value: "" }) {
    const rows = container.querySelector(".kv-rows");
    const row = document.createElement("div");
    row.className = "kv-row";
    row.innerHTML = `
      <input type="text" class="kv-key" name="environment" autocomplete="off" spellcheck="false" placeholder="${item.keyPlaceholder || "Environment"}" aria-label="Environment"/>
      <input type="url" class="kv-value" name="base-url" autocomplete="off" spellcheck="false" placeholder="${item.valuePlaceholder || "Base URL"}" aria-label="Base URL"/>
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
      case "string-list":
        inputOrContainer.value = Array.isArray(value) ? value.join("\n") : "";
        break;
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
      case "string-list":
        return inputOrContainer.value
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
          .filter((item, index, arr) => arr.findIndex((entry) => entry.toLowerCase() === item.toLowerCase()) === index);
      default:
        return inputOrContainer.value;
    }
  }

  formatValueForDisplay(value, type) {
    if (type === "kvlist") {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) return "Not configured";
      // non-empty handled via kv preview to avoid [object Object]
      return this.#kvPreviewHTML(arr);
    }
    if (type === "string-list") {
      const arr = Array.isArray(value) ? value : [];
      return this.#stringListPreviewHTML(arr);
    }
    if (type === "json") {
      return this.#jsonPreviewHTML(value);
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
    if (!pairs || pairs.length === 0) return "Not configured";
    const esc = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
    return `
      <table class="kvlist-table">
        <tbody>
          ${pairs
            .map(
              (p) => `
            <tr>
              <td class="kvlist-key">${esc(p.key)}</td>
              <td class="kvlist-value">${esc(p.value)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  #stringListPreviewHTML(values) {
    if (!values || values.length === 0) return "Not configured";
    const esc = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
    return `
      <div class="string-list-preview">
        ${values.map((value) => `<span class="string-list-chip">${esc(value)}</span>`).join("")}
      </div>
    `;
  }

  #jsonPreviewHTML(value) {
    if (value === undefined || value === null || value === "") return "—";
    const esc = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
    let text = String(value);
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch (_) {}
    const compact = text.length > 360 ? `${text.slice(0, 360)}…` : text;
    return `<pre class="json-setting-preview">${esc(compact)}</pre>`;
  }

  isSidecarUnavailableError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return error?.name === "TypeError" || message.includes("fetch") || message.includes("sidecar");
  }

  deactivate() {
    for (const dispose of this.syncDisposers || []) dispose();
    this.syncDisposers = [];
    for (const dispose of this.settingDisposers) dispose();
    this.settingDisposers.clear();
    this.container = null;
    this.categoriesRoot = null;
    this.searchInput = null;
    this.searchStatus = null;
    this.searchEmpty = null;
    this.settingsSearch = null;
    this.currentConfig = null;
    this._runtimeRetrySettings = false;
  }
}

export { SettingsPage };
