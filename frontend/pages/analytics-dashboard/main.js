/**
 * Analytics Dashboard Page
 * Password-protected internal analytics viewer
 * Tabs are fetched dynamically from the API
 */
import { AnalyticsDashboardTemplate } from "./template.js";
import "./styles.css";

const API_BASE = import.meta.env.DEV ? "http://localhost:8787" : "";
const TOKEN_KEY = "analytics.dashboard.token";

class AnalyticsDashboardPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.container = null;
    this.token = null;
    this.tabs = [];
    this.currentTab = null;
    this.cache = {};
    this.filterText = "";
    this.selectedRange = "30d";
    this.lastRenderedData = [];
  }

  mount(root) {
    if (!root) return;
    root.innerHTML = AnalyticsDashboardTemplate;
    this.container = root.querySelector(".analytics-dashboard");

    // Check for existing token
    try {
      const stored = sessionStorage.getItem(TOKEN_KEY);
      if (stored) {
        const payload = JSON.parse(atob(stored));
        if (payload.exp && payload.exp > Date.now()) {
          this.token = stored;
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
      this.loadCurrentTabData();
    });

    this.container.querySelector("#dashboard-search")?.addEventListener("input", (e) => {
      this.filterText = e.target.value.trim().toLowerCase();
      const content = this.container.querySelector("#dashboard-panel .panel-content");
      this.renderTable(content, this.lastRenderedData);
    });

    this.container.querySelector("#dashboard-range")?.addEventListener("change", (e) => {
      this.selectedRange = e.target.value || "30d";
      delete this.cache[this.getCacheKey(this.currentTab)];
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
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeRowDetail();
    });
  }

  async handleAuth(e) {
    e.preventDefault();
    const passwordInput = this.container.querySelector("#dashboard-password");
    const errorEl = this.container.querySelector("#auth-error");
    const password = passwordInput?.value || "";

    errorEl.textContent = "";

    try {
      const res = await fetch(`${API_BASE}/dashboard/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (data.ok && data.token) {
        this.token = data.token;
        try {
          sessionStorage.setItem(TOKEN_KEY, data.token);
        } catch (_) {}
        this.showDashboard();
        this.loadTabs();
      } else {
        errorEl.textContent = data.error || "Invalid password";
        passwordInput.focus();
      }
    } catch (err) {
      errorEl.textContent = "Connection error. Please try again.";
    }
  }

  showDashboard() {
    this.container.querySelector("#dashboard-auth").style.display = "none";
    this.container.querySelector("#dashboard-content").style.display = "flex";
  }

  logout() {
    this.token = null;
    this.tabs = [];
    this.currentTab = null;
    this.cache = {};
    this.filterText = "";
    this.selectedRange = "30d";
    this.lastRenderedData = [];
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
    this.container.querySelector("#dashboard-auth").style.display = "flex";
    this.container.querySelector("#dashboard-content").style.display = "none";
    this.container.querySelector("#dashboard-password").value = "";
  }

  async loadTabs() {
    const tabsContainer = this.container.querySelector("#dynamic-tabs");
    const sourceIndicator = this.container.querySelector("#config-source");
    if (!tabsContainer) return;

    tabsContainer.innerHTML = '<span style="color: hsl(var(--muted-foreground)); font-size: 0.875rem;">Loading tabs...</span>';

    try {
      const res = await fetch(`${API_BASE}/dashboard/tabs`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      if (res.status === 401) {
        this.logout();
        return;
      }

      const data = await res.json();

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
          this.switchTab(this.tabs[0].id);
        }
      } else {
        tabsContainer.innerHTML = `<span style="color: hsl(var(--destructive));">${data.error || "Failed to load tabs"}</span>`;
      }
    } catch (err) {
      tabsContainer.innerHTML = `<span style="color: hsl(var(--destructive));">Error: ${err.message}</span>`;
    }
  }

  renderTabs() {
    const tabsContainer = this.container.querySelector("#dynamic-tabs");
    if (!tabsContainer) return;

    tabsContainer.innerHTML = this.tabs
      .map(
        (tab, idx) =>
          `<button type="button" class="tab-button${idx === 0 ? " active" : ""}" data-tab="${tab.id}">${this.escapeHtml(tab.name)}</button>`,
      )
      .join("");

    // Bind click events
    tabsContainer.querySelectorAll(".tab-button").forEach((btn) => {
      btn.addEventListener("click", () => this.switchTab(btn.dataset.tab));
    });
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    this.filterText = "";
    const searchInput = this.container.querySelector("#dashboard-search");
    if (searchInput) searchInput.value = "";
    this.updateRangeVisibility();

    // Update active tab button
    this.container.querySelectorAll("#dynamic-tabs .tab-button").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabId);
    });

    this.loadCurrentTabData();
  }

  async loadCurrentTabData() {
    if (!this.currentTab) return;

    const panel = this.container.querySelector("#dashboard-panel");
    const loading = panel?.querySelector(".panel-loading");
    const content = panel?.querySelector(".panel-content");

    if (!panel || !content) return;

    // Check cache
    const cacheKey = this.getCacheKey(this.currentTab);
    if (this.cache[cacheKey]) {
      this.renderTable(content, this.cache[cacheKey]);
      return;
    }

    loading.style.display = "block";
    content.innerHTML = "";

    try {
      const res = await fetch(`${API_BASE}/dashboard/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ tabId: this.currentTab, range: this.selectedRange }),
      });

      if (res.status === 401) {
        this.logout();
        return;
      }

      const data = await res.json();

      if (data.ok && Array.isArray(data.data)) {
        this.cache[cacheKey] = data.data;
        this.renderTable(content, data.data);
      } else {
        content.innerHTML = `<div class="panel-error">${data.error || "Failed to load data"}</div>`;
      }
    } catch (err) {
      content.innerHTML = `<div class="panel-error">Connection error: ${err.message}</div>`;
    } finally {
      loading.style.display = "none";
    }
  }

  renderTable(container, data) {
    if (!container) return;
    this.lastRenderedData = Array.isArray(data) ? data : [];
    data = this.filterRows(this.lastRenderedData);

    if (!data.length) {
      const message = this.filterText ? "No matching rows" : "No data available";
      container.innerHTML = `<div class="panel-empty">${message}</div>`;
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

    const headerCells = columns.map((col) => `<th>${this.formatHeader(col)}</th>`).join("");
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
      <div class="table-info">${this.formatTableInfo(data.length)} - click a row for details</div>
      <div class="table-wrapper">
        <table class="dashboard-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // Bind row click events
    container.querySelectorAll(".dashboard-table tbody tr").forEach((tr, idx) => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => this.showRowDetail(data[idx]));
    });
  }

  shouldRenderGroupedToolUsage(columns, data) {
    if (this.currentTab !== "tools") return false;
    return ["tool_id", "action", "total_count"].every((col) => columns.includes(col)) && data.some((row) => row.action === "TOTAL");
  }

  shouldRenderOverviewCards(columns) {
    return this.currentTab === "overview" && ["metric", "value", "context"].every((col) => columns.includes(col));
  }

  shouldRenderWhoInsights(columns) {
    return ["section", "rank", "user", "events"].every((col) => columns.includes(col));
  }

  renderWhoInsights(container, data) {
    const sections = [
      {
        name: "Top users",
        description: "People with the most activity in the selected time range.",
        columns: ["rank", "user", "main_activity", "events", "tools_used", "devices_seen", "errors", "last_activity"],
        limit: 10,
      },
      {
        name: "Top user tools",
        description: "Which tools the most active people used most.",
        columns: ["rank", "user", "tool_id", "events", "action", "last_activity"],
        limit: 12,
      },
      {
        name: "Top user actions",
        description: "The repeated actions that make up most usage.",
        columns: ["rank", "user", "tool_id", "action", "events", "last_activity"],
        limit: 12,
      },
    ];
    const topUsers = data.filter((row) => row.section === "Top users");
    const topUser = topUsers[0];
    const activeUsers = Number(topUser?.active_users_total ?? topUsers.length);
    const totalActions = Number(topUser?.events_total ?? topUsers.reduce((sum, row) => sum + Number(row.events || 0), 0));
    const totalErrors = Number(topUser?.errors_total ?? topUsers.reduce((sum, row) => sum + Number(row.errors || 0), 0));
    const rangeLabel = this.getRangeLabel(this.selectedRange);
    const clickableRows = [];

    const summary = [
      {
        label: "Most active",
        value: topUser?.user || "-",
        context: topUser ? `${topUser.events || 0} actions, mostly ${this.formatActionName(topUser.action)}` : rangeLabel,
      },
      { label: "People", value: activeUsers, context: `Active ${rangeLabel}` },
      { label: "Actions", value: totalActions, context: "Tool usage events counted" },
      { label: "Errors", value: totalErrors, context: "Uncaught errors reported" },
    ]
      .map(
        (card) => `
          <div class="who-summary-card">
            <span>${this.escapeHtml(String(card.label))}</span>
            <strong>${this.escapeHtml(String(card.value))}</strong>
            <small>${this.escapeHtml(String(card.context))}</small>
          </div>
        `,
      )
      .join("");

    const sectionMarkup = sections
      .map((section) => {
        const allRows = data.filter((row) => row.section === section.name);
        const rows = allRows.slice(0, section.limit);
        if (!rows.length) return "";

        const headerCells = section.columns.map((col) => `<th>${this.formatWhoHeader(col, section.name)}</th>`).join("");
        const bodyRows = rows
          .map((row) => {
            const rowIndex = clickableRows.push(row) - 1;
            const cells = section.columns
              .map((col) => {
                const value = this.formatWhoValue(row, col);
                return `<td title="${this.escapeHtml(String(value ?? ""))}">${this.escapeHtml(String(value ?? "-"))}</td>`;
              })
              .join("");
            return `<tr data-row-index="${rowIndex}">${cells}</tr>`;
          })
          .join("");

        return `
          <section class="who-insight-section">
            <div class="who-insight-heading">
              <div>
                <h3>${this.escapeHtml(section.name)}</h3>
                <p>${this.escapeHtml(section.description)}</p>
              </div>
              <span>${this.formatSectionInfo(rows.length, allRows.length)}</span>
            </div>
            <div class="table-wrapper who-table-wrapper">
              <table class="dashboard-table">
                <thead><tr>${headerCells}</tr></thead>
                <tbody>${bodyRows}</tbody>
              </table>
            </div>
          </section>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="table-info">${this.formatTableInfo(data.length)} across ${this.escapeHtml(rangeLabel)} - click a row for details</div>
      <div class="who-insights">
        <div class="who-summary-grid">${summary}</div>
        ${sectionMarkup}
      </div>
    `;

    container.querySelectorAll(".dashboard-table tbody tr").forEach((tr) => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => this.showRowDetail(clickableRows[Number(tr.dataset.rowIndex)]));
    });
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
    const cards = data
      .map((row) => {
        return `
          <button type="button" class="overview-card" data-metric="${this.escapeHtml(String(row.metric ?? ""))}">
            <span class="overview-card-label">${this.escapeHtml(String(row.metric ?? "-"))}</span>
            <strong>${this.escapeHtml(String(row.value ?? "-"))}</strong>
            <span class="overview-card-context">${this.escapeHtml(String(row.context ?? ""))}</span>
          </button>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="table-info">${this.formatTableInfo(data.length)} - click a card for details</div>
      <div class="overview-grid">${cards}</div>
    `;

    container.querySelectorAll(".overview-card").forEach((card, idx) => {
      card.addEventListener("click", () => this.showRowDetail(data[idx]));
    });
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
        let displayValue = this.parseJsonString(value);
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

    overlay.classList.add("open");
  }

  closeRowDetail() {
    const overlay = this.container?.querySelector("#row-detail-overlay");
    overlay?.classList.remove("open");
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

  getCacheKey(tabId) {
    return tabId === "who" ? `${tabId}:${this.selectedRange}` : tabId;
  }

  updateRangeVisibility() {
    const rangeControl = this.container.querySelector(".dashboard-range");
    if (rangeControl) rangeControl.hidden = this.currentTab !== "who";
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

  formatCellValue(value) {
    let displayValue = value;
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
    this.container = null;
  }
}

export { AnalyticsDashboardPage };
