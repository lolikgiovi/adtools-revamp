export const SettingsTemplate = /*html*/`
  <section class="settings-page">
    <header class="settings-header">
      <h2>Settings</h2>
      <div class="settings-header-tools">
        <div class="runtime-status" aria-live="polite">
          <span id="runtime-status" class="runtime-status-badge" data-state="detecting">Detecting…</span>
        </div>
        <button type="button" class="btn btn-secondary settings-reload" aria-label="Reload configuration">Reload</button>
      </div>
    </header>
    <div class="settings-categories"></div>
  </section>
`;
