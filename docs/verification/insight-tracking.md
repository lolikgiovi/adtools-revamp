# Insight tracking: browser check (2026-11-04)

Passed in Chrome against a local Vite dev server (`./node_modules/.bin/vite --port 1235`) with the local dev identity
(`localStorage` `user.email=dev@localhost`, `user.registered=true`), the same setup the browser tests in `frontend/core/tests` use.

## How to reproduce

1. Open `http://localhost:1235/#home` and run in the console:

   ```js
   const { UsageTracker } = await import("/core/UsageTracker.js");
   window.__calls = [];
   const ev = UsageTracker.trackEvent.bind(UsageTracker);
   UsageTracker.trackEvent = (f, a, m) => {
     if (["page_view", "failed", "search_empty", "no_results"].includes(a)) window.__calls.push({ kind: a, f, ...m });
     return ev(f, a, m);
   };
   UsageTracker._enabled = true; // tracking is off in dev; remote flush stays off in dev
   const use = UsageTracker.trackToolUse.bind(UsageTracker);
   UsageTracker.trackToolUse = (f, a, m) => {
     const id = use(f, a, m);
     const item = UsageTracker._state.toolUses.find((i) => i.event_id === id);
     window.__calls.push({ kind: "use", f, a, ms_to_first_use: item?.meta?.ms_to_first_use });
     return id;
   };
   ```

2. Do each step and read `window.__calls`.

## Results

| Step | Recorded |
|---|---|
| Click JSON Tools in the sidebar | `page_view` json-tools, `previous: home`, `source: sidebar` |
| Prettify `{"a": ` | `failed` json-tools, `action: prettify`, `category: invalid_input`; no use |
| Prettify `{"a": 1}`, then again | 2 `prettify` uses; only the first has `ms_to_first_use` (3180) |
| Global search "Base64", Enter | `page_view` base64-tools, `source: search` |
| Global search "zzqq_nothing", Escape | `no_results`, `term_length: 12`, no text |
| Browser Back | `page_view` json-tools, `source: history` |
| Home, click the UUID Generator card | `page_view` uuid-generator, `previous: home`, `source: home` |

Dashboard SQL for Tool Adoption, Entry Points, Empty Searches and Tool Failures was run against seeded SQLite through the
real handlers. Expected values matched: 2 of 3 open-days converted (66.7%), median first use 10s of 4s/10s/20s,
failure rate 20% (1 failure, 4 uses), and page views recorded before this change are left out of Entry Points.
