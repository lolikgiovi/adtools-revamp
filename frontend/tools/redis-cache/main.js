import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { cleanAnalyticsMeta } from "../../core/AnalyticsMeta.js";
import { getIconSvg } from "./icon.js";
import {
  chunkRedisKeys,
  normalizeRedisPattern,
  normalizeRedisValueQuery,
  readFavorites,
  readRedisConfig,
  RedisCacheService,
  writeFavorites,
} from "./service.js";
import { RedisCacheTemplate } from "./template.js";
import "./styles.css";

const SETTINGS_FOCUS_STORAGE_KEY = "settings.focus";
const REDIS_RESULTS_PAGE_SIZE = 10;
const REDIS_SCAN_COUNT = 100;
const REDIS_MAX_PAGE_SCAN_REQUESTS = 25;

export function formatRedisValue(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch (_) {
      return { text: value, isJson: false };
    }
  }
  try {
    return { text: JSON.stringify(value, null, 2), isJson: true };
  } catch (_) {
    return { text: String(value ?? ""), isJson: false };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function highlightJson(json) {
  const source = String(json ?? "");
  const tokenPattern = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;
  let output = "";
  let lastIndex = 0;
  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    output += escapeHtml(source.slice(lastIndex, index));
    const afterToken = source.slice(index + token.length);
    const tokenClass = token.startsWith('"')
      ? /^\s*:/.test(afterToken)
        ? "redis-json-key"
        : "redis-json-string"
      : token === "true" || token === "false"
        ? "redis-json-boolean"
        : token === "null"
          ? "redis-json-null"
          : "redis-json-number";
    output += `<span class="${tokenClass}">${escapeHtml(token)}</span>`;
    lastIndex = index + token.length;
  }
  return output + escapeHtml(source.slice(lastIndex));
}

function formatRedisBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "Memory unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRedisTtl(value) {
  const ttl = Number(value);
  if (ttl === -1) return "No expiry";
  if (ttl === -2) return "Expired";
  if (!Number.isFinite(ttl) || ttl < 0) return "TTL unavailable";
  if (ttl < 60) return `${ttl}s TTL`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m TTL`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h TTL`;
  return `${Math.floor(ttl / 86400)}d TTL`;
}

export class RedisCacheTool extends BaseTool {
  constructor(eventBus, service = new RedisCacheService()) {
    super({ id: "redis-cache", eventBus });
    this.service = service;
    this.config = null;
    this.favorites = [];
    this.keys = [];
    this.resultPages = [];
    this.currentPage = 1;
    this.pendingKeys = [];
    this.seenKeys = new Set();
    this.selectedKeys = new Set();
    this.cursor = 0;
    this.scanComplete = false;
    this.pageScanLimitReached = false;
    this.activePattern = "";
    this.activeValueQuery = "";
    this.activeSearchMode = "keys";
    this.activeSearchTab = "keys";
    this.valueSearchInspected = 0;
    this.valueSearchTruncatedValues = 0;
    this.valueSearchUnsupportedValues = 0;
    this.pendingDeleteKeys = [];
    this.deleteTrigger = null;
    this.valueInspectorKey = "";
    this.valueInspectorTrigger = null;
    this.connectionDiagnosticStage = null;
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
    this.setActiveSearchTab("keys");
    this.renderConnection();
    this.renderFavorites();
    this.renderResults();
    this.container.querySelector("#redisPatternInput")?.focus();
  }

