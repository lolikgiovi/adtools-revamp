# Project settings plan

Status: proposed implementation. This document records the requested ownership model; application behavior has not changed.

## Settings hierarchy

```text
Settings
├── App Settings
│   ├── Theme
│   └── Updates
├── App Integration
│   ├── Confluence: URL, username, credential
│   ├── Jira: URL, username, credential
│   └── Jenkins: URL, username, credential
└── Project [selected project]
    ├── Quick Query schemas
    ├── Testing Environments
    │   └── [environment]
    │       ├── Oracle connections: critical and optional complementary
    │       ├── CDN public URL
    │       └── CDN direct URL
    ├── Jira project key
    ├── Redis
    ├── Kafka
    ├── Lockey Path
    ├── Merge SQL
    └── Velocity API Validator
```

The project selector remains the existing control. Each child edits the selected project's data.
Use these headings and existing field labels without explanatory taglines or duplicate scope labels.
Redis and Kafka stay direct project children rather than appearing inside testing environments.

Interpretations from the request:

- “Quickly schemas” means Quick Query schemas.
- “Login path” means the existing Lockey Path setting (`config.lockeyPath`).
- “Fastly API validator” means the existing Velocity API Validator, including both template endpoints.
- Credentials being “the same” means each service's credentials are reused across projects. It does not merge the three services' tokens.
- The target is one Jira project key per AD Tools project. Existing multi-key values need the migration handling below.

## Current behavior and gaps

| Area | Current behavior | Planned behavior |
| --- | --- | --- |
| Quick Query | Project-specific database and schema catalog | Preserve isolation and existing Manage schemas action |
| Environments | Project-specific records under Project | Preserve ownership and CDN fields |
| Oracle | Global connection catalog referenced by environment connection names | Environment-owned connections with stable identities |
| Integration credentials | Global service credentials | Preserve reuse across projects and existing secure storage |
| Jira keys | Global list under App Integration | One key under the selected Project |
| Redis and Kafka | Global configuration under Connections | Project-specific configuration directly under Project |
| Lockey, Merge SQL, validators | Global configuration under Tool Settings | Project-specific configuration directly under Project |
| Published settings | Some paths apply settings globally or to the legacy project | Explicit destination project for project-owned settings |

Relevant boundaries are `frontend/core/Projects.js`, `frontend/core/Environments.js`,
`frontend/pages/settings/{config.json,main.js,service.js}`, `frontend/core/PublishedSettings.js`,
and `shared/published-settings.js`. Tool consumers and Desktop commands must follow the same ownership model.

## Ownership and behavior rules

1. App integration URLs and credentials remain outside project storage. Changing projects does not require signing in again.
2. All project-owned reads and writes use a shared storage boundary with an explicit project identity.
   Capture that identity when starting asynchronous work so a later switch cannot redirect its result into another project.
3. Oracle connections belong to a testing environment. Maintain the current critical/complementary roles and use stable connection IDs
   for references and secure credentials. Renaming a connection or environment must not lose credentials or break bindings.
4. Redis credentials follow the project identity in Desktop secure storage. Identical hosts or display names in two projects must not
   cause credential reuse. Preserve Kafka's existing plaintext profile behavior while isolating saved and active profiles by project.
5. New projects start with empty project configuration. They reuse global app integrations without inheriting another project's values.
6. Switching projects refreshes tools, settings, active connection selections, and connection indicators together.
   Preserve existing unsaved-work protections. Environment switches affect Oracle and CDN targeting without changing Redis or Kafka.
7. Publication and import/export preserve project ownership. Credentials stay excluded from shared publications.
   Keep the existing department/access behavior outside this change's scope.

## Implementation sequence

### 1. Establish the shared storage boundary

Extend the existing project helpers rather than adding independent namespacing in every tool.
Declare project ownership centrally for Jira key, Redis fields, Kafka profiles and selection, Lockey Path,
Merge SQL squad names, and validator endpoints. Keep integration credentials, appearance, and updates global.
Use this same declaration for Settings, tool consumers, publishing, and import/export where applicable.

### 2. Migrate existing values without loss

- Use a versioned, repeatable migration with rollback on partial failure. Preserve legacy values until migration succeeds.
- Assign existing global project configuration to the existing legacy/default project only; do not copy it into every project.
- Preserve the existing Quick Query database and project environment IDs.
- Migrate a single Jira key automatically, including the older singular storage key. For multiple keys, retain the complete old list
  and show a project-specific selection step. Do not silently choose the first key or discard the others.
- Resolve each environment's existing Oracle name references. If several environments use one legacy connection, create independent
  environment-owned records and migrate their secure credentials. Retain unbound connections for explicit assignment.
- Report unresolved references without dropping them. Handle duplicate connection names across environments and projects.
- Migrate Redis secure credentials together with their project configuration. Make Desktop migration retryable if secure storage is unavailable.

### 3. Update consumers and Desktop integration

Route Ticket Template, Redis, Kafka, Master Lockey, Merge SQL, Velocity Template, HTML notification validation,
Oracle execution, and connection indicators through the shared scope helpers.
Inspect Desktop command and credential identities as well as frontend storage: moving fields in Settings alone is insufficient.
Ensure tool defaults and retries cannot fall back to a different project's configuration.

### 4. Align publication and import/export

Add explicit destination-project handling to shared settings application, publication selection, and restoration paths.
Update validation for environment-owned Oracle connections and project-specific Jira keys.
Preserve the ability to read existing publications through a compatibility layer with a defined destination project.
Retain atomic application and rollback; applying project settings must leave other projects and shared credentials intact.

### 5. Restructure Settings

Move project fields into the hierarchy above and remove the old top-level Connections and Tool Settings groups once empty.
Keep Oracle management inside the environment editor, including import and critical/complementary assignment.
Move the Jira key out of App Integration. Preserve search, focused-setting navigation, runtime visibility,
keyboard access, responsive layout, and existing unsaved Oracle import drafts.

### 6. Verify the complete workflow

Prefer a repeatable browser E2E scenario with two projects and matching environment and connection names:

1. Give each project different schemas, Oracle connections, Jira key, Redis/Kafka profiles, path, squads, and validator endpoints.
2. Switch projects and reload; verify every field and tool uses the expected project's values.
3. Switch environments within one project; verify Oracle/CDN changes while Redis/Kafka and the Jira key remain unchanged.
4. Verify shared integration configuration survives every switch.
5. Start an asynchronous action, switch projects, and confirm its result stays attached to its original project.
6. Exercise legacy migration, multi-key Jira selection, unbound/shared Oracle connections, retries, and failure recovery.
7. Apply a published configuration to one project and verify the other remains unchanged and no credentials appear in the payload.
8. Check Desktop secure credential isolation with mocked commands, then record any live Desktop verification still required.
9. Check Settings on desktop and narrow screens, including search links to relocated fields.

Write the reproduction command, pass/fail results, and screenshots under `docs/verification/project-settings/`.
Run the smallest relevant existing Vitest files sequentially, then broaden checks only as needed.
Design any necessary new isolated tests before implementation, first recording their failure scenarios.

## Completion criteria

The visible hierarchy and actual storage ownership agree. Switching projects changes every project-owned setting,
shared integration credentials remain usable, Oracle targeting follows the testing environment, and existing data migrates without loss.
