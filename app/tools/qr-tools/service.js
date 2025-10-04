class QRToolsService {
  isValidUrl(input) {
    try {
      const url = new URL(input);
      return Boolean(url.protocol && url.host);
    } catch (e) {
      const pattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;
      return pattern.test(input.trim());
    }
  }

  hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  }

  relativeLuminance({ r, g, b }) {
    const srgb = [r, g, b].map(v => v / 255);
    const mapped = srgb.map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * mapped[0] + 0.7152 * mapped[1] + 0.0722 * mapped[2];
  }

  getContrastRatio(hex1, hex2) {
    const l1 = this.relativeLuminance(this.hexToRgb(hex1));
    const l2 = this.relativeLuminance(this.hexToRgb(hex2));
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  async renderCanvas(canvas, content, config) {
    const options = {
      width: config.size,
      margin: config.margin,
      color: {
        dark: config.foreground,
        light: config.background,
      },
    };
    await QRCode.toCanvas(canvas, content, options);
    return canvas;
  }

  async generateSvgString(content, config) {
    const options = {
      type: 'svg',
      margin: config.margin,
      color: {
        dark: config.foreground,
        light: config.background,
      },
    };
    const svgString = await QRCode.toString(content, options);
    return svgString;
  }
}

window.QRToolsService = QRToolsService;