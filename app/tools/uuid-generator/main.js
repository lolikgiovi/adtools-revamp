import { UUIDGeneratorTemplate } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";

class UUIDGenerator extends BaseTool {
  constructor(eventBus) {
    super({
      id: "uuid-generator",
      name: "UUID Generator",
      description: "Generate UUID v4 strings for unique identifiers",
      icon: "uuid",
      category: "application",
      eventBus,
    });
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return UUIDGeneratorTemplate;
  }

  onMount() {
    this.bindToolEvents();
    this.generateSingleUUID();
  }

  bindToolEvents() {
    const generateSingleBtn = document.getElementById("generateSingleUUID");
    const copySingleBtn = document.getElementById("copySingleUUID");

    const generateMultipleBtn = document.getElementById("generateMultipleUUID");
    const copyMultipleBtn = document.getElementById("copyMultipleUUID");
    const clearMultipleBtn = document.getElementById("clearMultipleUUID");

    if (generateSingleBtn) {
      generateSingleBtn.addEventListener("click", () => {
        this.generateSingleUUID();
      });
    }

    if (copySingleBtn) {
      copySingleBtn.addEventListener("click", () => {
        this.copySingleUUID();
      });
    }

    if (generateMultipleBtn) {
      generateMultipleBtn.addEventListener("click", () => {
        this.generateMultipleUUIDs();
      });
    }

    if (copyMultipleBtn) {
      copyMultipleBtn.addEventListener("click", () => {
        this.copyMultipleUUIDs();
      });
    }

    if (clearMultipleBtn) {
      clearMultipleBtn.addEventListener("click", () => {
        this.clearMultipleUUIDs();
      });
    }
  }

  generateSingleUUID() {
    const uuid = crypto.randomUUID();
    const resultInput = document.getElementById("singleUuidResult");

    if (resultInput) {
      resultInput.value = uuid;
    }

    // Enable copy button
    const copyBtn = document.getElementById("copySingleUUID");
    if (copyBtn) {
      copyBtn.disabled = false;
    }
  }

  generateMultipleUUIDs() {
    const quantityInput = document.getElementById("uuidQuantity");
    const resultTextarea = document.getElementById("multipleUuidResult");

    if (!quantityInput || !resultTextarea) return;

    const quantity = parseInt(quantityInput.value) || 1;
    const uuids = [];

    for (let i = 0; i < Math.min(quantity, 100); i++) {
      uuids.push(crypto.randomUUID());
    }

    resultTextarea.value = uuids.join("\n");

    // Enable copy button
    const copyBtn = document.getElementById("copyMultipleUUID");
    if (copyBtn) {
      copyBtn.disabled = false;
    }
  }

  async copySingleUUID() {
    const resultInput = document.getElementById("singleUuidResult");
    if (resultInput && resultInput.value) {
      UsageTracker.trackFeature("uuid-generator", "single");
      await this.copyToClipboard(resultInput.value);
    }
  }

  async copyMultipleUUIDs() {
    const resultTextarea = document.getElementById("multipleUuidResult");
    if (resultTextarea && resultTextarea.value) {
      UsageTracker.trackFeature("uuid-generator", "multiple");
      await this.copyToClipboard(resultTextarea.value);
    }
  }

  clearMultipleUUIDs() {
    const resultTextarea = document.getElementById("multipleUuidResult");
    const quantityInput = document.getElementById("uuidQuantity");

    if (resultTextarea) {
      resultTextarea.value = "";
    }

    if (quantityInput) {
      quantityInput.value = "";
    }

    const copyBtn = document.getElementById("copyMultipleUUID");
    if (copyBtn) {
      copyBtn.disabled = true;
    }
  }
}

// Also export for ESM consumers
export { UUIDGenerator };
