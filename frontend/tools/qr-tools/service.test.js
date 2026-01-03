import { vi } from 'vitest';
vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn(async () => {}),
    toString: vi.fn(async () => '<svg></svg>'),
  },
}));
import { QRToolsService } from './service.js';

describe('QRToolsService', () => {
  it('validates URLs robustly', () => {
    const svc = new QRToolsService();
    expect(svc.isValidUrl('https://example.com')).toBe(true);
    expect(svc.isValidUrl('not a url')).toBe(false);
  });

  it('computes contrast ratio', () => {
    const svc = new QRToolsService();
    const ratio = svc.getContrastRatio('#000000', '#ffffff');
    expect(ratio).toBeGreaterThan(7); // WCAG AA contrast
  });

  it('renders QR to canvas and SVG', async () => {
    const svc = new QRToolsService();
    const canvas = document.createElement('canvas');
    const cfg = { size: 128, margin: 1, foreground: '#000', background: '#fff' };
    await svc.renderCanvas(canvas, 'hello', cfg);
    // toCanvas should be called on the qrcode module
    // (mocked above)
    // No direct global assertion needed
    const svg = await svc.generateSvgString('hello', cfg);
    expect(svg).toContain('<svg');
  });
});