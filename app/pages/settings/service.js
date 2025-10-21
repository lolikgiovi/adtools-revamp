class SettingsService {
  constructor({ eventBus, themeManager } = {}) {
    this.eventBus = eventBus;
    this.themeManager = themeManager;
    this.userRole = localStorage.getItem("user.role") || "user";
  }

  async loadConfig() {
    try {
      const url = new URL("./config.json", import.meta.url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load settings config: ${res.status}`);
      const json = await res.json();
      return json;
    } catch (err) {
      console.error(err);
      this.eventBus?.emit?.("notification:error", { message: "Unable to load settings configuration" });
      return { version: 1, categories: [] };
    }
  }

  shouldShowCategory(cat) {
    if (!cat) return false;
    if (Array.isArray(cat.roles) && cat.roles.length) {
      return cat.roles.includes(this.userRole);
    }
    return true; // visible by default
  }

  shouldShowItem(item) {
    if (!item) return false;
    if (Array.isArray(item.roles) && item.roles.length) {
      return item.roles.includes(this.userRole);
    }
    return true;
  }

  getValue(key, type, defaultValue) {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "null") {
      if (type === "boolean" && defaultValue === "system") {
        try {
          const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          return !!prefersDark;
        } catch (_) {
          return false;
        }
      }
      if (type === "enum" && defaultValue === "system") {
        try {
          const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          return prefersDark ? "dark" : "light";
        } catch (_) {
          return "light";
        }
      }
      if (type === "kvlist") {
        return Array.isArray(defaultValue) ? defaultValue : [];
      }
      return defaultValue;
    }
    try {
      switch (type) {
        case "number":
          return raw === "" ? defaultValue : Number(raw);
        case "boolean":
          return raw === "true";
        case "kvlist": {
          try {
            const val = JSON.parse(raw);
            return Array.isArray(val) ? val : [];
          } catch (_) {
            return [];
          }
        }
        case "date":
        case "time":
        case "datetime":
        case "string":
        case "color":
        case "enum":
        default:
          return raw;
      }
    } catch (_) {
      return defaultValue;
    }
  }

  setValue(key, type, value, applyHint) {
    let storeVal = value;
    switch (type) {
      case "number":
        storeVal = String(value);
        break;
      case "boolean":
        storeVal = value ? "true" : "false";
        break;
      case "kvlist":
        storeVal = JSON.stringify(Array.isArray(value) ? value : []);
        break;
      case "date":
      case "time":
      case "datetime":
      case "string":
      case "color":
      case "enum":
      default:
        storeVal = String(value ?? "");
        break;
    }

    localStorage.setItem(key, storeVal);

    if (applyHint === "theme") {
      let theme = storeVal;
      if (type === "boolean") {
        theme = value ? "dark" : "light";
      }
      this.themeManager?.setTheme?.(theme);
    }

    this.eventBus?.emit?.("notification:success", { message: "Setting saved", duration: 1000 });
    return type === 'kvlist' ? (Array.isArray(value) ? value : []) : storeVal;
  }

  validate(value, type, rules = {}) {
    if (rules.required && (value === undefined || value === null || value === "")) {
      return { valid: false, message: "This field is required" };
    }

    switch (type) {
      case "number": {
        const num = Number(value);
        if (Number.isNaN(num)) return { valid: false, message: "Must be a number" };
        if (typeof rules.min === "number" && num < rules.min) return { valid: false, message: `Minimum is ${rules.min}` };
        if (typeof rules.max === "number" && num > rules.max) return { valid: false, message: `Maximum is ${rules.max}` };
        return { valid: true };
      }
      case "kvlist": {
        const rows = Array.isArray(value) ? value : [];
        for (const { key, value: url } of rows) {
          if (!key && !url) continue; // allow empty row while editing
          if (!key) return { valid: false, message: "Environment is required" };
          if (!url) return { valid: false, message: "Base URL is required" };
          try {
            const u = new URL(url);
            if (!u.protocol.startsWith('http')) return { valid: false, message: "URL must be http(s)" };
          } catch (_) {
            return { valid: false, message: "Invalid URL format" };
          }
        }
        return { valid: true };
      }
      case "secret":
      case "string": {
        if (typeof rules.minLength === "number" && String(value).length < rules.minLength) return { valid: false, message: `Min length is ${rules.minLength}` };
        if (typeof rules.maxLength === "number" && String(value).length > rules.maxLength) return { valid: false, message: `Max length is ${rules.maxLength}` };
        if (rules.pattern) {
          try {
            const re = new RegExp(rules.pattern, rules.patternFlags || undefined);
            if (!re.test(String(value))) return { valid: false, message: "Invalid format" };
          } catch (_) {}
        }
        return { valid: true };
      }
      case "enum": {
        if (Array.isArray(rules.allowedValues) && rules.allowedValues.length) {
          if (!rules.allowedValues.includes(value)) return { valid: false, message: "Invalid option" };
        }
        return { valid: true };
      }
      case "boolean":
      case "color":
      case "date":
      case "time":
      case "datetime":
      default:
        return { valid: true };
    }
  }

  inputForType(type, item) {
    switch (type) {
      case 'boolean': {
        // Daisy-like toggle styling
        return `
          <label class="switch">
            <input type="checkbox" class="setting-input" aria-label="${item.label}">
            <span class="slider"></span>
          </label>
        `;
      }
      case 'kvlist': {
        return `
          <div class="kvlist">
            <div class="kv-rows"></div>
            <div class="kv-actions">
              <button type="button" class="btn kv-add" data-action="kv-add">Add</button>
            </div>
          </div>
        `;
      }
      case 'secret': {
        // Stricter security: no show/hide or copy; only replacement
        return `
          <input type="password" class="setting-input" placeholder="Enter new token" aria-label="${item.label}">
        `;
      }
      default: {
        return `<input type="text" class="setting-input" aria-label="${item.label}">`;
      }
    }
  }
}

export { SettingsService };