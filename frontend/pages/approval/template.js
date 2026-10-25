export const ApprovalTemplate = /* html */ `
  <section class="approval-dashboard">
    <div class="approval-auth" id="approval-auth">
      <div class="approval-auth-card">
        <form id="approval-auth-form">
          <label for="approval-password">Dashboard password</label>
          <input type="password" id="approval-password" class="approval-input" autocomplete="current-password" required>
          <button type="submit" class="btn btn-primary">Unlock Approvals</button>
          <div class="approval-message is-error" id="approval-auth-error" aria-live="polite"></div>
        </form>
      </div>
    </div>

    <div class="approval-content" id="approval-content" hidden>
      <div class="approval-header-actions" data-dashboard-session-actions hidden>
        <button type="button" class="btn btn-secondary btn-sm" id="approval-refresh">Refresh</button>
        <button type="button" class="btn btn-secondary btn-sm" id="approval-logout">Logout</button>
      </div>

      <div class="approval-toolbar">
        <div class="approval-tabs" role="tablist" aria-label="Approval status">
          <button type="button" class="approval-tab is-active" data-status="pending" role="tab" aria-selected="true">
            Pending <span id="pending-count">0</span>
          </button>
          <button type="button" class="approval-tab" data-status="approved" role="tab" aria-selected="false">
            Approved <span id="approved-count">0</span>
          </button>
        </div>
        <label class="approval-search">
          <span class="sr-only">Search requests</span>
          <input type="search" id="approval-search" class="approval-input" placeholder="Search email, name, or device">
        </label>
      </div>

      <div class="approval-message" id="approval-message" aria-live="polite"></div>
      <div class="approval-list" id="approval-list"></div>
    </div>
  </section>
`;
