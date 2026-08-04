const customCombobox = ({ field, label, placeholder = "Choose an option", id = `ttc-${field}`, hint = "" }) => `
  <div class="ttc-control-group ttc-combobox-field" data-combobox data-combobox-field="${field}" data-combobox-heading="${label}">
    <div class="ttc-control-heading"><span>${label}</span>${hint ? `<small>${hint}</small>` : ""}</div>
    <div class="ttc-combobox-control">
      <input id="${id}-search" class="ttc-combobox-search" data-combobox-search type="text" role="combobox" aria-label="${label}" aria-expanded="false" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="${id}-options" placeholder="${placeholder}" autocomplete="off" spellcheck="false" />
      <button id="${id}-trigger" class="ttc-combobox-trigger" data-combobox-trigger type="button" aria-label="Show ${label} options" aria-expanded="false" aria-haspopup="listbox" aria-controls="${id}-options">▼</button>
      <div class="ttc-combobox-menu" data-combobox-menu hidden>
        <div id="${id}-options" class="ttc-combobox-options" data-combobox-options role="listbox"></div>
      </div>
    </div>
    <input id="${id}" data-field="${field}" data-combobox-value type="hidden" />
  </div>
`;

const TICKET_TEMPLATE_HEADER_ICONS = {
  reload: `<svg class="ttc-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-14.8-4.2L3 9"></path><path d="M3 4v5h5"></path><path d="M4 13a8.1 8.1 0 0 0 14.8 4.2L21 15"></path><path d="M21 20v-5h-5"></path></svg>`,
  global: `<svg class="ttc-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3z"></path></svg>`,
  feature: `<svg class="ttc-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path><circle cx="9" cy="6" r="2"></circle><circle cx="15" cy="12" r="2"></circle><circle cx="10" cy="18" r="2"></circle></svg>`,
};

const featureConfigField = (markup, key) => `
  <div class="ttc-config-field" data-feature-config-field="${key}">
    ${markup}
    <small class="ttc-config-origin" data-config-origin="${key}">Inherited from Global config</small>
  </div>
`;

export const lookupInput = ({ field, label, placeholder, lookup, multiple = false }) => `
  <label class="ttc-field ttc-lookup-field${multiple ? " ttc-lookup-field--multiple" : " ttc-lookup-field--single"}" data-lookup-multiple="${String(multiple)}">
    <span class="ttc-field-label"><span>${label}</span><small>${multiple ? "Many values" : "1 value"}</small></span>
    <div class="ttc-lookup-control" data-lookup-control>
      <div class="ttc-lookup-chips" data-lookup-chips aria-live="polite"></div>
      <input data-lookup-input data-lookup-field="${field}" data-${lookup}-lookup type="text" placeholder="${placeholder}" autocomplete="off" spellcheck="false" />
      <div class="ttc-lookup-menu" data-lookup-menu role="listbox" hidden></div>
    </div>
    <input data-lookup-committed type="hidden" />
    <input data-field="${field}" data-lookup-value type="hidden" />
  </label>
`;

