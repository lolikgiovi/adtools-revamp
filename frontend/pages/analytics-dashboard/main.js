/**
 * Analytics Dashboard Page
 * Password-protected internal analytics viewer
 */
import { AnalyticsDashboardTemplate } from './template.js';
import './styles.css';

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : '';
const TOKEN_KEY = 'analytics.dashboard.token';

class AnalyticsDashboardPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.container = null;
    this.token = null;
    this.currentTab = 'tools';
    this.cache = {};
  }

  mount(root) {
    if (!root) return;
    root.innerHTML = AnalyticsDashboardTemplate;
    this.container = root.querySelector('.analytics-dashboard');
    
    // Check for existing token
    try {
      const stored = sessionStorage.getItem(TOKEN_KEY);
      if (stored) {
        const payload = JSON.parse(atob(stored));
        if (payload.exp && payload.exp > Date.now()) {
          this.token = stored;
          this.showDashboard();
          this.loadCurrentTab();
        }
      }
    } catch (_) {}
    
    this.bindEvents();
  }

  bindEvents() {
    // Auth form
    const form = this.container.querySelector('#dashboard-auth-form');
    form?.addEventListener('submit', (e) => this.handleAuth(e));

    // Tabs
    this.container.querySelectorAll('.tab-button').forEach((tab) => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Refresh
    this.container.querySelector('#dashboard-refresh')?.addEventListener('click', () => {
      this.cache = {};
      this.loadCurrentTab();
    });

    // Logout
    this.container.querySelector('#dashboard-logout')?.addEventListener('click', () => {
      this.logout();
    });

    // Row detail modal close
    this.container.querySelector('#row-detail-close')?.addEventListener('click', () => {
      this.closeRowDetail();
    });
    this.container.querySelector('#row-detail-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'row-detail-overlay') this.closeRowDetail();
    });
    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeRowDetail();
    });
  }

  async handleAuth(e) {
    e.preventDefault();
    const passwordInput = this.container.querySelector('#dashboard-password');
    const errorEl = this.container.querySelector('#auth-error');
    const password = passwordInput?.value || '';

    errorEl.textContent = '';
    
    try {
      const res = await fetch(`${API_BASE}/dashboard/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      const data = await res.json();
      
      if (data.ok && data.token) {
        this.token = data.token;
        try {
          sessionStorage.setItem(TOKEN_KEY, data.token);
        } catch (_) {}
        this.showDashboard();
        this.loadCurrentTab();
      } else {
        errorEl.textContent = data.error || 'Invalid password';
        passwordInput.focus();
      }
    } catch (err) {
      errorEl.textContent = 'Connection error. Please try again.';
    }
  }

  showDashboard() {
    this.container.querySelector('#dashboard-auth').style.display = 'none';
    this.container.querySelector('#dashboard-content').style.display = 'block';
  }

  logout() {
    this.token = null;
    this.cache = {};
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
    this.container.querySelector('#dashboard-auth').style.display = 'flex';
    this.container.querySelector('#dashboard-content').style.display = 'none';
    this.container.querySelector('#dashboard-password').value = '';
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    
    // Update active tab
    this.container.querySelectorAll('.tab-button').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    
    // Update active panel
    this.container.querySelectorAll('.dashboard-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${tabId}`);
    });
    
    this.loadCurrentTab();
  }

  async loadCurrentTab() {
    const endpoints = {
      'tools': '/dashboard/stats/tools',
      'daily': '/dashboard/stats/daily',
      'devices': '/dashboard/stats/devices',
      'events': '/dashboard/stats/events',
      'quick-query': '/dashboard/stats/quick-query',
      'quick-query-errors': '/dashboard/stats/quick-query-errors',
    };

    const endpoint = endpoints[this.currentTab];
    if (!endpoint) return;

    const panel = this.container.querySelector(`#panel-${this.currentTab}`);
    const loading = panel?.querySelector('.panel-loading');
    const content = panel?.querySelector('.panel-content');
    
    if (!panel || !content) return;

    // Check cache
    if (this.cache[this.currentTab]) {
      this.renderTable(content, this.cache[this.currentTab], this.currentTab);
      return;
    }

    loading.style.display = 'block';
    content.innerHTML = '';

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${this.token}` },
      });

      if (res.status === 401) {
        this.logout();
        return;
      }

      const data = await res.json();
      
      if (data.ok && Array.isArray(data.data)) {
        this.cache[this.currentTab] = data.data;
        this.renderTable(content, data.data, this.currentTab);
      } else {
        content.innerHTML = `<div class="panel-error">${data.error || 'Failed to load data'}</div>`;
      }
    } catch (err) {
      content.innerHTML = `<div class="panel-error">Connection error: ${err.message}</div>`;
    } finally {
      loading.style.display = 'none';
    }
  }

  renderTable(container, data, tabId) {
    if (!data.length) {
      container.innerHTML = '<div class="panel-empty">No data available</div>';
      return;
    }

    // Define columns per tab
    const columnConfig = {
      'tools': ['tool_id', 'action', 'total_count'],
      'daily': ['user_email', 'platform', 'tool_id', 'action'],
      'devices': ['email', 'platform'],
      'events': ['email', 'platform', 'feature_id', 'action', 'properties'],
      'quick-query': ['time', 'user', 'platform', 'type', 'table_name', 'row_count', 'attachment'],
      'quick-query-errors': ['time', 'user', 'platform', 'action', 'table_name', 'field', 'error'],
    };

    const columns = columnConfig[tabId] || Object.keys(data[0] || {});
    
    const headerCells = columns.map((col) => `<th>${this.formatHeader(col)}</th>`).join('');
    const rows = data.map((row) => {
      const cells = columns.map((col) => {
        let value = row[col];
        // JSON stringify objects
        if (typeof value === 'object' && value !== null) {
          value = JSON.stringify(value);
        }
        // Truncate long values
        if (typeof value === 'string' && value.length > 100) {
          value = value.slice(0, 100) + '…';
        }
        return `<td title="${this.escapeHtml(String(value ?? ''))}">${this.escapeHtml(String(value ?? '-'))}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    container.innerHTML = `
      <div class="table-info">Showing ${data.length} row${data.length !== 1 ? 's' : ''} – click a row for details</div>
      <div class="table-wrapper">
        <table class="dashboard-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // Bind row click events
    container.querySelectorAll('.dashboard-table tbody tr').forEach((tr, idx) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => this.showRowDetail(data[idx]));
    });
  }

  showRowDetail(row) {
    if (!row) return;
    const overlay = this.container.querySelector('#row-detail-overlay');
    const content = this.container.querySelector('#row-detail-content');
    if (!overlay || !content) return;

    // Build transposed table (key-value pairs)
    const rows = Object.entries(row).map(([key, value]) => {
      let displayValue = value;
      // Pretty print objects/arrays
      if (typeof value === 'object' && value !== null) {
        try {
          displayValue = JSON.stringify(value, null, 2);
        } catch (_) {
          displayValue = String(value);
        }
      }
      return `
        <tr>
          <th>${this.escapeHtml(this.formatHeader(key))}</th>
          <td><pre>${this.escapeHtml(String(displayValue ?? '-'))}</pre></td>
        </tr>
      `;
    }).join('');

    content.innerHTML = `
      <table class="row-detail-table">
        <tbody>${rows}</tbody>
      </table>
    `;

    overlay.classList.add('open');
  }

  closeRowDetail() {
    const overlay = this.container?.querySelector('#row-detail-overlay');
    overlay?.classList.remove('open');
  }

  formatHeader(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  deactivate() {
    this.container = null;
  }
}

export { AnalyticsDashboardPage };
