// Basic tests for JSONToolsService; if still using globals, import the file
import { JSONToolsService } from './service.js';

describe('JSONToolsService', () => {
  it('validates correct JSON', () => {
    const { result, error } = JSONToolsService.validate('{"a":1}');
    expect(error).toBeNull();
    expect(result).toContain('\n');
  });

  it('prettifies compact JSON', () => {
    const { result, error } = JSONToolsService.prettify('{"a":1}');
    expect(error).toBeNull();
    expect(result).toContain('\n');
  });
});