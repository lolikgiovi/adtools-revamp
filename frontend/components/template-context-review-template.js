export const TemplateContextReviewTemplate = /* html */ `
    <div id="velocitySyncOverlay" class="vtl-import-overlay app-overlay-backdrop" hidden></div>
    <div
      id="velocitySyncDialog"
      class="vtl-import-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="velocitySyncTitle"
      hidden
    >
      <div class="vtl-import-dialog app-overlay-surface">
        <div class="vtl-import-header">
          <h3 id="velocitySyncTitle">Review context fields</h3>
          <button id="btnCloseVelocitySync" class="overlay-close-button app-overlay-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="vtl-import-body">
          <p class="vtl-sync-intro">
            Review missing inputs and values whose shape does not match the template. Apply the suggested samples, then edit
            them with your data. Helper methods require runtime support and cannot be supplied through JSON.
          </p>
          <ul id="velocitySyncFields" class="vtl-sync-list"></ul>
        </div>
        <div class="vtl-import-footer app-modal-actions">
          <button id="btnApplyVelocitySync" class="btn btn-primary" type="button">Apply changes</button>
          <button id="btnCancelVelocitySync" class="btn" type="button">Cancel</button>
        </div>
      </div>
    </div>


`;
