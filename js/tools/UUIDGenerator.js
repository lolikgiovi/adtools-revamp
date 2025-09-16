/**
 * UUIDGenerator - Generate UUID v4 strings
 * Example tool implementation extending BaseTool
 */
class UUIDGenerator extends BaseTool {
    constructor(eventBus) {
        super({
            id: 'uuid-generator',
            name: 'UUID Generator',
            description: 'Generate UUID v4 strings for unique identifiers',
            icon: 'uuid',
            category: 'application',
            eventBus
        });
        
        this.generatedUUIDs = [];
        this.maxHistory = 10;
    }

    /**
     * Render the tool's HTML
     * @returns {string} HTML string
     */
    render() {
        return `
            <div class="tool-container uuid-generator">
                <div class="tool-header">
                    <h2>UUID Generator</h2>
                    <p class="tool-description">Generate universally unique identifiers (UUID v4)</p>
                </div>
                
                <div class="tool-content">
                    <div class="uuid-controls">
                        <button class="btn btn-primary" id="generateUUID">
                            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                                <path d="M2 2l7.586 7.586"/>
                                <circle cx="11" cy="11" r="2"/>
                            </svg>
                            Generate UUID
                        </button>
                        
                        <div class="uuid-options">
                            <label class="checkbox-label">
                                <input type="checkbox" id="upperCase" />
                                <span class="checkmark"></span>
                                Uppercase
                            </label>
                            
                            <label class="checkbox-label">
                                <input type="checkbox" id="removeDashes" />
                                <span class="checkmark"></span>
                                Remove dashes
                            </label>
                        </div>
                    </div>
                    
                    <div class="uuid-output">
                        <div class="output-group">
                            <label for="uuidResult">Generated UUID:</label>
                            <div class="input-group">
                                <input 
                                    type="text" 
                                    id="uuidResult" 
                                    class="form-input" 
                                    readonly 
                                    placeholder="Click 'Generate UUID' to create a new UUID"
                                />
                                <button class="btn btn-secondary" id="copyUUID" disabled>
                                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                    </svg>
                                    Copy
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="uuid-history" id="uuidHistory" style="display: none;">
                        <h3>Recent UUIDs</h3>
                        <div class="history-list" id="historyList"></div>
                        <button class="btn btn-outline" id="clearHistory">Clear History</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Called after tool is mounted
     */
    onMount() {
        this.bindToolEvents();
        this.loadHistory();
    }

    /**
     * Bind tool-specific events
     */
    bindToolEvents() {
        const generateBtn = document.getElementById('generateUUID');
        const copyBtn = document.getElementById('copyUUID');
        const clearHistoryBtn = document.getElementById('clearHistory');
        const upperCaseCheckbox = document.getElementById('upperCase');
        const removeDashesCheckbox = document.getElementById('removeDashes');

        if (generateBtn) {
            generateBtn.addEventListener('click', () => {
                this.generateUUID();
            });
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                this.copyCurrentUUID();
            });
        }

        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => {
                this.clearHistory();
            });
        }

        // Auto-generate on option change
        if (upperCaseCheckbox) {
            upperCaseCheckbox.addEventListener('change', () => {
                this.updateCurrentUUID();
            });
        }

        if (removeDashesCheckbox) {
            removeDashesCheckbox.addEventListener('change', () => {
                this.updateCurrentUUID();
            });
        }

        // Generate initial UUID
        this.generateUUID();
    }

    /**
     * Generate a new UUID v4
     */
    generateUUID() {
        const uuid = this.createUUIDv4();
        const formattedUUID = this.formatUUID(uuid);
        
        this.displayUUID(formattedUUID);
        this.addToHistory(uuid);
        this.updateHistory();
        
        // Enable copy button
        const copyBtn = document.getElementById('copyUUID');
        if (copyBtn) {
            copyBtn.disabled = false;
        }
    }

    /**
     * Create UUID v4
     * @returns {string} UUID v4 string
     */
    createUUIDv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Format UUID based on options
     * @param {string} uuid - Raw UUID
     * @returns {string} Formatted UUID
     */
    formatUUID(uuid) {
        let formatted = uuid;
        
        const upperCaseCheckbox = document.getElementById('upperCase');
        const removeDashesCheckbox = document.getElementById('removeDashes');
        
        if (removeDashesCheckbox && removeDashesCheckbox.checked) {
            formatted = formatted.replace(/-/g, '');
        }
        
        if (upperCaseCheckbox && upperCaseCheckbox.checked) {
            formatted = formatted.toUpperCase();
        }
        
        return formatted;
    }

    /**
     * Display UUID in the output field
     * @param {string} uuid - UUID to display
     */
    displayUUID(uuid) {
        const resultInput = document.getElementById('uuidResult');
        if (resultInput) {
            resultInput.value = uuid;
        }
    }

    /**
     * Update current UUID with new formatting
     */
    updateCurrentUUID() {
        const resultInput = document.getElementById('uuidResult');
        if (resultInput && resultInput.value) {
            // Get the raw UUID from history
            const lastUUID = this.generatedUUIDs[this.generatedUUIDs.length - 1];
            if (lastUUID) {
                const formattedUUID = this.formatUUID(lastUUID);
                this.displayUUID(formattedUUID);
            }
        }
    }

    /**
     * Copy current UUID to clipboard
     */
    async copyCurrentUUID() {
        const resultInput = document.getElementById('uuidResult');
        if (resultInput && resultInput.value) {
            await this.copyToClipboard(resultInput.value);
        }
    }

    /**
     * Add UUID to history
     * @param {string} uuid - UUID to add
     */
    addToHistory(uuid) {
        this.generatedUUIDs.push(uuid);
        
        // Keep only the last maxHistory items
        if (this.generatedUUIDs.length > this.maxHistory) {
            this.generatedUUIDs = this.generatedUUIDs.slice(-this.maxHistory);
        }
        
        this.saveHistory();
    }

    /**
     * Update history display
     */
    updateHistory() {
        const historyContainer = document.getElementById('uuidHistory');
        const historyList = document.getElementById('historyList');
        
        if (!historyContainer || !historyList) return;
        
        if (this.generatedUUIDs.length > 0) {
            historyContainer.style.display = 'block';
            
            historyList.innerHTML = this.generatedUUIDs
                .slice()
                .reverse()
                .map((uuid, index) => `
                    <div class="history-item">
                        <span class="history-uuid">${uuid}</span>
                        <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText('${uuid}')">
                            Copy
                        </button>
                    </div>
                `).join('');
        } else {
            historyContainer.style.display = 'none';
        }
    }

    /**
     * Clear history
     */
    clearHistory() {
        this.generatedUUIDs = [];
        this.saveHistory();
        this.updateHistory();
        this.showSuccess('History cleared');
    }

    /**
     * Load history from localStorage
     */
    loadHistory() {
        try {
            const saved = localStorage.getItem('uuid-generator-history');
            if (saved) {
                this.generatedUUIDs = JSON.parse(saved);
                this.updateHistory();
            }
        } catch (error) {
            console.error('Error loading UUID history:', error);
        }
    }

    /**
     * Save history to localStorage
     */
    saveHistory() {
        try {
            localStorage.setItem('uuid-generator-history', JSON.stringify(this.generatedUUIDs));
        } catch (error) {
            console.error('Error saving UUID history:', error);
        }
    }

    /**
     * Called when tool is deactivated
     */
    onDeactivate() {
        this.saveHistory();
    }
}

// Export for use in other modules
window.UUIDGenerator = UUIDGenerator;