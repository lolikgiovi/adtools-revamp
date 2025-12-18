export class DashboardService {
  constructor() {
    this.baseUrl = window.location.origin;
  }

  async getSessionToken() {
    // Get the session token from localStorage
    const token = localStorage.getItem("sessionToken");
    if (!token) {
      throw new Error("No session token found. Please login first.");
    }
    return token;
  }

  async fetchDashboardData(endpoint) {
    try {
      const token = await this.getSessionToken();

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Unauthorized: Please login again");
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || "Unknown error occurred");
      }

      return data.data || [];
    } catch (error) {
      console.error(`Error fetching ${endpoint}:`, error);
      throw error;
    }
  }

  async getToolsUsage() {
    return this.fetchDashboardData("/api/dashboard/tools-usage");
  }

  async getDailyLogs() {
    return this.fetchDashboardData("/api/dashboard/daily-logs");
  }

  async getDeviceList() {
    return this.fetchDashboardData("/api/dashboard/device-list");
  }

  async getEvents() {
    return this.fetchDashboardData("/api/dashboard/events");
  }
}
