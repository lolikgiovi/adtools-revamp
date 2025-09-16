/**
 * Breadcrumb - Navigation breadcrumb component
 * Manages breadcrumb navigation and updates
 */
class Breadcrumb {
    constructor(options = {}) {
        this.eventBus = options.eventBus;
        this.router = options.router;
        this.app = options.app;
        
        this.breadcrumbElement = null;
        this.currentPageElement = null;
        
        this.init();
    }

    /**
     * Initialize the breadcrumb component
     */
    init() {
        this.setupDOM();
        this.bindEvents();
        this.updateBreadcrumb();
    }

    /**
     * Setup DOM references
     */
    setupDOM() {
        this.breadcrumbElement = document.querySelector('.breadcrumb');
        this.currentPageElement = document.querySelector('.breadcrumb-current span');
        
        if (!this.breadcrumbElement) {
            console.error('Breadcrumb element not found');
            return;
        }

        // Setup home link click handler
        const homeLink = this.breadcrumbElement.querySelector('.breadcrumb-link');
        if (homeLink) {
            homeLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateToHome();
            });
        }
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        if (this.eventBus) {
            this.eventBus.on('page:changed', (data) => {
                this.updateBreadcrumb(data);
            });
        }
    }

    /**
     * Update breadcrumb based on current page
     * @param {Object} pageData - Page change data
     */
    updateBreadcrumb(pageData = {}) {
        if (!this.currentPageElement) return;

        const { page, toolId } = pageData;

        if (page === 'home' || !page) {
            this.currentPageElement.textContent = 'Home';
        } else if (page === 'tool' && toolId) {
            const toolName = this.getToolName(toolId);
            this.currentPageElement.textContent = toolName;
        } else {
            this.currentPageElement.textContent = 'Unknown Page';
        }
    }

    /**
     * Get tool name by ID
     * @param {string} toolId - Tool ID
     * @returns {string} Tool name
     */
    getToolName(toolId) {
        if (!this.app) return toolId;

        const tools = this.app.getTools();
        const tool = tools.get(toolId);
        
        if (tool) {
            const metadata = tool.getMetadata();
            return metadata.name;
        }

        return toolId;
    }

    /**
     * Navigate to home page
     */
    navigateToHome() {
        if (this.router) {
            this.router.navigate('home');
        } else if (this.app) {
            this.app.showHome();
        }
    }

    /**
     * Destroy the breadcrumb component
     */
    destroy() {
        if (this.eventBus) {
            this.eventBus.off('page:changed');
        }
    }
}

// Export for use in other modules
window.Breadcrumb = Breadcrumb;