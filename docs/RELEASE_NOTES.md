# AD Tools 1.3.10

- **Kafka** — Save named broker connections in Settings, then pick the active broker from the Kafka tool header. Existing broker settings are migrated into saved connections.
- **Quick Query** — Excel and Oracle imports are now a single Import menu.
- **Quick Query** — Add Row and Remove Row buttons replace the previous Modify Rows menu.
- **Quick Query** — Save always opens the filename dialog and writes a `.sql` file.

## Earlier release notes

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
