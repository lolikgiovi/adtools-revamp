import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { cleanAnalyticsMeta } from "../../core/AnalyticsMeta.js";
import { getIconSvg } from "./icon.js";
import { chunkRedisKeys, normalizeRedisPattern, readFavorites, readRedisConfig, RedisCacheService, writeFavorites } from "./service.js";
import { RedisCacheTemplate } from "./template.js";
import "./styles.css";

const SETTINGS_FOCUS_STORAGE_KEY = "settings.focus";

export class RedisCacheTool extends BaseTool {
  constructor(eventBus, service = new RedisCacheService()) {
    super({ id: "redis-cache", eventBus });
    this.service = service;
    this.config = null;
    this.favorites = [];
    this.keys = [];
    this.selectedKeys = new Set();
    this.cursor = 0;
    this.activePattern = "";
    this.pendingDeleteKeys = [];
    this.deleteTrigger = null;
    this.busy = false;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return RedisCacheTemplate;
  }

  onMount() {
    this.config = readRedisConfig();
    this.favorites = readFavorites();
    this.bindEvents();
    this.renderConnection();
    this.renderFavorites();
    this.renderResults();
    this.container.querySelector("#redisPatternInput")?.focus();
  }

  bindEvents() {
    this.container.querySelector("#redisSearchForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.search({ reset: true });
    });
    this.container.querySelector("#redisLoadMore")?.addEventListener("click", () => this.search({ reset: false }));
    this.container.querySelector("#redisTestConnection")?.addEventListener("click", () => this.testConnection());
    this.container.querySelector("#redisOpenSettings")?.addEventListener("click", () => this.openSettings());
    this.container.querySelector("#redisSelectAll")?.addEventListener("click", () => this.toggleSelectAll());
    this.container.querySelector("#redisClearSelected")?.addEventListener("click", () => this.requestDelete([...this.selectedKeys]));
    this.container.querySelector("#redisCancelDelete")?.addEventListener("click", () => this.closeDeleteConfirmation());
    this.container.querySelector("#redisConfirmDelete")?.addEventListener("click", () => this.confirmDelete());
    this.container.querySelector("#redisDeleteConfirmation")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeDeleteConfirmation();
      }
    });
    this.container.querySelector("#redisResults")?.addEventListener("click", (event) => this.handleResultAction(event));
    this.container.querySelector("#redisResults")?.addEventListener("change", (event) => this.handleResultSelection(event));
    this.container.querySelector("#redisFavoritesList")?.addEventListener("click", (event) => this.handleFavoriteAction(event));
  }

  renderConnection() {
    const label = this.container.querySelector("#redisConnectionLabel");
    const detail = this.container.querySelector("#redisConnectionDetail");
    const testButton = this.container.querySelector("#redisTestConnection");
    const dot = this.container.querySelector(".redis-status-dot");
    const configured = Boolean(this.config?.host);
    if (label) label.textContent = configured ? `${this.config.host}:${this.config.port}` : "Not configured";
    if (detail)
      detail.textContent = configured
        ? `Database ${this.config.database}${this.config.tls ? " · TLS" : ""}`
        : "Add the Redis connection in Settings.";
    if (testButton) testButton.disabled = !configured || this.busy;
    if (dot) dot.dataset.state = configured ? "idle" : "missing";
    this.updateActionState();
  }

  async testConnection() {
    if (this.busy || !this.requireConfiguration()) return;
    const button = this.container.querySelector("#redisTestConnection");
    const dot = this.container.querySelector(".redis-status-dot");
    const original = button?.textContent || "Test";
    if (button) {
      button.textContent = "Testing…";
    }
    this.setBusy(true);
    if (dot) dot.dataset.state = "checking";
    try {
      const result = await this.service.testConnection(this.config);
      if (dot) dot.dataset.state = result?.ok ? "ready" : "error";
      this.setMessage(result?.message || "Connection successful", result?.ok ? "success" : "error");
    } catch (error) {
      if (dot) dot.dataset.state = "error";
      this.setMessage(this.errorMessage(error), "error");
    } finally {
      if (button) {
        button.textContent = original;
      }
      this.setBusy(false);
    }
  }

  async search({ reset }) {
    if (this.busy || !this.requireConfiguration()) return;
    const input = this.container.querySelector("#redisPatternInput");
    const pattern = reset ? normalizeRedisPattern(input?.value) : this.activePattern;
    if (!pattern) {
      this.setMessage("Enter a key or wildcard pattern to search.", "error");
      input?.focus();
      return;
    }

    if (reset) {
      this.keys = [];
      this.selectedKeys.clear();
      this.cursor = 0;
      this.activePattern = pattern;
    }
    this.setBusy(true, reset ? "Searching…" : "Scanning…");
    this.setMessage(`Scanning database ${this.config.database} with ${pattern}`, "neutral");
    try {
      const result = await this.service.scan(this.config, pattern, this.cursor, 100);
      const incoming = Array.isArray(result?.keys) ? result.keys.map(String) : [];
      this.keys = [...new Set([...this.keys, ...incoming])];
      this.cursor = Number(result?.cursor) || 0;
      this.renderResults();
      const suffix = this.cursor === 0 ? "Scan complete." : "More keyspace remains.";
      this.setMessage(`${this.keys.length.toLocaleString()} unique ${this.keys.length === 1 ? "key" : "keys"} found. ${suffix}`, "success");
      UsageTracker.trackToolUse(
        "redis-cache",
        "search",
        cleanAnalyticsMeta({ result_count: this.keys.length, scan_complete: this.cursor === 0 }),
      );
    } catch (error) {
      this.setMessage(this.errorMessage(error), "error");
      this.renderResults();
    } finally {
      this.setBusy(false);
    }
  }

  renderResults() {
    const root = this.container.querySelector("#redisResults");
    const count = this.container.querySelector("#redisResultsCount");
    const pattern = this.container.querySelector("#redisAppliedPattern");
    const loadMore = this.container.querySelector("#redisLoadMore");
    if (!root) return;
    if (count)
      count.textContent = this.keys.length
        ? `${this.keys.length.toLocaleString()} ${this.keys.length === 1 ? "key" : "keys"}`
        : "No results";
    if (pattern) pattern.textContent = this.activePattern ? `Pattern: ${this.activePattern}` : "";
    if (loadMore) loadMore.hidden = !this.activePattern || this.cursor === 0;

    root.replaceChildren();
    if (!this.keys.length) {
      const empty = document.createElement("div");
      empty.className = "redis-empty-state";
      empty.innerHTML = this.activePattern
        ? `<h3>No keys in this page</h3><p>${this.cursor ? "Scan the next page to continue through the keyspace." : "Try a broader pattern or confirm the database number."}</p>`
        : `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="13" rx="15" ry="6"></ellipse><path d="M9 13v10c0 3.3 6.7 6 15 6s15-2.7 15-6V13"></path><path d="M9 23v10c0 3.3 6.7 6 15 6 4.1 0 7.8-.7 10.5-1.9"></path><path d="m36 33 6 6m0-6-6 6"></path></svg><h3>Search the keyspace</h3><p>Results appear here in bounded pages. No values are fetched.</p>`;
      root.appendChild(empty);
      this.updateActionState();
      return;
    }

    const table = document.createElement("table");
    table.className = "redis-key-table";
    table.innerHTML = `<thead><tr><th class="redis-select-column"><span class="sr-only">Select</span></th><th>Key</th><th class="redis-row-actions-heading">Actions</th></tr></thead>`;
    const body = document.createElement("tbody");
    this.keys.forEach((key) => body.appendChild(this.createKeyRow(key)));
    table.appendChild(body);
    root.appendChild(table);
    this.updateActionState();
  }

  createKeyRow(key) {
    const row = document.createElement("tr");
    row.dataset.key = key;
    const selectCell = document.createElement("td");
    const selectTarget = document.createElement("label");
    selectTarget.className = "redis-key-select-target";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "redis-key-select";
    checkbox.checked = this.selectedKeys.has(key);
    checkbox.setAttribute("aria-label", `Select ${key}`);
    selectTarget.appendChild(checkbox);
    selectCell.appendChild(selectTarget);

    const keyCell = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = key;
    code.title = key;
    keyCell.appendChild(code);

    const actions = document.createElement("td");
    actions.className = "redis-row-actions";
    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.className = "redis-icon-button";
    favorite.dataset.action = "favorite";
    favorite.setAttribute("aria-label", this.favorites.includes(key) ? `Remove ${key} from favorites` : `Save ${key} as favorite`);
    favorite.setAttribute("aria-pressed", String(this.favorites.includes(key)));
    favorite.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path></svg>`;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "redis-icon-button redis-icon-button-danger";
    clear.dataset.action = "clear";
    clear.setAttribute("aria-label", `Clear ${key}`);
    clear.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="m9 7 .7-3h4.6l.7 3"></path><path d="m6 7 1 13h10l1-13"></path><path d="M10 11v5m4-5v5"></path></svg>`;
    actions.append(favorite, clear);
    row.append(selectCell, keyCell, actions);
    return row;
  }

  handleResultSelection(event) {
    const checkbox = event.target.closest(".redis-key-select");
    if (!checkbox) return;
    const key = checkbox.closest("tr")?.dataset.key;
    if (!key) return;
    checkbox.checked ? this.selectedKeys.add(key) : this.selectedKeys.delete(key);
    this.updateActionState();
  }

  handleResultAction(event) {
    const button = event.target.closest("[data-action]");
    const key = button?.closest("tr")?.dataset.key;
    if (!button || !key) return;
    if (button.dataset.action === "favorite") this.toggleFavorite(key);
    if (button.dataset.action === "clear") this.requestDelete([key]);
  }

  toggleSelectAll() {
    const allSelected = this.keys.length > 0 && this.keys.every((key) => this.selectedKeys.has(key));
    this.selectedKeys = allSelected ? new Set() : new Set(this.keys);
    this.renderResults();
  }

  toggleFavorite(key) {
    this.favorites = this.favorites.includes(key) ? this.favorites.filter((favorite) => favorite !== key) : [key, ...this.favorites];
    this.favorites = writeFavorites(this.favorites);
    this.renderFavorites();
    this.renderResults();
  }

  renderFavorites() {
    const root = this.container.querySelector("#redisFavoritesList");
    const count = this.container.querySelector("#redisFavoritesCount");
    if (!root) return;
    if (count) count.textContent = this.favorites.length.toLocaleString();
    root.replaceChildren();
    if (!this.favorites.length) {
      const empty = document.createElement("div");
      empty.className = "redis-favorites-empty";
      empty.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path></svg><p>Save a result to make repeat clears faster.</p>`;
      root.appendChild(empty);
      return;
    }
    this.favorites.forEach((key) => {
      const item = document.createElement("div");
      item.className = "redis-favorite-item";
      item.dataset.key = key;
      const value = document.createElement("code");
      value.textContent = key;
      value.title = key;
      const actions = document.createElement("div");
      actions.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-favorite-action="remove">Remove</button><button type="button" class="btn btn-danger btn-sm" data-favorite-action="clear">Clear</button>`;
      item.append(value, actions);
      root.appendChild(item);
    });
  }

  handleFavoriteAction(event) {
    const button = event.target.closest("[data-favorite-action]");
    const key = button?.closest(".redis-favorite-item")?.dataset.key;
    if (!button || !key) return;
    if (button.dataset.favoriteAction === "remove") this.toggleFavorite(key);
    if (button.dataset.favoriteAction === "clear") this.requestDelete([key]);
  }

  requestDelete(keys) {
    if (this.busy || !this.requireConfiguration()) return;
    this.pendingDeleteKeys = [...new Set(keys.map(String).filter(Boolean))];
    if (!this.pendingDeleteKeys.length) return;
    this.deleteTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const confirmation = this.container.querySelector("#redisDeleteConfirmation");
    const description = this.container.querySelector("#redisDeleteDescription");
    const confirmButton = this.container.querySelector("#redisConfirmDelete");
    const count = this.pendingDeleteKeys.length;
    if (description) {
      description.textContent = `${count} ${count === 1 ? "key" : "keys"} will be removed from ${this.config.host}:${this.config.port}, database ${this.config.database}. This cannot be undone.`;
    }
    if (confirmButton) confirmButton.textContent = `Clear ${count === 1 ? "key" : `${count} keys`}`;
    if (confirmation) confirmation.hidden = false;
    confirmButton?.focus();
  }

  closeDeleteConfirmation({ restoreFocus = true } = {}) {
    this.pendingDeleteKeys = [];
    const confirmation = this.container.querySelector("#redisDeleteConfirmation");
    if (confirmation) confirmation.hidden = true;
    if (restoreFocus) this.restoreDeleteFocus();
  }

  restoreDeleteFocus() {
    const target = this.deleteTrigger?.isConnected ? this.deleteTrigger : this.container.querySelector("#redisPatternInput");
    this.deleteTrigger = null;
    target?.focus();
  }

  async confirmDelete() {
    const keys = [...this.pendingDeleteKeys];
    if (!keys.length || this.busy) return;
    this.setBusy(true, "Clearing…");
    const confirmButton = this.container.querySelector("#redisConfirmDelete");
    if (confirmButton) confirmButton.disabled = true;
    const clearedKeys = new Set();
    let deleted = 0;
    let command = "UNLINK";
    try {
      for (const batch of chunkRedisKeys(keys)) {
        const result = await this.service.deleteKeys(this.config, batch);
        deleted += Number(result?.deleted) || 0;
        command = result?.command || command;
        batch.forEach((key) => clearedKeys.add(key));
      }
      this.removeClearedResults(clearedKeys);
      this.closeDeleteConfirmation({ restoreFocus: false });
      this.renderResults();
      this.restoreDeleteFocus();
      this.setMessage(`${deleted.toLocaleString()} ${deleted === 1 ? "key" : "keys"} cleared with ${command}.`, "success");
      UsageTracker.trackToolUse("redis-cache", "clear", cleanAnalyticsMeta({ requested_count: keys.length, deleted_count: deleted }));
    } catch (error) {
      this.removeClearedResults(clearedKeys);
      this.closeDeleteConfirmation({ restoreFocus: false });
      this.renderResults();
      this.restoreDeleteFocus();
      if (clearedKeys.size) {
        UsageTracker.trackToolUse(
          "redis-cache",
          "clear",
          cleanAnalyticsMeta({ requested_count: keys.length, cleared_batch_count: clearedKeys.size, partial: true }),
        );
      }
      const prefix = clearedKeys.size ? `${clearedKeys.size.toLocaleString()} keys were processed before the operation stopped. ` : "";
      this.setMessage(`${prefix}${this.errorMessage(error)}`, "error");
    } finally {
      if (confirmButton) confirmButton.disabled = false;
      this.setBusy(false);
    }
  }

  removeClearedResults(clearedKeys) {
    if (!clearedKeys?.size) return;
    this.keys = this.keys.filter((key) => !clearedKeys.has(key));
    clearedKeys.forEach((key) => this.selectedKeys.delete(key));
  }

  setBusy(busy, label = "Find keys") {
    this.busy = busy;
    const search = this.container.querySelector("#redisSearchButton");
    const loadMore = this.container.querySelector("#redisLoadMore");
    const testConnection = this.container.querySelector("#redisTestConnection");
    if (search) {
      search.disabled = busy || !this.config?.host;
      search.textContent = busy ? label : "Find keys";
    }
    if (loadMore) loadMore.disabled = busy;
    if (testConnection) testConnection.disabled = busy || !this.config?.host;
    this.container.querySelector(".redis-cache-tool")?.setAttribute("aria-busy", String(busy));
    this.updateActionState();
  }

  updateActionState() {
    const configured = Boolean(this.config?.host);
    const search = this.container.querySelector("#redisSearchButton");
    const selectAll = this.container.querySelector("#redisSelectAll");
    const clearSelected = this.container.querySelector("#redisClearSelected");
    if (search) search.disabled = this.busy || !configured;
    if (selectAll) {
      selectAll.disabled = this.busy || !this.keys.length;
      selectAll.textContent = this.keys.length && this.keys.every((key) => this.selectedKeys.has(key)) ? "Clear selection" : "Select all";
    }
    if (clearSelected) {
      clearSelected.disabled = this.busy || !this.selectedKeys.size;
      clearSelected.textContent = this.selectedKeys.size ? `Clear selected (${this.selectedKeys.size})` : "Clear selected";
    }
  }

  setMessage(message, state = "neutral") {
    const element = this.container.querySelector("#redisSearchMessage");
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
  }

  requireConfiguration() {
    if (this.config?.host) return true;
    this.setMessage("Configure the Redis host in Settings before connecting.", "error");
    return false;
  }

  openSettings() {
    try {
      localStorage.setItem(SETTINGS_FOCUS_STORAGE_KEY, "config.redis.host");
    } catch (_) {
      // Navigation still works when local storage is unavailable.
    }
    if (window.app?.router?.navigate) window.app.router.navigate("settings");
    else this.eventBus?.emit?.("route:change", { path: "settings" });
  }

  errorMessage(error) {
    return String(error?.message || error || "Redis operation failed");
  }
}
