/**
 * Analytics Dashboard Page
 * Password-protected internal analytics viewer
 * Tabs are fetched dynamically from the API
 */
import { renderTrends, renderDeviceHealth } from "./analysis.js";
import { AnalyticsDashboardTemplate } from "./template.js";
import "./styles.css";

const API_BASE = String(import.meta.env.VITE_WORKER_BASE || (import.meta.env.DEV ? "http://localhost:8787" : "")).replace(/\/$/, "");
const TOKEN_KEY = "analytics.dashboard.token";
const PRIMARY_VIEWS = [
  { id: "overview", label: "Summary" },
  { id: "opportunities", label: "Tools" },
  { id: "who", label: "People" },
  { id: "trends", label: "Trends" },
  { id: "device-health", label: "Devices" },
  { id: "daily", label: "Activity" },
];
const RANGED_REPORTS = new Set([
  "trends",
  "overview",
  "opportunities",
  "who",
  "daily",
  "capability-adoption",
  "capability-people",
  "import-sources",
]);
const REPORT_GROUPS = [
  [
    "Usage & Adoption",
    [
      "overview",
      "trends",
      "opportunities",
      "who",
      "capability-adoption",
      "capability-people",
      "active-users",
      "tools",
      "tool-adoption",
      "daily",
    ],
  ],
  [
    "Reliability & Diagnostics",
    ["friction", "improvement-notes", "errors", "error-summary", "device-health", "versions", "devices", "events"],
  ],
  ["Quick Query", ["quick-query", "import-sources", "qq-table-usage", "quick-query-errors", "qq-insights", "qq-splits", "qq-outcomes"]],
  ["Compare Config", ["compare-config", "cc-table-pairs"]],
  ["Run Query", ["run-query", "run-query-summary"]],
  ["Run Batch", ["run-batch", "run-batch-summary"]],
  ["JSON Tools", ["json-tools", "json-tools-summary", "json-outcomes"]],
  ["Base64 Tools", ["base64-tools", "base64-summary"]],
  ["QR Tools", ["qr-tools", "qr-summary"]],
  ["TLV Viewer", ["tlv-viewer", "tlv-summary"]],
  ["Image Checker", ["image-checker", "image-checker-summary"]],
  ["HTML & Splunk", ["html-splunk", "template-editors-summary", "html-outcomes"]],
  ["UUID & SQL IN", ["uuid-sql", "uuid-sql-summary"]],
  ["Merge SQL", ["merge-sql", "merge-sql-summary"]],
  ["Master Lockey", ["master-lockey", "master-lockey-summary"]],
];

class AnalyticsDashboardPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.container = null;
    this.token = null;
    this.personDirectoryData = null;
    this.tabs = [];
    this.currentTab = null;
    this.cache = {};
    this.reportWarnings = {};
    this.filterText = "";
    this.selectedRange = "30d";
    this.currentWhoSection = "users";
    this.selectedPerson = null;
    this.lastRenderedData = [];
    this.dataRequestId = 0;
    this.dataAbortController = null;
    this.tabsRequestId = 0;
    this.authRequestId = 0;
    this.documentKeydownListener = null;
    this.sortColumn = null;
    this.sortDirection = "desc";
    this.pagination = {
      daily: { page: 0, pageSize: 100, hasMore: false, search: "", rows: [], loading: false },
      events: { page: 0, pageSize: 100, hasMore: false, search: "", rows: [], loading: false },
    };
  }

  mount(root) {
    if (!root) return;
    root.innerHTML = AnalyticsDashboardTemplate;
    this.container = root.querySelector(".analytics-dashboard");

    this.sessionActions = this.container.querySelector("[data-dashboard-session-actions]");

    // Check for existing token
    try {
      const stored = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
      if (stored) {
        const payload = JSON.parse(atob(stored));
        if (payload.exp && payload.exp > Date.now()) {
          this.token = stored;
          localStorage.setItem(TOKEN_KEY, stored);
          sessionStorage.removeItem(TOKEN_KEY);
          this.showDashboard();
          this.loadTabs();
        }
      }
    } catch (_) {}

    this.bindEvents();
  }

  bindEvents() {
    // Auth form
    const form = this.container.querySelector("#dashboard-auth-form");
    form?.addEventListener("submit", (e) => this.handleAuth(e));

    // Refresh
    this.container.querySelector("#dashboard-refresh")?.addEventListener("click", () => {
      this.cache = {};
      if (this.currentTab === "__reports") {
        this.showReportLibrary();
        return;
      }
      if (this.isPaginatedTab(this.currentTab)) this.resetPagination(this.currentTab, this.filterText);
      this.invalidateDataRequests();
      this.loadCurrentTabData();
    });

    this.container.querySelector("#dashboard-search")?.addEventListener("input", (e) => {
      this.filterText = e.target.value.trim().toLowerCase().slice(0, 120);
      const content = this.container.querySelector("#dashboard-panel .panel-content");
      if (this.isPaginatedTab(this.currentTab)) {
        this.resetPagination(this.currentTab, this.filterText);
        this.invalidateDataRequests();
        this.loadCurrentTabData();
      } else {
        this.renderTable(content, this.lastRenderedData);
      }
    });

    this.container.querySelector("#dashboard-range")?.addEventListener("change", (e) => {
      this.selectedRange = e.target.value || "30d";
      this.updateNavigation();
      delete this.cache[this.getCacheKey(this.currentTab)];
      this.invalidateDataRequests();
      this.loadCurrentTabData();
    });

    // Logout
    this.container.querySelector("#dashboard-logout")?.addEventListener("click", () => {
      this.logout();
    });

    // Row detail modal close
    this.container.querySelector("#row-detail-close")?.addEventListener("click", () => {
      this.closeRowDetail();
    });
    this.container.querySelector("#row-detail-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "row-detail-overlay") this.closeRowDetail();
    });
    // Escape to close
    if (this.documentKeydownListener) document.removeEventListener("keydown", this.documentKeydownListener);
    this.documentKeydownListener = (e) => {
      if (e.key === "Escape") this.closeRowDetail();
      const overlay = this.container?.querySelector("#row-detail-overlay");
      if (e.key === "Tab" && overlay && !overlay.hidden) {
        const controls = [...overlay.querySelectorAll('button, a[href], input, select, [tabindex="0"]')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if ((e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
      }
    };
    document.addEventListener("keydown", this.documentKeydownListener);
  }

  async handleAuth(e) {
    e.preventDefault();
    const passwordInput = this.container.querySelector("#dashboard-password");
    const errorEl = this.container.querySelector("#auth-error");
    const password = passwordInput?.value || "";
    const container = this.container;
    const authRequestId = ++this.authRequestId;

    errorEl.textContent = "";

    try {
      const res = await fetch(`${API_BASE}/dashboard/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (this.container !== container || authRequestId !== this.authRequestId) return;

      if (data.ok && data.token) {
        this.token = data.token;
        try {
          localStorage.setItem(TOKEN_KEY, data.token);
          sessionStorage.removeItem(TOKEN_KEY);
        } catch (_) {}
        this.showDashboard();
        this.loadTabs();
      } else {
        errorEl.textContent = data.error || "Invalid password";
        passwordInput.focus();
      }
    } catch (err) {
      if (this.container === container && authRequestId === this.authRequestId) {
        errorEl.textContent = "Connection error. Please try again.";
      }
    }
  }

  showDashboard() {
    if (!this.container) return;
    this.sessionActions.hidden = false;
    this.container.querySelector("#dashboard-auth").style.display = "none";
    this.container.querySelector("#dashboard-content").style.display = "flex";
  }

  logout() {
    this.sessionActions.hidden = true;
    this.invalidateDataRequests();
    this.tabsRequestId += 1;
    this.authRequestId += 1;
    this.token = null;
    this.personDirectoryData = null;
    this.tabs = [];
    this.currentTab = null;
    this.cache = {};
    this.filterText = "";
    this.selectedRange = "30d";
    this.currentWhoSection = "users";
    this.selectedPerson = null;
    this.lastRenderedData = [];
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
    Object.keys(this.pagination).forEach((tabId) => this.resetPagination(tabId));
    const authPanel = this.container?.querySelector("#dashboard-auth");
    const dashboardContent = this.container?.querySelector("#dashboard-content");
    if (authPanel) authPanel.style.display = "flex";
    if (dashboardContent) dashboardContent.style.display = "none";
    const passwordInput = this.container?.querySelector("#dashboard-password");
    if (passwordInput) passwordInput.value = "";
  }

  async loadTabs() {
    if (!this.container) return;
    const tabsContainer = this.container.querySelector("#dynamic-tabs");
    const sourceIndicator = this.container.querySelector("#config-source");
    if (!tabsContainer) return;
    const container = this.container;
    const tokenAtStart = this.token;
    const tabsRequestId = ++this.tabsRequestId;

    tabsContainer.innerHTML = '<span style="color: hsl(var(--muted-foreground)); font-size: 0.875rem;">Loading tabs...</span>';

    try {
      const res = await fetch(`${API_BASE}/dashboard/tabs`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      if (res.status === 401) {
        if (this.container === container && tabsRequestId === this.tabsRequestId && tokenAtStart === this.token) this.logout();
        return;
      }

      const data = await res.json();

      if (this.container !== container || tabsRequestId !== this.tabsRequestId || tokenAtStart !== this.token) return;

      if (data.ok && Array.isArray(data.tabs)) {
        this.tabs = data.tabs;
        this.configSource = data.source || "defaults";
        this.renderTabs();
        // Show source indicator
        if (sourceIndicator) {
          const label = this.configSource === "kv" ? "KV Config" : this.configSource === "kv+defaults" ? "KV + Defaults" : "Defaults";
          const sourceClass = this.configSource.replace(/[^a-z0-9-]/gi, "-");
          sourceIndicator.innerHTML = `<span class="config-source-badge ${sourceClass}">${label}</span>`;
        }
        // Auto-select first tab
        if (this.tabs.length > 0) {
          this.switchTab(this.tabs.some((tab) => tab.id === "overview") ? "overview" : this.tabs[0].id);
        }
      } else {
        tabsContainer.innerHTML = `<span style="color: hsl(var(--destructive));">${data.error || "Failed to load tabs"}</span>`;
      }
    } catch (err) {
      if (this.container === container && tabsRequestId === this.tabsRequestId && tokenAtStart === this.token) {
        tabsContainer.innerHTML = `<span style="color: hsl(var(--destructive));">Error: ${err.message}</span>`;
      }
    }
  }

  renderTabs() {
    const tabsContainer = this.container.querySelector("#dynamic-tabs");
    if (!tabsContainer) return;

    tabsContainer.setAttribute("aria-label", "Analytics views");
    tabsContainer.innerHTML =
      PRIMARY_VIEWS.filter((view) => this.tabs.some((tab) => tab.id === view.id))
        .map((view) => `<button type="button" class="tab-button" data-tab="${view.id}">${view.label}</button>`)
        .join("") + '<button type="button" class="tab-button" data-library>Detailed reports</button>';
    tabsContainer.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => this.switchTab(button.dataset.tab));
    });
    tabsContainer.querySelector("[data-library]").addEventListener("click", () => this.showReportLibrary());
    this.updateNavigation();
  }

  getReportGroups() {
    const known = new Set(REPORT_GROUPS.flatMap(([, ids]) => ids));
    return [
      ...REPORT_GROUPS.map(([name, ids]) => ({ name, tabs: this.tabs.filter((tab) => ids.includes(tab.id)) })),
      { name: "Custom Reports", tabs: this.tabs.filter((tab) => !known.has(tab.id)) },
    ].filter((group) => group.tabs.length);
  }

  updateNavigation() {
    if (!this.container) return;
    const library = this.currentTab === "__reports";
    const primary = PRIMARY_VIEWS.find((view) => view.id === this.currentTab);
    this.container.querySelectorAll("#dynamic-tabs button").forEach((button) => {
      const selected = button.dataset.library !== undefined ? !primary : button.dataset.tab === this.currentTab;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const title = this.container.querySelector("#dashboard-report-title");
    if (title)
      title.textContent = library
        ? "Report Library"
        : primary?.label || this.tabs.find((tab) => tab.id === this.currentTab)?.name || "Overview";
    const ranged = RANGED_REPORTS.has(this.currentTab);
    const scope = this.container.querySelector("#dashboard-scope");
    if (scope) scope.hidden = true;
    if (scope)
      scope.textContent = library
        ? "Browse by tool or search all reports."
        : ranged
          ? `Activity for ${this.getRangeLabel(this.selectedRange)}`
          : "Report-defined period";
    const heading = this.container.querySelector(".dashboard-report-heading");
    if (heading) heading.hidden = library || Boolean(primary);
    const actions = this.container.querySelector(".dashboard-actions");
    if (actions) actions.hidden = library;
    const search = this.container.querySelector(".dashboard-search");
    if (search) search.hidden = ["overview", "trends"].includes(this.currentTab) || Boolean(this.selectedPerson);
    const input = this.container.querySelector("#dashboard-search");
    const label =
      this.currentTab === "who"
        ? "Search people"
        : this.currentTab === "device-health"
          ? "Search people, devices or versions"
          : this.currentTab === "opportunities"
            ? "Search tools"
            : this.currentTab === "daily"
              ? "Search activity"
              : "Search this report";
    if (input) {
      input.setAttribute("aria-label", label);
      input.placeholder = `${label}…`;
    }
  }

  showReportLibrary() {
    this.invalidateDataRequests();
    this.selectedPerson = null;
    this.currentTab = "__reports";
    this.updateNavigation();
    const panel = this.container.querySelector("#dashboard-panel");
    const warning = panel.querySelector(".dashboard-report-warning");
    if (warning) warning.hidden = true;
    panel.querySelector(".panel-loading").style.display = "none";
    const content = panel.querySelector(".panel-content");
    content.innerHTML = `<div class="report-library">
      <label class="report-library-search" for="report-library-search"><span class="dashboard-search-label">Find a Report</span>
        <input id="report-library-search" type="search" name="report-search" autocomplete="off" placeholder="Search tools or reports…">
      </label><div class="report-groups"></div><p class="report-search-status" role="status"></p></div>`;
    const input = content.querySelector("#report-library-search");
    const render = () => {
      const term = input.value.trim().toLowerCase();
      const groups = this.getReportGroups()
        .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => `${group.name} ${tab.name}`.toLowerCase().includes(term)) }))
        .filter((group) => group.tabs.length);
      content.querySelector(".report-groups").innerHTML = groups
        .map(
          (group) =>
            `<section class="report-group"><h3>${this.escapeHtml(group.name)}</h3><div>${group.tabs
              .map(
                (tab) =>
                  `<button type="button" class="report-link" data-report="${this.escapeHtml(tab.id)}">
            <span>${this.escapeHtml(tab.name)}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 5 7 7-7 7"/></svg></button>`,
              )
              .join("")}</div></section>`,
        )
        .join("");
      const count = groups.reduce((sum, group) => sum + group.tabs.length, 0);
      content.querySelector(".report-search-status").textContent = count
        ? `${count} reports`
        : "No matching reports. Try a tool name or clear your search.";
      content.querySelectorAll("[data-report]").forEach((button) =>
        button.addEventListener("click", () => {
          this.switchTab(button.dataset.report);
          const primary = [...this.container.querySelectorAll("#dynamic-tabs [data-tab]")].find(
            (tab) => tab.dataset.tab === button.dataset.report,
          );
          (primary || this.container.querySelector("#dashboard-report-title"))?.focus();
        }),
      );
    };
    input.addEventListener("input", render);
    render();
  }

  switchTab(tabId) {
    if (!this.container) return;
    this.selectedPerson = null;
    this.sortColumn = null;
    this.sortDirection = "desc";
    this.currentTab = tabId;
    this.filterText = "";
    const searchInput = this.container.querySelector("#dashboard-search");
    if (searchInput) searchInput.value = "";
    if (this.isPaginatedTab(tabId)) this.resetPagination(tabId);
    this.invalidateDataRequests();
    this.updateRangeVisibility();

    // Update active tab button
    this.container.querySelectorAll("#dynamic-tabs .tab-button").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabId);
    });

    this.updateNavigation();
    this.loadCurrentTabData();
  }

  isPaginatedTab(tabId) {
    return tabId === "daily" || tabId === "events";
  }

  resetPagination(tabId, search = "") {
    const state = this.pagination[tabId];
    if (!state) return;
    state.page = 0;
    state.hasMore = false;
    state.search = search;
    state.rows = [];
    state.loading = false;
  }

  invalidateDataRequests() {
    this.dataRequestId += 1;
    try {
      this.dataAbortController?.abort();
    } catch (_) {}
    this.dataAbortController = null;
  }

  isDataRequestCurrent(requestId, tabId, content) {
    return (
      requestId === this.dataRequestId &&
      this.currentTab === tabId &&
      this.container &&
      content &&
      content === this.container.querySelector("#dashboard-panel .panel-content")
    );
  }

  async loadCurrentTabData({ append = false } = {}) {
    if (!this.currentTab || this.currentTab === "__reports" || !this.container) return;
    if (this.selectedPerson) return this.loadPersonData();

    const panel = this.container.querySelector("#dashboard-panel");
    const loading = panel?.querySelector(".panel-loading");
    const content = panel?.querySelector(".panel-content");

    if (!panel || !content) return;

    const tabId = this.currentTab;
    const warning = panel.querySelector(".dashboard-report-warning");
    if (warning) {
      warning.textContent = this.reportWarnings[tabId] || "";
      warning.hidden = !warning.textContent;
    }
    const paginated = this.isPaginatedTab(tabId);
    const paginationState = paginated ? this.pagination[tabId] : null;
    if (append && paginationState?.loading) return;
    const page = paginated ? (append ? paginationState.page + 1 : 1) : null;
    const search = paginated ? paginationState.search : "";
    const cacheKey = this.getCacheKey(tabId, page);
    const cached = this.cache[cacheKey];
    if (cached) {
      if (paginated) {
        this.applyPaginatedPage(content, cached.data || [], cached.pagination || {}, append, paginationState);
      } else {
        this.renderTable(content, cached);
      }
      return;
    }

    this.dataAbortController?.abort?.();
    const requestId = ++this.dataRequestId;
    this.dataAbortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    const signal = this.dataAbortController?.signal;
    if (paginated) {
      paginationState.loading = true;
      this.updatePaginationControls(content, paginationState);
    }
    if (loading) loading.style.display = "block";
    if (!append) content.innerHTML = "";

    try {
      const rankingRequest =
        tabId === "overview" && this.tabs.some((tab) => tab.id === "opportunities")
          ? fetch(`${API_BASE}/dashboard/query`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
              body: JSON.stringify({ tabId: "opportunities", range: this.selectedRange }),
              signal,
            })
              .then((response) => (response.ok ? response.json() : null))
              .catch(() => null)
          : Promise.resolve(null);
      const res = await fetch(`${API_BASE}/dashboard/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(
          paginated
            ? { tabId, range: this.selectedRange, page, pageSize: paginationState.pageSize, search, sort: this.sortDirection }
            : { tabId, range: this.selectedRange },
        ),
        signal,
      });

      if (res.status === 401) {
        if (this.isDataRequestCurrent(requestId, tabId, content)) this.logout();
        return;
      }

      const data = await res.json();
      const ranking = await rankingRequest;
      if (!this.isDataRequestCurrent(requestId, tabId, content)) return;
      if (ranking?.ok && Array.isArray(ranking.data)) this.cache[this.getCacheKey("opportunities")] = ranking.data;

      if (data.ok && Array.isArray(data.data)) {
        this.reportWarnings[tabId] = typeof data.warning === "string" ? data.warning : "";
        if (warning) {
          warning.textContent = this.reportWarnings[tabId];
          warning.hidden = !warning.textContent;
        }
        if (paginated) {
          const pageResult = {
            data: data.data,
            pagination: data.pagination || { page, pageSize: paginationState.pageSize, hasMore: false },
          };
          this.cache[cacheKey] = pageResult;
          this.applyPaginatedPage(content, pageResult.data, pageResult.pagination, append, paginationState);
        } else {
          this.cache[cacheKey] = data.data;
          this.renderTable(content, data.data);
        }
      } else {
        content.innerHTML = `<div class="panel-error">${this.escapeHtml(data.error || "Failed to load data")}</div>`;
      }
    } catch (err) {
      if (this.isDataRequestCurrent(requestId, tabId, content)) {
        content.innerHTML = `<div class="panel-error">Connection error: ${this.escapeHtml(err.message)}</div>`;
      }
    } finally {
      if (this.isDataRequestCurrent(requestId, tabId, content)) {
        if (paginated) {
          paginationState.loading = false;
          this.updatePaginationControls(content, paginationState);
        }
        if (loading) loading.style.display = "none";
        this.dataAbortController = null;
      }
    }
  }

  applyPaginatedPage(container, rows, pagination, append, state) {
    const pageRows = Array.isArray(rows) ? rows : [];
    state.rows = append ? [...state.rows, ...pageRows] : pageRows.slice();
    state.page = Number(pagination.page) || (append ? state.page + 1 : 1);
    state.pageSize = Number(pagination.pageSize) || state.pageSize;
    state.hasMore = Boolean(pagination.hasMore);
    this.renderTable(container, state.rows, { skipFilter: true });
    this.updatePaginationControls(container, state);
  }

  updatePaginationControls(container, state) {
    if (!container) return;
    container.querySelector(".dashboard-pagination")?.remove();
    if (!state?.hasMore) return;

    const wrapper = document.createElement("div");
    wrapper.className = "dashboard-pagination";
    const button = document.createElement("button");
    button.type = "button";
    button.id = "dashboard-load-more";
    button.className = "btn btn-secondary btn-sm";
    button.disabled = Boolean(state.loading);
    button.textContent = state.loading ? "Loading..." : "Load more";
    button.addEventListener("click", () => this.loadCurrentTabData({ append: true }));
    wrapper.appendChild(button);
    container.appendChild(wrapper);
  }

  renderTable(container, data, { skipFilter = false } = {}) {
    if (!container) return;
    this.lastRenderedData = Array.isArray(data) ? data : [];
    if (this.currentTab === "trends") return renderTrends(this, container, this.lastRenderedData);
    if (this.currentTab === "device-health") return renderDeviceHealth(this, container, this.lastRenderedData);
    data = skipFilter || this.isPaginatedTab(this.currentTab) ? this.lastRenderedData : this.filterRows(this.lastRenderedData);

    if (!data.length) {
      const message = this.filterText ? "No matching rows" : "No data available";
      container.innerHTML = `<div class="panel-empty">${message}</div>`;
      return;
    }

    if (this.currentTab === "opportunities" && data.some((row) => "successful_uses" in row)) {
      this.renderToolInsights(container, data);
      return;
    }

    // Infer columns from first row
    const columns = Object.keys(data[0] || {});

    if (this.shouldRenderOverviewCards(columns)) {
      this.renderOverviewCards(container, data);
      return;
    }

    if (this.shouldRenderGroupedToolUsage(columns, data)) {
      this.renderGroupedToolUsageTable(container, data, columns);
      return;
    }

    if (this.shouldRenderWhoInsights(columns)) {
      this.renderWhoInsights(container, data);
      return;
    }

    const dateColumns = columns.filter((col) =>
      /^(time|date|day|created_time|created_at|last_seen|last_activity|last_updated|requested_at|approved_at)$/.test(col),
    );
    const sortColumn = this.sortColumn || dateColumns.find((col) => ["time", "date", "day", "created_time", "created_at"].includes(col));
    if (sortColumn && !this.isPaginatedTab(this.currentTab)) {
      const timestamp = (value) => {
        let raw = String(value || "").replace(" / ", " ");
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += "T00:00:00";
        if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
        const parsed = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : `${raw.replace(" ", "T")}+07:00`);
        return Number.isFinite(parsed) ? parsed : null;
      };
      data = [...data].sort((a, b) => {
        const left = timestamp(a[sortColumn]);
        const right = timestamp(b[sortColumn]);
        if (left === null) return right === null ? 0 : 1;
        if (right === null) return -1;
        return (left - right) * (this.sortDirection === "asc" ? 1 : -1);
      });
    }
    const headerCells = columns
      .map((col) =>
        dateColumns.includes(col)
          ? `<th aria-sort="${col === sortColumn ? (this.sortDirection === "asc" ? "ascending" : "descending") : "none"}">
          <button type="button" class="table-sort" data-sort-column="${col}">${this.formatHeader(col)}
          ${col === sortColumn ? (this.sortDirection === "asc" ? "↑" : "↓") : ""}</button></th>`
          : `<th>${this.formatHeader(col)}</th>`,
      )
      .join("");
    const rows = data
      .map((row) => {
        const cells = columns
          .map((col) => {
            let value = row[col];
            value = this.formatCellValue(value);
            return `<td title="${this.escapeHtml(String(value ?? ""))}">${this.escapeHtml(String(value ?? "-"))}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    container.innerHTML = `
      <div class="table-info">${this.formatTableInfo(data.length)}${dateColumns.length ? " · Asia/Jakarta" : ""}</div>
      <div class="table-wrapper">
        <table class="dashboard-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    container.querySelectorAll("[data-sort-column]").forEach((button) => {
      button.addEventListener("click", () => {
        this.sortDirection = sortColumn === button.dataset.sortColumn && this.sortDirection === "desc" ? "asc" : "desc";
        this.sortColumn = button.dataset.sortColumn;
        if (this.isPaginatedTab(this.currentTab)) {
          this.resetPagination(this.currentTab, this.filterText);
          this.invalidateDataRequests();
          this.loadCurrentTabData();
        } else this.renderTable(container, this.lastRenderedData);
      });
    });

    // Bind row click events
    container.querySelectorAll(".dashboard-table tbody tr").forEach((tr, idx) => {
      tr.style.cursor = "pointer";
      tr.tabIndex = 0;
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          tr.click();
        }
      });
      tr.addEventListener("click", () => this.showRowDetail(data[idx]));
    });
  }

  renderToolInsights(container, data) {
    const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
    const total = this.lastRenderedData.reduce((sum, row) => sum + (Number(row.successful_uses) || 0), 0);
    container.innerHTML = `<div class="tools-summary"><span>${number(data.length)} ${this.filterText ? "matching " : ""}tools · ${number(total)} successful uses</span>
      <details class="counting-help"><summary>How counts work</summary><p>Successful uses are completed tool actions.
      Repeat users have at least two successful uses in the selected period; this does not measure returning on another day.</p></details></div>
      <div class="table-wrapper"><table class="dashboard-table tool-insights-table">
      <thead><tr><th>Tool</th><th>Users</th><th>Successful Uses</th><th>Share of Uses</th><th>Repeat Users</th><th>Most Used Action</th><th>Details</th></tr></thead>
      <tbody>${data
        .map((row, index) => {
          const share = total ? Math.max(0, Math.min(100, (Number(row.successful_uses) / total) * 100)) : 0;
          return `<tr><td>${this.escapeHtml(this.formatToolName(row.tool_id))}
          <span class="tool-usage-bar" style="--usage-share:${share}%" aria-hidden="true"></span></td>
          <td>${number(row.users)}</td><td>${number(row.successful_uses)}</td>
          <td><span class="usage-share"><span class="usage-share-track" aria-hidden="true"><span style="width:${share}%"></span></span>
          ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(share)}%</span></td>
          <td>${number(row.repeat_users)} of ${number(row.users)}</td>
          <td>${this.escapeHtml(this.formatTitleValue(row.top_action))}</td>
          <td><button type="button" class="btn btn-outline btn-sm" data-tool-detail="${index}"
            aria-label="View ${this.escapeHtml(this.formatToolName(row.tool_id))} usage details">View</button></td></tr>`;
        })
        .join("")}</tbody></table></div>`;
    container.querySelectorAll("[data-tool-detail]").forEach((button) => {
      button.addEventListener("click", () => this.renderToolDetail(container, data[Number(button.dataset.toolDetail)]));
    });
  }

  renderToolDetail(container, row) {
    const tool = this.formatToolName(row.tool_id);
    const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
    const reports = this.tabs.filter(
      (tab) =>
        tab.id === row.tool_id || REPORT_GROUPS.some(([name, ids]) => name.toLowerCase() === tool.toLowerCase() && ids.includes(tab.id)),
    );
    container.innerHTML = `<section class="tool-detail">
      <button type="button" class="btn btn-outline btn-sm" data-tools-back>Back to tools</button>
      <h2>${this.escapeHtml(tool)}</h2>
      <dl class="overview-stats">
        <div><dt>People</dt><dd>${number(row.users)}</dd></div>
        <div><dt>Successful uses</dt><dd>${number(row.successful_uses)}</dd></div>
        <div><dt>Repeat users</dt><dd>${number(row.repeat_users)} / ${number(row.users)}</dd></div>
        <div><dt>Most used action</dt><dd>${this.escapeHtml(this.formatTitleValue(row.top_action))}</dd></div>
      </dl>
      <div class="tool-detail-reports">
        ${reports
          .map(
            (tab) => `<button type="button" class="btn btn-secondary btn-sm" data-tool-report="${this.escapeHtml(tab.id)}">
          ${this.escapeHtml(tab.name)}</button>`,
          )
          .join("")}
        ${this.tabs.some((tab) => tab.id === "daily") ? '<button type="button" class="btn btn-secondary btn-sm" data-tool-activity>View activity</button>' : ""}
      </div>
      <details class="counting-help"><summary>How counts work</summary><p>Repeat users have at least two successful uses in the selected period.
        Detailed reports use their own date windows; activity follows the selected range.</p></details>
    </section>`;
    container.querySelector("[data-tools-back]").addEventListener("click", () => this.renderTable(container, this.lastRenderedData));
    container.querySelectorAll("[data-tool-report]").forEach((button) => {
      button.addEventListener("click", () => this.switchTab(button.dataset.toolReport));
    });
    container.querySelector("[data-tool-activity]")?.addEventListener("click", () => {
      this.switchTab("daily");
      const input = this.container.querySelector("#dashboard-search");
      input.value = row.tool_id;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  shouldRenderGroupedToolUsage(columns, data) {
    if (this.currentTab !== "tools") return false;
    return ["tool_id", "action", "total_count"].every((col) => columns.includes(col)) && data.some((row) => row.action === "TOTAL");
  }

  shouldRenderOverviewCards(columns) {
    return this.currentTab === "overview" && ["metric", "value"].every((col) => columns.includes(col));
  }

  shouldRenderWhoInsights(columns) {
    return ["section", "rank", "user", "events"].every((col) => columns.includes(col));
  }

  renderWhoInsights(container, data) {
    const sections = [
      {
        id: "users",
        name: "Top users",
        tabLabel: "Users",
        description: "Select a name to inspect behavior. Ranked by activity; up to 200 people.",
        columns: ["rank", "user", "main_activity", "events", "tools_used", "devices_seen", "errors", "last_activity"],
      },
      {
        id: "tools",
        name: "Top user tools",
        tabLabel: "Tools by user",
        description: "Which tools the most active people used most.",
        columns: ["rank", "user", "tool_id", "events", "action", "last_activity"],
      },
      {
        id: "actions",
        name: "Top user actions",
        tabLabel: "Actions",
        description: "The repeated actions that make up most usage.",
        columns: ["rank", "user", "tool_id", "action", "events", "last_activity"],
      },
    ];
    if (!sections.some((section) => section.id === this.currentWhoSection)) {
      this.currentWhoSection = "users";
    }
    const activeSection = sections.find((section) => section.id === this.currentWhoSection) || sections[0];
    const topUsers = data.filter((row) => row.section === "Top users");
    const topUser = topUsers[0];
    const activeUsers = Number(topUser?.active_users_total ?? topUsers.length);
    const totalActions = Number(topUser?.events_total ?? topUsers.reduce((sum, row) => sum + Number(row.events || 0), 0));
    const totalErrors = Number(topUser?.errors_total ?? topUsers.reduce((sum, row) => sum + Number(row.errors || 0), 0));
    const clickableRows = [];

    const summary = [
      { label: "Active People", value: activeUsers, context: "" },
      { label: "Actions", value: totalActions, context: "Tool usage events counted" },
      { label: "Errors", value: totalErrors, context: "Uncaught errors reported" },
    ]
      .map(
        (card) => `
          <div class="who-summary-card">
            <span>${this.escapeHtml(String(card.label))}</span>
            <strong>${this.escapeHtml(String(card.value))}</strong>
            ${card.context ? `<small>${this.escapeHtml(String(card.context))}</small>` : ""}
          </div>
        `,
      )
      .join("");

    const sectionTabs = sections
      .map((section) => {
        const allRows = data.filter((row) => row.section === section.name);
        return `
          <button type="button" class="who-section-tab${section.id === activeSection.id ? " active" : ""}" data-who-section="${section.id}">
            <span>${this.escapeHtml(section.tabLabel)}</span>
            <strong>${allRows.length}</strong>
          </button>
        `;
      })
      .join("");
    const activeRows = data.filter((row) => row.section === activeSection.name);
    const headerCells = activeSection.columns.map((col) => `<th>${this.formatWhoHeader(col, activeSection.name)}</th>`).join("");
    const bodyRows = activeRows.length
      ? activeRows
          .map((row) => {
            const rowIndex = clickableRows.push(row) - 1;
            const cells = activeSection.columns
              .map((col) => {
                const value = this.formatWhoValue(row, col);
                if (col === "user" && row.user_email)
                  return `<td><button type="button" class="person-link"
                  data-person="${this.escapeHtml(row.user_email)}">${this.escapeHtml(row.user)}<small>${this.escapeHtml(row.user_email)}</small></button></td>`;
                return `<td title="${this.escapeHtml(String(value ?? ""))}">${this.escapeHtml(String(value ?? "-"))}</td>`;
              })
              .join("");
            return `<tr data-row-index="${rowIndex}">${cells}</tr>`;
          })
          .join("")
      : `<tr><td colspan="${activeSection.columns.length}" class="who-empty-cell">No matching rows</td></tr>`;

    container.innerHTML = `
      <div class="who-insights">
        <div class="who-summary-grid">${summary}</div>
        <div class="who-section-tabs">${sectionTabs}</div>
        <section class="who-insight-section">
          <div class="who-insight-heading">
            <div>
              <h3 class="dashboard-search-label">${this.escapeHtml(activeSection.name)}</h3>
              <p>${this.escapeHtml(activeSection.description)}</p>
            </div>
            <span>${this.formatSectionInfo(activeRows.length)}</span>
          </div>
          <div class="table-wrapper who-table-wrapper">
            <table class="dashboard-table">
              <thead><tr>${headerCells}</tr></thead>
              <tbody>${bodyRows}</tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    container.querySelectorAll(".who-section-tab").forEach((button) => {
      button.addEventListener("click", () => {
        this.currentWhoSection = button.dataset.whoSection || "users";
        this.renderTable(container, this.lastRenderedData);
      });
    });

    container.querySelectorAll(".dashboard-table tbody tr").forEach((tr) => {
      tr.style.cursor = "pointer";
      tr.tabIndex = 0;
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          tr.click();
        }
      });
      tr.addEventListener("click", () => {
        const row = clickableRows[Number(tr.dataset.rowIndex)];
        if (row?.user_email) this.openPerson(row.user_email);
        else this.showRowDetail(row);
      });
    });
  }

  async openPerson(identity) {
    if (!this.container || !identity) return;
    this.personDirectoryData = this.lastRenderedData;
    this.personDirectoryRange = this.selectedRange;
    this.currentTab = "who";
    this.selectedPerson = identity;
    this.focusPersonHeading = true;
    this.invalidateDataRequests();
    this.updateNavigation();
    return this.loadPersonData();
  }

  async loadPersonData() {
    if (!this.container || !this.selectedPerson) return;
    this.invalidateDataRequests();
    const requestId = ++this.dataRequestId;
    const person = this.selectedPerson;
    const container = this.container;
    const content = container.querySelector("#dashboard-panel .panel-content");
    container.querySelector(".panel-loading").style.display = "none";
    content.innerHTML =
      '<div class="person-profile"><button type="button" class="btn btn-secondary btn-sm" data-person-back>Back to People</button>' +
      '<p role="status">Loading person activity…</p></div>';
    this.bindPersonBack(content);
    this.dataAbortController = new AbortController();
    const current = () =>
      this.container === container && this.currentTab === "who" && this.selectedPerson === person && this.dataRequestId === requestId;
    try {
      const response = await fetch(`${API_BASE}/dashboard/query`, {
        method: "POST",
        signal: this.dataAbortController.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ tabId: "who", person, range: this.selectedRange }),
      });
      if (!current()) return;
      if (response.status === 401) {
        this.logout();
        return;
      }
      const result = await response.json();
      if (!current()) return;
      if (!result.ok || !result.data || Array.isArray(result.data)) throw new Error(result.error || "Person activity is unavailable");
      this.renderPersonProfile(content, result.data, result.source || "recorded activity");
    } catch (error) {
      if (!current() || error.name === "AbortError") return;
      content.innerHTML = `<div class="person-profile"><button type="button" class="btn btn-secondary btn-sm" data-person-back>Back to People</button>
        <p role="alert">${this.escapeHtml(error.message)}. Use Refresh to try again.</p></div>`;
      this.bindPersonBack(content);
    } finally {
      if (current()) this.dataAbortController = null;
    }
  }

  bindPersonBack(content) {
    content.querySelector("[data-person-back]")?.addEventListener("click", () => {
      const identity = this.selectedPerson;
      this.selectedPerson = null;
      this.invalidateDataRequests();
      this.updateNavigation();
      if (this.personDirectoryRange === this.selectedRange && this.personDirectoryData?.length) {
        this.renderTable(content, this.personDirectoryData);
        [...content.querySelectorAll("[data-person]")].find((button) => button.dataset.person === identity)?.focus();
      } else this.loadCurrentTabData();
    });
  }

  renderPersonProfile(content, data, source) {
    const summary = data.summary || {};
    const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
    const escape = (value) => this.escapeHtml(String(value ?? "—"));
    const date = (value) => {
      if (!value) return "—";
      const raw = String(value).replace(" ", "T");
      const timestamp = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : raw + "+07:00");
      return Number.isNaN(timestamp.getTime())
        ? escape(value)
        : escape(
            new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(timestamp),
          );
    };
    const tools = data.tools || [];
    const actions = data.actions || [];
    const recent = data.recent || [];
    const errors = data.errors || [];
    const table = (headers, rows) => `<div class="person-table-wrap"><table class="dashboard-table"><thead><tr>
      ${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
    const toolRows = tools.map(
      (row) => `<tr><td>${escape(this.formatToolName(row.tool_id))}</td><td>${number(row.events)}</td>
      <td>${Number(summary.events) ? number((Number(row.events) / Number(summary.events)) * 100) : 0}%</td></tr>`,
    );
    const actionRows = actions.map(
      (row) => `<tr><td>${escape(this.formatToolName(row.tool_id))}</td>
      <td>${escape(this.formatTitleValue(row.action))}</td><td>${number(row.events)}</td><td>${date(row.last_activity)}</td></tr>`,
    );
    const recentRows = recent.map(
      (row) => `<tr><td>${date(row.created_time)}</td><td>${escape(this.formatToolName(row.tool_id))}</td>
      <td>${escape(this.formatTitleValue(row.action))}</td><td>${escape(row.device_id)}</td></tr>`,
    );
    const errorRows = errors.map(
      (row) => `<tr><td>${date(row.created_time)}</td><td>${escape(this.formatToolName(row.tool_id))}</td>
      <td>${escape(row.error_name)}</td><td class="person-error-message">${escape(row.message)}</td></tr>`,
    );
    content.innerHTML = `<article class="person-profile">
      <button type="button" class="btn btn-secondary btn-sm" data-person-back>Back to People</button>
      <header class="person-heading"><h3 tabindex="-1">${escape(summary.user_email || this.selectedPerson)}</h3>
        <p>${escape(source)} · dates in Asia/Jakarta</p></header>
      <dl class="person-stats">${[
        ["Recorded Activity", summary.events],
        ["Active Days", summary.active_days],
        ["Tools Used", summary.tools_used],
        ["Devices", summary.devices_seen],
        ["Uncaught Errors", data.error_count],
      ]
        .map(([label, value]) => `<div><dt>${label}</dt><dd>${number(value)}</dd></div>`)
        .join("")}</dl>
      <p class="person-context">First activity in this period: ${date(summary.first_activity)}. Last activity: ${date(summary.last_activity)}.</p>
      ${Number(summary.events) === 0 ? '<p class="panel-empty">No recorded activity for this person in this period. Try a wider time range.</p>' : ""}
      <div class="person-breakdowns"><section><h4>Tool Mix</h4><p>Share of this person’s recorded activity.</p>
        ${tools.length ? table(["Tool", "Activity", "Share"], toolRows) : "<p>No tool activity in this period.</p>"}</section>
      <section><h4>Active Days</h4><p>Days with recorded activity; this does not measure sessions or time spent.</p>
        ${
          (data.days || []).length
            ? table(
                ["Day", "Activity"],
                data.days.map((row) => `<tr><td>${escape(row.day)}</td><td>${number(row.events)}</td></tr>`),
              )
            : "<p>No active days recorded.</p>"
        }</section></div>
      <section><h4>Actions by Tool</h4><p>All recorded action totals for this person in the selected period.</p>
        ${actions.length ? table(["Tool", "Action", "Activity", "Last Used"], actionRows) : "<p>No actions recorded.</p>"}</section>
      <details><summary>Recent Activity · ${number(recent.length)} of ${number(summary.events)} records</summary>
        <p>Latest 100 records. This is an activity sequence, not a session replay.</p>
        ${recent.length ? table(["Time", "Tool", "Action", "Device"], recentRows) : "<p>No recent activity recorded.</p>"}</details>
      <details><summary>Uncaught Errors · ${number(data.error_count)} reports</summary><p>Latest 50 error reports, counted separately from usage.</p>
        ${errors.length ? table(["Time", "Tool", "Error", "Message"], errorRows) : "<p>No uncaught errors recorded in this period.</p>"}</details>
    </article>`;
    this.bindPersonBack(content);
    if (this.focusPersonHeading) content.querySelector(".person-heading h3")?.focus();
    this.focusPersonHeading = false;
  }

  formatWhoHeader(key, sectionName) {
    if (key === "events") return sectionName === "Top user actions" ? "Times" : "Actions";
    if (key === "tool_id") return sectionName === "Top users" ? "Top tool" : "Tool";
    if (key === "action") return sectionName === "Top users" ? "Most common action" : "Action";
    if (key === "tools_used") return "Tools";
    if (key === "devices_seen") return "Devices";
    if (key === "last_activity") return "Last seen";
    return this.formatHeader(key);
  }

  formatWhoValue(row, key) {
    if (key === "main_activity") {
      return `${this.formatToolName(row.tool_id)}: ${this.formatActionName(row.action)}`;
    }
    if (key === "tool_id") return this.formatToolName(row.tool_id);
    if (key === "action") return this.formatActionName(row.action);
    return this.formatCellValue(row[key]);
  }

  formatToolName(toolId) {
    const labels = {
      "base64-tools": "Base64 Tools",
      "compare-config": "Compare Config",
      "html-template": "HTML Template",
      "image-checker": "Check Image",
      "check-image": "Check Image",
      "sql-in-clause": "Query IN",
      "json-tools": "JSON Tools",
      "master-lockey": "Master Lockey",
      "merge-sql": "Merge SQL",
      "quick-query": "Quick Query",
      "qr-tools": "QR Tools",
      "run-batch": "Run Batch",
      "run-query": "Run Query",
      "tlv-viewer": "TLV Viewer",
      "uuid-generator": "UUID Generator",
    };
    return labels[toolId] || this.formatTitleValue(toolId);
  }

  formatActionName(action) {
    const labels = {
      comparison_success: "successful comparisons",
      copy_uuid: "copied UUIDs",
      format_action: "formatted content",
      generate_uuid: "generated UUIDs",
      load_from_cache: "loaded saved data",
      merge: "merged data",
      query_generated: "generated queries",
      run_click: "clicked Run",
      run_started: "started runs",
      run_success: "successful runs",
      schema_load: "loaded schemas",
    };
    return labels[action] || this.formatTitleValue(action);
  }

  formatTitleValue(value) {
    return String(value || "-")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  renderOverviewCards(container, data) {
    const metrics = new Map(data.map((row) => [row.metric, row.value]));
    const numeric = (key) => {
      const raw = metrics.get(key);
      if (raw === undefined || raw === null || raw === "") return null;
      const value = Number(String(raw).replaceAll(",", ""));
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const count = (key) => (numeric(key) === null ? "—" : new Intl.NumberFormat().format(numeric(key)));
    const top = String(metrics.get("Most used tool") || "").match(/^(.*?)\s*\(([\d,]+)\)$/);
    const total = numeric("Successful tool uses");
    const toolName = top ? this.formatToolName(top[1].trim()) : "No tool activity recorded";
    const share = top && total > 0 ? (Number(top[2].replaceAll(",", "")) / total) * 100 : null;
    const rawError = String(metrics.get("Noisiest error") || "—");
    const errorParts = rawError.match(/^(.*?) \/ (.*?) \(([\d,]+)\)$/);
    const topError = errorParts ? `${this.formatToolName(errorParts[1])} · ${errorParts[2]} · ${errorParts[3]} reports` : rawError;
    const rankedTools = (this.cache[this.getCacheKey("opportunities")] || []).filter((row) => Number(row.successful_uses) > 0).slice(0, 5);
    const stats = [
      ["Active People", count("Active users"), "who"],
      ["Successful Uses", count("Successful tool uses"), "opportunities"],
      ["Tool Opens", count("Tool opens"), "daily"],
      ["People with Errors", count("Affected users"), "errors"],
    ];
    container.innerHTML = `<div class="owner-overview"><dl class="overview-stats">${stats
      .map(
        ([label, value, view]) =>
          `<div><dt>${label}</dt><dd><button type="button" data-overview-view="${view}" aria-label="Inspect ${label.toLowerCase()}">${value}</button></dd>${label === "People with Errors" ? `<small>${count("Uncaught errors")} uncaught reports</small>` : ""}</div>`,
      )
      .join("")}</dl>
      <section class="overview-observation"><div><h2>Where Usage Concentrates</h2><p><strong>${this.escapeHtml(toolName)}</strong>
        ${
          share !== null
            ? `accounts for ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(share)}% of successful uses.`
            : top
              ? `has ${new Intl.NumberFormat().format(Number(top[2].replaceAll(",", "")))} successful uses.`
              : ""
        }</p>${
          total !== null && numeric("Active users") > 0
            ? `<p class="overview-derived">${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(total / numeric("Active users"))} successful uses per active person.</p>`
            : ""
        }</div>
        <button type="button" class="btn btn-secondary btn-sm" data-overview-view="opportunities">Explore Tools</button></section>
      ${
        rankedTools.length
          ? `<section class="overview-ranking"><h2>Most used tools</h2><ol>
        ${rankedTools
          .map((row) => {
            const percent = total > 0 ? Math.max(0, Math.min(100, (Number(row.successful_uses) / total) * 100)) : 0;
            return `<li><button type="button" data-overview-tool="${this.escapeHtml(row.tool_id)}">
            <span>${this.escapeHtml(this.formatToolName(row.tool_id))}</span>
            <span class="overview-ranking-track" aria-hidden="true"><span style="width:${percent}%"></span></span>
            <strong>${new Intl.NumberFormat().format(Number(row.successful_uses))}</strong>
            <span>${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(percent)}%</span>
          </button></li>`;
          })
          .join("")}</ol></section>`
          : ""
      }
      <section class="overview-observation"><div><h2>Most Reported Error</h2><p>${this.escapeHtml(topError)}</p>
        <small>Error reports are counted separately from successful uses.</small></div>
        <button type="button" class="btn btn-outline btn-sm" data-overview-view="errors"
          title="Error Details uses its own report-defined time period">Inspect Errors</button></section>
      <div class="overview-investigate">
        ${this.tabs.some((tab) => tab.id === "who") ? '<button type="button" class="btn btn-outline btn-sm" data-overview-view="who">Explore people</button>' : ""}
        ${this.tabs.some((tab) => tab.id === "daily") ? '<button type="button" class="btn btn-outline btn-sm" data-overview-view="daily">Recent activity</button>' : ""}
        <button type="button" class="btn btn-outline btn-sm" data-overview-view="__reports">All detailed reports</button>
      </div>
      <details class="counting-help"><summary>About these metrics</summary><p>Active people have recorded tool usage.
        Successful uses count completed actions; tool opens count navigation. Multiple uses can follow one open.
        People with errors are counted from uncaught reports and may differ from the active-people population.</p></details></div>`;
    container.querySelectorAll("[data-overview-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        const row = rankedTools.find((item) => item.tool_id === button.dataset.overviewTool);
        this.switchTab("opportunities");
        this.renderToolDetail(container, row);
      });
    });
    container.querySelectorAll("[data-overview-view]").forEach((button) =>
      button.addEventListener("click", () => {
        if (button.dataset.overviewView === "__reports") this.showReportLibrary();
        else if (button.dataset.overviewView === "errors" && !this.tabs.some((tab) => tab.id === "errors")) this.showReportLibrary();
        else this.switchTab(button.dataset.overviewView);
      }),
    );
  }

  renderGroupedToolUsageTable(container, data, columns) {
    const groupedRows = [];
    const groups = [];

    data.forEach((row) => {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.toolId !== row.tool_id) {
        groups.push({ toolId: row.tool_id, rows: [row] });
      } else {
        lastGroup.rows.push(row);
      }
    });

    const headerCells = columns.map((col) => `<th>${this.formatHeader(col)}</th>`).join("");
    const rows = groups
      .map((group) =>
        group.rows
          .map((row, rowIndex) => {
            groupedRows.push(row);
            const isSummary = row.action === "TOTAL";
            const cells = columns
              .map((col) => {
                if (col === "tool_id") {
                  if (rowIndex > 0) return "";
                  const rowSpan = group.rows.length > 1 ? ` rowspan="${group.rows.length}"` : "";
                  const toolTitle = this.escapeHtml(String(group.toolId ?? ""));
                  const toolLabel = this.escapeHtml(String(group.toolId ?? "-"));
                  return `<td class="tool-group-cell"${rowSpan} title="${toolTitle}">${toolLabel}</td>`;
                }

                let value = row[col];
                value = this.formatCellValue(value);

                const displayValue = this.escapeHtml(String(value ?? "-"));
                const title = this.escapeHtml(String(value ?? ""));
                if (col === "action" && !isSummary) {
                  return `<td class="nested-action-cell" title="${title}"><span class="nested-action-label">${displayValue}</span></td>`;
                }
                return `<td title="${title}">${displayValue}</td>`;
              })
              .join("");

            return `<tr class="${isSummary ? "tool-summary-row" : "tool-detail-row"}">${cells}</tr>`;
          })
          .join(""),
      )
      .join("");

    container.innerHTML = `
      <div class="table-info">${this.formatTableInfo(data.length)} - click a row for details</div>
      <div class="table-wrapper">
        <table class="dashboard-table grouped-tool-usage-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    container.querySelectorAll(".dashboard-table tbody tr").forEach((tr, idx) => {
      tr.style.cursor = "pointer";
      tr.tabIndex = 0;
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          tr.click();
        }
      });
      tr.addEventListener("click", () => this.showRowDetail(groupedRows[idx]));
    });
  }

  showRowDetail(row) {
    if (!row) return;
    const overlay = this.container.querySelector("#row-detail-overlay");
    const content = this.container.querySelector("#row-detail-content");
    if (!overlay || !content) return;

    // Build transposed table (key-value pairs)
    const rows = Object.entries(row)
      .filter(([key]) => !["section_order", "active_users_total", "events_total", "errors_total"].includes(key))
      .map(([key, value]) => {
        let displayValue = this.parseJsonString(this.formatDateValue(value));
        // Pretty print objects/arrays
        if (typeof displayValue === "object" && displayValue !== null) {
          try {
            displayValue = JSON.stringify(displayValue, null, 2);
          } catch (_) {
            displayValue = String(displayValue);
          }
        }
        return `
        <tr>
          <th>${this.escapeHtml(this.formatHeader(key))}</th>
          <td><pre>${this.escapeHtml(String(displayValue ?? "-"))}</pre></td>
        </tr>
      `;
      })
      .join("");

    content.innerHTML = `
      <table class="row-detail-table">
        <tbody>${rows}</tbody>
      </table>
    `;

    this.detailTrigger = document.activeElement;
    overlay.hidden = false;
    overlay.classList.add("open");
    this.container.querySelector("#row-detail-close").focus();
  }

  closeRowDetail() {
    const overlay = this.container?.querySelector("#row-detail-overlay");
    overlay?.classList.remove("open");
    if (overlay) overlay.hidden = true;
    this.detailTrigger?.focus?.();
    this.detailTrigger = null;
  }

  formatHeader(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  formatTableInfo(visibleCount) {
    const totalCount = this.lastRenderedData.length;
    const noun = visibleCount === 1 ? "row" : "rows";
    if (this.filterText && visibleCount !== totalCount) {
      return `Showing ${visibleCount} of ${totalCount} ${noun}`;
    }
    return `Showing ${visibleCount} ${noun}`;
  }

  formatSectionInfo(visibleCount, totalCount = visibleCount) {
    const noun = visibleCount === 1 ? "row" : "rows";
    if (visibleCount < totalCount) return `Top ${visibleCount} of ${totalCount}`;
    return `Showing ${visibleCount} ${noun}`;
  }

  getCacheKey(tabId, page = null) {
    if (this.isPaginatedTab(tabId)) {
      const state = this.pagination[tabId];
      const requestedPage = page || state?.page || 1;
      return `${tabId}:${tabId === "daily" ? this.selectedRange : "all"}:${requestedPage}:${state?.pageSize || 100}:${state?.search || ""}:${this.sortDirection}`;
    }
    return RANGED_REPORTS.has(tabId) ? `${tabId}:${this.selectedRange}` : tabId;
  }

  updateRangeVisibility() {
    const rangeControl = this.container.querySelector(".dashboard-range");
    if (rangeControl) rangeControl.hidden = !RANGED_REPORTS.has(this.currentTab);
  }

  getRangeLabel(range) {
    const labels = {
      today: "today",
      "7d": "the last 7 days",
      "30d": "the last 30 days",
      "90d": "the last 90 days",
      all: "all time",
    };
    return labels[range] || labels["30d"];
  }

  filterRows(data) {
    if (!this.filterText) return data;
    return data.filter((row) => {
      return Object.values(row || {}).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(this.filterText),
      );
    });
  }

  formatDateValue(value) {
    if (typeof value !== "string") return value;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return value.replace(/^(?:(\d{4})-)?(\d{2})-(\d{2})(?=$|[T /])/, (date, year, month, day) => {
      const label = months[Number(month) - 1];
      return label ? `${day} ${label}${year ? ` ${year}` : ""}` : date;
    });
  }

  formatCellValue(value) {
    let displayValue = this.formatDateValue(value);
    if (typeof displayValue === "object" && displayValue !== null) {
      displayValue = JSON.stringify(displayValue);
    }
    if (typeof displayValue === "string" && displayValue.length > 120) {
      displayValue = `${displayValue.slice(0, 120)}...`;
    }
    return displayValue;
  }

  parseJsonString(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed || !["{", "["].includes(trimmed[0])) return value;
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return value;
    }
  }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  deactivate() {
    this.invalidateDataRequests();
    this.container = null;
  }

  unmount() {
    this.personDirectoryData = null;
    this.selectedPerson = null;
    this.invalidateDataRequests();
    this.tabsRequestId += 1;
    this.authRequestId += 1;
    if (this.documentKeydownListener) {
      document.removeEventListener("keydown", this.documentKeydownListener);
      this.documentKeydownListener = null;
    }
    this.container = null;
  }
}

export { AnalyticsDashboardPage };
