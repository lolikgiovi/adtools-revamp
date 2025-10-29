import { SettingsTemplate } from './template.js';
import './styles.css';
import { SettingsService } from './service.js';
import { invoke } from '@tauri-apps/api/core';

class SettingsPage {
  constructor({ eventBus, themeManager } = {}) {
    this.eventBus = eventBus;
    this.themeManager = themeManager;
    this.service = new SettingsService({ eventBus, themeManager });
    this.container = null;
    this.categoriesRoot = null;
    this.searchInput = null;
    this.currentConfig = null;
    this._runtimeRetrySettings = false;
  }

  async mount(root) {
    if (!root) {
      console.error('SettingsPage: root container not provided');
      return;
    }

    // Render base template
    root.innerHTML = SettingsTemplate;
    this.container = root.querySelector('.settings-page');
    this.categoriesRoot = root.querySelector('.settings-categories');
    this.searchInput = root.querySelector('#settings-search');

    // Populate runtime status badge (desktop arch-aware when available)
    try {
      const { getRuntime } = await import('../../core/Runtime.js');
      const setBadge = (rt, arch) => {
        const badge = root.querySelector('#runtime-status');
        if (!badge) return;
        const isDesktop = rt === 'tauri';
        let text = isDesktop ? 'Desktop' : 'Web App';
        if (isDesktop && typeof arch === 'string') {
          const a = arch.toLowerCase();
          if (a.includes('aarch64') || a.includes('arm64')) text = 'Desktop - Apple Silicon';
          else if (a.includes('x86_64') || a.includes('amd64') || a.includes('x64')) text = 'Desktop - Intel';
        }
        badge.textContent = text;
        badge.setAttribute('data-state', isDesktop ? 'desktop' : 'web');
        const titleSuffix = isDesktop ? text : 'Browser';
        badge.setAttribute('title', isDesktop ? `Running in Tauri (${titleSuffix})` : 'Running in Browser');
      };
      const runtime = getRuntime();
      setBadge(runtime);
      // If desktop, try to get arch via Tauri backend
      if (runtime === 'tauri') {
        try {
          const arch = await invoke('get_arch');
          setBadge(runtime, arch);
        } catch (_) {
          // silent fallback to generic Desktop
        }
      }
      // One-time delayed re-check in case Tauri globals arrive slightly later
      if (!this._runtimeRetrySettings && runtime !== 'tauri') {
        this._runtimeRetrySettings = true;
        setTimeout(async () => {
          try {
            const rt2 = getRuntime();
            if (rt2 === 'tauri') {
              try {
                const arch2 = await invoke('get_arch');
                setBadge(rt2, arch2);
              } catch (_) {
                setBadge(rt2);
              }
            }
          } catch (_) {}
        }, 200);
      }
    } catch (_) {}

    // Bind toolbar actions
    root.querySelector('.settings-reload')?.addEventListener('click', () => this.reloadConfig());
    root.querySelector('.settings-check-update')?.addEventListener('click', () => this.handleManualCheckUpdate());
    this.searchInput?.addEventListener('input', () => this.applySearch());

    await this.reloadConfig();
  }

