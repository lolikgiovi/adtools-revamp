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
    this._managedListeners = []; // Track all listeners for automatic cleanup

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
    this.removeAllManagedListeners(); // Auto-cleanup all managed listeners
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
   * Add an event listener that will be automatically cleaned up on deactivation
   * @param {EventTarget} target - DOM element or window/document
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} options - addEventListener options
   */
  addManagedListener(target, event, handler, options = {}) {
    target.addEventListener(event, handler, options);
    this._managedListeners.push({ target, event, handler, options });
  }

  /**
   * Remove a specific managed listener
   * @param {EventTarget} target - DOM element or window/document
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  removeManagedListener(target, event, handler) {
    target.removeEventListener(event, handler);
    this._managedListeners = this._managedListeners.filter(
      (l) => !(l.target === target && l.event === event && l.handler === handler)
    );
  }

  /**
   * Remove all managed listeners (called automatically on deactivate)
   */
  removeAllManagedListeners() {
    this._managedListeners.forEach(({ target, event, handler, options }) => {
      target.removeEventListener(event, handler, options);
    });
    this._managedListeners = [];
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
      this.#inlineToast(message, "error", durationMs);
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
      this.#inlineToast(message, "success", durationMs);
    }
  }

  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   */
  async copyToClipboard(text, targetEl = null) {
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess("Copied to clipboard!");
      if (targetEl) {
        try {
          targetEl.classList.add("copied");
          setTimeout(() => targetEl.classList.remove("copied"), 1000);
        } catch (_) {
          // noop if targetEl does not support classList
        }
      }
    } catch (error) {
      this.showError("Failed to copy to clipboard");
      console.error("Clipboard error:", error);
    }
  }

  // Lightweight inline toast for environments without EventBus
  #inlineToast(message, type = "success", durationMs = 2500) {
    try {
      const toast = document.createElement("div");
      toast.textContent = message;
      toast.style.position = "fixed";
      toast.style.bottom = "16px";
      toast.style.right = "16px";
      toast.style.padding = "8px 12px";
      toast.style.borderRadius = "6px";
      toast.style.zIndex = "9999";
      toast.style.color = type === "error" ? "#721c24" : "#0f5132";
      toast.style.background = type === "error" ? "#f8d7da" : "#d1e7dd";
      toast.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), durationMs);
    } catch (_) {
      // ignore if DOM is not available
    }
  }
}

export { BaseTool };
