# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# analytics
- Avoid double-counting analytics events. Tabs reporting unique actions must not count the same event under multiple categories; each event should map to exactly one action type. Confidence: 0.80

# tauri
- Use Tauri native file selection dialog instead of browser-based upload mechanism for file picking. Confidence: 0.70

# ui
See [ui/taste.md](ui/taste.md)

# product
- Prefers generalizing hardcoded, per-pipeline Jenkins curl wrappers (e.g. run-query, run-batch) into one dynamic, config-driven pipeline runner: the user browses/searches the available pipelines, picks one, and sets its parameters up through the tooling instead of adding another bespoke wrapper module. Confidence: 0.6
- Wants user-set parameters to be savable as reusable favorites, and those favorites to be quick and easy to access. Confidence: 0.6
- Prefers cross-cutting configuration to be promoted into one explicit, app-wide domain concept rather than a page-local settings widget: e.g. a "Testing Environment" that bundles a critical/core database, an optional complementary database, and the CDN base URL(s), so every tool reads the same shared model instead of each re-deriving its own env-keyed lists. Confidence: 0.6
- Prefers the DRY version of per-environment URL config: instead of repeating a full URL per environment, store one shared relative path and append it to the environment's base URL (base URL stored without a trailing slash, path always starting with `/`); validate URL inputs as http(s) host+path (IP or domain) with no query/fragment on the base. Confidence: 0.5

# workflow
- Wants finished work committed as its own focused commit before starting the next task, rather than letting changes pile up uncommitted across tasks (typical message: "commit. next, ..."). Confidence: 0.5

# communication
- Communicates in very short, telegraphic directives ("commit. next, how about adding ...") and expects the agent to infer scope, pick the implementation details, and report back — no long specs needed. Confidence: 0.6
- Frames new ideas as feasibility questions ("how hard is it?" / "right?") and wants an honest difficulty/approach assessment of the proposed design before implementation starts. Confidence: 0.55
- Wants precise terminology spelled out for technical artifacts, not just behavior: when shown a technical comparison, asks "what are they called?" — expects standard/industry names for each piece (e.g. hostname vs IP literal, property vs edge hostname, public/edge URL vs direct-to-origin URL) rather than descriptions alone. Confidence: 0.5
- Proposes new concepts up front as a named idea plus a nested bullet breakdown of its constituent fields/parts ("How about we frame a concept of X? Consist of: ...") and expects the agent to work out the actual data model and integration from that sketch. Confidence: 0.55
- When a change involves a design/format decision (data shape, input convention, validation policy), wants to be shown the competing options with a clear recommendation and trade-offs rather than have the agent silently pick one ("Or which is better give me option"). Confidence: 0.6
# html-minification
- Keep closing slashes and closing tags when minifying HTML; do not use minification that removes closing tags as it breaks legacy HTML processors. Confidence: 0.70
- Remove fallback behavior for html-minifier: if the package is unavailable, fail with a clear error message instead of silently falling back to an unsafe minification path. Confidence: 0.70
