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
            <input type="password" id="dashboard-password" class="form-input" placeholder="Password" autocomplete="current-password" required>
          </div>
          <div class="auth-error" id="auth-error"></div>
          <button type="submit" class="btn btn-primary btn-block">Access Dashboard</button>
        </form>
      </div>
    </div>

    <!-- Dashboard Content (hidden until authenticated) -->
    <div class="dashboard-content" id="dashboard-content" style="display: none;">
      <!-- Tabs -->
      <div class="tabs-container">
        <div class="tabs-left" id="dynamic-tabs">
          <!-- Tabs will be rendered dynamically -->
        </div>
        <div class="dashboard-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="dashboard-refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Refresh
          </button>
          <button type="button" class="btn btn-outline btn-sm" id="dashboard-logout">Logout</button>
        </div>
      </div>

      <!-- Single Panel for dynamic content -->
      <div class="dashboard-panels">
        <div class="dashboard-panel active" id="dashboard-panel">
          <div class="panel-loading">Loading...</div>
          <div class="panel-content"></div>
        </div>
      </div>
    </div>

    <!-- Row Detail Modal -->
    <div class="row-detail-overlay" id="row-detail-overlay">
      <div class="row-detail-modal">
        <div class="row-detail-header">
          <h3>Row Details</h3>
          <button type="button" class="row-detail-close" id="row-detail-close">
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
