/**
 * ThemeManager - Theme management system
 * Handles multi-theme switching (light, grey-muted, grey-paper, dark) and persistence
 */
class ThemeManager {
    static THEMES = ["light", "grey-muted", "grey-paper", "soft-pink", "dark"];
    static THEME_LABELS = {
        "light": "Light",
        "grey-muted": "Grey (Cool)",
        "grey-paper": "Grey (Warm)",
        "soft-pink": "Soft Pink",
        "dark": "Dark"
    };

    constructor(eventBus) {
        this.eventBus = eventBus;
        this.theme = this.getInitialTheme();
        this.init();
    }

    /**
     * Determine initial theme from localStorage or system preference
     */
    getInitialTheme() {
        const stored = localStorage.getItem("theme");
        if (stored && ThemeManager.THEMES.includes(stored)) {
            return stored;
        }
        // Detect system preference
        if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
            return "dark";
        }
        return "light";
    }

    /**
     * Initialize theme manager
     */
    init() {
        this.applyTheme();
        this.setupSystemPreferenceListener();
        this.bindEvents();
    }

    /**
     * Listen for system preference changes
     */
    setupSystemPreferenceListener() {
        if (window.matchMedia) {
            window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
                // Only auto-switch if user hasn't explicitly set a preference
                if (!localStorage.getItem("theme")) {
                    this.setTheme(e.matches ? "dark" : "light", false);
                }
            });
        }
    }

    /**
     * Apply current theme to document
     */
    applyTheme() {
        // Remove all theme classes
        ThemeManager.THEMES.forEach(t => {
            document.documentElement.classList.remove(t);
        });
        // Add current theme class (light has no class, just :root defaults)
        if (this.theme !== "light") {
            document.documentElement.classList.add(this.theme);
        }
        document.documentElement.setAttribute("data-theme", this.theme);
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        if (this.eventBus) {
            this.eventBus.on("theme:toggle", () => {
                this.cycleTheme();
            });
            this.eventBus.on("theme:set", (data) => {
                if (data && data.theme) {
                    this.setTheme(data.theme);
                }
            });
        }
    }

    /**
     * Cycle through themes (for legacy toggle button)
     */
    cycleTheme() {
        const currentIndex = ThemeManager.THEMES.indexOf(this.theme);
        const nextIndex = (currentIndex + 1) % ThemeManager.THEMES.length;
        this.setTheme(ThemeManager.THEMES[nextIndex]);
    }

    /**
     * Get current theme
     * @returns {string} Current theme
     */
    getTheme() {
        return this.theme;
    }

    /**
     * Get all available themes with labels
     * @returns {Array} Array of {value, label} objects
     */
    getThemeOptions() {
        return ThemeManager.THEMES.map(t => ({
            value: t,
            label: ThemeManager.THEME_LABELS[t]
        }));
    }

    /**
     * Set theme programmatically
     * @param {string} theme - Theme to set
     * @param {boolean} persist - Whether to save to localStorage (default: true)
     */
    setTheme(theme, persist = true) {
        if (ThemeManager.THEMES.includes(theme)) {
            this.theme = theme;
            if (persist) {
                localStorage.setItem("theme", this.theme);
            }
            this.applyTheme();

            if (this.eventBus) {
                this.eventBus.emit("theme:change", {
                    theme: this.theme
                });
            }

            document.dispatchEvent(
                new CustomEvent("themeChange", {
                    detail: { theme: this.theme },
                })
            );
        }
    }

    /**
     * Check if current theme is dark
     * @returns {boolean} True if dark theme is active
     */
    isDark() {
        return this.theme === "dark";
    }

    /**
     * Check if current theme is light
     * @returns {boolean} True if light theme is active
     */
    isLight() {
        return this.theme === "light";
    }

    /**
     * Check if current theme is a grey variant
     * @returns {boolean} True if grey theme is active
     */
    isGrey() {
        return this.theme.startsWith("grey-");
    }
}

export { ThemeManager };