# Analytics dashboard navigation

The dashboard presents usage, adoption, and behavior through five primary views: **Overview**, **Tools**, **People**,
**Activity**, and **Reports**. Overview summarizes successful use; Tools compares reach and repeated use; People supports
user inspection; Activity shows recent behavior; Reports opens the searchable report library. Primary data views are shown
when their backing reports are available. The existing report identifiers and queries remain intact.

## Navigation and scope

The report library groups reports under Usage & Adoption, Reliability & Diagnostics, and individual tool families.
Reports with identifiers outside these known groups appear under **Custom Reports**. **Find a Report** searches both group
and report names, displays the matching count, and gives a clear message when nothing matches. Selecting a report moves
focus to its heading. The Reports navigation item remains selected while inspecting a report outside the primary views.

The selected primary tab supplies the visible page identity. The four primary data views and Reports hide the duplicate
report heading and scope line. Detailed reports alone display their report name and **Report-defined period**. **Reports**
is the sole discovery surface for detailed reports; there is no Jump to Report selector.

The four primary data views share a compact filter row with **Time Range**: Today, Last 7 days, Last 30 days, Last 90 days,
and All time. The selected range itself communicates the period. Contextual search says **Search tools**, **Search people**,
or **Search activity**; detailed reports use **Search this report**. Accessible field labels remain available while their
visual labels are hidden. Overview and person profiles omit search. Reports has its own library search. Raw reports keep
their original SQL, including its date and scope rules. Report selection and time range are not deep-linked in the URL yet.

## Owner overview

Overview prioritizes a quick reading of adoption and behavior. Four nonclickable totals show **Active People**,
**Successful Uses**, **Tool Opens**, and **People with Errors**, with the uncaught report count alongside the latter.
**Where Usage Concentrates** identifies the most-used tool and shows its share when a usable successful-use total is
available; otherwise it shows the tool's count. **Most Reported Error** surfaces the leading uncaught-error cluster.
These are observations from measured data, not inferred recommendations.

**Explore Tools** opens the comparison view. **Inspect Errors** opens Error Details, whose own report-defined dates apply;
if that report is unavailable, it opens Reports. Definitions are available in the collapsed **About these metrics**
disclosure. Opens, completed uses, and uncaught errors remain distinct counts; the people-with-errors population can differ
from the active-people population.

## Tools comparison

Tools replaces a wide diagnostic table with six columns:

| Column | Meaning |
| --- | --- |
| Tool | Familiar tool name, with a small visual share of successful uses |
| Users | People represented by the report's usage count |
| Successful Uses | Completed uses counted by the existing report |
| Repeat Users | Repeat users shown alongside the total user count |
| Most Used Action | The report's leading action, formatted for reading |
| Details | A View button opening the full row details |

The table fits its rows instead of leaving a tall empty container. **How counts work** holds the explanations in a
disclosure, including repeat use as at least two successful uses in the selected period. It does not claim that these
users returned on another day. The Details dialog keeps the remaining report fields available for inspection.

## Person behavior

People now lists up to **200 people** ranked by recorded activity, replacing the former top-25 directory. Select a person's
name to open their profile inline. The full email appears beneath the display name and supplies the exact identity, so
people with the same display name remain separate. The request uses report tab `who`, `person` containing the full email,
and the selected date window.

People summaries use a flat, compact presentation. Existing secondary rankings remain available through smaller controls
so the directory keeps priority. The profile heading identifies the person and data source; the range remains in the
shared filter without a repeated selected-range sentence.

The profile shows Recorded Activity, Active Days, Tools Used, Devices, and Uncaught Errors, plus the first and last
recorded activity within that period. Tool Mix and Actions by Tool include the complete aggregate totals; Active Days
includes every day with recorded activity. Recent Activity expands to the latest **100 activity records**, while Uncaught
Errors expands separately to the latest **50 error reports**. Error totals remain separate from usage counts. Dates are
displayed in Asia/Jakarta.

The heading states the data source: successful uses where available, or the legacy activity fallback. Read the counts
according to that source. Recorded activity and active days do not establish sessions, time spent, session duration, or
retention. Recent Activity is a sequence of records rather than a session replay.

**Back to People** preserves the directory and selected range, returning focus to the selected person's control when the
cached directory is restored. Changing the range requests that person's activity for the new window. This feature adds
no route or schema migration. The backend changes must ship alongside the frontend for the profile to work.

## Inherited visual system

This is a navigation integration within the existing application design. Shared theme tokens remain the authority:
`--background`, `--foreground`, `--muted-foreground`, `--border`, `--accent`, and `--primary`. The dashboard inherits IBM Plex
Sans Variable from the global reset. Its title, report heading, and navigation use a compact hierarchy (1.5rem, 1.125rem,
and 0.875rem respectively), while numbers use tabular figures for comparison. Shared buttons, range selectors, and overlay
surfaces retain their incumbent treatments. No global design identity or token system is introduced.

