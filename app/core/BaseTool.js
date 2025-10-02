/**
 * BaseTool - Base class for all tools
 * Provides common functionality and structure
 */
class BaseTool {
  constructor(config = {}) {
    this.id = config.id || this.constructor.name.toLowerCase();
    this.name = config.name || "Unnamed Tool";
    this.description = config.description || "";
    this.icon = config.icon || "tool";
    this.category = config.category || "general";
    this.container = null;
    this.isActive = false;
    this.eventBus = config.eventBus;

    this.init();
  }

  /**
   * Initialize the tool
   * Override in child classes for custom initialization
   */
  init() {
    // Default initialization
    this.bindEvents();
  }

  /**
   * Bind event listeners
   * Override in child classes for custom events
   */
  bindEvents() {
    if (this.eventBus) {
      this.eventBus.on("tool:activate", (data) => {
        if (data.toolId === this.id) {
          this.activate();
        } else {
          this.deactivate();
        }
      });
    }
  }

  /**
   * Render the tool's HTML
   * Must be implemented by child classes
   * @returns {string} HTML string
   */
  render() {
    throw new Error("render() method must be implemented by child classes");
  }

  /**
   * Activate the tool
   */
  activate() {
    if (this.isActive) return;

    this.isActive = true;
    this.onActivate();

    if (this.eventBus) {
      this.eventBus.emit("tool:activated", { toolId: this.id });
    }
  }

  /**
   * Deactivate the tool
   */
  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;
    this.onDeactivate();

    if (this.eventBus) {
      this.eventBus.emit("tool:deactivated", { toolId: this.id });
    }
  }

  /**
   * Called when tool is activated
   * Override in child classes
   */
  onActivate() {
    // Default behavior
  }

  /**
   * Called when tool is deactivated
   * Override in child classes
   */
  onDeactivate() {
    // Default behavior
  }

  /**
   * Mount the tool to a container
   * @param {HTMLElement} container - Container element
   */
  mount(container) {
    this.container = container;
    container.innerHTML = this.render();
    this.onMount();
  }

  /**
   * Called after tool is mounted
   * Override in child classes for DOM manipulation
   */
  onMount() {
    // Default behavior
  }

  /**
   * Unmount the tool
   */
  unmount() {
    if (this.container) {
      this.onUnmount();
      this.container.innerHTML = "";
      this.container = null;
    }
  }

  /**
   * Called before tool is unmounted
   * Override in child classes for cleanup
   */
  onUnmount() {
    // Default behavior
  }

  /**
   * Get tool metadata
   * @returns {Object} Tool metadata
   */
  getMetadata() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      icon: this.icon,
      category: this.category,
    };
  }

  /**
   * Validate input
   * @param {*} input - Input to validate
   * @returns {Object} Validation result
   */
  validate(input) {
    return { isValid: true, errors: [] };
  }

  /**
   * Show error message
   * @param {string} message - Error message
   */
  showError(message, durationMs = 4000) {
    if (this.eventBus) {
      this.eventBus.emit("notification:error", { message, duration: durationMs });
    } else {
      console.error(message);
    }
  }

  /**
   * Show success message
   * @param {string} message - Success message
   */
  showSuccess(message, durationMs = 2500) {
    if (this.eventBus) {
      this.eventBus.emit("notification:success", { message, duration: durationMs });
    } else {
      console.log(message);
    }
  }

  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess("Copied to clipboard!");
    } catch (error) {
      this.showError("Failed to copy to clipboard");
      console.error("Clipboard error:", error);
    }
  }
}

// Export for use in other modules
window.BaseTool = BaseTool;