export const TICKET_TEMPLATE_CREATE_TEMPLATE = /*html*/ `
  <section class="ticket-template-create" data-template-state="locked">
    <header class="ttc-hero">
      <div class="ttc-hero-copy">
        <p class="ttc-eyebrow">JIRA TICKET CREATOR</p>
        <h2>Create tickets from a feature</h2>
        <p>Choose a saved feature, choose its Jira parent, and create tickets with the defaults already prepared.</p>
      </div>
      <div class="ttc-hero-state">
        <span class="ttc-mode-badge">No Jira writes yet</span>
        <span id="ttc-jira-sync-status" class="ttc-status-badge" data-state="idle">Jira metadata not loaded</span>
        <button class="ttc-help-link" data-tutorial-trigger type="button" aria-controls="ttc-tutorial">Show tutorial</button>
        <small id="ttc-jira-sync-detail" class="ttc-visually-hidden" aria-live="polite"></small>
      </div>
    </header>

    <section class="ttc-workspace-header" data-tutorial-target="project" aria-label="Ticket template workspace controls">
      <div class="ttc-workspace-header-left">
        <div class="ttc-header-control ttc-project-control">
          ${customCombobox({ field: "project-key", label: "Project", placeholder: "Choose a project", id: "ttc-project-select" })}
          <button id="ttc-project-reload" class="ttc-icon-button ttc-header-button" type="button" aria-label="Reload Jira project metadata" title="Reload Jira project metadata">${TICKET_TEMPLATE_HEADER_ICONS.reload}<span>Reload Jira metadata</span></button>
          <span id="ttc-project-status" class="ttc-header-status" data-state="idle">Choose a project</span>
        </div>
        <div class="ttc-header-control ttc-feature-control">
          ${customCombobox({ field: "feature-select", label: "Feature", placeholder: "Choose a feature", id: "ttc-feature-select" })}
          <button id="ttc-feature-edit" class="ttc-icon-button" type="button" aria-label="Edit selected feature" title="Edit selected feature" disabled>✎</button>
          <span id="ttc-feature-status" class="ttc-header-status" data-state="idle">Choose a feature</span>
        </div>
      </div>
      <div class="ttc-workspace-header-right">
        <button id="ttc-feature-config-open" class="ttc-header-action" type="button" disabled>${TICKET_TEMPLATE_HEADER_ICONS.feature}<span>Feature config</span><small>Selected feature</small></button>
        <button id="ttc-global-config-open" class="ttc-header-action" type="button">${TICKET_TEMPLATE_HEADER_ICONS.global}<span>Global config</span><small>All tickets</small></button>
        ${customCombobox({ field: "ticket-type", label: "Ticket type", placeholder: "Choose ticket type", id: "ttc-ticket-type" })}
      </div>
    </section>

    <aside id="ttc-tutorial" class="ttc-tutorial" data-tutorial hidden role="dialog" aria-modal="false" aria-labelledby="ttc-tutorial-title" aria-describedby="ttc-tutorial-copy">
      <div class="ttc-tutorial-header">
        <span class="ttc-tutorial-kicker" data-tutorial-kicker>QUICK GUIDE · 1 OF 5</span>
        <button class="ttc-tutorial-close" data-tutorial-close type="button" aria-label="Close tutorial">×</button>
      </div>
      <h3 id="ttc-tutorial-title" data-tutorial-title>Load Jira metadata</h3>
      <p id="ttc-tutorial-copy" data-tutorial-copy>Start by loading the live Jira fields and your PAT owner. This only reads Jira.</p>
      <div class="ttc-tutorial-actions">
        <button class="btn btn-quiet" data-tutorial-back type="button">Back</button>
        <button class="btn btn-primary" data-tutorial-next type="button">Next</button>
      </div>
    </aside>

    <div id="ttc-error" class="ttc-error" role="alert" hidden></div>

    <section id="ttc-pat-setup" class="ttc-panel ttc-inline-state" data-tutorial-target="pat" hidden aria-labelledby="ttc-pat-setup-title">
      <div><p class="ttc-eyebrow">JIRA PAT REQUIRED</p><h3 id="ttc-pat-setup-title">Set up Jira once to start</h3><p id="ttc-pat-copy">Your Jira PAT is stored securely in the desktop credential store.</p></div>
      <div class="ttc-inline-state-action"><span id="ttc-pat-status" class="ttc-status-badge" data-state="checking">Checking PAT…</span><button id="ttc-open-settings" class="btn btn-primary" type="button">Set up Jira PAT</button></div>
    </section>

    <section id="ttc-workspace-empty" class="ttc-panel ttc-workspace-empty" aria-live="polite">
      <span class="ttc-workspace-empty-mark" aria-hidden="true">↳</span>
      <div><strong id="ttc-workspace-empty-title">Choose a project to load Jira metadata</strong><p id="ttc-workspace-empty-copy">Use the Project dropdown above to add a project or select a saved one. Then use ↻ to refresh its Jira fields.</p></div>
    </section>

    <dialog id="ttc-project-dialog" class="ttc-dialog" aria-labelledby="ttc-project-dialog-title">
      <form id="ttc-project-form" class="ttc-dialog-form">
        <div class="ttc-dialog-header"><div><p class="ttc-eyebrow">PROJECT</p><h3 id="ttc-project-dialog-title">Add a Jira project</h3><p>Enter the project key. We’ll validate it against Jira before saving it locally.</p></div><button class="ttc-dialog-close" data-dialog-close type="button" aria-label="Close project dialog">×</button></div>
        <label class="ttc-field"><span>Project key</span><input id="ttc-project-key-entry" type="text" autocomplete="off" maxlength="32" placeholder="e.g. PMT or EVDF" /></label>
        <input id="ttc-base-url" type="hidden" />
        <input id="ttc-allow-invalid-tls" type="checkbox" hidden />
        <div class="ttc-dialog-actions"><button class="btn btn-secondary" data-dialog-close type="button">Cancel</button><button id="ttc-project-save" class="btn btn-primary" type="submit">Validate and save</button></div>
      </form>
    </dialog>

    <dialog id="ttc-feature-dialog" class="ttc-dialog ttc-feature-dialog" aria-labelledby="ttc-feature-dialog-title">
      <form id="ttc-feature-form" class="ttc-dialog-form">
        <div class="ttc-dialog-header"><div><p class="ttc-eyebrow">FEATURE</p><h3 id="ttc-feature-dialog-title">Edit feature</h3><p>Keep the Jira requirements here so the ticket flow can stay focused.</p></div><button class="ttc-dialog-close" data-dialog-close type="button" aria-label="Close feature dialog">×</button></div>
        <div class="ttc-dialog-grid">
          <label class="ttc-field"><span>Feature name</span><input id="ttc-feature-name" type="text" placeholder="e.g. Payment Redeem Point" maxlength="100" /></label>
          <label class="ttc-field"><span>Feature Epic</span><input id="ttc-feature-epic" type="text" placeholder="PMT-1234 or Jira link" /></label>
          <label class="ttc-field ttc-wide"><span>Stories and Improvements</span><textarea id="ttc-feature-parent-sources" rows="4" placeholder="One Jira key or link per line"></textarea></label>
          <label class="ttc-field ttc-wide"><span>Known bugs for this feature</span><textarea id="ttc-feature-bug-sources" rows="3" placeholder="Optional: one bug key or link per line"></textarea></label>
        </div>
        <div class="ttc-dialog-actions"><button class="btn btn-secondary" data-dialog-close type="button">Cancel</button><button id="ttc-feature-save" class="btn btn-primary" type="submit">Save feature</button></div>
      </form>
    </dialog>

    <div id="ttc-workbench-shell" class="ttc-workbench-grid" hidden>
      <aside class="ttc-rail" aria-label="Ticket template configuration">
        <div id="ttc-config-stack" class="ttc-config-stack" hidden>
        <div class="ttc-config-overlay-panel">
        <div class="ttc-config-stack-header"><strong>Configuration</strong><button class="ttc-dialog-close" data-config-close type="button" aria-label="Close configuration">×</button></div>
        <details id="ttc-global-panel" class="ttc-panel ttc-defaults-panel" data-tutorial-target="global" data-post-discovery>
          <summary class="ttc-panel-summary">
            <span><span class="ttc-step-label">03 · GLOBAL CONFIG</span><strong>Global config</strong><small>Set the starting values used for every new ticket. Feature-level config can override them.</small></span>
            <span id="ttc-global-status" class="ttc-status-badge" data-state="checking">Loading defaults…</span>
          </summary>
          <div class="ttc-defaults-body">
            <div class="ttc-default-section">
              <div class="ttc-subsection-heading"><h4>Labels by stream</h4><p>Defaults added to every ticket in that stream. Type to search Jira labels.</p></div>
              <div class="ttc-default-grid ttc-default-grid-2">
                ${lookupInput({ field: "global-label-common", label: "Common labels", placeholder: "Add a label…", lookup: "label", multiple: true })}
                ${lookupInput({ field: "global-label-ios", label: "iOS labels", placeholder: "Add an iOS label…", lookup: "label", multiple: true })}
                ${lookupInput({ field: "global-label-android", label: "Android labels", placeholder: "Add an Android label…", lookup: "label", multiple: true })}
                ${lookupInput({ field: "global-label-web", label: "Web labels", placeholder: "Add a web label…", lookup: "label", multiple: true })}
              </div>
              <details class="ttc-nested-details">
                <summary>BE component labels</summary>
                <div class="ttc-default-grid ttc-default-grid-2">
                  ${lookupInput({ field: "global-label-be-API", label: "API", placeholder: "Add an API label…", lookup: "label", multiple: true })}
                  ${lookupInput({ field: "global-label-be-Table", label: "Table", placeholder: "Add a table label…", lookup: "label", multiple: true })}
                  ${lookupInput({ field: "global-label-be-Service", label: "Service", placeholder: "Add a service label…", lookup: "label", multiple: true })}
                  ${lookupInput({ field: "global-label-be-Consumer", label: "Consumer", placeholder: "Add a consumer label…", lookup: "label", multiple: true })}
                  ${lookupInput({ field: "global-label-be-Batch", label: "Batch", placeholder: "Add a batch label…", lookup: "label", multiple: true })}
                </div>
              </details>
            </div>
            <div class="ttc-default-section">
              <div class="ttc-subsection-heading"><h4>People defaults</h4><p>These people are prefilled for every ticket. Feature settings can replace them.</p></div>
              <div class="ttc-people-grid">
                <article class="ttc-default-card"><h4>AD / SA reviewers</h4><div data-people-scope="global" data-people-stream="common"></div></article>
                <article class="ttc-default-card"><h4>iOS developers</h4><div data-people-scope="global" data-people-stream="ios"></div></article>
                <article class="ttc-default-card"><h4>Android developers</h4><div data-people-scope="global" data-people-stream="android"></div></article>
                <article class="ttc-default-card"><h4>Web developers</h4><div data-people-scope="global" data-people-stream="web"></div></article>
                <article class="ttc-default-card"><h4>BE developers</h4><div data-people-scope="global" data-people-stream="be"></div></article>
              </div>
            </div>
            <div class="ttc-default-section">
              <div class="ttc-subsection-heading"><h4>Jira-backed defaults</h4><p>These values are selectable after Jira metadata is loaded; filtering happens locally.</p></div>
              <div class="ttc-form-stack">
                ${customCombobox({ field: "global-ad-story-point", label: "Default AD Story Point", hint: "Required by Jira", id: "ttc-global-ad-story-point" })}
                ${customCombobox({ field: "global-dev-story-point", label: "Default Dev Story Point", hint: "Optional; Jira defaults to 0", id: "ttc-global-dev-story-point" })}
                ${customCombobox({ field: "global-priority", label: "Default Priority", hint: "Low by default", id: "ttc-global-priority" })}
                ${customCombobox({ field: "global-release", label: "Default Release Number", id: "ttc-global-release" })}
                ${customCombobox({ field: "global-squad", label: "Default Squad", id: "ttc-global-squad" })}
                ${customCombobox({ field: "global-task-trigger", label: "Default Task Trigger By", hint: "Design by default", id: "ttc-global-task-trigger" })}
              </div>
            </div>
            <div class="ttc-default-section">
              <div class="ttc-subsection-heading"><h4>Date rule</h4><p>Calendar-day offsets from today.</p></div>
              <div class="ttc-default-grid ttc-default-grid-2">
                <label class="ttc-field"><span>Start offset</span><input data-field="global-start-offset-days" type="number" value="0" min="-30" max="365" /></label>
                <label class="ttc-field"><span>Duration</span><input data-field="global-deadline-offset-days" type="number" value="3" min="0" max="365" /></label>
              </div>
            </div>
            <button id="ttc-global-save" class="btn btn-secondary ttc-full-button" type="button">Save defaults for all tickets</button>
          </div>
        </details>

        <details id="ttc-feature-config" class="ttc-panel ttc-defaults-panel" data-tutorial-target="feature-config" data-post-discovery>
          <summary class="ttc-panel-summary">
            <span><span class="ttc-step-label">04 · FEATURE CONFIG</span><strong>Feature-level config</strong><small>Save values for this feature only. Unchanged values inherit from Global config.</small></span>
            <span id="ttc-feature-config-status" class="ttc-status-badge" data-state="idle">Inherited from Global</span>
          </summary>
          <div class="ttc-defaults-body">
            <div class="ttc-config-intro">
              <strong data-feature-scope-name>New feature</strong>
              <p>Use this panel for reusable people, labels, Jira defaults, and date rules. Summary, description, Confluence Page, parent, stream, and BE component are entered when creating tickets.</p>
            </div>
            <div class="ttc-default-section">
              <div class="ttc-subsection-heading"><h4>Feature labels</h4><p>Add labels for this feature. Global stream labels still apply.</p></div>
              ${featureConfigField(lookupInput({ field: "feature-labels", label: "Feature labels", placeholder: "Add a feature label…", lookup: "label", multiple: true }), "feature-labels")}
            </div>
            <div class="ttc-default-section">
              <div class="ttc-subsection-heading"><h4>Feature people</h4><p>These values start from Global config. Change them here to override people for this feature.</p></div>
              <div class="ttc-people-grid">
                <article class="ttc-default-card"><h4>AD / SA reviewers</h4><small class="ttc-config-origin" data-config-origin="people-common">Inherited from Global config</small><div data-people-scope="feature" data-people-stream="common"></div></article>
                <article class="ttc-default-card"><h4>iOS developers</h4><small class="ttc-config-origin" data-config-origin="people-ios">Inherited from Global config</small><div data-people-scope="feature" data-people-stream="ios"></div></article>
                <article class="ttc-default-card"><h4>Android developers</h4><small class="ttc-config-origin" data-config-origin="people-android">Inherited from Global config</small><div data-people-scope="feature" data-people-stream="android"></div></article>
                <article class="ttc-default-card"><h4>Web developers</h4><small class="ttc-config-origin" data-config-origin="people-web">Inherited from Global config</small><div data-people-scope="feature" data-people-stream="web"></div></article>
                <article class="ttc-default-card"><h4>BE developers</h4><small class="ttc-config-origin" data-config-origin="people-be">Inherited from Global config</small><div data-people-scope="feature" data-people-stream="be"></div></article>
              </div>
            </div>
            <div class="ttc-default-section">
              <div class="ttc-subsection-heading"><h4>Feature Jira defaults</h4><p>These values prefill every ticket created from this feature.</p></div>
              <div class="ttc-form-stack">
                ${featureConfigField(customCombobox({ field: "ad-story-point", label: "AD Story Point", hint: "Required", id: "ttc-ad-story-point" }), "ad-story-point")}
                ${featureConfigField(customCombobox({ field: "dev-story-point", label: "Dev Story Point", hint: "Optional", id: "ttc-dev-story-point" }), "dev-story-point")}
                ${featureConfigField(customCombobox({ field: "priority", label: "Priority", hint: "Low by default", id: "ttc-priority" }), "priority")}
                ${featureConfigField(customCombobox({ field: "release", label: "Release Number", hint: "Required", id: "ttc-release" }), "release")}
                ${featureConfigField(customCombobox({ field: "squad", label: "Squad", hint: "Required", id: "ttc-squad" }), "squad")}
                ${featureConfigField(customCombobox({ field: "task-trigger", label: "Task Trigger By", hint: "Design by default", id: "ttc-task-trigger" }), "task-trigger")}
              </div>
            </div>
            <div class="ttc-default-section">
              <div class="ttc-subsection-heading"><h4>Feature date rule</h4><p>Set reusable calendar-day offsets. The resulting dates remain editable for each ticket run.</p></div>
              <div class="ttc-default-grid ttc-default-grid-2">
                ${featureConfigField('<label class="ttc-field"><span>Start offset</span><input data-field="start-offset-days" type="number" value="0" min="-30" max="365" /></label>', "start-offset-days")}
                ${featureConfigField('<label class="ttc-field"><span>Duration</span><input data-field="deadline-offset-days" type="number" value="3" min="0" max="365" /></label>', "deadline-offset-days")}
              </div>
            </div>
            <p id="ttc-override-notice" class="ttc-override-notice" hidden></p>
            <p id="ttc-date-hint" class="ttc-date-hint"></p>
            <button id="ttc-feature-config-save" class="btn btn-secondary ttc-full-button" type="button">Save feature config</button>
          </div>
        </details>
        </div>
        </div>
      </aside>

      <main class="ttc-main-column">
        <section id="ttc-create-workflow" class="ttc-create-workflow" hidden>
          <section class="ttc-panel ttc-flow-panel" data-tutorial-target="parent" data-ticket-mode-panel>
            <div class="ttc-step-label">01 · JIRA PARENT</div>
            <div class="ttc-panel-header">
              <div>
                <h3>Choose the Jira ticket to create under</h3>
                <p data-parent-mode-copy>Paste a Story, Improvement, or Bug key or URL. Epic children are also supported and merged into one list.</p>
              </div>
              <span class="ttc-flow-status">Read first · write later</span>
            </div>
            <div class="ttc-parent-lookup">
              <label class="ttc-field"><span data-parent-mode-label>Jira parent</span><textarea id="ttc-parent-input" data-field="parent-sources" rows="3" placeholder="Paste one key or URL\nEVDEV-350436"></textarea></label>
              <button id="ttc-resolve-parent" class="btn btn-primary" type="button">Find parent</button>
            </div>
            <div id="ttc-parent-result" class="ttc-parent-result" hidden>
              <div class="ttc-result-heading"><span class="ttc-step-label">PARENT CANDIDATES</span><p id="ttc-parent-source"></p></div>
              ${customCombobox({ field: "parent-select", label: "Create under", placeholder: "Choose an eligible parent", id: "ttc-parent-select" })}
            </div>
          </section>

          <section id="ttc-ticket-form" class="ttc-panel ttc-flow-panel" data-tutorial-target="ticket">
            <div class="ttc-step-label">02 · TICKET DETAILS</div>
            <div class="ttc-panel-header">
              <div>
                <h3>Create ticket details</h3>
                <p>Enter the details that change for this run. People, labels, Jira defaults, and date rules come from config.</p>
              </div>
              <span id="ttc-mode-note" class="ttc-flow-status">iOS + Android selected</span>
            </div>

            <div class="ttc-prefill-summary" id="ttc-prefill-summary">
              <div><strong>Config prefill</strong><span id="ttc-prefill-source">Choose a feature to apply its defaults</span></div>
              <a href="#ttc-feature-config" data-feature-config-link>View config <span aria-hidden="true">→</span></a>
            </div>
            <div class="ttc-prefill-legend" aria-label="Prefill source legend"><span data-source="global">Global config</span><span data-source="feature">Feature config</span><span data-source="user">Your input</span></div>

            <fieldset class="ttc-stream-picker">
              <legend>Ticket stream</legend>
              <label class="ttc-mode-option"><input type="checkbox" data-stream-toggle="ios" checked /><span><strong>iOS</strong><small>FE mobile</small></span></label>
              <label class="ttc-mode-option"><input type="checkbox" data-stream-toggle="android" checked /><span><strong>Android</strong><small>FE mobile</small></span></label>
              <label class="ttc-mode-option"><input type="checkbox" data-stream-toggle="web" /><span><strong>Web</strong><small>standalone FE</small></span></label>
              <label class="ttc-mode-option"><input type="checkbox" data-stream-toggle="be" /><span><strong>BE</strong><small>one component ticket</small></span></label>
            </fieldset>

            <label class="ttc-mobile-summary" data-mobile-summary>
              <span>Mobile summary · shared by iOS and Android</span>
              <div class="ttc-prefixed-input"><strong>[iOS] / [Android]</strong><input data-field="summary-mobile" type="text" placeholder="Mobile Screen X" /></div>
            </label>

            <div class="ttc-ticket-grid">
              <article class="ttc-ticket-card" data-stream-card="ios"><div class="ttc-card-kicker">FE · iOS</div><h4>iOS ticket</h4><p class="ttc-card-note">People and labels are prefilled from config.</p></article>
              <article class="ttc-ticket-card" data-stream-card="android"><div class="ttc-card-kicker">FE · ANDROID</div><h4>Android ticket</h4><p class="ttc-card-note">People and labels are prefilled from config.</p></article>
              <article class="ttc-ticket-card" data-stream-card="web" hidden>
                <div class="ttc-card-kicker">FE · WEB</div><h4>Web ticket</h4>
                <label class="ttc-field"><span>Summary</span><div class="ttc-prefixed-input"><strong>[Web]</strong><input data-field="summary-web" type="text" placeholder="Web Screen X" /></div></label>
                <p class="ttc-card-note">People and labels are prefilled from config.</p>
              </article>
              <article class="ttc-ticket-card" data-stream-card="be" hidden>
                <div class="ttc-card-kicker">BE · COMPONENT</div><h4>Backend ticket</h4>
                ${customCombobox({ field: "be-component", label: "Component prefix", placeholder: "API", id: "ttc-be-component" })}
                <label class="ttc-field"><span>Summary</span><div class="ttc-prefixed-input"><strong data-be-prefix>[API]</strong><input data-field="summary-be" type="text" placeholder="POST service/v1/endpoint" /></div></label>
                <p class="ttc-card-note">People and labels are prefilled from config.</p>
              </article>
            </div>

            <div class="ttc-section-divider"><span>Per-ticket details</span><small>These are entered for this creation run.</small></div>
            <div class="ttc-form-grid ttc-creation-fields">
              <label class="ttc-field ttc-wide"><span>Description</span><textarea data-field="description" rows="4" placeholder="Optional Jira description"></textarea></label>
              <label class="ttc-field ttc-wide"><span>Confluence Page</span><input data-field="confluence-page" type="url" placeholder="https://confluence…" /></label>
              <label class="ttc-field"><span>Start Development On</span><input data-field="start-date" type="date" /></label>
              <label class="ttc-field"><span>Deadline</span><input data-field="deadline" type="date" /></label>
              <label class="ttc-field ttc-wide"><span>Assignee</span><input data-field="assignee-display" type="text" readonly placeholder="Loaded from Jira PAT user" /></label>
            </div>

            <section class="ttc-preview-panel">
              <div class="ttc-section-heading"><div><div class="ttc-step-label">03 · REVIEW</div><h4>Creation preview</h4><p>Confirm parent, stream, summaries, and labels before the only Jira write.</p></div></div>
              <div id="ttc-create-preview" class="ttc-create-preview"></div>
            </section>
            <div class="ttc-actions ttc-final-actions"><span id="ttc-create-status" class="ttc-note">Choose a parent and complete required fields.</span><button id="ttc-create" class="btn btn-primary" type="button">Review and create tickets</button></div>
          </section>
        </section>

      </main>
    </div>

    <details id="ttc-contract-details" class="ttc-contract-details" hidden>
      <summary>View discovered Jira create contract</summary>
      <section id="ttc-results" class="ttc-results">
        <div class="ttc-results-header"><div><p class="ttc-eyebrow">Discovery result</p><h3>Jira create contract</h3></div><span id="ttc-result-time" class="ttc-result-time"></span></div>
        <div id="ttc-summary" class="ttc-summary-grid"></div>
        <div id="ttc-issue-types" class="ttc-issue-types"></div>
      </section>
    </details>
  </section>
`;
