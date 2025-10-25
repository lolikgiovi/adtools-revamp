export const RegisterTemplate = /* html */ `
  <div class="register-page">
    <div class="register-card">
      <h2 class="register-title">Welcome</h2>
      <p class="register-desc">Enter your details, then verify via email OTP.</p>
      <form class="register-form" novalidate>
        <div class="register-field">
          <label for="reg-username">Username</label>
          <input type="text" id="reg-username" class="register-input" placeholder="Input Username" aria-label="Username" maxlength="15" required />
        </div>
        <div class="register-field">
          <label for="reg-email">Office Email</label>
          <input type="email" id="reg-email" class="register-input" placeholder="name@bankmandiri.co.id" aria-label="Office Email" required />
        </div>
        <div class="register-field otp-field" style="display:none">
          <label for="reg-otp">Verification Code</label>
          <input type="text" id="reg-otp" class="register-input" placeholder="6-digit code" aria-label="Verification Code" inputmode="numeric" maxlength="6" />
          <div class="register-hint">We sent a code to your email. Enter it to continue.</div>
        </div>
        <div class="register-actions">
          <button type="submit" class="btn btn-primary" data-role="submit-btn">Continue</button>
        </div>
        <div class="register-error" aria-live="polite"></div>
      </form>
      <p class="register-note">We verify your office email via OTP. Whitelist applies.</p>
    </div>
  </div>
`;
