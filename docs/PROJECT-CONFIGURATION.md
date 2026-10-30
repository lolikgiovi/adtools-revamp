# Project configuration

Each registered department can have multiple projects. Use the project selector in
navigation or Settings to select one. Add and rename projects in Settings.

```text
Department
└── Project
    ├── QQ Schema (opens Quick Query)
    └── Testing Environments
        └── Environment
            ├── Critical Database connection reference
            ├── Complementary Database connection reference
            ├── CDN Public URL
            └── CDN Direct URL
```

Projects scope the environment list used by existing tools and the Quick Query
schema catalog, saved table data, query tabs, and tab sessions. Oracle connection
profiles and secure credentials remain shared; environment entries reference
profiles by name. Renaming or deleting a connection updates references across all
projects. Other tool preferences and integrations keep their existing scope.

## Storage and compatibility

- `config.projects` holds a versioned project registry, department ownership, and
  the original project's ID. This is device-local configuration, not a server
  project directory or a new authorization boundary.
- The original project keeps existing `config.environments`, `config.baseUrls`,
  and the `QuickQueryDatabase` IndexedDB database. No schema copy is required.
- New projects get empty environment lists under
  `project:<id>:config.environments` and independent
  `QuickQueryDatabase-project-<id>` databases.
- Each browser tab pins its active project in session storage. A saved local
  preference determines the initial selection in a new tab. A switch in another
  tab does not change an existing tab's active project.
- Switching saves the active QQ draft before reloading the application and
  reopening the current screen. Failed saves and known running jobs block the
  switch.
- Older environment publications have no project identity. They continue to
  update the original project's environments, regardless of selection. Publication
  rollback includes the environment storage keys.
- Project creation, selection, and schemas do not synchronize between devices.
  Publishing project registries or project schema catalogs is not implemented.

## Verification

See [the repeatable browser checks](verification/projects/README.md). Core coverage
is in `frontend/core/tests/projects.test.js` and `project-switch.test.js`.
