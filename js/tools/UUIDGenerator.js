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
    }

    /**
     * Render the tool's HTML
     * @returns {string} HTML string
     */
    render() {
        return `
            <div class="tool-container uuid-generator">
                <!-- Single UUID Section -->
                <div class="uuid-section">
                    <h2>Single UUID</h2>
                    <div class="uuid-display">
                        <input 
                            type="text" 
                            id="singleUuidResult" 
                            class="uuid-input" 
                            readonly 
                            placeholder="Generated UUID will appear here"
                        />
                    </div>
                    <div class="uuid-buttons">
                        <button class="btn btn-primary" id="generateSingleUUID">
                            Generate
                        </button>
                        <button class="btn btn-primary" id="copySingleUUID" disabled>
                            Copy
                        </button>
                    </div>
                </div>

                <!-- Multiple UUIDs Section -->
                <div class="uuid-section">
                    <h2>Multiple UUIDs</h2>
                    <div class="multiple-controls">
                        <input 
                            type="number" 
                            id="uuidQuantity" 
                            class="quantity-input" 
                            placeholder="How many?" 
                            min="1" 
                            max="100"
                        />
                        <div class="uuid-buttons">
                            <button class="btn btn-primary" id="generateMultipleUUID">
                                Generate
                            </button>
                            <button class="btn btn-primary" id="copyMultipleUUID" disabled>
                                Copy
                            </button>
                            <button class="btn btn-primary" id="clearMultipleUUID">
                                Clear
                            </button>
                        </div>
                    </div>
                    <div class="multiple-output">
                        <textarea 
                            id="multipleUuidResult" 
                            class="uuid-textarea" 
                            readonly 
                            placeholder="Generated UUIDs will appear here"
                        ></textarea>
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
    }

    /**
     * Bind tool-specific events
     */
    bindToolEvents() {
        // Single UUID events
        const generateSingleBtn = document.getElementById('generateSingleUUID');
        const copySingleBtn = document.getElementById('copySingleUUID');
        
        // Multiple UUID events
        const generateMultipleBtn = document.getElementById('generateMultipleUUID');
        const copyMultipleBtn = document.getElementById('copyMultipleUUID');
        const clearMultipleBtn = document.getElementById('clearMultipleUUID');

        if (generateSingleBtn) {
            generateSingleBtn.addEventListener('click', () => {
                this.generateSingleUUID();
            });
        }

        if (copySingleBtn) {
            copySingleBtn.addEventListener('click', () => {
                this.copySingleUUID();
            });
        }

        if (generateMultipleBtn) {
            generateMultipleBtn.addEventListener('click', () => {
                this.generateMultipleUUIDs();
            });
        }

        if (copyMultipleBtn) {
            copyMultipleBtn.addEventListener('click', () => {
                this.copyMultipleUUIDs();
            });
        }

        if (clearMultipleBtn) {
            clearMultipleBtn.addEventListener('click', () => {
                this.clearMultipleUUIDs();
            });
        }

        // Generate initial single UUID
        this.generateSingleUUID();
    }

    /**
     * Generate a single UUID
     */
    generateSingleUUID() {
        const uuid = this.createUUIDv4();
        const resultInput = document.getElementById('singleUuidResult');
        
        if (resultInput) {
            resultInput.value = uuid;
        }
        
        // Enable copy button
        const copyBtn = document.getElementById('copySingleUUID');
        if (copyBtn) {
            copyBtn.disabled = false;
        }
    }

    /**
     * Generate multiple UUIDs
     */
    generateMultipleUUIDs() {
        const quantityInput = document.getElementById('uuidQuantity');
        const resultTextarea = document.getElementById('multipleUuidResult');
        
        if (!quantityInput || !resultTextarea) return;
        
        const quantity = parseInt(quantityInput.value) || 1;
        const uuids = [];
        
        for (let i = 0; i < Math.min(quantity, 100); i++) {
            uuids.push(this.createUUIDv4());
        }
        
        resultTextarea.value = uuids.join('\n');
        
        // Enable copy button
        const copyBtn = document.getElementById('copyMultipleUUID');
        if (copyBtn) {
            copyBtn.disabled = false;
        }
    }

    /**
     * Copy single UUID to clipboard
     */
    async copySingleUUID() {
        const resultInput = document.getElementById('singleUuidResult');
        if (resultInput && resultInput.value) {
            await this.copyToClipboard(resultInput.value);
        }
    }

    /**
     * Copy multiple UUIDs to clipboard
     */
    async copyMultipleUUIDs() {
        const resultTextarea = document.getElementById('multipleUuidResult');
        if (resultTextarea && resultTextarea.value) {
            await this.copyToClipboard(resultTextarea.value);
        }
    }

    /**
     * Clear multiple UUIDs
     */
    clearMultipleUUIDs() {
        const resultTextarea = document.getElementById('multipleUuidResult');
        const quantityInput = document.getElementById('uuidQuantity');
        
        if (resultTextarea) {
            resultTextarea.value = '';
        }
        
        if (quantityInput) {
            quantityInput.value = '';
        }
        
        // Disable copy button
        const copyBtn = document.getElementById('copyMultipleUUID');
        if (copyBtn) {
            copyBtn.disabled = true;
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
}

// Export for use in other modules
window.UUIDGenerator = UUIDGenerator;