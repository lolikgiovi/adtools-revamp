/**
 * Sidebar - Modular sidebar component
 * Manages navigation and tool selection
 */
class Sidebar {
    constructor(config = {}) {
        this.eventBus = config.eventBus;
        this.router = config.router;
        this.tools = config.tools || [];
        this.isCollapsed = false;
        this.currentTool = null;
        
        this.init();
    }

    /**
     * Initialize the sidebar
     */
    init() {
        this.bindEvents();
        this.setupToggle();
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        if (this.eventBus) {
            this.eventBus.on('tool:registered', (data) => {
                this.addTool(data.tool);
            });

            this.eventBus.on('route:changed', (data) => {
                this.updateActiveItem(data.path);
            });
        }
    }

    /**
     * Setup sidebar toggle functionality
     */
    setupToggle() {
        const toggleBtn = document.querySelector('.sidebar-toggle');
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggle();
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                this.collapse();
            });
        }

        // Handle escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.isCollapsed) {
                this.collapse();
            }
        });
    }

    /**
     * Toggle sidebar
     */
    toggle() {
        if (this.isCollapsed) {
            this.expand();
        } else {
            this.collapse();
        }
    }

    /**
     * Expand sidebar
     */
    expand() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        if (sidebar) {
            sidebar.classList.add('expanded');
            this.isCollapsed = false;
        }
        
        if (overlay) {
            overlay.classList.add('active');
        }

        if (this.eventBus) {
            this.eventBus.emit('sidebar:expanded');
        }
    }

    /**
     * Collapse sidebar
     */
    collapse() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        if (sidebar) {
            sidebar.classList.remove('expanded');
            this.isCollapsed = true;
        }
        
        if (overlay) {
            overlay.classList.remove('active');
        }

        if (this.eventBus) {
            this.eventBus.emit('sidebar:collapsed');
        }
    }

    /**
     * Add a tool to the sidebar
     * @param {BaseTool} tool - Tool instance
     */
    addTool(tool) {
        const metadata = tool.getMetadata();
        this.tools.push(metadata);
        this.renderTools();
    }

    /**
     * Render tools in the sidebar
     */
    renderTools() {
        const applicationGroup = document.querySelector('.sidebar-group[data-category="application"] .sidebar-menu');
        
        if (!applicationGroup) return;

        // Group tools by category
        const toolsByCategory = this.tools.reduce((acc, tool) => {
            if (!acc[tool.category]) {
                acc[tool.category] = [];
            }
            acc[tool.category].push(tool);
            return acc;
        }, {});

        // Render application tools
        if (toolsByCategory.application) {
            applicationGroup.innerHTML = toolsByCategory.application.map(tool => `
                <a href="#${tool.id}" class="sidebar-item" data-tool="${tool.id}">
                    <div class="sidebar-icon">
                        ${this.getToolIcon(tool.icon)}
                    </div>
                    <span class="sidebar-text">${tool.name}</span>
                </a>
            `).join('');

            // Add click handlers
            applicationGroup.querySelectorAll('.sidebar-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const toolId = item.dataset.tool;
                    this.selectTool(toolId);
                });
            });
        }
    }

    /**
     * Get icon SVG for a tool
     * @param {string} iconName - Icon name
     * @returns {string} SVG string
     */
    getToolIcon(iconName) {
        const icons = {
            uuid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <path d="M9 9h6v6H9z"/>
            </svg>`,
            json: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
            </svg>`,
            hash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="4" y1="9" x2="20" y2="9"/>
                <line x1="4" y1="15" x2="20" y2="15"/>
                <line x1="10" y1="3" x2="8" y2="21"/>
                <line x1="16" y1="3" x2="14" y2="21"/>
            </svg>`,
            encode: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
            </svg>`,
            qr: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="5" height="5"/>
                <rect x="3" y="16" width="5" height="5"/>
                <rect x="16" y="3" width="5" height="5"/>
                <path d="M21 16h-3a2 2 0 0 0-2 2v3"/>
                <path d="M21 21v.01"/>
                <path d="M12 7v3a2 2 0 0 1-2 2H7"/>
                <path d="M3 12h.01"/>
                <path d="M12 3h.01"/>
                <path d="M12 16v.01"/>
                <path d="M16 12h1"/>
                <path d="M21 12v.01"/>
                <path d="M12 21v-1"/>
            </svg>`,
            color: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="13.5" cy="6.5" r=".5"/>
                <circle cx="17.5" cy="10.5" r=".5"/>
                <circle cx="8.5" cy="7.5" r=".5"/>
                <circle cx="6.5" cy="12.5" r=".5"/>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
            </svg>`,
            password: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <circle cx="12" cy="16" r="1"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>`,
            default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                <path d="M2 2l7.586 7.586"/>
                <circle cx="11" cy="11" r="2"/>
            </svg>`
        };

        return icons[iconName] || icons.default;
    }

    /**
     * Select a tool
     * @param {string} toolId - Tool ID
     */
    selectTool(toolId) {
        this.currentTool = toolId;
        this.updateActiveItem(toolId);
        
        if (this.router) {
            this.router.navigate(toolId);
        }

        if (this.eventBus) {
            this.eventBus.emit('tool:activate', { toolId });
        }

        // Auto-collapse on mobile
        if (window.innerWidth <= 768) {
            this.collapse();
        }
    }

    /**
     * Update active item in sidebar
     * @param {string} toolId - Tool ID
     */
    updateActiveItem(toolId) {
        // Remove active class from all items
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active');
        });

        // Add active class to current item
        const activeItem = document.querySelector(`[data-tool="${toolId}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }
    }

    /**
     * Get current tool
     * @returns {string} Current tool ID
     */
    getCurrentTool() {
        return this.currentTool;
    }
}

// Export for use in other modules
window.Sidebar = Sidebar;