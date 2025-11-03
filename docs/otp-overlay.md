# OTP Overlay Component

A reusable vanilla JS OTP overlay for AD Tools.

## Features

- Request and verify OTP via configurable endpoints.
- Front-end rate limiting: disables the request button with a countdown.
- Dev-mode convenience: auto-fills OTP if backend returns `devCode`.
- Optional KV fetch after successful verification, using a configurable key.
- Lightweight API suitable for any module.

## Import

```
import { openOtpOverlay } from '../../components/OtpOverlay.js';
```

## Usage

```
const email = localStorage.getItem('user.email');
const { token, kvValue } = await openOtpOverlay({
  email,
  requestEndpoint: '/register/request-otp',
  verifyEndpoint: '/register/verify',
  rateLimitMs: 60_000,
  storageScope: 'settings-defaults',
  kvKey: 'settings/defaults',
});

// Apply kvValue if provided
```

### Options

- `email`: Email address to receive the OTP (required).
- `requestEndpoint`: Endpoint to request OTP (default `/register/request-otp`).
- `verifyEndpoint`: Endpoint to verify OTP (default `/register/verify`).
- `rateLimitMs`: Cooldown in ms for the request button (default `60000`).
- `storageScope`: LocalStorage key suffix to scope cooldown per use case.
- `kvKey`: Optional KV key to fetch after verification (e.g., `settings/defaults`).
- `onClose`: Optional callback fired when overlay closes.

## UI/UX

- Mirrors the Register OTP experience: simple inputs, clear errors, and success flow.
- Button text switches to `Resend in Ns` during cooldown.

## Notes

- CSS classes reuse Settings module styles (`.otp-modal`, `.otp-dialog`, etc.). Ensure styles are loaded in modules that use this overlay.