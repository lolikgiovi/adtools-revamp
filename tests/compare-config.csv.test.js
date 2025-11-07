// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { CompareConfigTool } from '../app/tools/compare-config/main.js';

function sampleComparisonPayload() {
  return {
    env1: { id: 'UAT1' },
    env2: { id: 'PROD1' },
    table: 'CONFIGS',
    fields: ['ID', 'KEY', 'VALUE'],
    comparisons: [
      {
        primary_key: { ID: '42' },
        status: 'Match',
        env1_data: { ID: '42', KEY: 'X', VALUE: 'A' },
        env2_data: { ID: '42', KEY: 'X', VALUE: 'A' }
      },
      {
        primary_key: { ID: '43' },
        status: 'Differ',
        differences: [
          { field: 'VALUE', env1: 'B', env2: 'C' },
          { field: 'KEY', env1: 'Y', env2: 'Y2' }
        ],
        env1_data: { ID: '43', KEY: 'Y', VALUE: 'B' },
        env2_data: { ID: '43', KEY: 'Y2', VALUE: 'C' }
      },
      {
        primary_key: { ID: '99' },
        status: 'OnlyInEnv1',
        env1_data: { ID: '99', KEY: 'Z', VALUE: 'K' },
        env2_data: null
      },
      {
        primary_key: { ID: '100' },
        status: 'OnlyInEnv2',
        env1_data: null,
        env2_data: { ID: '100', KEY: 'Q', VALUE: 'V' }
      }
    ]
  };
}

describe('CompareConfigTool CSV generation', () => {
  let tool;

  beforeEach(() => {
    tool = new CompareConfigTool(null);
  });

  it('generates CSV with header and rows for differences and only-in envs', () => {
    const csv = tool.toCsv(sampleComparisonPayload());
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('primary_key,status,field,env1,env2');
    // 2 difference rows + only-in rows expand to fields count
    // OnlyInEnv1 has 3 fields; OnlyInEnv2 has 3 fields → total rows >= 2 + 3 + 3 = 8
    expect(lines.length).toBeGreaterThanOrEqual(9); // header + rows
    // spot-check a difference row
    const diffRow = lines.find(l => l.includes('Differ') && l.includes('VALUE'));
    expect(diffRow).toBeTruthy();
    expect(diffRow.includes(',B,'));
    expect(diffRow.includes(',C'));
    // primary_key should be a JSON object string (single quotes normalized)
    expect(lines[1].startsWith('"{'));
  });
});