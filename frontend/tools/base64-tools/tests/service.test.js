import { Base64ToolsService } from '../service.js';

describe('Base64ToolsService', () => {
  it('encodes and decodes text', () => {
    const encoded = Base64ToolsService.encodeText('hello');
    expect(typeof encoded).toBe('string');
    const decoded = Base64ToolsService.decodeToBinaryString(encoded);
    expect(decoded).toBe('hello');
  });

  it('validates base64 and data URIs', () => {
    const ok = Base64ToolsService.isValidBase64('aGVsbG8=');
    expect(ok).toBe(true);
    const okData = Base64ToolsService.isValidBase64('data:text/plain;base64,aGVsbG8=');
    expect(okData).toBe(true);
  });

  it('detects text content', () => {
    const isText = Base64ToolsService.isTextContent('Hello world!');
    expect(isText).toBe(true);
  });
});