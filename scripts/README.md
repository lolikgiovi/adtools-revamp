# Oracle Instant Client Installation Script

This directory contains the installation script for Oracle Instant Client, which is required for the Compare Config feature in AD Tools.

## Files

- `install-oracle-instant-client.sh` - The automated installation script

## Deployment

### Hosting the Script on Cloudflare Workers

The script needs to be hosted at: `https://adtools.lolik.workers.dev/install-oracle-instant-client.sh`

**Option 1: Upload to Cloudflare R2/Workers Storage**

1. Log in to Cloudflare Dashboard
2. Navigate to R2 or Workers KV
3. Upload `install-oracle-instant-client.sh`
4. Make it publicly accessible at the URL above

**Option 2: Create a Cloudflare Worker**

Create a simple worker that serves the script:

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/install-oracle-instant-client.sh') {
      const script = await fetch('https://raw.githubusercontent.com/YOUR_REPO/ad-tools-revamp/main/scripts/install-oracle-instant-client.sh');
      return new Response(await script.text(), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

**Option 3: Direct File Serving**

Upload the script content directly to Cloudflare Workers as a static asset:

```javascript
const INSTALL_SCRIPT = `#!/bin/bash
... (content of install-oracle-instant-client.sh) ...
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/install-oracle-instant-client.sh') {
      return new Response(INSTALL_SCRIPT, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

## Testing the Installation Script

Before deploying, test the script locally:

```bash
# Make script executable
chmod +x scripts/install-oracle-instant-client.sh

# Run script locally (dry-run mode if available)
./scripts/install-oracle-instant-client.sh
```

## Testing the Deployed Script

Once deployed to Cloudflare Workers, test the one-line installation:

```bash
curl -fsSL https://adtools.lolik.workers.dev/install-oracle-instant-client.sh | bash
```

## Script Functionality

The script automatically:

1. ✓ Detects macOS version (requires 11.0+)
2. ✓ Detects architecture (ARM64 or x86_64)
3. ✓ Downloads Oracle Instant Client from Oracle's official site
4. ✓ Extracts and installs to `~/Documents/adtools_library/instantclient/`
5. ✓ Verifies installation integrity
6. ✓ Provides clear progress messages and error handling

## Oracle Download URLs

For macOS ARM64 (Apple Silicon), the installer now uses the official DMG package and falls back to ZIP if needed:

- **ARM64 (Apple Silicon) – DMG (preferred)**: `https://download.oracle.com/otn_software/mac/instantclient/instantclient-basic-macos-arm64.dmg`
- **ARM64 (fallback ZIP)**: `https://download.oracle.com/otn_software/mac/instantclient/instantclient-basic-macos.arm64-23.3.zip` and `instantclient-basiclite-macos.arm64-23.3.zip`
- **Intel x86_64**: ZIP packages, e.g. `https://download.oracle.com/otn_software/mac/instantclient/instantclient-basiclite-macos.x64-23.3.zip`

Check the Oracle page for the latest version and package availability:
`https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html`.

## Security Considerations

- The script uses `set -e` to exit on any error
- No admin/sudo privileges required
- Downloads only from official Oracle domains
- Verifies file integrity after extraction
- All operations are in user's home directory

## Version Management

When Oracle releases new Instant Client versions:

1. Update the `VERSION` variable in the script (e.g., `VERSION="23_3"`)
2. Update download URLs if the URL format changes
3. Test locally before deploying to Cloudflare Workers
4. Update the documentation if installation steps change

## Support

For issues with the installation script:

1. Check the troubleshooting guide in the app
2. Verify macOS version compatibility
3. Check architecture detection (`uname -m`)
4. Review Oracle's official download page for changes
