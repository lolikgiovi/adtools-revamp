# Release tour authoring

Use this walkthrough when preparing the post-update “What’s new” experience for a Desktop or Web release. The goal is a short, useful product tour: explain the user-visible change, show where it matters, and give the user a clear next action.

## Source of truth

- Content: `frontend/config/release-content.json`
- Contract: `frontend/config/release-content.schema.json`
- Bundled media: `frontend/public/release-assets/<releaseId>/`
- Validator: `npm run release:content:check`
- Web embedding: `npm run build` writes the content into `frontend/public/web-build.json`
- Desktop embedding: `npm run release:build` copies the content into the generated updater manifest; `npm run release:upload` publishes that manifest

The runtime creates an opening release slide and any authored feature slides. If `tips` are present, the final slide offers a guided continuation that automatically opens each relevant route and highlights the feature in place. Skipped or unavailable tips remain eligible to appear contextually when the user reaches that route later, and each tip is remembered independently once opened. The legacy `tour` field remains available for startup-visible steps when no route-aware tips are authored. The announcement is shown once per `releaseId` after a successful update or newly detected build.

## Agent walkthrough

### 1. Inventory the release

Read the release diff, the release brief, and the affected UI code. Identify only changes a user can see or act on.

Done when every proposed claim maps to a verified code change or an explicit release brief, with no invented behavior.

### 2. Choose the story

Select one to three meaningful changes. For each change, write the user benefit first, then the behavior that enables it. Skip internal refactors, dependency updates, and implementation details unless they change what the user experiences.

Use the opening fields for the overall story:

- `title`: a short, outcome-led phrase
- `summary`: one sentence explaining why the update matters
- `notes`: concise facts; three to six is a good target

Done when the release can be summarized in one sentence and each selected change has a clear “why should I care?” answer.

### 3. Gather evidence and media

Add a screenshot, diagram, or short visual only when it makes the change easier to understand. Prefer one focused image per slide. Store local files in `frontend/public/release-assets/<releaseId>/`, provide meaningful `alt` text, and use `imageCaption` only when the image needs context.

Use `links` for deeper documentation and `action` for a primary in-app destination. Prefer an in-app `route` for product workflows. External links must use `https://` and should be stable, public URLs.

Done when every local media reference exists, every image has useful alternative text, every link has a meaningful label, and every in-app route is known to the current router.

### 4. Author the JSON

Edit `frontend/config/release-content.json`. Change `releaseId` for each intentional release story; keep it unchanged when revising the same story. Add up to three authored `slides`. Each slide needs a `title` and `body`, and may include `bullets`, `image`, `imageAlt`, `imageCaption`, `links`, and `action`.

Add up to three `tour` steps only when the relevant UI is visible immediately after startup. Use stable selectors, keep each tooltip focused on one task, and verify the selector against the current markup. Set `tour: []` when there is no useful guided action; this disables the default search/sidebar tips for that release.

Use `tips` for guidance that belongs on a particular route. After the slides, the app navigates through these tips in authored order; unfinished tips can still appear contextually later. Each tip needs a stable lowercase `id`, an exact `route`, a visible `target`, a placement, a short title, and one actionable sentence. A tip is remembered as soon as it opens and will not be shown again for that `releaseId`. Keep the list to eight or fewer and omit tips for technical changes with no user action.

Keep the content direct and calm. Do not add internal ticket IDs, private URLs, secrets, unsupported promises, or decorative copy that does not help the user understand the update.

Done when the JSON contains only fields described by `release-content.schema.json` and the tour can be completed without prior product knowledge.

### 5. Validate the contract

Run:

```bash
npm run release:content:check
```

The validator checks the JSON shape, item limits, safe URL schemes, local `release-assets` references, image alternative text, link labels, and tour placements. Fix errors before continuing. Treat warnings about remote media or missing release identity as a reason to review the content.

Done when the command exits successfully and the output contains no unresolved warnings.

### 6. Verify both release surfaces

For Web, run the normal build path and inspect the generated `frontend/public/web-build.json`. Confirm that `releaseId`, notes, slides, images, links, actions, and tour steps are present as intended. The Web deployment is then the normal push to `main` and automatic deploy.