The report library uses an adaptive grid with a minimum group width of 17rem capped to the available width. Report labels
wrap. At widths of 640px and below, the title and session actions can wrap, navigation becomes denser and wraps, and the
compact filters adapt to the available width. Wide tables scroll within their table
container. Focus uses the shared primary color, and reduced-motion preferences disable dashboard transitions and animation.

## Keyboard behavior

Primary navigation and report links are ordinary buttons with visible focus; the selected navigation button has
`aria-current="page"`. Report discovery, overview actions, person selection, and disclosures remain keyboard accessible.
Inspectable table rows support Enter and Space where row activation is
provided; Tools uses explicit View buttons. Row Details receives focus, confines Tab and Shift+Tab to its controls, closes
with Escape, and restores focus to the opening control.

## Reproducible verification

Start the existing local Vite binary from the repository root:

```bash
./node_modules/.bin/vite --host 0.0.0.0 --port 1235
```

Open `http://127.0.0.1:1235/pages/analytics-dashboard/tests/preview.html`. This preview mounts the actual dashboard and
synthetic data. It is a UI fixture, not production analytics evidence.

1. Open Reports and enter **Quick Query** in Find a Report. Verify six matching reports and open **QQ Outcomes**.
2. Verify the report heading, selected Reports navigation item, and Report-defined period. Return to Reports to discover
   another report. Verify primary views and the library have no duplicate report heading or scope line.
3. Open the primary **Tools** view. Verify all six comparison columns and the repeat-use definition.
4. Activate a View button. Use Tab and Shift+Tab to verify focus stays inside Row Details, then Escape to verify focus
   returns to that View button.
5. Repeat in light and dark themes at desktop width 1280px, then at widths 390px and 480px. Inspect wrapping, selector
   filter layout, table scrolling, and visible keyboard focus.
6. Open **People**, select **Alex** in the synthetic preview, and verify the profile's full email, source, selected range,
   summary, tools, actions, and active days. Expand Recent Activity and Uncaught Errors, then use Back to People and
   verify the directory and range are preserved. Repeat in desktop and mobile light/dark themes.
7. Open **Overview**. Verify four nonclickable totals, the measured usage concentration, and the most-reported error.
   Expand About these metrics, then check Explore Tools and Inspect Errors. Confirm the detailed error report shows its
   own Report-defined period. In Tools, expand How counts work and verify the table fits the available rows.

The completed verification recorded **21 frontend dashboard tests passing** and a **direct Vite build passing**. Reproduce these
checks with the installed local binaries, sequentially:

```bash
./node_modules/.bin/vitest run frontend/pages/analytics-dashboard/tests
./node_modules/.bin/vite build
```

Person-specific coverage is in `frontend/pages/analytics-dashboard/tests/person.test.js` and
`backend-workers/tests/dashboard-person.test.js`. Backend integration checks use SQLite with the migrated schema and
include a default-tabs smoke check. Run the frontend and backend checks sequentially with the existing local binary:

```bash
./node_modules/.bin/vitest run frontend/pages/analytics-dashboard/tests/person.test.js
./node_modules/.bin/vitest run backend-workers/tests/dashboard-person.test.js
```

Current owner-view captures are saved under `.impeccable/review/`: `owner-overview-desktop.png`, `owner-overview-light.png`,
`owner-overview-mobile.png`, `owner-overview-mobile-light.png`, `owner-tools-desktop.png`, `owner-tools-mobile.png`,
`owner-people-desktop.png`, `owner-people-mobile.png`, `owner-activity-desktop.png`, `owner-activity-mobile.png`, and
`owner-reports-mobile.png`. They document the compact overview, comparison, directory, activity, and report library.

Person-profile captures are also saved there as `person-desktop-dark.png`, `person-desktop-light.png`,
`person-mobile-dark.png`, and `person-mobile-light.png`.

Production backend and authentication behavior, and integration inside the full application shell, were not verified by
this preview. Local SQLite integration evidence does not establish production backend behavior. No deployment was performed.

### Final Person Verification

The final focused regression run passed **26 tests across 8 files**, covering the frontend dashboard, the authenticated
person query against the migrated SQLite schema, default-report SQL, and dashboard performance contracts. The direct
Vite production build passed. Browser fixture checks confirmed person selection, profile heading focus, expandable
recent activity and errors, and Back returning keyboard focus to the selected person. These are local UI and SQLite
integration results; production Worker/D1 and full-shell browser integration remain unverified. The person finish review
returned **ship** at this scoped boundary.
