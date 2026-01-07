// @vitest-environment jsdom
import { describe, it, beforeEach, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { importSchemasPayload } from '../services/SchemaImportService.js';
import { LocalStorageService } from '../services/LocalStorageService.js';

const SCHEMA_KEY = 'tool:quick-query:schema';

describe('SchemaImportService (KV nested tables payload)', () => {
  let svc;

  beforeEach(() => {
    localStorage.clear();
    svc = new LocalStorageService();
  });

  it('imports new_data_model_schema.json and persists tables', () => {
    const jsonPath = path.resolve(__dirname, '../new_data_model_schema.json');
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    const count = importSchemasPayload(payload, svc);
    expect(count).toBeGreaterThanOrEqual(2); // two tables in the JSON

    const store = JSON.parse(localStorage.getItem(SCHEMA_KEY));
    expect(store).toBeTruthy();

    const inhouse = store.inhouse_forex;
    expect(inhouse).toBeTruthy();
    expect(typeof inhouse.tables).toBe('object');

    const rate = inhouse.tables.rate_tiering;
    expect(rate).toBeTruthy();
    expect(rate.columns.RATE_TIERING_ID.type).toBe('VARCHAR2(36)');
    expect(Array.isArray(rate.pk)).toBe(true);
    expect(typeof rate.last_updated).toBe('string');

    const other = inhouse.tables.other_table;
    expect(other).toBeTruthy();
    expect(other.columns.OTHER_TABLE_ID.type).toBe('VARCHAR2(36)');
    expect(Array.isArray(other.pk)).toBe(true);
    expect(typeof other.last_updated).toBe('string');
  });
});