For Desktop, confirm that `npm run release:build` reads the same content file and that the generated `stable.json` or `beta.json` contains the release fields. The actual Desktop publishing sequence remains `npm run release:build` followed by `npm run release:upload`.

Done when both generated metadata paths carry the same release story and the authored selectors still exist in the built app.

## Manual smoke test

The overlay can be triggered locally without making a release. Run `npm run dev` or `npm run tauri:dev`, then click the development-only `Preview What's New` button in the header. It always reads the current `release-content.json` and does not mark the release as seen.

For an automatic Web preview, open `http://localhost:1234/?release-tour=preview`. The query switch is development-only and also works when the Tauri WebView is configured to load that URL.

If you need to test the storage/reload path itself, open DevTools on the app origin, paste the following, and reload:

```js
localStorage.removeItem("releaseTour.seen.manual-release-test");
localStorage.setItem(
  "releaseTour.pending",
  JSON.stringify({
    surface: "web",
    releaseId: "manual-release-test",
    version: "0.0.0-test",
    title: "Manual release tour test",
    summary: "This verifies the post-update overlay and authored slide content.",
    notes: ["Use Next to move through the slides.", "Use Escape or Skip tour to dismiss it."],
    slides: [
      {
        title: "A custom slide",
        body: "This is where a real release can explain one focused change.",
        links: [{ label: "Example documentation", href: "https://example.com" }],
      },
    ],
    tour: [
      {
        target: ".header-search",
        placement: "bottom",
        title: "Search",
        body: "The live tooltip should point at the header search field.",
      },
    ],
  }),
);
location.reload();
```

Check the opening slide, custom slide, Next/Back, Skip tour, Escape, keyboard focus, external link behavior, automatic route changes, and each live tooltip. To replay it, remove the `releaseTour.seen.manual-release-test` key and the matching `releaseTip.opened.*` keys, then set the pending payload again.

## Release triggers

- Web: commit the authored content with the product change and push to `main`. The deployment runs `npm run build`, embeds the content in `web-build.json`, and the running app reloads when its hourly build check detects the new build.
- Desktop: run `npm run release:build`, choose the intended version/channel, accept or override the content-derived notes, then run `npm run release:upload`. The updater stores the release payload before installation and the relaunched app shows it only after the install succeeds.

Done when the manual smoke test passes and the release command for the target surface has been selected correctly.

## Small, valid example

```json
{
  "releaseId": "release-2026-09-05",
  "title": "A faster way to find saved work",
  "summary": "Search now reaches saved schemas as well as tools and pages.",
  "notes": [
    "Press ⌘K to open global search.",
    "Saved Quick Query schemas appear in the results.",
    "Use the guided tour for a two-step orientation."
  ],
  "slides": [
    {
      "title": "Search saved schemas from anywhere",
      "body": "Jump from the header to a saved Quick Query schema without opening the tool first.",
      "image": {
        "src": "/release-assets/release-2026-09-05/global-search.png",
        "alt": "Global search results showing a saved Quick Query schema"
      },
      "links": [
        {
          "label": "Read the search guide",
          "href": "https://example.com/docs/search"
        }
      ],
      "action": {
        "label": "Open search",
        "route": "home"
      }
    }
  ],
  "tour": [
    {
      "target": ".header-search",
      "placement": "bottom",
      "title": "Start here",
      "body": "Search for a tool, page, or saved schema."
    }
  ]
}
```

The example is illustrative; replace its claims, route, selector, URL, and asset with evidence from the actual release.

## Handoff checklist

- [ ] `releaseId` identifies this release story and is not changed during unrelated edits.
- [ ] Every claim is user-visible and verified.
- [ ] There are no more than three authored slides, three tour steps, and eight contextual tips.
- [ ] Local media is under `frontend/public/release-assets/` and has alt text.
- [ ] Links have labels and use safe `https://`, route, or local asset references.
- [ ] Tour selectors are stable and visible after startup.
- [ ] Contextual tip routes and selectors exist, and tip IDs are unique within the release.
- [ ] `npm run release:content:check` passes without warnings.
- [ ] Web metadata and Desktop manifests are both expected to include the same content.