  bindEvents() {
    this.container.querySelector("#redisSearchTabs")?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-search-tab]");
      if (!tab || this.busy) return;
      this.setActiveSearchTab(tab.dataset.searchTab);
    });
    this.container.querySelector("#redisSearchTabs")?.addEventListener("keydown", (event) => {
      const tabs = [...this.container.querySelectorAll("[data-search-tab]")];
      const currentIndex = tabs.indexOf(event.target.closest("[data-search-tab]"));
      if (currentIndex < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      this.setActiveSearchTab(nextTab.dataset.searchTab, { focus: true });
    });
    this.container.querySelector("#redisKeySearchForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.search({ reset: true, mode: "keys" });
    });
    this.container.querySelector("#redisValueSearchForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.search({ reset: true, mode: "values" });
    });
    this.container.querySelector("#redisPagination")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-redis-page]");
      if (!button || button.disabled) return;
      const pageValue = button.dataset.redisPage;
      const targetPage = pageValue === "previous" ? this.currentPage - 1 : pageValue === "next" ? this.currentPage + 1 : Number(pageValue);
      this.goToPage(targetPage);
    });
    this.container.querySelector("#redisTestConnection")?.addEventListener("click", () => this.testConnection());
    this.container.querySelector("#redisDismissDiagnostics")?.addEventListener("click", () => this.dismissConnectionDiagnostics());
    this.container.querySelector("#redisOpenSettings")?.addEventListener("click", () => this.openSettings());
    this.container.querySelector("#redisCloseInspector")?.addEventListener("click", () => this.closeValueInspector());
    this.container.querySelector("#redisValueInspector")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.busy) {
        event.preventDefault();
        this.closeValueInspector();
      }
    });
    this.container.querySelector("#redisSelectAll")?.addEventListener("click", () => this.toggleSelectAll());
    this.container.querySelector("#redisClearSelected")?.addEventListener("click", () => this.requestDelete([...this.selectedKeys]));
    this.container.querySelector("#redisCancelDelete")?.addEventListener("click", () => this.closeDeleteConfirmation());
    this.container.querySelector("#redisConfirmDelete")?.addEventListener("click", () => this.confirmDelete());
    this.container.querySelector("#redisDeleteConfirmation")?.addEventListener("keydown", (event) => {
      const confirmation = event.currentTarget;
      if (event.key === "Escape" && !this.busy) {
        event.preventDefault();
        this.closeDeleteConfirmation();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...confirmation.querySelectorAll("button:not(:disabled)")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    this.container.querySelector("#redisDeleteConfirmation")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget && !this.busy) this.closeDeleteConfirmation();
    });
    this.container.querySelector("#redisResults")?.addEventListener("click", (event) => this.handleResultAction(event));
    this.container.querySelector("#redisResults")?.addEventListener("change", (event) => this.handleResultSelection(event));
    this.container.querySelector("#redisFavoritesList")?.addEventListener("click", (event) => this.handleFavoriteAction(event));
  }

  setActiveSearchTab(mode, { focus = false } = {}) {
    const activeMode = mode === "values" ? "values" : "keys";
    this.activeSearchTab = activeMode;
    this.container.querySelectorAll("[data-search-tab]").forEach((tab) => {
      const selected = tab.dataset.searchTab === activeMode;
      tab.setAttribute("aria-selected", String(selected));
      tab.classList.toggle("active", selected);
      tab.tabIndex = selected ? 0 : -1;
      if (focus && selected) tab.focus();
    });
    this.container.querySelector("#redisKeySearchPanel")?.toggleAttribute("hidden", activeMode !== "keys");
    this.container.querySelector("#redisValueSearchPanel")?.toggleAttribute("hidden", activeMode !== "values");
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
      this.renderConnectionDiagnostics(result);
      this.setMessage(result?.message || "Connection test failed", result?.ok ? "success" : "error");
    } catch (error) {
      if (dot) dot.dataset.state = "error";
      const detail = this.errorMessage(error);
      this.renderConnectionDiagnostics({
        ok: false,
        message: "Connection test failed",
        stage: "unknown",
        endpoint: this.connectionEndpoint(),
        detail,
        hint: "Check the Redis settings and the native desktop connection bridge, then test again.",
      });
      this.setMessage(detail, "error");
    } finally {
      if (button) {
        button.textContent = original;
      }
      this.setBusy(false);
    }
  }

  renderConnectionDiagnostics(result = {}) {
    const root = this.container.querySelector("#redisConnectionDiagnostics");
    if (!root) return;
    const diagnostic = result || {};
    const ok = diagnostic.ok === true;
    const stage = String(diagnostic.stage || (ok ? "redis" : "unknown"));
    const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1);
    const detail = String(diagnostic.detail || "").trim();
    const hint = String(diagnostic.hint || "").trim();
    const latencyValue = diagnostic.latency_ms;
    const latency =
      latencyValue !== null && latencyValue !== undefined && Number.isFinite(Number(latencyValue))
        ? `${Number(latencyValue)} ms`
        : "Not reached";
    // Successful checks are already represented by the connection summary.
    // Keep the detailed panel available for failures without adding noise after a healthy test.
    root.hidden = ok;
    root.dataset.state = ok ? "success" : "error";
    this.connectionDiagnosticStage = stage;
    this.setText(
      "#redisConnectionDiagnosticSummary",
      ok ? "The configured endpoint accepted a Redis PING." : `The check stopped at the ${stage} stage.`,
    );
    this.setText("#redisDiagnosticStatus", diagnostic.message || (ok ? "Redis replied to PING" : "Connection test failed"));
    this.setText("#redisDiagnosticEndpoint", diagnostic.endpoint || this.connectionEndpoint());
    this.setText("#redisDiagnosticDatabase", String(this.config?.database ?? "—"));
    this.setText("#redisDiagnosticTransport", this.config?.tls ? "TLS (rediss://)" : "TCP (redis://)");
    this.setText("#redisDiagnosticStage", stageLabel);
    this.setText("#redisDiagnosticLatency", latency);
    this.setText("#redisDiagnosticDetail", detail);
    this.setText("#redisDiagnosticHint", hint);
    const statusDot = this.container.querySelector("#redisDiagnosticStatusDot");
    if (statusDot) statusDot.dataset.state = ok ? "ready" : "error";
    const detailBlock = this.container.querySelector("#redisDiagnosticDetailBlock");
    if (detailBlock) detailBlock.hidden = !detail;
    const hintElement = this.container.querySelector("#redisDiagnosticHint");
    if (hintElement) hintElement.hidden = !hint;
  }

  dismissConnectionDiagnostics() {
    const diagnostics = this.container.querySelector("#redisConnectionDiagnostics");
    if (diagnostics) diagnostics.hidden = true;
    this.container.querySelector("#redisTestConnection")?.focus();
  }

  connectionEndpoint() {
    const host = String(this.config?.host || "").trim();
    const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return host ? `${formattedHost}:${this.config.port}` : "Not configured";
  }

  setText(selector, value) {
    const element = this.container.querySelector(selector);
    if (element) element.textContent = String(value ?? "");
  }

  async search({ reset = true, mode = this.activeSearchMode } = {}) {
    if (this.busy || !this.requireConfiguration()) return;
    const input = this.container.querySelector("#redisPatternInput");
    const valueInput = this.container.querySelector("#redisValueQueryInput");
    const searchMode = reset ? mode : this.activeSearchMode;
    const valueQuery = reset && searchMode === "values" ? normalizeRedisValueQuery(valueInput?.value) : reset ? "" : this.activeValueQuery;
    const pattern = reset ? (searchMode === "values" ? "*" : normalizeRedisPattern(input?.value)) : this.activePattern;
    if (!pattern) {
      this.setMessage("Enter a key pattern or value text to search for.", "error");
      input?.focus();
      return;
    }
    if (searchMode === "values" && !valueQuery) {
      this.setMessage("Enter text to search for in Redis values.", "error");
      valueInput?.focus();
      return;
    }

    if (reset) {
      this.keys = [];
      this.resultPages = [];
      this.currentPage = 1;
      this.pendingKeys = [];
      this.seenKeys.clear();
      this.selectedKeys.clear();
      this.cursor = 0;
      this.scanComplete = false;
      this.pageScanLimitReached = false;
      this.activePattern = pattern;
      this.activeValueQuery = valueQuery;
      this.activeSearchMode = searchMode;
      this.setActiveSearchTab(searchMode);
      this.valueSearchInspected = 0;
      this.valueSearchTruncatedValues = 0;
      this.valueSearchUnsupportedValues = 0;
      this.closeValueInspector({ restoreFocus: false });
    }
    await this.loadResultPage(reset ? 1 : this.currentPage + 1, { reset, pattern });
  }

  async goToPage(pageNumber) {
    if (this.busy || !this.activePattern) return;
    const targetPage = Math.max(1, Math.floor(Number(pageNumber) || 1));
    const maxAvailablePage = this.resultPages.length + (this.hasUnloadedPage() ? 1 : 0);
    if (targetPage > maxAvailablePage) return;

    if (targetPage <= this.resultPages.length) {
      if (targetPage === this.currentPage) return;
      this.selectedKeys.clear();
      this.currentPage = targetPage;
      this.syncCurrentPage();
      this.renderResults();
      this.setMessage(`Showing page ${targetPage}.`, "neutral");
      return;
    }

    await this.loadResultPage(targetPage);
  }

  async loadResultPage(targetPage, { reset = false, pattern = this.activePattern } = {}) {
    this.setBusy(true, reset ? "Searching…" : "Scanning…");
    this.setMessage(
      this.activeSearchMode === "values"
        ? `Searching values across database ${this.config.database}`
        : `Scanning database ${this.config.database} with ${pattern}`,
      "neutral",
    );
    let scanRequests = 0;
    try {
      while (this.resultPages.length < targetPage && this.hasUnloadedPage()) {
        scanRequests += await this.scanNextResultPage(pattern);
      }
      if (!this.resultPages.length) await this.scanNextResultPage(pattern);
      this.currentPage = Math.min(targetPage, this.resultPages.length);
      this.syncCurrentPage();
      this.renderResults();
      const suffix = this.scanComplete
        ? "Scan complete."
        : this.pageScanLimitReached || scanRequests >= REDIS_MAX_PAGE_SCAN_REQUESTS
          ? "More keyspace remains; use the pagination controls to continue."
          : "More keyspace remains.";
      const valueSummary =
        this.activeSearchMode === "values"
          ? ` Inspected ${this.valueSearchInspected.toLocaleString()} keys${
              this.valueSearchTruncatedValues ? `; ${this.valueSearchTruncatedValues} large value${this.valueSearchTruncatedValues === 1 ? " was" : "s were"} sampled` : ""
            }.${this.valueSearchUnsupportedValues ? ` ${this.valueSearchUnsupportedValues} unsupported value type${this.valueSearchUnsupportedValues === 1 ? " was" : "s were"} skipped.` : ""}`
          : "";
      this.setMessage(
        `${this.keys.length.toLocaleString()} ${this.keys.length === 1 ? "key" : "keys"} on page ${this.currentPage}.${valueSummary} ${suffix}`,
        "success",
      );
      UsageTracker.trackToolUse(
        "redis-cache",
        "search",
        cleanAnalyticsMeta({
          result_count: this.keys.length,
          page: this.currentPage,
          mode: this.activeSearchMode,
          scan_complete: this.scanComplete,
        }),
      );
    } catch (error) {
      this.setMessage(this.errorMessage(error), "error");
      this.renderResults();
    } finally {
      this.setBusy(false);
    }
  }

  async scanNextResultPage(pattern) {
    const pageKeys = [];
    let scanRequests = 0;
    while (
      pageKeys.length < REDIS_RESULTS_PAGE_SIZE &&
      (this.pendingKeys.length > 0 || !this.scanComplete) &&
      scanRequests < REDIS_MAX_PAGE_SCAN_REQUESTS
    ) {
      while (this.pendingKeys.length && pageKeys.length < REDIS_RESULTS_PAGE_SIZE) {
        pageKeys.push(this.pendingKeys.shift());
      }
      if (pageKeys.length >= REDIS_RESULTS_PAGE_SIZE || this.scanComplete) break;

      const result =
        this.activeSearchMode === "values"
          ? await this.service.searchValues(this.config, pattern, this.activeValueQuery, this.cursor, REDIS_RESULTS_PAGE_SIZE)
          : await this.service.scan(this.config, pattern, this.cursor, REDIS_SCAN_COUNT);
      const incoming = Array.isArray(result?.keys) ? result.keys.map(String) : [];
      if (this.activeSearchMode === "values") {
        this.valueSearchInspected += Number(result?.inspected) || 0;
        this.valueSearchTruncatedValues += Number(result?.truncated_values) || 0;
        this.valueSearchUnsupportedValues += Number(result?.unsupported_values) || 0;
      }
      incoming.forEach((key) => {
        if (this.seenKeys.has(key)) return;
        this.seenKeys.add(key);
        this.pendingKeys.push(key);
      });
      this.cursor = Number(result?.cursor) || 0;
      this.scanComplete = this.cursor === 0;
      scanRequests += 1;
    }

    while (this.pendingKeys.length && pageKeys.length < REDIS_RESULTS_PAGE_SIZE) {
      pageKeys.push(this.pendingKeys.shift());
    }
    this.pageScanLimitReached =
      scanRequests >= REDIS_MAX_PAGE_SCAN_REQUESTS && !this.scanComplete && pageKeys.length < REDIS_RESULTS_PAGE_SIZE;
    this.resultPages.push(pageKeys);
    return scanRequests;
  }

  syncCurrentPage() {
    this.keys = this.resultPages[this.currentPage - 1]?.slice?.() || [];
  }

  hasUnloadedPage() {
    return this.pendingKeys.length > 0 || !this.scanComplete;
  }

  renderResults() {
    const root = this.container.querySelector("#redisResults");
    const count = this.container.querySelector("#redisResultsCount");
    const pattern = this.container.querySelector("#redisAppliedPattern");
    if (!root) return;
    if (count)
      count.textContent = this.keys.length
        ? `${this.keys.length.toLocaleString()} ${this.keys.length === 1 ? "key" : "keys"}`
        : "No results";
    if (pattern) {
      pattern.textContent =
        this.activeSearchMode === "values" && this.activeValueQuery
          ? `Value: ${this.activeValueQuery} · all keys`
          : this.activePattern
            ? `Pattern: ${this.activePattern}`
            : "";
    }

    root.replaceChildren();
    if (!this.keys.length) {
      const empty = document.createElement("div");
      empty.className = "redis-empty-state";
      empty.innerHTML = this.activePattern
        ? `<h3>${this.activeSearchMode === "values" ? "No matching values" : "No keys in this page"}</h3><p>${this.hasUnloadedPage() ? "Use the pagination controls to continue through the keyspace." : this.activeSearchMode === "values" ? "Try different text or confirm the database number." : "Try a broader pattern or confirm the database number."}</p>`
        : `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="13" rx="15" ry="6"></ellipse><path d="M9 13v10c0 3.3 6.7 6 15 6s15-2.7 15-6V13"></path><path d="M9 23v10c0 3.3 6.7 6 15 6 4.1 0 7.8-.7 10.5-1.9"></path><path d="m36 33 6 6m0-6-6 6"></path></svg><h3>Search the keyspace</h3><p>Results appear here in bounded pages. No values are fetched.</p>`;
      root.appendChild(empty);
      this.renderPagination();
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
    this.renderPagination();
    this.updateActionState();
  }

  renderPagination() {
    const root = this.container.querySelector("#redisPagination");
    if (!root) return;
    root.replaceChildren();
    const pageCount = this.resultPages.length;
    const hasNextPage = pageCount > 0 && (this.currentPage < pageCount || this.hasUnloadedPage());
    root.hidden = !this.activePattern || pageCount === 0 || !(pageCount > 1 || hasNextPage);
    if (root.hidden) return;

    const summary = document.createElement("span");
    summary.className = "redis-pagination-summary";
    summary.id = "redisPaginationSummary";
    summary.textContent = `Page ${this.currentPage} of ${this.hasUnloadedPage() ? `${pageCount}+` : pageCount}`;

    const controls = document.createElement("div");
    controls.className = "redis-pagination-controls";
    controls.appendChild(this.createPaginationButton("Previous", "previous", this.currentPage <= 1));

    const pages = this.getPaginationPages(pageCount);
    pages.forEach((page, index) => {
      if (index > 0 && page - pages[index - 1] > 1) {
        const ellipsis = document.createElement("span");
        ellipsis.className = "redis-pagination-ellipsis";
        ellipsis.setAttribute("aria-hidden", "true");
        ellipsis.textContent = "…";
        controls.appendChild(ellipsis);
      }
      controls.appendChild(this.createPaginationButton(String(page), String(page), false, page === this.currentPage));
    });

    controls.appendChild(this.createPaginationButton("Next", "next", !hasNextPage));
    root.append(summary, controls);
  }

  getPaginationPages(pageCount) {
    return [...new Set([1, pageCount, this.currentPage - 1, this.currentPage, this.currentPage + 1])]
      .filter((page) => page >= 1 && page <= pageCount)
      .sort((left, right) => left - right);
  }

  createPaginationButton(label, page, disabled = false, current = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-ghost btn-sm redis-pagination-button${current ? " redis-pagination-page-current" : ""}`;
    button.dataset.redisPage = page;
    button.disabled = disabled || this.busy;
    button.textContent = label;
    button.setAttribute("aria-label", page === "previous" || page === "next" ? `${label} page` : `Page ${page}`);
    if (current) button.setAttribute("aria-current", "page");
    return button;
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
    const view = document.createElement("button");
    view.type = "button";
    view.className = "redis-icon-button";
    view.dataset.action = "view";
    view.title = "View value";
    view.setAttribute("aria-label", `View value for ${key}`);
    view.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>`;
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
    clear.title = `Clear ${key}`;
    clear.setAttribute("aria-label", `Clear ${key}`);
    clear.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="m9 7 .7-3h4.6l.7 3"></path><path d="m6 7 1 13h10l1-13"></path><path d="M10 11v5m4-5v5"></path></svg>`;
    actions.append(view, favorite, clear);
    row.append(selectCell, keyCell, actions);
    return row;
  }

  async viewValue(key) {
    if (this.busy || !this.requireConfiguration()) return;
    this.valueInspectorKey = key;
    this.valueInspectorTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.renderValueInspector({ key, loading: true });
    this.setBusy(true, "Loading value…");
    try {
      const result = await this.service.getValue(this.config, key);
      if (this.valueInspectorKey !== key) return;
      this.renderValueInspector(result);
      UsageTracker.trackToolUse("redis-cache", "view", cleanAnalyticsMeta({ type: result?.kind || "unknown" }));
    } catch (error) {
      if (this.valueInspectorKey === key) this.renderValueInspector({ key, error: this.errorMessage(error) });
    } finally {
      this.setBusy(false);
      this.container.querySelector("#redisCloseInspector")?.focus();
    }
  }

  renderValueInspector(result = {}) {
    const root = this.container.querySelector("#redisValueInspector");
    const keyElement = this.container.querySelector("#redisValueInspectorKey");
    const metaElement = this.container.querySelector("#redisValueInspectorMeta");
    const notice = this.container.querySelector("#redisValueInspectorNotice");
    const content = this.container.querySelector("#redisValueContent");
    if (!root || !content) return;

    root.hidden = false;
    root.dataset.state = result.loading ? "loading" : result.error ? "error" : "ready";
    if (keyElement) keyElement.textContent = result.key || "";
    if (metaElement) {
      const metadata = result.loading || result.error
        ? ""
        : [
            result.kind || "unknown type",
            formatRedisTtl(result.ttl_seconds),
            result.memory_bytes === null || result.memory_bytes === undefined ? "Memory unavailable" : formatRedisBytes(result.memory_bytes),
          ].join(" · ");
      metaElement.textContent = metadata;
    }
    if (notice) {
      notice.hidden = true;
      notice.textContent = "";
    }
    content.className = "redis-value-content";
    content.textContent = "";

    if (result.loading) {
      content.textContent = "Reading this value…";
      return;
    }
    if (result.error) {
      content.textContent = result.error;
      return;
    }
    if (result.supported === false) {
      content.textContent = `Redis type “${result.kind || "unknown"}” is not supported for inspection yet.`;
      return;
    }

    const formatted = formatRedisValue(result.value);
    content.classList.add(formatted.isJson ? "redis-json-content" : "redis-raw-content");
    if (formatted.isJson) content.innerHTML = highlightJson(formatted.text);
    else content.textContent = formatted.text;
    if (result.truncated && notice) {
      notice.hidden = false;
      notice.textContent = "This value is larger than the safe preview limit and has been truncated. Search and mutation remain separate from this view.";
    }
  }

  closeValueInspector({ restoreFocus = true } = {}) {
    const root = this.container.querySelector("#redisValueInspector");
    if (root) root.hidden = true;
    this.valueInspectorKey = "";
    if (restoreFocus) {
      const target = this.valueInspectorTrigger?.isConnected ? this.valueInspectorTrigger : this.container.querySelector("#redisPatternInput");
      this.valueInspectorTrigger = null;
      target?.focus();
    } else this.valueInspectorTrigger = null;
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
    if (button.dataset.action === "view") this.viewValue(key);
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
    if (this.valueInspectorKey && clearedKeys.has(this.valueInspectorKey)) this.closeValueInspector({ restoreFocus: false });
    this.keys = this.keys.filter((key) => !clearedKeys.has(key));
    const currentPage = this.resultPages[this.currentPage - 1];
    if (currentPage) currentPage.splice(0, currentPage.length, ...this.keys);
    clearedKeys.forEach((key) => this.selectedKeys.delete(key));
  }

  setBusy(busy, label = "Find keys") {
    this.busy = busy;
    const search = this.container.querySelector("#redisSearchButton");
    const valueSearch = this.container.querySelector("#redisValueSearchButton");
    const testConnection = this.container.querySelector("#redisTestConnection");
    if (search) {
      search.disabled = busy || !this.config?.host;
      search.textContent = busy ? label : "Find keys";
    }
    if (valueSearch) {
      valueSearch.disabled = busy || !this.config?.host;
      valueSearch.textContent = busy ? label : "Search values";
    }
    if (testConnection) testConnection.disabled = busy || !this.config?.host;
    const cancelDelete = this.container.querySelector("#redisCancelDelete");
    if (cancelDelete) cancelDelete.disabled = busy;
    const closeInspector = this.container.querySelector("#redisCloseInspector");
    if (closeInspector) closeInspector.disabled = busy;
    this.container.querySelectorAll("[data-search-tab]").forEach((tab) => {
      tab.disabled = busy;
    });
    this.container.querySelectorAll("#redisResults [data-action]").forEach((button) => {
      button.disabled = busy;
    });
    this.container.querySelector(".redis-cache-tool")?.setAttribute("aria-busy", String(busy));
    this.updateActionState();
  }

  updateActionState() {
    const configured = Boolean(this.config?.host);
    const search = this.container.querySelector("#redisSearchButton");
    const valueSearch = this.container.querySelector("#redisValueSearchButton");
    const selectAll = this.container.querySelector("#redisSelectAll");
    const clearSelected = this.container.querySelector("#redisClearSelected");
    if (search) search.disabled = this.busy || !configured;
    if (valueSearch) valueSearch.disabled = this.busy || !configured;
    this.container.querySelectorAll("[data-search-tab]").forEach((tab) => {
      tab.disabled = this.busy;
    });
    const pagination = this.container.querySelector("#redisPagination");
    const hasNextPage = this.currentPage < this.resultPages.length || this.hasUnloadedPage();
    pagination?.querySelector('[data-redis-page="previous"]')?.toggleAttribute("disabled", this.busy || this.currentPage <= 1);
    pagination?.querySelector('[data-redis-page="next"]')?.toggleAttribute("disabled", this.busy || !hasNextPage);
    pagination?.querySelectorAll('[data-redis-page]:not([data-redis-page="previous"]):not([data-redis-page="next"])').forEach((button) => {
      button.disabled = this.busy;
    });
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
      const focusKey = this.connectionDiagnosticStage === "database" ? "config.redis.database" : "config.redis.host";
      localStorage.setItem(SETTINGS_FOCUS_STORAGE_KEY, focusKey);
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
