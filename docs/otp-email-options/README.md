# OTP email design options

Preview-only designs for the AD Tools verification email. Charcoal & gold is now implemented in `backend-workers/src/utils/email.js`. Deployment is separate.

Open `index.html` directly, or serve this directory:

```sh
python3 -m http.server 1248 --bind 127.0.0.1 --directory docs/otp-email-options
```

Visit http://127.0.0.1:1248. Select each design and toggle Phone width. Light and dark previews sit side by side.

- **Charcoal & gold:** warm accent, rounded sheet and code panel; closest to the existing direction.
- **Paper & ink:** square letter, left-aligned code, minimal framing.
- **Midnight blue:** centered composition and a larger blue code panel.

The unsuffixed HTML files are sendable concept templates with inline default colors, HTML background attributes,
`prefers-color-scheme` rules, and Outlook `data-ogsb` selectors. The `-light` and `-dark` files freeze each
palette for comparison. All use the synthetic code `123456` and the current 30-minute expiry.
These files do not generate valid authentication codes.

## Verification

Browser inspection at 1440, 768, and 390 pixels passed with no findings after allowing the marketing-page-only
imagery, large hero, motion, and video rules. Those rules are inappropriate for transactional emails and their preview.
The source lint passed. Arial is intentional: email-safe system typography avoids dependence on web-font loading.

Reproduce the browser inspection using the installed skill tooling:

```sh
node /Users/ddl/.agents/skills/design-taste-frontend/scripts/lint.mjs docs/otp-email-options
node /Users/ddl/.agents/skills/design-taste-frontend/scripts/inspect.mjs docs/otp-email-options/index.html --out /tmp/adtools-otp-inspect --widths 1440,768,390 --allow few-pictures,focal-point,still-page,no-footage
```

The palette previews are browser evidence, not Outlook rendering evidence. After selecting a direction, send the
unsuffixed HTML through Resend to the existing Gmail and office test recipients. Inspect each received message in
light and dark mode. Outlook versions can transform colors even when custom dark-mode CSS is present.

## Outlook message-toggle correction

The first received-email test still showed dark colors in the light message view, and flattened gray backgrounds in dark mode.
The OS-level dark media query now excludes Outlook-prefixed classes. A white wrapper gives Outlook a background
it can transform; its `data-ogsb` marker scopes the message-level dark palette to descendants.
Reference: https://www.hteumeuleu.com/2021/emails-react-outlook-com-dark-mode/
Browser simulations can check selector behavior but do not establish real Outlook rendering.
