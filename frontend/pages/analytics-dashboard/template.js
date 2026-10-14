export const AnalyticsDashboardTemplate = /*html*/ `
  <section class="analytics-dashboard">
    <!-- Password Gate -->
    <div class="dashboard-auth" id="dashboard-auth">
      <div class="auth-card">
        <div class="auth-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
        <h2>Analytics Dashboard</h2>
        <p class="auth-description">Enter the dashboard password to continue</p>
        <form id="dashboard-auth-form" class="auth-form">
          <div class="form-group">
            <input type="password" id="dashboard-password" class="form-input" name="dashboard-password" aria-label="Dashboard password" placeholder="Password" autocomplete="current-password" required>
          </div>
          <div class="auth-error" id="auth-error" role="alert"></div>
          <button type="submit" class="btn btn-primary btn-block">Access Dashboard</button>
        </form>
      </div>
    </div>

    <!-- Dashboard Content (hidden until authenticated) -->
    <div class="dashboard-content" id="dashboard-content" style="display: none;">
      <header class="dashboard-heading">
        <div><h1>Usage &amp; Adoption</h1><p>Understand who uses AD Tools and what they do.</p></div>
        <div class="dashboard-session-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="dashboard-refresh">Refresh</button>
          <button type="button" class="btn btn-outline btn-sm" id="dashboard-logout">Logout</button>
        </div>
      </header>
      <!-- Primary views -->
      <div class="tabs-container">
        <div class="tabs-left" id="dynamic-tabs">
          <!-- Tabs will be rendered dynamically -->
        </div>
      </div>
      <div class="dashboard-report-heading" hidden>
        <div><h2 id="dashboard-report-title" tabindex="-1">Overview</h2><p id="dashboard-scope">Last 30 days</p></div>
      </div>
      <div class="dashboard-actions">
        <label class="dashboard-range" for="dashboard-range" hidden>
          <span class="dashboard-range-label">Time Range</span>
          <select id="dashboard-range" aria-label="Time range" class="dashboard-range-select">
            <option value="today">Today</option><option value="7d">Last 7 days</option>
            <option value="30d" selected>Last 30 days</option><option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </label>
        <label class="dashboard-search" for="dashboard-search">
          <span class="dashboard-search-label">Search</span>
          <input type="search" id="dashboard-search" name="dashboard-search" class="dashboard-search-input"
            placeholder="Search rows…" autocomplete="off">
        </label>
        <span id="config-source" hidden></span>
      </div>

      <!-- Single Panel for dynamic content -->
      <div class="dashboard-panels">
        <div class="dashboard-panel active" id="dashboard-panel">
          <div class="panel-loading" role="status">Loading…</div>
          <div class="panel-content"></div>
        </div>
      </div>
    </div>

    <!-- Row Detail Modal -->
    <div class="row-detail-overlay app-overlay-backdrop" id="row-detail-overlay" hidden>
      <div class="row-detail-modal app-overlay-surface" role="dialog" aria-modal="true" aria-labelledby="row-detail-title">
        <div class="row-detail-header">
          <h3 id="row-detail-title">Row Details</h3>
          <button type="button" class="row-detail-close app-overlay-close" id="row-detail-close" aria-label="Close row details">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="row-detail-content" id="row-detail-content"></div>
      </div>
    </div>
  </section>
`;
