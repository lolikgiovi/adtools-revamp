import { QRToolsService } from './service.js';
import { QRToolsTemplate } from './template.js';
import { BaseTool } from '../../core/BaseTool.js';
import { getIconSvg } from './icon.js';
import { UsageTracker } from '../../core/UsageTracker.js';

class QRTools extends BaseTool {
  constructor(eventBus) {
    super({
      id: "qr-tools",
      name: "QR Tools",
      description: "Generate static QR codes from text or URLs",
      icon: "qr",
      category: "application",
      eventBus,
    });
    this.service = new QRToolsService();
    this.state = {
      mode: "text",
      content: "",
      size: 256,
      margin: 2,
      foreground: "#000000",
      background: "#FFFFFF",
      isValid: false,
    };
    this._debounceTimer = null;
  }

  getIconSvg() { return getIconSvg(); }

  render() {
    return QRToolsTemplate;
  }

  onMount() {
    UsageTracker.track('qr-tools', 'mount');
    this.bindEvents();
    this.updatePreview();
  }

  bindEvents() {
    const modeEl = document.getElementById("qrMode");
    const contentEl = document.getElementById("qrContent");
    const sizeEl = document.getElementById("qrSize");
    const marginEl = document.getElementById("qrMargin");
    const fgEl = document.getElementById("qrColorForeground");
    const bgEl = document.getElementById("qrColorBackground");
    const downloadPngEl = document.getElementById("qrDownloadPng");
    const downloadSvgEl = document.getElementById("qrDownloadSvg");
    const resetEl = document.getElementById("qrReset");

    if (modeEl)
      modeEl.addEventListener("change", () => {
        this.state.mode = modeEl.value;
        this.scheduleUpdate();
      });
    if (contentEl)
      contentEl.addEventListener("input", () => {
        this.state.content = contentEl.value;
        this.scheduleUpdate();
      });
    if (sizeEl) sizeEl.value = String(this.state.size);
    if (marginEl) marginEl.value = String(this.state.margin);
    if (fgEl)
      fgEl.addEventListener("input", () => {
        this.state.foreground = fgEl.value;
        this.scheduleUpdate();
      });
    if (bgEl)
      bgEl.addEventListener("input", () => {
        this.state.background = bgEl.value;
        this.scheduleUpdate();
      });
    if (downloadPngEl)
      downloadPngEl.addEventListener("click", () => {
        this.downloadPng();
      });
    if (downloadSvgEl)
      downloadSvgEl.addEventListener("click", () => {
        this.downloadSvg();
      });
    if (resetEl)
      resetEl.addEventListener("click", () => {
        this.resetForm();
      });
  }

  scheduleUpdate() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.updatePreview(), 200);
  }

  getConfig() {
    return {
      size: this.state.size,
      margin: this.state.margin,
      foreground: this.state.foreground,
      background: this.state.background,
    };
  }

  updatePreview() {
    const validationEl = document.getElementById("qrValidation");
    const contrastEl = document.getElementById("qrContrastWarning");
    const canvas = document.getElementById("qrCanvas");
    const pngBtn = document.getElementById("qrDownloadPng");
    const svgBtn = document.getElementById("qrDownloadSvg");

    const content = (this.state.content || "").trim();
    let isValid = content.length > 0;

    if (this.state.mode === "url") {
      const urlValid = this.service.isValidUrl(content);
      isValid = isValid && urlValid;
      if (validationEl) {
        validationEl.textContent = urlValid ? "" : "Warning: This URL may be invalid. Ensure it includes a protocol or a valid domain.";
      }
    } else {
      if (validationEl) validationEl.textContent = "";
    }

    this.state.isValid = isValid;

    const ratio = this.service.getContrastRatio(this.state.foreground, this.state.background);
    if (contrastEl) {
      if (ratio < 3.0) {
        contrastEl.textContent = `Low contrast detected (~${ratio.toFixed(
          2
        )}:1). Darken foreground or lighten background for better scanability.`;
      } else {
        contrastEl.textContent = "";
      }
    }

    if (pngBtn) pngBtn.disabled = !isValid;
    if (svgBtn) svgBtn.disabled = !isValid;

    if (!canvas) return;
    canvas.width = this.state.size;
    canvas.height = this.state.size;

    if (!isValid) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    this.service.renderCanvas(canvas, content, this.getConfig()).catch(() => {
      this.showError("Failed to render QR code.");
    });
  }

  async downloadPng() {
    const canvas = document.getElementById("qrCanvas");
    if (!canvas || !this.state.isValid) return;
    const link = document.createElement("a");
    link.download = "qr-code.png";
    try {
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          link.href = url;
          link.click();
          URL.revokeObjectURL(url);
          this.showSuccess("PNG downloaded");
        });
      } else {
        link.href = canvas.toDataURL("image/png");
        link.click();
        this.showSuccess("PNG downloaded");
      }
    } catch (e) {
      this.showError("Failed to download PNG");
      console.error(e);
    }
  }

  async downloadSvg() {
    const content = (this.state.content || "").trim();
    if (!content || !this.state.isValid) return;
    try {
      const svgString = await this.service.generateSvgString(content, this.getConfig());
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "qr-code.svg";
      link.click();
      URL.revokeObjectURL(url);
      this.showSuccess("SVG downloaded");
    } catch (e) {
      this.showError("Failed to download SVG");
      console.error(e);
    }
  }

  resetForm() {
    const modeEl = document.getElementById("qrMode");
    const contentEl = document.getElementById("qrContent");
    const sizeEl = document.getElementById("qrSize");
    const marginEl = document.getElementById("qrMargin");
    const fgEl = document.getElementById("qrColorForeground");
    const bgEl = document.getElementById("qrColorBackground");

    if (modeEl) modeEl.value = "text";
    if (contentEl) contentEl.value = "";
    if (sizeEl) sizeEl.value = "256";
    if (marginEl) marginEl.value = "16";
    if (fgEl) fgEl.value = "#000000";
    if (bgEl) bgEl.value = "#FFFFFF";

    this.state = {
      mode: "text",
      content: "",
      size: 256,
      margin: 16,
      foreground: "#000000",
      background: "#FFFFFF",
      isValid: false,
    };
    this.updatePreview();
  }
}
export { QRTools };
