// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { CompareConfigTool } from '../app/tools/compare-config/main.js';

function ensureInput(id) {
  const el = document.createElement('input');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function ensureSpan(id) {
  const el = document.createElement('span');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function ensureSelect(id) {
  const el = document.createElement('select');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

describe('CompareConfigTool presets', () => {
  let tool;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    tool = new CompareConfigTool(null);

    // Inputs required by getPresetPayload
    ensureInput('env1Id').value = 'UAT1';
    ensureInput('env1Host').value = 'uat.db';
    ensureInput('env1Port').value = '1521';
    ensureInput('env1Service').value = 'ORCLPDB1';
    ensureInput('env1Schema').value = 'APP_SCHEMA';
    ensureInput('env2Id').value = 'PROD1';
    ensureInput('env2Host').value = 'prod.db';
    ensureInput('env2Port').value = '1521';
    ensureInput('env2Service').value = 'ORCLPDB1';
    ensureInput('env2Schema').value = 'APP_SCHEMA';
    ensureInput('cmpTable').value = 'CONFIGS';
    ensureInput('cmpFields').value = 'ID,KEY,VALUE';
    ensureInput('cmpWhere').value = "KEY IN ('X','Y')";

    // Preset controls
    ensureInput('presetName').value = 'My Preset';
    ensureSpan('presetStatus');
    ensureSelect('presetSelect');

    // Extra inputs used by applySelectedPreset
    ensureInput('env1User');
    ensureInput('env1Pass');
    ensureInput('env2User');
    ensureInput('env2Pass');
  });

  it('saves, applies, and deletes a preset', () => {
    tool.savePreset();
    const store = JSON.parse(localStorage.getItem('compare-config.presets'));
    expect(Array.isArray(store)).toBe(true);
    expect(store.length).toBe(1);
    expect(store[0].name).toBe('My Preset');

    // refresh select and select first item
    tool.refreshPresetsSelect();
    const select = document.getElementById('presetSelect');
    select.value = '0';
    tool.applySelectedPreset();

    // Check a couple of fields populated
    expect(document.getElementById('env1Id').value).toBe('UAT1');
    expect(document.getElementById('env2Service').value).toBe('ORCLPDB1');
    expect(document.getElementById('cmpTable').value).toBe('CONFIGS');

    // Delete the preset
    tool.deleteSelectedPreset();
    const after = JSON.parse(localStorage.getItem('compare-config.presets'));
    expect(Array.isArray(after)).toBe(true);
    expect(after.length).toBe(0);
  });
});