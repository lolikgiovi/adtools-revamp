# AD Tools 1.3.11

- **Velocity Template** — Edit Velocity templates with JSON Context Data, live Text/JSON previews, source-located diagnostics, and validation through the configured API. Desktop can import templates from Oracle and create Quick Query drafts.
- **Lockey Update** — Validate localization batches for up to four release targets, generate Oracle INSERT SQL with post-update inspection queries, and inspect/filter localization history loaded from Oracle.
- **Quick Query** — Preserve typed spreadsheet values, BLOB placeholders, and CONFIG_IDs; align imports with schema fields, show clearer Oracle errors, and warn about attachments over 300 KB.
- **HTML Template** — Preserve unusual line separators through text import and export, and identify them in encoding review.
- **Registration** — Collect Bank Mandiri department and role details, verify by OTP first, and offer manual approval when email delivery fails.
- **App experience** — Refresh the analytics dashboard, improve mobile sidebar behavior and installed-web-app metadata, and add a Desktop title bar, tab shortcuts, and macOS window lifecycle handling.

## Earlier release notes

### AD Tools 1.3.10

- **Compare Config** — Your sources, query mode, fetch limit, and comparison options are remembered and restored the next time you open the tool.
- **Compare Config** — Results are now Summary Grid and Detail View tabs; Detail View puts each record's changed fields over one side-by-side text diff.
- **Compare Config** — Get row query turns every differing record into a paste-ready WHERE predicate, grouped as Only in Source A, Only in Source B, and Value differs.
- **Kafka** — Save named broker connections in Settings, then pick the active broker from the Kafka tool header. Existing broker settings are migrated into saved connections.
- **Quick Query** — Excel and Oracle imports are now a single Import menu.
- **Quick Query** — Add Row and Remove Row buttons replace the previous Modify Rows menu.
- **Quick Query** — Save always opens the filename dialog and writes a `.sql` file.
- **Check Image** — Choose one or more saved Oracle connections; each selected connection adds its own Context and Base64 size columns for CONTENT.IMAGE.

### AD Tools 1.3.9

- **Kafka** — Generate and copy a UUID directly from the payload editor.
- **Kafka** — Keep multiple request tabs open; drafts and the active tab are restored when you reopen Kafka.
- **Kafka** — Retained-history search handles partitions without matching records and offers search ranges up to 60 days.
- **Run Query** — The template editor now lays out correctly when its modal opens.

### AD Tools 1.3.8

- **HTML Template** — Review characters at risk in Windows text imports. Compare the Windows example and ASCII-safe preview, inspect the source diff,
  and apply supported replacements with Undo available.
- **Quick Query** — Scrolling stays inside query editors. Oracle import keeps your draft query, and Save As has clearer SQL file naming.
- **HTML Template** — Save the current document as an HTML file.
- **Base64 Tools** — Preview a decoded file before saving it.
- **Dashboard** — Overview metrics now follow the selected time range.

### AD Tools 1.3.7

- **Kafka** — Configure a bootstrap server, publish to topics, listen live, and search retained messages. Reuse a received message as an editable Publish draft.
- **Redis Cache** — Find keys in bounded pages, inspect values, and clear selected keys with a confirmation step.
- **Editors** — Work with multiple HTML documents in tabs, use tab menu actions, and undo bulk closes. Quick Query also has improved tab management and layout.
- **Preview and Check Image** — Choose preview viewport presets and VTL mode; check images across multiple environments.

### Older changes

- **Quick Query Enhancements**
  - DBeaver schema paste support
  - UUID generator popover support
  - Save As file name, also support format for Deployment
- **Performance Enhancement** — Prevent memory leak by cleaning up idle editors/tables/workers
- **Merge SQL** — Add "Validation SQL" to count before-after query execution
