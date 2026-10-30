# AD Tools Product Context

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The analytics dashboard serves the maintainer investigating AD Tools adoption and user behavior. This audience and job were confirmed on 2026-10-14. Other product audiences are outside this scoped record.

## Product Purpose

Help the maintainer understand when and how people use tools, how patterns change between periods,
and how people and devices are distributed across departments. More recorded activity is not a product goal.

## Operating Context

AD Tools has a Vanilla JavaScript frontend, a Cloudflare Workers backend, and a Tauri desktop wrapper. The dashboard is password protected and reads analytics through Worker endpoints.

## Capabilities and Constraints

- Preserve authentication, existing report access, configured report definitions, and pagination.
- Preserve the established application shell and shared component vocabulary.
- Distinguish successful uses, opens, tracked events, validation reports, and uncaught errors.
- Repeated use within one date window is not evidence of returning on a later day.
- Do not invent trends, funnels, cohorts, or retention metrics unsupported by the data.
- Recorded tool actions are not unique tasks, productivity, or time saved. Separate output actions, opens, errors, and device check-ins.
- Compare equal periods in Jakarta time and expose collection gaps and uncertainty rather than treating missing telemetry as confirmed non-use.
- Keep the redesign scoped to analytics; other tools are outside the request.

## Evidence on Hand

Live Overview and Opportunities inspected on 2026-10-14. Source: `frontend/pages/analytics-dashboard/` and `backend-workers/src/routes/dashboard.js`. Live values are a snapshot, not fixtures or permanent product facts.

## Product Principles

- Lead with questions the maintainer needs answered.
- The owner is the main dashboard user: use compact controls and avoid repeating the selected view or date scope.
- Connect summaries to inspectable evidence.
- State date windows, denominators, and measurement limitations.
- Keep detailed reports discoverable without placing every report in the primary navigation.
