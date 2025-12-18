import { BaseTool } from "../../core/BaseTool.js";
import { DashboardTemplate } from "./template.js";
import { DashboardService } from "./services/DashboardService.js";
import { getIconSvg } from "./icon.js";
import Chart from "chart.js/auto";
import "./styles.css";

export class MonitoringDashboard extends BaseTool {
  constructor(eventBus) {
    super({
      id: "monitoring-dashboard",
      name: "Monitoring Dashboard",
      description: "View usage analytics and monitoring data",
      icon: "dashboard",
      category: "Admin",
      keywords: ["monitoring", "analytics", "dashboard", "admin", "usage", "stats"],
      eventBus,
    });

    this.service = new DashboardService();
    this.charts = {};
    this.currentTab = "tools-usage";
    this.lastUpdated = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return DashboardTemplate.main();
  }

  async onMount() {
    // Check if user has valid session token
    const hasSession = await this.checkSession();
    if (!hasSession) {
      this.showNoAuthMessage();
      return;
    }

    this.bindElements();
    this.setupEventListeners();
    await this.loadData();
  }

  async checkSession() {
    try {
      const token = localStorage.getItem("sessionToken");
      return !!token;
    } catch (error) {
      console.error("Error checking session:", error);
      return false;
    }
  }

  showNoAuthMessage() {
    const container = this.container.querySelector(".monitoring-dashboard");
    if (container) {
      container.innerHTML = DashboardTemplate.noAuth();
    }
  }

  bindElements() {
    this.elements = {
      refreshBtn: this.container.querySelector("#btn-refresh"),
      lastUpdated: this.container.querySelector("#last-updated"),
      tabBtns: this.container.querySelectorAll(".tab-btn"),
      tabContents: this.container.querySelectorAll(".tab-content"),

      // Tables
      tableToolsUsage: this.container.querySelector("#table-tools-usage"),
      tableDailyLogs: this.container.querySelector("#table-daily-logs"),
      tableDeviceList: this.container.querySelector("#table-device-list"),
      tableEvents: this.container.querySelector("#table-events"),

      // Charts
      chartToolsUsage: this.container.querySelector("#chart-tools-usage"),
      chartDevicePlatform: this.container.querySelector("#chart-device-platform"),
    };
  }

