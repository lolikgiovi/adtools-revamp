import { BaseTool } from "../../core/BaseTool.js";
import { QRGenerator } from "./generator.js";
import { TLVViewer } from "../tlv-viewer/main.js";
import { getIconSvg } from "./icon.js";
import "./tabs.css";

class QRTools extends BaseTool {
  constructor(eventBus) {
    super({ id: "qr-tools", eventBus });
    this.activeTab = "qr";
    this.tools = {
      qr: new QRGenerator(eventBus),
      tlv: new TLVViewer(eventBus),
    };
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return /* html */ `
      <div class="qr-tlv">
        <div class="tabs-container">
          <div class="tabs-left" role="tablist" aria-label="QR & TLV">
            <button class="tab-button" id="qr-tlv-qr-tab" type="button" role="tab"
              data-qr-tlv-tab="qr" aria-controls="qr-tlv-qr-panel">QR Generator</button>
            <button class="tab-button" id="qr-tlv-tlv-tab" type="button" role="tab"
              data-qr-tlv-tab="tlv" aria-controls="qr-tlv-tlv-panel">TLV Viewer</button>
          </div>
        </div>
        <div id="qr-tlv-qr-panel" role="tabpanel" aria-labelledby="qr-tlv-qr-tab" hidden></div>
        <div id="qr-tlv-tlv-panel" role="tabpanel" aria-labelledby="qr-tlv-tlv-tab" hidden></div>
      </div>
    `;
  }

  onMount() {
    Object.entries(this.tools).forEach(([tab, tool]) => {
      tool.mount(this.container.querySelector(`#qr-tlv-${tab}-panel`));
    });
    this.container.querySelectorAll("[data-qr-tlv-tab]").forEach((button) => {
      button.addEventListener("click", () => this.selectTab(button.dataset.qrTlvTab));
      button.addEventListener("keydown", (event) => {
        let tab;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          tab = this.activeTab === "qr" ? "tlv" : "qr";
        } else if (event.key === "Home") {
          tab = "qr";
        } else if (event.key === "End") {
          tab = "tlv";
        } else {
          return;
        }
        event.preventDefault();
        this.selectTab(tab);
        this.container.querySelector(`#qr-tlv-${tab}-tab`).focus();
      });
    });
    this.selectTab(this.activeTab);
  }

  selectTab(tab) {
    if (!this.tools[tab]) return;
    this.activeTab = tab;
    Object.entries(this.tools).forEach(([key, tool]) => {
      const selected = key === tab;
      const button = this.container.querySelector(`#qr-tlv-${key}-tab`);
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      this.container.querySelector(`#qr-tlv-${key}-panel`).hidden = !selected;
      if (this.isActive && selected) tool.activate();
      else tool.deactivate();
    });
  }

  onRouteData(data) {
    if (data?.tab) this.selectTab(data.tab);
  }

  onActivate() {
    this.tools[this.activeTab].activate();
  }

  onDeactivate() {
    Object.values(this.tools).forEach((tool) => tool.deactivate());
  }

  onUnmount() {
    Object.values(this.tools).forEach((tool) => tool.unmount());
  }
}

export { QRTools };
