window.UUIDGeneratorTemplate = /* html */ `
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
