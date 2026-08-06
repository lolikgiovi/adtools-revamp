export const RegisterTemplate = /* html */ `
  <div class="register-page">
    <div class="register-card">
      <h2 class="register-title">Welcome</h2>
      <p class="register-desc">Enter your details, then choose email verification or request a manual review.</p>
      <form class="register-form" novalidate>
        <div class="register-field">
          <label for="reg-username">Display Name</label>
          <input type="text" id="reg-username" class="register-input" placeholder="Input Username" aria-label="Username" maxlength="15" required />
        </div>
        <div class="register-field">
          <label for="reg-email">Email</label>
          <input type="email" id="reg-email" class="register-input" placeholder="name@example.com" aria-label="Email" required />
        </div>
        <div class="register-field otp-field" style="display:none">
          <label for="reg-otp">Verification Code</label>
          <input type="text" id="reg-otp" class="register-input" placeholder="6-digit code" aria-label="Verification Code" inputmode="numeric" maxlength="6" />
          <div class="register-hint">We sent a code to your email. Enter it to continue.</div>
        </div>
        <div class="register-actions">
          <button type="button" class="btn btn-secondary" data-role="manual-approval-btn">Request Manual Approval</button>
          <button type="submit" class="btn btn-primary" data-role="submit-btn">Request OTP</button>
        </div>
        <div class="register-error" aria-live="polite"></div>
      </form>
      <div class="approval-status" data-role="approval-status" hidden>
        <div class="approval-status-mark" aria-hidden="true"></div>
        <div class="approval-status-copy">
          <strong>Approval requested</strong>
          <span>An administrator needs to approve this device before you can continue.</span>
        </div>
        <button type="button" class="btn btn-secondary" data-role="check-approval-btn">Check Status</button>
      </div>
      <p class="register-note">Manual requests include device and browser details so an administrator can recognize the request. Bank Mandiri email is required for managed config access.</p>
    </div>
  </div>
`;