  async handleManualCheckUpdate() {
    const btn = this.container?.querySelector('.settings-check-update');
    const original = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Checking…';
    }
    try {
      const { checkUpdate, getCurrentVersionSafe } = await import('../../core/Updater.js');
      const current = await getCurrentVersionSafe();
      const result = await checkUpdate();
      if (result?.error) {
        this.eventBus?.emit?.('notification:error', { message: `Update check failed: ${result.error}` });
      } else if (result?.available) {
        this.eventBus?.emit?.('notification:success', { message: `Update available: v${result.version}` });
        // Request UI to show the optional update banner
        this.eventBus?.emit?.('update:show-banner', { result });
      } else {
        this.eventBus?.emit?.('notification:info', { message: `You're up to date (v${current})` });
        this.eventBus?.emit?.('update:hide-banner');
      }
    } catch (err) {
      this.eventBus?.emit?.('notification:error', { message: `Update check failed: ${String(err)}` });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original || 'Check for Update';
      }
    }
  }

  async reloadConfig() {
    const cfg = await this.service.loadConfig();
    this.currentConfig = cfg;
    this.renderCategories(cfg.categories || []);
  }

  applySearch() {
    const q = (this.searchInput?.value || '').trim().toLowerCase();
    if (!q) {
      this.renderCategories(this.currentConfig?.categories || []);
      return;
    }
    const filtered = this.filterConfig(this.currentConfig, q);
    this.renderCategories(filtered.categories);
  }

  filterConfig(config, q) {
    const matchItem = (item) => {
      const hay = `${item.label} ${item.key} ${item.description || ''}`.toLowerCase();
      return hay.includes(q);
    };
    const recurseCats = (cats) => {
      const result = [];
      for (const cat of cats || []) {
        if (!this.service.shouldShowCategory(cat)) continue;
        const items = (cat.items || []).filter(i => this.service.shouldShowItem(i) && matchItem(i));
        const subcats = recurseCats(cat.categories || []);
        if (items.length || subcats.length) {
          result.push({ ...cat, items, categories: subcats });
        }
      }
      return result;
    };
    return { ...config, categories: recurseCats(config.categories || []) };
  }

  renderCategories(categories) {
    if (!this.categoriesRoot) return;
    this.categoriesRoot.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const cat of categories) {
      if (!this.service.shouldShowCategory(cat)) continue;
      const el = this.renderCategory(cat);
      frag.appendChild(el);
    }
    this.categoriesRoot.appendChild(frag);
  }

  renderCategory(cat) {
    const catId = cat.id || Math.random().toString(36).slice(2);
    const expandedKey = `settings.ui.expanded.${catId}`;
    const initiallyExpanded = localStorage.getItem(expandedKey) ?? (cat.initiallyExpanded ? 'true' : 'false');
    const wrapper = document.createElement('section');
    wrapper.className = 'settings-category';
    wrapper.setAttribute('aria-expanded', initiallyExpanded === 'true' ? 'true' : 'false');

    const header = document.createElement('div');
    header.className = 'settings-category-header';
    header.innerHTML = `<h3>${cat.label}</h3><button type="button" class="settings-category-toggle" aria-label="Toggle">${initiallyExpanded === 'true' ? 'Collapse' : 'Expand'}</button>`;
    header.addEventListener('click', () => {
      const isExpanded = wrapper.getAttribute('aria-expanded') === 'true';
      const next = !isExpanded;
      wrapper.setAttribute('aria-expanded', next ? 'true' : 'false');
      header.querySelector('.settings-category-toggle').textContent = next ? 'Collapse' : 'Expand';
      localStorage.setItem(expandedKey, next ? 'true' : 'false');
    });

    const content = document.createElement('div');
    content.className = 'settings-category-content';

    // Items
    for (const item of cat.items || []) {
      if (!this.service.shouldShowItem(item)) continue;
      content.appendChild(this.renderItem(item));
    }

    // Nested categories
    for (const sub of cat.categories || []) {
      if (!this.service.shouldShowCategory(sub)) continue;
      content.appendChild(this.renderCategory(sub));
    }

    wrapper.appendChild(header);
    wrapper.appendChild(content);
    return wrapper;
  }

  renderItem(item) {
    const storageKey = item.storageKey || item.key;
    const current = this.service.getValue(storageKey, item.type, item.default);

    const wrapper = document.createElement('div');
    wrapper.className = 'setting-item';
    wrapper.setAttribute('data-setting', item.key);
    wrapper.setAttribute('data-type', item.type);
    wrapper.setAttribute('data-editing', 'false');

    const row = document.createElement('div');
    row.className = 'setting-row';

    // Inline, immediate toggles for boolean settings
    if (item.type === 'boolean') {
      row.innerHTML = `
        <div class="setting-name">${item.label}</div>
        <div class="setting-control">${this.service.inputForType('boolean', item)}</div>
      `;
      const input = row.querySelector('.setting-input');
      this.applyInitialInputValue(input, 'boolean', current);
      input.addEventListener('change', () => {
        const newVal = !!input.checked;
        this.service.setValue(storageKey, 'boolean', newVal, item.apply);
      });
      wrapper.appendChild(row);
      return wrapper;
    }

    // Action-type items render as a button that performs the action
    if (item.type === 'action') {
      row.innerHTML = `
        <div class="setting-name">${item.label}</div>
        <div class="setting-control"><button type="button" class="btn btn-primary setting-action-btn">${item.buttonLabel || 'Run'}</button></div>
      `;
      const btn = row.querySelector('.setting-action-btn');
      btn.addEventListener('click', async () => {
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Running…';
        try {
          // Currently only known action: update.check
          if (item.key === 'update.check') {
            await this.handleManualCheckUpdate();
          } else {
            this.eventBus?.emit?.('notification:info', { message: 'Action executed' });
          }
        } catch (err) {
          this.eventBus?.emit?.('notification:error', { message: String(err) || 'Action failed' });
        } finally {
          btn.disabled = false;
          btn.textContent = original || 'Run';
        }
      });
      wrapper.appendChild(row);
      return wrapper;
    }

    // Display value
    let displayValue = '';
    const isRequired = !!(item.validation && item.validation.required);
    if (item.type === 'secret') {
      displayValue = current ? '••••••••' : '—';
    } else if (item.type === 'kvlist') {
      displayValue = this.#kvPreviewHTML(Array.isArray(current) ? current : []);
    } else {
      displayValue = this.formatValueForDisplay(current, item.type);
    }

    // Non-boolean: direct inline editing when clicking the value
    row.innerHTML = `
      <div class="setting-name">${item.label}${isRequired ? ' <span class=\"setting-required\" title=\"Required\" aria-hidden=\"true\">*</span>' : ''}</div>
      <div class="setting-value editable" data-value tabindex="0" role="button" aria-label="Edit ${item.label}">
        ${displayValue}
      </div>
    `;

    const panel = document.createElement('div');
    panel.className = 'setting-edit-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="setting-edit-row">
        ${this.service.inputForType(item.type, item)}
        <div class="setting-actions">
          <button class="btn btn-primary btn-sm setting-confirm" data-action="confirm" disabled>Confirm</button>
          <button class="btn btn-secondary btn-sm setting-cancel" data-action="cancel">Cancel</button>
        </div>
      </div>
      <div class="setting-error" aria-live="polite"></div>
    `;

    const confirmBtn = panel.querySelector('.setting-confirm');
    const errorEl = panel.querySelector('.setting-error');

    // Special handling per type
    let input = null;
    let kvContainer = null;
    if (item.type === 'kvlist') {
      kvContainer = panel.querySelector('.kvlist');
      this.applyInitialInputValue(kvContainer, 'kvlist', current, item);
    } else {
      input = panel.querySelector('.setting-input');
      if (item.type === 'secret') {
        // Plain text only for initial set (no existing value)
        input.type = (current === undefined || current === null || current === '') ? 'text' : 'password';
      } else {
        this.applyInitialInputValue(input, item.type, current);
      }
    }

    const getCurrentEditValue = () => {
      if (item.type === 'kvlist') return this.extractInputValue(kvContainer, 'kvlist', item);
      return this.extractInputValue(input, item.type);
    };

    const validateAndToggle = () => {
      const value = getCurrentEditValue();
      const { valid, message } = this.service.validate(value, item.type, item.validation || {});
      errorEl.textContent = valid ? '' : message;
      confirmBtn.disabled = !valid;
    };

    // Bind kvlist actions
    if (item.type === 'kvlist') {
      panel.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        if (action === 'kv-add') {
          this.#kvAddRow(kvContainer, item);
          validateAndToggle();
        }
        if (e.target.getAttribute('data-role') === 'kv-remove') {
          const rowEl = e.target.closest('.kv-row');
          rowEl?.remove();
          validateAndToggle();
        }
      });
      panel.addEventListener('input', validateAndToggle);
    } else {
      input.addEventListener('input', validateAndToggle);
    }
    validateAndToggle();

    const openInline = () => {
      wrapper.dataset.editing = 'true';
      panel.style.display = 'flex';
      if (item.type === 'kvlist') {
        const firstKey = panel.querySelector('.kv-key');
        firstKey?.focus();
      } else {
        input?.focus();
      }
    };

    const closeInline = () => {
      wrapper.dataset.editing = 'false';
      panel.style.display = 'none';
    };

    const valueEl = row.querySelector('.setting-value.editable');
    valueEl.addEventListener('click', openInline);
    valueEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openInline();
      }
    });

    panel.addEventListener('click', async (e) => {
      const action = e.target.getAttribute('data-action');
      if (!action) return;

      if (action === 'cancel') {
        if (item.type === 'kvlist') {
          this.applyInitialInputValue(kvContainer, 'kvlist', this.service.getValue(storageKey, item.type, item.default), item);
        } else {
          const resetVal = this.service.getValue(storageKey, item.type, item.default);
          this.applyInitialInputValue(input, item.type, resetVal);
          if (item.type === 'secret') {
            input.type = (resetVal === undefined || resetVal === null || resetVal === '') ? 'text' : 'password';
          }
        }
        validateAndToggle();
        closeInline();
      }
      if (action === 'confirm') {
        const value = getCurrentEditValue();
        const { valid } = this.service.validate(value, item.type, item.validation || {});
        if (!valid) return;

        let stored;
        if (storageKey === 'secure.jenkins.token') {
          try {
            await invoke('set_jenkins_token', { token: value });
          } catch (err) {
            errorEl.textContent = String(err);
            return;
          }
          // Store a marker only, not the token itself
          stored = this.service.setValue(storageKey, 'secret', 'set', item.apply);
        } else if (storageKey === 'secure.jenkins.username') {
          try {
            await invoke('set_jenkins_username', { username: value });
          } catch (err) {
            errorEl.textContent = String(err);
            return;
          }
          // Persist username for display
          stored = this.service.setValue(storageKey, 'string', value, item.apply);
        } else if (storageKey === 'config.jenkins.url') {
          // Strong URL validation via URL parser
          try {
            const u = new URL(String(value));
            if (!u.protocol.startsWith('http')) throw new Error('URL must be http(s)');
          } catch (err) {
            errorEl.textContent = 'Invalid URL format';
            return;
          }
          stored = this.service.setValue(storageKey, 'string', value, item.apply);
        } else {
          stored = this.service.setValue(storageKey, item.type, value, item.apply);
        }

        let display = '';
        if (item.type === 'secret') {
          display = stored ? '••••••••' : '—';
        } else if (item.type === 'kvlist') {
          display = this.#kvPreviewHTML(Array.isArray(stored) ? stored : []);
        } else {
          display = this.formatValueForDisplay(stored, item.type);
        }
        row.querySelector('[data-value]').innerHTML = display;
        closeInline();
      }
    });

    wrapper.appendChild(row);
    wrapper.appendChild(panel);
    return wrapper;
  }

  #kvAddRow(container, item, rowData = { key: '', value: '' }) {
    const rows = container.querySelector('.kv-rows');
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
      <input type="text" class="kv-key" placeholder="${item.keyPlaceholder || 'Environment'}" aria-label="Environment"/>
      <input type="url" class="kv-value" placeholder="${item.valuePlaceholder || 'Base URL'}" aria-label="Base URL"/>
      <button type="button" class="btn btn-outline btn-sm kv-remove" data-role="kv-remove" aria-label="Remove">Remove</button>
    `;
    row.querySelector('.kv-key').value = rowData.key || '';
    row.querySelector('.kv-value').value = rowData.value || '';
    rows.appendChild(row);
  }

  applyInitialInputValue(inputOrContainer, type, value, item) {
    if (!inputOrContainer) return;
    switch (type) {
      case 'boolean':
        inputOrContainer.checked = value === true || value === 'true';
        break;
      case 'kvlist': {
        const container = inputOrContainer;
        const rows = container.querySelector('.kv-rows');
        rows.innerHTML = '';
        const arr = Array.isArray(value) ? value : [];
        if (arr.length === 0) {
          this.#kvAddRow(container, item);
        } else {
          for (const pair of arr) {
            this.#kvAddRow(container, item, pair);
          }
        }
        break;
      }
      default:
        inputOrContainer.value = value ?? '';
        break;
    }
  }

  extractInputValue(inputOrContainer, type) {
    if (!inputOrContainer) return undefined;
    switch (type) {
      case 'number':
        return inputOrContainer.value === '' ? undefined : Number(inputOrContainer.value);
      case 'boolean':
        return !!inputOrContainer.checked;
      case 'kvlist': {
        const rows = inputOrContainer.querySelectorAll('.kv-row');
        const result = [];
        rows.forEach((row) => {
          const key = row.querySelector('.kv-key')?.value?.trim() || '';
          const value = row.querySelector('.kv-value')?.value?.trim() || '';
          result.push({ key, value });
        });
        return result;
      }
      default:
        return inputOrContainer.value;
    }
  }

  formatValueForDisplay(value, type) {
    if (type === 'kvlist') {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) return '(Empty, add new one)';
      // non-empty handled via kv preview to avoid [object Object]
      return this.#kvPreviewHTML(arr);
    }
    if (value === undefined || value === null || value === '') return '—';
    switch (type) {
      case 'boolean': return value === true || value === 'true' ? 'On' : 'Off';
      case 'color': return String(value);
      case 'date':
      case 'time':
      case 'datetime':
      default: return String(value);
    }
  }

  #kvPreviewHTML(pairs) {
    if (!pairs || pairs.length === 0) return '(Empty, add new one)';
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    return `
      <div class="kvlist-preview">
        ${pairs.map(p => `
          <div class="kvlist-preview-row">
            <span class="kvlist-env">${esc(p.key)}</span>
            <span class="kvlist-arrow">→</span>
            <span class="kvlist-url">${esc(p.value)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  deactivate() {
    this.container = null;
    this.categoriesRoot = null;
    this.searchInput = null;
    this.currentConfig = null;
    this._runtimeRetrySettings = false;
  }
}

export { SettingsPage };