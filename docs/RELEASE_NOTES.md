# Release Notes

## What's New

- **Analytics Dashboard** — Added owner insight tabs, Compare Config analytics tabs, nested tool actions, and stabilized overview queries
- **Analytics Coverage** — Expanded tracking across Quick Query, Compare Config, Base64 Tools, JSON Tools, HTML Editor, Master Lockey, Merge SQL, Run Batch, Run Query, Splunk Template, SQL In-Clause, TLV Viewer, and UUID Generator
- **Quick Query Enhancements**
  - Table autosave with debounced persistence
  - DBeaver schema paste support
  - UUID generator popover
  - Persisted query type with saved table state
  - Compact saved schema rows and styled action labels
  - Word wrap toggle and shortened action labels
- **Merge SQL** — Layout refinements including header padding and style improvements
- **Compare Config** — Analytics integration with dedicated dashboard tabs

## Fixes

- Fixed report image copy/download in web browser context
- Fixed report scroll clipping and added squad/feature tagging from inline SQL comments
- Fixed Download All to stagger downloads so browsers don't drop concurrent clicks
- Added asset load recovery for web tool routes

## Infrastructure

- Added lint and format tooling (ESLint, Prettier)
- Added D1 migration scripts for Cloudflare deploys
- Hardened analytics ingestion with error reporting
- Upload release artifacts before manifests
- Added ErrorMonitor for client-side error tracking