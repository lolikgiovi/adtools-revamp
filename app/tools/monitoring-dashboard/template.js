export class DashboardTemplate {
  static main() {
    return `
      <div class="monitoring-dashboard">
        <div class="dashboard-header">
          <h2>Monitoring Dashboard</h2>
          <div class="dashboard-controls">
            <span class="last-updated" id="last-updated">Never updated</span>
            <button class="btn-refresh" id="btn-refresh" title="Refresh data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
              </svg>
              Refresh
            </button>
          </div>
        </div>

        <div class="dashboard-tabs">
          <button class="tab-btn active" data-tab="tools-usage">Tools Usage</button>
          <button class="tab-btn" data-tab="daily-logs">Daily Logs</button>
          <button class="tab-btn" data-tab="device-list">Device List</button>
          <button class="tab-btn" data-tab="events">Events</button>
        </div>

        <div class="dashboard-content">
          <div class="tab-content active" id="tab-tools-usage">
            <div class="chart-container">
              <canvas id="chart-tools-usage"></canvas>
            </div>
            <div class="table-container">
              <table class="dashboard-table">
                <thead>
                  <tr>
                    <th>Tool ID</th>
                    <th>Action</th>
                    <th>Total Count</th>
                  </tr>
                </thead>
                <tbody id="table-tools-usage">
                  <tr><td colspan="3" class="loading">Loading...</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="tab-content" id="tab-daily-logs">
            <div class="table-container">
              <table class="dashboard-table">
                <thead>
                  <tr>
                    <th>User Email</th>
                    <th>Platform</th>
                    <th>Tool ID</th>
                    <th>Action</th>
                    <th>Created Time</th>
                  </tr>
                </thead>
                <tbody id="table-daily-logs">
                  <tr><td colspan="5" class="loading">Loading...</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="tab-content" id="tab-device-list">
            <div class="chart-container">
              <canvas id="chart-device-platform"></canvas>
            </div>
            <div class="table-container">
              <table class="dashboard-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Platform</th>
                  </tr>
                </thead>
                <tbody id="table-device-list">
                  <tr><td colspan="2" class="loading">Loading...</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="tab-content" id="tab-events">
            <div class="table-container">
              <table class="dashboard-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Device ID</th>
                    <th>Platform</th>
                    <th>Feature ID</th>
                    <th>Action</th>
                    <th>Properties</th>
                    <th>Created Time</th>
                  </tr>
                </thead>
                <tbody id="table-events">
                  <tr><td colspan="7" class="loading">Loading...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  static noAuth() {
    return `
      <div class="monitoring-dashboard">
        <div class="no-auth-message">
          <h2>🔒 Authentication Required</h2>
          <p>Please log in to access the monitoring dashboard.</p>
          <p class="hint">Use the registration system to get a session token.</p>
        </div>
      </div>
    `;
  }
}
