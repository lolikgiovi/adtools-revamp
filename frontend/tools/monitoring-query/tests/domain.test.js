import { describe, expect, it } from 'vitest';
import { planChanges, cloneBranch, healthFindings, canonicalNumber, validateChanges } from '../domain.js';

const number = (value) => ({ type: 'number', value });
const fixture = () => ({
  DSH_MENU: [{ MENU_ID: 'm', CHANNEL_NAME: 'Payments', MENU_LABEL: 'Original', DISPLAY_ORDER: number('1'), IS_ACTIVE: 'Y' }],
  DSH_SUMMARY_GROUP: [{ GROUP_ID: 'g', MENU_ID: 'm', DATASOURCE_ID: 'd', SQL_TEXT: { type: 'clob', value: "select 'm & g' from dual -- :startDate\r\n" }, DISPLAY_ORDER: number('1') }],
  DSH_SUMMARY_FIELD: [{ FIELD_ID: 'f', GROUP_ID: 'g', SOURCE_FIELD: 'TOTAL', DISPLAY_ORDER: number('1') }, { FIELD_ID: 'orphan', GROUP_ID: 'gone' }],
  DSH_DETAIL_TABLE: [], DSH_DETAIL_COLUMN: [], DSH_DATASOURCE: [{ DATASOURCE_ID: 'd' }], DSH_SUMMARY_QUERY: [],
});
describe('Monitoring domain contracts', () => {
  it('canonicalizes exact decimals without Number coercion', () => {
    expect(canonicalNumber('000123456789012345678901234567890.1200')).toBe('123456789012345678901234567890.12');
    expect(canonicalNumber('-000.000')).toBe('0');
    expect(() => canonicalNumber('1e5')).toThrow();
  });
  it('plans changed columns and retains null versus empty CLOB', () => {
    const baseline = fixture(); const desired = structuredClone(baseline);
    desired.DSH_MENU[0].MENU_LABEL = 'Edited';
    desired.DSH_SUMMARY_GROUP[0].CHART_SQL = { type: 'clob', value: '' };
    const ops = planChanges(baseline, desired);
    expect(ops[0].action).toBe('UPDATE');
    expect(ops[0].columns).toEqual(['MENU_LABEL']);
    expect(ops[1].columns).toContain('CHART_SQL');
    expect(planChanges(baseline, baseline)).toEqual([]);
  });
  it('clones supported hierarchy with fresh structural IDs and exact SQL', () => {
    const baseline = fixture();
    const result = cloneBranch(baseline, 'DSH_MENU', 'm');
    const menu = result.tables.DSH_MENU.at(-1); const group = result.tables.DSH_SUMMARY_GROUP.at(-1);
    expect(menu.MENU_ID).not.toBe('m');
    expect(group.MENU_ID).toBe(menu.MENU_ID);
    expect(group.SQL_TEXT).toEqual(baseline.DSH_SUMMARY_GROUP[0].SQL_TEXT);
    expect(result.tables.DSH_SUMMARY_FIELD.at(-1).GROUP_ID).toBe(group.GROUP_ID);
    expect(result.tables.DSH_SUMMARY_FIELD).toHaveLength(3);
    expect(baseline.DSH_MENU).toHaveLength(1);
  });
  it('blocks cloning a menu with compatibility configuration', () => {
    const tables = fixture(); tables.DSH_SUMMARY_QUERY.push({ MENU_ID: 'm' });
    expect(() => cloneBranch(tables, 'DSH_MENU', 'm')).toThrow(/compatibility/i);
  });
  it('exposes orphan fields without repairing them', () => {
    const tables = fixture();
    expect(healthFindings(tables).filter(f => f.code === 'orphan')).toHaveLength(1);
    expect(tables.DSH_SUMMARY_FIELD).toHaveLength(2);
  });
  it('blocks changing structural parents', () => {
    const tables = fixture(); const desired = structuredClone(tables);
    desired.DSH_SUMMARY_GROUP[0].MENU_ID = 'other';
    expect(validateChanges(planChanges(tables, desired), {}, desired).some(e => /parent/i.test(e.message))).toBe(true);
  });
});
