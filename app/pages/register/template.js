export const RegisterTemplate = /* html */ `
  <div class="register-page">
    <div class="register-card">
      <h2 class="register-title">Welcome</h2>
      <p class="register-desc">Set your Username and Office Email to continue.</p>
      <form class="register-form" novalidate>
        <div class="register-field">
          <label for="reg-username">Username</label>
          <input type="text" id="reg-username" class="register-input" placeholder="Input Username" aria-label="Username" required />
        </div>
        <div class="register-field">
          <label for="reg-email">Office Email</label>
          <input type="email" id="reg-email" class="register-input" placeholder="name@bankmandiri.co.id" aria-label="Office Email" required />
        </div>
        <div class="register-actions">
          <button type="submit" class="btn btn-primary">Continue</button>
        </div>
        <div class="register-error" aria-live="polite"></div>
      </form>
      <p class="register-note"></p>
    </div>
  </div>
`;
