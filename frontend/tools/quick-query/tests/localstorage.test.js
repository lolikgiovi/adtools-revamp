// @vitest-environment jsdom
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { LocalStorageService } from '../services/LocalStorageService.js';

const SCHEMA_KEY = 'tool:quick-query:schema';
const DATA_KEY = 'tool:quick-query:data';

function sampleSchemaArray() {
  return [
    ['RATE_TIERING_ID', 'VARCHAR2(36)', 'No', null, null, 'Yes'],
    ['CURRENCY_ISO_CODE', 'VARCHAR2(10)', 'No', null, null, 'Yes'],
    ['MIN_AMOUNT', 'NUMBER(20,2)', 'Yes', null, null, 'No'],
    ['MAX_AMOUNT', 'NUMBER(20,2)', 'Yes', null, null, 'No'],
    ['TIERING_GROUP', 'VARCHAR2(36)', 'No', null, null, 'Yes'],
  ];
}

function sampleDataArray() {
  return [
    ['RATE_TIERING_ID', 'CURRENCY_ISO_CODE', 'MIN_AMOUNT', 'MAX_AMOUNT', 'TIERING_GROUP'],
    ['RT-UUID-001', 'USD', '0', '10000', 'RETAIL'],
    ['RT-UUID-002', 'USD', '10000', '50000', 'RETAIL'],
  ];
}

describe('LocalStorageService (separated schema/data)', () => {
  let svc;

  beforeEach(() => {
    localStorage.clear();
    svc = new LocalStorageService();
  });

  it('saves schema and data to separate keys', () => {
    const ok = svc.saveSchema('inhouse_forex.rate_tiering', sampleSchemaArray(), sampleDataArray());
    expect(ok).toBe(true);

    const schemaStore = JSON.parse(localStorage.getItem(SCHEMA_KEY));
    const dataStore = JSON.parse(localStorage.getItem(DATA_KEY));

    expect(schemaStore).toBeTruthy();
    expect(dataStore).toBeTruthy();

    // Schema shape
    expect(schemaStore.inhouse_forex).toBeTruthy();
    expect(schemaStore.inhouse_forex.tables.rate_tiering.columns.RATE_TIERING_ID.type).toBe('VARCHAR2(36)');
    expect(Array.isArray(schemaStore.inhouse_forex.tables.rate_tiering.pk)).toBe(true);
    expect(typeof schemaStore.inhouse_forex.tables.rate_tiering.last_updated).toBe('string');

    // Data shape
    expect(Array.isArray(dataStore.inhouse_forex.rate_tiering.rows)).toBe(true);
    expect(dataStore.inhouse_forex.rate_tiering.rows[0].RATE_TIERING_ID).toBe('RT-UUID-001');
    expect(typeof dataStore.inhouse_forex.rate_tiering.last_updated).toBe('string');
  });

  it('loads schema and data back in array form', () => {
    svc.saveSchema('inhouse_forex.rate_tiering', sampleSchemaArray(), sampleDataArray());
    const result = svc.loadSchema('inhouse_forex.rate_tiering', true);
    expect(result).toBeTruthy();
    expect(Array.isArray(result.schema)).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.schema[0][0]).toBe('RATE_TIERING_ID');
    expect(result.data[0][0]).toBe('RATE_TIERING_ID');
  });

  it('updates table data only', () => {
    svc.saveSchema('inhouse_forex.rate_tiering', sampleSchemaArray(), sampleDataArray());
    const beforeDataStore = JSON.parse(localStorage.getItem(DATA_KEY));
    const beforeTs = beforeDataStore.inhouse_forex.rate_tiering.last_updated;
    const newData = [
      ['RATE_TIERING_ID', 'CURRENCY_ISO_CODE', 'MIN_AMOUNT', 'MAX_AMOUNT', 'TIERING_GROUP'],
      ['RT-UUID-003', 'USD', '50000', '100000', 'RETAIL'],
    ];
    const ok = svc.updateTableData('inhouse_forex.rate_tiering', newData);
    expect(ok).toBe(true);
    const dataStore = JSON.parse(localStorage.getItem(DATA_KEY));
    expect(dataStore.inhouse_forex.rate_tiering.rows[0].RATE_TIERING_ID).toBe('RT-UUID-003');
    expect(typeof dataStore.inhouse_forex.rate_tiering.last_updated).toBe('string');
    const afterTsNum = new Date(dataStore.inhouse_forex.rate_tiering.last_updated).getTime();
    const beforeTsNum = new Date(beforeTs).getTime();
    expect(Number.isNaN(afterTsNum)).toBe(false);
    expect(afterTsNum).toBeGreaterThanOrEqual(beforeTsNum);
    const schemaStore = JSON.parse(localStorage.getItem(SCHEMA_KEY));
    expect(schemaStore.inhouse_forex.tables.rate_tiering.columns.RATE_TIERING_ID.type).toBe('VARCHAR2(36)');
  });

  it('deletes schema and associated data', () => {
    svc.saveSchema('inhouse_forex.rate_tiering', sampleSchemaArray(), sampleDataArray());
    const ok = svc.deleteSchema('inhouse_forex.rate_tiering');
    expect(ok).toBe(true);
    const schemaStore = JSON.parse(localStorage.getItem(SCHEMA_KEY));
    const dataStore = JSON.parse(localStorage.getItem(DATA_KEY));
    expect(schemaStore?.inhouse_forex).toBeUndefined();
    expect(dataStore?.inhouse_forex).toBeUndefined();
  });

  it('clears all schemas and data', () => {
    svc.saveSchema('inhouse_forex.rate_tiering', sampleSchemaArray(), sampleDataArray());
    const ok = svc.clearAllSchemas();
    expect(ok).toBe(true);
    expect(localStorage.getItem(SCHEMA_KEY)).toBeNull();
    expect(localStorage.getItem(DATA_KEY)).toBeNull();
  });

  it('handles corrupted schema store gracefully', () => {
    localStorage.setItem(SCHEMA_KEY, '{not-json');
    const tables = svc.getAllTables();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBe(0);
    const res = svc.loadSchema('inhouse_forex.rate_tiering');
    expect(res).toBeNull();
  });

  it('handles quota exceeded error on save', () => {
    const spy = vi.spyOn(window.localStorage.__proto__, 'setItem');
    spy.mockImplementation(() => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    });
    const ok = svc.saveSchema('inhouse_forex.rate_tiering', sampleSchemaArray(), sampleDataArray());
    expect(ok).toBe(false);
    spy.mockRestore();
  });
});