export const SettingsTemplate = /*html*/ `
  <section class="settings-page">
    <header class="settings-header">
      <h2>Settings</h2>
      <input
        id="settings-search"
        class="settings-search"
        type="search"
        placeholder="Search settings…"
        aria-label="Search settings"
        aria-controls="settings-categories"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="settings-header-tools">
      <button type="button" class="btn btn-secondary btn-sm settings-load-defaults" aria-label="Load default settings">Load Default Settings</button>
      <div class="runtime-status" aria-live="polite">
        <span id="runtime-status" class="runtime-status-badge" data-state="detecting">Detecting…</span>
      </div>
      </div>
    </header>
    <span id="settings-search-status" class="sr-only" role="status" aria-live="polite"></span>
    <div id="settings-categories" class="settings-categories"></div>
    <p id="settings-search-empty" class="settings-search-empty" hidden>No settings match your search.</p>
  </section>
`;
