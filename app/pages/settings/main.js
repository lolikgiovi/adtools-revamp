import { SettingsTemplate } from './template.js';
import './styles.css';
import { SettingsService } from './service.js';

class SettingsPage {
  constructor({ eventBus, themeManager } = {}) {
    this.eventBus = eventBus;
    this.themeManager = themeManager;
    this.service = new SettingsService({ eventBus, themeManager });
    this.container = null;
    this.categoriesRoot = null;
    this.searchInput = null;
    this.currentConfig = null;
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

    // Bind toolbar actions
    root.querySelector('.settings-reload')?.addEventListener('click', () => this.reloadConfig());
    this.searchInput?.addEventListener('input', () => this.applySearch());

    await this.reloadConfig();
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

    // Display value
    let displayValue = '';
    if (item.type === 'secret') {
      displayValue = current ? '••••••••' : '—';
    } else if (item.type === 'kvlist') {
      displayValue = this.#kvPreviewHTML(Array.isArray(current) ? current : []);
    } else {
      displayValue = this.formatValueForDisplay(current, item.type);
    }

    // Non-boolean: direct inline editing when clicking the value
    row.innerHTML = `
      <div class="setting-name">${item.label}</div>
      <div class="setting-value editable" data-value tabindex="0" role="button" aria-label="Edit ${item.label}">
        ${displayValue}
      </div>
    `;

    const panel = document.createElement('div');
    panel.className = 'setting-edit-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      ${this.service.inputForType(item.type, item)}
      <div class="setting-actions">
        <button class="setting-confirm" data-action="confirm" disabled>Confirm</button>
        <button class="setting-cancel" data-action="cancel">Cancel</button>
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

    panel.addEventListener('click', (e) => {
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
        const stored = this.service.setValue(storageKey, item.type, value, item.apply);
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
      <button type="button" class="btn btn-icon kv-remove" data-role="kv-remove" aria-label="Remove">Remove</button>
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
  }
}

export { SettingsPage };