// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { CompareConfigTool } from '../app/tools/compare-config/main.js';

function setCheckbox(id, checked) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.id = id;
  el.checked = checked;
  document.body.appendChild(el);
}

describe('CompareConfigTool filters', () => {
  let tool;
  const sample = [
    { status: 'Match' },
    { status: 'Differ' },
    { status: 'OnlyInEnv1' },
    { status: 'OnlyInEnv2' },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
    tool = new CompareConfigTool(null);
  });

  it('shows only differences when Differences is checked', () => {
    setCheckbox('fltMatches', false);
    setCheckbox('fltDifferences', true);
    setCheckbox('fltOnlyEnv1', false);
    setCheckbox('fltOnlyEnv2', false);
    const filtered = tool.filterComparisons(sample);
    expect(filtered.length).toBe(1);
    expect(filtered[0].status).toBe('Differ');
  });

  it('shows matches only when Matches is checked', () => {
    setCheckbox('fltMatches', true);
    setCheckbox('fltDifferences', false);
    setCheckbox('fltOnlyEnv1', false);
    setCheckbox('fltOnlyEnv2', false);
    const filtered = tool.filterComparisons(sample);
    expect(filtered.length).toBe(1);
    expect(filtered[0].status).toBe('Match');
  });

  it('shows all when all filters are checked', () => {
    setCheckbox('fltMatches', true);
    setCheckbox('fltDifferences', true);
    setCheckbox('fltOnlyEnv1', true);
    setCheckbox('fltOnlyEnv2', true);
    const filtered = tool.filterComparisons(sample);
    expect(filtered.length).toBe(sample.length);
  });
});