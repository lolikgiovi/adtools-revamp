export const SettingsTemplate = /*html*/ `
  <section class="settings-page">
    <header class="settings-header">
      <h2>Settings</h2>
      <div class="settings-header-tools">
      <button type="button" class="btn btn-secondary settings-load-defaults" aria-label="Load default settings">Load Default Settings</button>
      <div class="runtime-status" aria-live="polite">
        <span id="runtime-status" class="runtime-status-badge" data-state="detecting">Detecting…</span>
      </div>
      </div>
    </header>
    <div class="settings-categories"></div>

    <!-- OTP Modal -->
    <div class="otp-modal" hidden>
      <div class="otp-dialog">
        <h3>Load Default Settings</h3>
        <p class="otp-email-status"></p>
        <div class="otp-actions">
          <button type="button" class="btn btn-primary otp-request">Request OTP</button>
        </div>
        <div class="otp-input-row">
          <input type="text" class="otp-code-input" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter 6-digit OTP" />
          <button type="button" class="btn btn-secondary otp-confirm">Confirm</button>
        </div>
        <div class="otp-error" aria-live="polite"></div>
        <div class="otp-footer">
          <button type="button" class="btn otp-close">Close</button>
        </div>
      </div>
    </div>
  </section>
`;
