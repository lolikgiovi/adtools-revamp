/**
 * ThemeManager - Theme management system
 * Handles dark/light mode switching and persistence
 */
class ThemeManager {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.theme = localStorage.getItem("theme") || "light";
        this.init();
    }

    /**
     * Initialize theme manager
     */
    init() {
        this.applyTheme();
        this.setupThemeToggle();
        this.bindEvents();
    }

    /**
     * Apply current theme to document
     */
    applyTheme() {
        document.documentElement.classList.toggle("dark", this.theme === "dark");
        document.documentElement.setAttribute('data-theme', this.theme);
    }

    /**
     * Setup theme toggle functionality
     */
    setupThemeToggle() {
        // Add theme toggle button if needed
        const themeToggle = document.querySelector("[data-theme-toggle]");
        if (themeToggle) {
            themeToggle.addEventListener("click", () => {
                this.toggleTheme();
            });
        }
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        if (this.eventBus) {
            this.eventBus.on('theme:toggle', () => {
                this.toggleTheme();
            });
        }
    }

    /**
     * Toggle between light and dark themes
     */
    toggleTheme() {
        this.theme = this.theme === "light" ? "dark" : "light";
        localStorage.setItem("theme", this.theme);
        this.applyTheme();

        // Emit theme change event
        if (this.eventBus) {
            this.eventBus.emit("theme:change", {
                theme: this.theme
            });
        }

        // Also emit custom DOM event for compatibility
        document.dispatchEvent(
            new CustomEvent("themeChange", {
                detail: { theme: this.theme },
            })
        );
    }

    /**
     * Get current theme
     * @returns {string} Current theme ('light' or 'dark')
     */
    getTheme() {
        return this.theme;
    }

    /**
     * Set theme programmatically
     * @param {string} theme - Theme to set ('light' or 'dark')
     */
    setTheme(theme) {
        if (["light", "dark"].includes(theme)) {
            this.theme = theme;
            localStorage.setItem("theme", this.theme);
            this.applyTheme();

            if (this.eventBus) {
                this.eventBus.emit("theme:change", {
                    theme: this.theme
                });
            }
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
}

export { ThemeManager };