  setupEventListeners() {
    // Refresh button
    if (this.elements.refreshBtn) {
      this.elements.refreshBtn.addEventListener("click", () => this.loadData());
    }

    // Tab buttons
    this.elements.tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });
  }

  switchTab(tabId) {
    this.currentTab = tabId;

    // Update button states
    this.elements.tabBtns.forEach((btn) => {
      if (btn.dataset.tab === tabId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Update content visibility
    this.elements.tabContents.forEach((content) => {
      if (content.id === `tab-${tabId}`) {
        content.classList.add("active");
      } else {
        content.classList.remove("active");
      }
    });
  }

  async loadData() {
    this.setLoading(true);

    try {
      // Load all data in parallel
      const [toolsUsageData, dailyLogsData, deviceListData, eventsData] = await Promise.all([
        this.service.getToolsUsage(),
        this.service.getDailyLogs(),
        this.service.getDeviceList(),
        this.service.getEvents(),
      ]);

      // Render data
      this.renderToolsUsage(toolsUsageData);
      this.renderDailyLogs(dailyLogsData);
      this.renderDeviceList(deviceListData);
      this.renderEvents(eventsData);

      // Update last updated time
      this.lastUpdated = new Date();
      this.updateLastUpdatedTime();
    } catch (error) {
      console.error("Error loading dashboard data:", error);
      this.showError(error.message);
    } finally {
      this.setLoading(false);
    }
  }

  setLoading(loading) {
    if (this.elements.refreshBtn) {
      this.elements.refreshBtn.disabled = loading;
      if (loading) {
        this.elements.refreshBtn.classList.add("loading");
      } else {
        this.elements.refreshBtn.classList.remove("loading");
      }
    }
  }

  updateLastUpdatedTime() {
    if (this.elements.lastUpdated && this.lastUpdated) {
      const timeStr = this.lastUpdated.toLocaleTimeString();
      this.elements.lastUpdated.textContent = `Last updated: ${timeStr}`;
    }
  }

  renderToolsUsage(data) {
    // Render table
    if (this.elements.tableToolsUsage) {
      if (data.length === 0) {
        this.elements.tableToolsUsage.innerHTML = '<tr><td colspan="3">No data available</td></tr>';
      } else {
        this.elements.tableToolsUsage.innerHTML = data
          .map(
            (row) => `
          <tr>
            <td>${this.escapeHtml(row.tool_id)}</td>
            <td>${this.escapeHtml(row.action)}</td>
            <td>${this.formatNumber(row.total_count)}</td>
          </tr>
        `
          )
          .join("");
      }
    }

    // Render chart
    this.renderToolsUsageChart(data);
  }

  renderToolsUsageChart(data) {
    if (!this.elements.chartToolsUsage) return;

    // Destroy existing chart
    if (this.charts.toolsUsage) {
      this.charts.toolsUsage.destroy();
    }

    // Take top 10 for readability
    const topData = data.slice(0, 10);

    const ctx = this.elements.chartToolsUsage.getContext("2d");
    this.charts.toolsUsage = new Chart(ctx, {
      type: "bar",
      data: {
        labels: topData.map((d) => `${d.tool_id} (${d.action})`),
        datasets: [
          {
            label: "Usage Count",
            data: topData.map((d) => d.total_count),
            backgroundColor: "rgba(59, 130, 246, 0.5)",
            borderColor: "rgba(59, 130, 246, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          title: {
            display: true,
            text: "Top 10 Tool Usage",
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    });
  }

  renderDailyLogs(data) {
    if (this.elements.tableDailyLogs) {
      if (data.length === 0) {
        this.elements.tableDailyLogs.innerHTML = '<tr><td colspan="5">No logs for today</td></tr>';
      } else {
        this.elements.tableDailyLogs.innerHTML = data
          .map(
            (row) => `
          <tr>
            <td>${this.escapeHtml(row.user_email)}</td>
            <td>${this.escapeHtml(row.platform)}</td>
            <td>${this.escapeHtml(row.tool_id)}</td>
            <td>${this.escapeHtml(row.action)}</td>
            <td>${this.formatTimestamp(row.created_time)}</td>
          </tr>
        `
          )
          .join("");
      }
    }
  }

  renderDeviceList(data) {
    // Render table
    if (this.elements.tableDeviceList) {
      if (data.length === 0) {
        this.elements.tableDeviceList.innerHTML = '<tr><td colspan="2">No devices found</td></tr>';
      } else {
        this.elements.tableDeviceList.innerHTML = data
          .map(
            (row) => `
          <tr>
            <td>${this.escapeHtml(row.email)}</td>
            <td>${this.escapeHtml(row.platform)}</td>
          </tr>
        `
          )
          .join("");
      }
    }

    // Render chart
    this.renderDevicePlatformChart(data);
  }

  renderDevicePlatformChart(data) {
    if (!this.elements.chartDevicePlatform) return;

    // Destroy existing chart
    if (this.charts.devicePlatform) {
      this.charts.devicePlatform.destroy();
    }

    // Count platforms
    const platformCounts = {};
    data.forEach((row) => {
      const platform = row.platform || "Unknown";
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    });

    const labels = Object.keys(platformCounts);
    const counts = Object.values(platformCounts);

    const ctx = this.elements.chartDevicePlatform.getContext("2d");
    this.charts.devicePlatform = new Chart(ctx, {
      type: "pie",
      data: {
        labels: labels,
        datasets: [
          {
            data: counts,
            backgroundColor: [
              "rgba(59, 130, 246, 0.7)",
              "rgba(16, 185, 129, 0.7)",
              "rgba(245, 158, 11, 0.7)",
              "rgba(239, 68, 68, 0.7)",
              "rgba(139, 92, 246, 0.7)",
              "rgba(236, 72, 153, 0.7)",
            ],
            borderColor: "#ffffff",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
          },
          title: {
            display: true,
            text: "Platform Distribution",
          },
        },
      },
    });
  }

  renderEvents(data) {
    if (this.elements.tableEvents) {
      if (data.length === 0) {
        this.elements.tableEvents.innerHTML = '<tr><td colspan="7">No events found</td></tr>';
      } else {
        this.elements.tableEvents.innerHTML = data
          .map(
            (row) => `
          <tr>
            <td>${this.escapeHtml(row.email)}</td>
            <td>${this.escapeHtml(row.device_id)}</td>
            <td>${this.escapeHtml(row.platform)}</td>
            <td>${this.escapeHtml(row.feature_id)}</td>
            <td>${this.escapeHtml(row.action)}</td>
            <td>${this.formatProperties(row.properties)}</td>
            <td>${this.formatTimestamp(row.created_time)}</td>
          </tr>
        `
          )
          .join("");
      }
    }
  }

  formatProperties(props) {
    if (!props) return "";
    try {
      const parsed = typeof props === "string" ? JSON.parse(props) : props;
      return `<code>${this.escapeHtml(JSON.stringify(parsed, null, 2))}</code>`;
    } catch {
      return this.escapeHtml(String(props));
    }
  }

  formatTimestamp(ts) {
    if (!ts) return "";
    try {
      const date = new Date(ts);
      return date.toLocaleString();
    } catch {
      return this.escapeHtml(String(ts));
    }
  }

  formatNumber(num) {
    return Number(num).toLocaleString();
  }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str || "");
    return div.innerHTML;
  }

  showError(message) {
    // Show error notification
    if (window.app && window.app.showNotification) {
      window.app.showNotification(message, "error");
    } else {
      alert(`Error: ${message}`);
    }
  }

  onUnmount() {
    // Destroy all charts
    Object.values(this.charts).forEach((chart) => {
      if (chart && chart.destroy) {
        chart.destroy();
      }
    });
    this.charts = {};
  }
}
