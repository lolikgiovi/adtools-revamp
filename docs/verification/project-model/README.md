# Project model assessment

Business scenario: a Retail person works on Livin, Livin Dili, and a project handled by another department.
Each project has independent environments and Quick Query table definitions, including identical names.

This assessment uses a fresh browser context with fixture data and blocks requests outside the local Vite server.
It changes no application behavior and uses no real database credentials or remote databases.

## Reproduce

Start the installed server:

```sh
./node_modules/.bin/vite --port 1247 --host 127.0.0.1
```

Run with the already installed browser tooling:

```sh
PROJECTS_TEST_URL=http://127.0.0.1:1247 \
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/core/tests/project-model-browser.mjs
```

The runner writes [result.json](result.json) and screenshots beside this file. Exit code 1 means at least one business requirement
failed; inspect the named checks to distinguish a model mismatch from an unexpected execution failure.

## Findings

The storage boundary is the project ID: identical `APP.CUSTOMER` names, `UAT` environment names, and query draft IDs can have
different contents in Livin and Livin Dili. Checks cover saved table data, drafts, tab sessions, switching, reloads, existing-tab
selection, and rendering both projects in Quick Query. Settings navigation and project switching use the application UI;
table definitions and draft contents are seeded through the real storage service.

The cross-department requirement fails: the registry filters projects using `user.department` and rejects selecting another
department's project. There is no assignment/membership model. The cross-department fixture creates a project under SME and then
attempts selection as Retail; it does not claim that a real assignment API exists.

The intended domain distinguishes a person's department from the projects they work on; see [the glossary](../../../CONTEXT.md).
A project remains the container for environments and schemas. Department can describe ownership or organization without determining
which local project a person can select. Shared project discovery or enforced membership would require a separate product decision;
the current registry is device-local and provides neither.

This assessment does not resolve the earlier switching, concurrent-registry, Oracle import draft, or defaults-loading findings.
It does not test live Oracle execution, cross-device sharing, authorization, or department changes while a tool is mounted.
