/**
 * Sidebar - Modular sidebar component
 * Manages navigation and tool selection
 */
class Sidebar {
    constructor(config = {}) {
        this.eventBus = config.eventBus;
        this.router = config.router;
        this.tools = config.tools || [];
        
        // State management - matching script.js
        this.state = {
            isOpen: false,
            isCollapsed: false,
            isMobile: false,
        };
        
        this.currentTool = null;
        this.mobileBreakpoint = 768;
        
        this.init();
    }

    /**
     * Initialize the sidebar
     */
    init() {
        this.bindEvents();
        this.setupToggle();
        this.initializeAccessibility();
        this.setupMenuButtons();
        
        // Set initial state - start with sidebar expanded on desktop
        if (!this.state.isMobile) {
            this.state.isCollapsed = false;
        }
        this.updateSidebarState();
    }

    /**
     * Initialize accessibility features
     */
    initializeAccessibility() {
        const sidebar = document.querySelector('.sidebar');
        const toggleBtn = document.querySelector('.sidebar-trigger');

        if (!sidebar || !toggleBtn) return;

        // Set initial ARIA attributes
        sidebar.setAttribute("role", "navigation");
        sidebar.setAttribute("aria-label", "Main navigation");

        toggleBtn.setAttribute("type", "button");
        toggleBtn.setAttribute("aria-controls", "sidebar");

        // Set initial state
        this.updateAriaStates();
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
        const toggleBtn = document.querySelector('.sidebar-trigger');
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggle();
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                if (this.state.isMobile) {
                    this.close();
                }
            });
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });

        // Window resize
        this.handleResize();
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }

    /**
     * Handle keyboard events
     */
    handleKeydown(e) {
        // ESC key closes sidebar on mobile
        if (e.key === 'Escape' && this.state.isMobile && this.state.isOpen) {
            this.close();
        }

        // Toggle with Ctrl/Cmd + B
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            this.toggle();
        }
    }

    /**
     * Handle window resize for mobile detection
     */
    handleResize() {
        const isMobile = window.innerWidth <= this.mobileBreakpoint;
        const wasMobile = this.state.isMobile;
        
        this.state.isMobile = isMobile;
        
        // If switching between mobile and desktop
        if (wasMobile !== isMobile) {
            // Reset collapsed state based on device type
            this.state.isCollapsed = isMobile ? true : false;
            this.updateSidebarState();
        }
        
        // Initial run - set state based on device type
        if (wasMobile === undefined) {
            this.state.isCollapsed = isMobile ? true : false;
            this.updateSidebarState();
        }
    }

    /**
     * Update sidebar state and DOM attributes
     */
    updateSidebarState() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        const main = document.querySelector('.main');

        if (!sidebar) return;

        // Update sidebar data attributes
        if (this.state.isMobile) {
            // Mobile behavior
            sidebar.setAttribute(
                "data-state",
                this.state.isOpen ? "open" : "closed"
            );
            sidebar.setAttribute("data-mobile", "true");
        } else {
            // Desktop behavior
            sidebar.setAttribute(
                "data-state",
                this.state.isCollapsed ? "collapsed" : "expanded"
            );
            sidebar.setAttribute("data-mobile", "false");
        }

        // Update main content margin based on sidebar state
        if (main) {
            if (this.state.isMobile) {
                main.style.marginLeft = "0";
            } else {
                main.style.marginLeft = this.state.isCollapsed ? "0" : "16rem";
            }
        }

        // Update overlay
        if (overlay) {
            overlay.setAttribute(
                "data-state",
                this.state.isMobile && this.state.isOpen ? "open" : "closed"
            );
        }

        // Update trigger icon rotation
        this.updateTriggerIcon();

        // Update ARIA attributes
        this.updateAriaStates();
    }

    /**
     * Update trigger icon rotation based on sidebar state
     */
    updateTriggerIcon() {
        const toggleBtn = document.querySelector('.sidebar-trigger');
        if (!toggleBtn) return;

        const icon = toggleBtn.querySelector(".sidebar-trigger-icon");
        if (!icon) return;

        // Rotate icon based on state
        if (this.state.isMobile) {
            icon.style.transform = this.state.isOpen
                ? "rotate(180deg)"
                : "rotate(0deg)";
        } else {
            icon.style.transform = this.state.isCollapsed
                ? "rotate(0deg)"
                : "rotate(180deg)";
        }
    }

    /**
     * Update ARIA states for accessibility
     */
    updateAriaStates() {
        const sidebar = document.querySelector('.sidebar');
        const toggleBtn = document.querySelector('.sidebar-trigger');

        if (!sidebar || !toggleBtn) return;

        sidebar.setAttribute(
            "aria-hidden",
            this.state.isMobile && !this.state.isOpen ? "true" : "false"
        );

        toggleBtn.setAttribute(
            "aria-expanded",
            this.state.isMobile
                ? this.state.isOpen.toString()
                : (!this.state.isCollapsed).toString()
        );

        toggleBtn.setAttribute(
            "aria-label",
            this.state.isMobile
                ? this.state.isOpen
                    ? "Close sidebar"
                    : "Open sidebar"
                : this.state.isCollapsed
                ? "Expand sidebar"
                : "Collapse sidebar"
        );
    }

    /**
     * Emit state change event
     */
    emitStateChange() {
        if (this.eventBus) {
            this.eventBus.emit('sidebar:stateChange', {
                isOpen: this.state.isOpen,
                isCollapsed: this.state.isCollapsed,
                isMobile: this.state.isMobile
            });
        }

        // Also emit to document for compatibility
        document.dispatchEvent(new CustomEvent('sidebarStateChange', {
            detail: {
                isOpen: this.state.isOpen,
                isCollapsed: this.state.isCollapsed,
                isMobile: this.state.isMobile
            }
        }));
    }

    /**
     * Toggle sidebar state
     */
    toggle() {
        if (this.state.isMobile) {
            if (this.state.isOpen) {
                this.close();
            } else {
                this.open();
            }
        } else {
            if (this.state.isCollapsed) {
                this.expand();
            } else {
                this.collapse();
            }
        }
    }

    /**
     * Open sidebar (mobile)
     */
    open() {
        this.state.isOpen = true;
        this.updateSidebarState();

        if (this.eventBus) {
            this.eventBus.emit('sidebar:opened');
        }
    }

    /**
     * Close sidebar (mobile)
     */
    close() {
        this.state.isOpen = false;
        this.updateSidebarState();

        if (this.eventBus) {
            this.eventBus.emit('sidebar:closed');
        }
    }

    /**
     * Expand sidebar (desktop)
     */
    expand() {
        this.state.isCollapsed = false;
        this.updateSidebarState();

        if (this.eventBus) {
            this.eventBus.emit('sidebar:expanded');
        }
    }

    /**
     * Collapse sidebar (desktop)
     */
    collapse() {
        this.state.isCollapsed = true;
        this.updateSidebarState();

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

        // Close sidebar on mobile after selection
        if (this.state.isMobile && this.state.isOpen) {
            setTimeout(() => {
                this.close();
            }, 150);
        }
    }

    /**
     * Update active item in sidebar
     * @param {string} toolId - Tool ID
     */
    updateActiveItem(toolId) {
        // Remove active state from all menu buttons
        document.querySelectorAll('.sidebar-menu-button').forEach(button => {
            button.removeAttribute('data-active');
        });

        // Add active state to current item
        const activeButton = document.querySelector(`[data-tool="${toolId}"] .sidebar-menu-button`);
        if (activeButton) {
            activeButton.setAttribute('data-active', 'true');
        }
    }

    /**
     * Setup menu click handlers for existing menu items
     */
    setupMenuButtons() {
        const menuButtons = document.querySelectorAll(".sidebar-menu-button");
        menuButtons.forEach((button) => {
            button.addEventListener("click", (e) => {
                this.handleMenuClick(e);
            });
        });
    }

    handleMenuClick(e) {
        const button = e.currentTarget;

        // Remove active state from all buttons
        document.querySelectorAll(".sidebar-menu-button").forEach((btn) => {
            btn.setAttribute("data-active", "false");
        });

        // Set active state on clicked button
        button.setAttribute("data-active", "true");

        // Close sidebar on mobile after selection
        if (this.state.isMobile && this.state.isOpen) {
            setTimeout(() => {
                this.close();
            }, 150);
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