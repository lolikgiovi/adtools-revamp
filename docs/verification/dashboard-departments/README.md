# Analytics › Departments

Which departments use AD Tools, and which tools each department uses.

## Behavior

- New primary Analytics view **Departments** (`tabId: "departments"` on `/dashboard/query`). It uses the
  existing dashboard password session and Analytics time range.
- Department table: active / registered people, actions, distinct tools, devices, last active.
  Registered departments without activity stay visible. People without a department appear as `Unknown`.
- Tools by department matrix: one row per tool and one column per active department. People/Actions toggle.
- Counts come from directly recorded client actions in `tool_usage` (`source = 'client'`). Reconstructed rows,
  excluded/development devices, and double counting across one person's devices are rejected.
  Registered people need a non-excluded device. Departments use each person's current profile.
- Windows match Trends: multi-day ranges are complete Jakarta days ending at midnight today.
- No migration. Needs Worker and frontend deployment.

## Reproduce

```bash
./node_modules/.bin/vite --host 127.0.0.1 --port 1246 --strictPort
```

```bash
DASHBOARD_TEST_URL=http://127.0.0.1:1246 \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node frontend/pages/analytics-dashboard/tests/departments-browser.mjs
```

The test uses migrated in-memory SQLite, real authenticated Worker handlers, and system Chrome.
`result.json` lists checks. Screenshots: `1440-departments.png`, `390-departments.png`.
