export const SettingsTemplate = /* html */ `
  <div class="settings-page">
    <div class="settings-header">
      <h2 class="settings-title">Settings</h2>
      <div class="settings-actions">
        <button type="button" class="btn settings-reload">Reload Config</button>
      </div>
    </div>
    <div class="settings-toolbar">
      <input id="settings-search" class="settings-search" type="search" placeholder="Search settings..." aria-label="Search settings">
    </div>
    <div class="settings-categories" aria-live="polite"></div>
  </div>
`;
