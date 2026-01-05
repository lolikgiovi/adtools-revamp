/**
 * Analytics Dashboard Page
 * Password-protected internal analytics viewer
 * Tabs are fetched dynamically from the API
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
    this.tabs = [];
    this.currentTab = null;
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
          this.loadTabs();
        }
      }
    } catch (_) {}
    
    this.bindEvents();
  }

  bindEvents() {
    // Auth form
    const form = this.container.querySelector('#dashboard-auth-form');
    form?.addEventListener('submit', (e) => this.handleAuth(e));

    // Refresh
    this.container.querySelector('#dashboard-refresh')?.addEventListener('click', () => {
      this.cache = {};
      this.loadCurrentTabData();
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
        this.loadTabs();
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
    this.tabs = [];
    this.currentTab = null;
    this.cache = {};
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
    this.container.querySelector('#dashboard-auth').style.display = 'flex';
    this.container.querySelector('#dashboard-content').style.display = 'none';
    this.container.querySelector('#dashboard-password').value = '';
  }

  async loadTabs() {
    const tabsContainer = this.container.querySelector('#dynamic-tabs');
    const sourceIndicator = this.container.querySelector('#config-source');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = '<span style="color: hsl(var(--muted-foreground)); font-size: 0.875rem;">Loading tabs...</span>';

    try {
      const res = await fetch(`${API_BASE}/dashboard/tabs`, {
        headers: { 'Authorization': `Bearer ${this.token}` },
      });

      if (res.status === 401) {
        this.logout();
        return;
      }

      const data = await res.json();
      
      if (data.ok && Array.isArray(data.tabs)) {
        this.tabs = data.tabs;
        this.configSource = data.source || 'defaults';
        this.renderTabs();
        // Show source indicator
        if (sourceIndicator) {
          const label = this.configSource === 'kv' ? 'KV Config' : 'Defaults';
          sourceIndicator.innerHTML = `<span class="config-source-badge ${this.configSource}">${label}</span>`;
        }
        // Auto-select first tab
        if (this.tabs.length > 0) {
          this.switchTab(this.tabs[0].id);
        }
      } else {
        tabsContainer.innerHTML = `<span style="color: hsl(var(--destructive));">${data.error || 'Failed to load tabs'}</span>`;
      }
    } catch (err) {
      tabsContainer.innerHTML = `<span style="color: hsl(var(--destructive));">Error: ${err.message}</span>`;
    }
  }

  renderTabs() {
    const tabsContainer = this.container.querySelector('#dynamic-tabs');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = this.tabs.map((tab, idx) => 
      `<button type="button" class="tab-button${idx === 0 ? ' active' : ''}" data-tab="${tab.id}">${this.escapeHtml(tab.name)}</button>`
    ).join('');

    // Bind click events
    tabsContainer.querySelectorAll('.tab-button').forEach((btn) => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });
  }

  switchTab(tabId) {
    this.currentTab = tabId;
    
    // Update active tab button
    this.container.querySelectorAll('#dynamic-tabs .tab-button').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    
    this.loadCurrentTabData();
  }

  async loadCurrentTabData() {
    if (!this.currentTab) return;

    const panel = this.container.querySelector('#dashboard-panel');
    const loading = panel?.querySelector('.panel-loading');
    const content = panel?.querySelector('.panel-content');
    
    if (!panel || !content) return;

    // Check cache
    if (this.cache[this.currentTab]) {
      this.renderTable(content, this.cache[this.currentTab]);
      return;
    }

    loading.style.display = 'block';
    content.innerHTML = '';

    try {
      const res = await fetch(`${API_BASE}/dashboard/query`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}` 
        },
        body: JSON.stringify({ tabId: this.currentTab }),
      });

      if (res.status === 401) {
        this.logout();
        return;
      }

      const data = await res.json();
      
      if (data.ok && Array.isArray(data.data)) {
        this.cache[this.currentTab] = data.data;
        this.renderTable(content, data.data);
      } else {
        content.innerHTML = `<div class="panel-error">${data.error || 'Failed to load data'}</div>`;
      }
    } catch (err) {
      content.innerHTML = `<div class="panel-error">Connection error: ${err.message}</div>`;
    } finally {
      loading.style.display = 'none';
    }
  }

  renderTable(container, data) {
    if (!data.length) {
      container.innerHTML = '<div class="panel-empty">No data available</div>';
      return;
    }

    // Infer columns from first row
    const columns = Object.keys(data[0] || {});
    
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
