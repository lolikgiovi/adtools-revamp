const customCombobox = ({ field, label, placeholder = "Choose an option", id = `ttc-${field}`, hint = "" }) => `
  <div class="ttc-control-group ttc-combobox-field" data-combobox data-combobox-field="${field}" data-combobox-heading="${label}">
    <div class="ttc-control-heading"><span>${label}</span>${hint ? `<small>${hint}</small>` : ""}</div>
    <div class="ttc-combobox-control">
      <input id="${id}-search" class="ttc-combobox-search" data-combobox-search type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="${id}-options" placeholder="${placeholder}" autocomplete="off" spellcheck="false" />
      <button id="${id}-trigger" class="ttc-combobox-trigger" data-combobox-trigger type="button" aria-label="Show ${label} options" aria-expanded="false" aria-haspopup="listbox" aria-controls="${id}-options">▼</button>
      <div class="ttc-combobox-menu" data-combobox-menu hidden>
        <div id="${id}-options" class="ttc-combobox-options" data-combobox-options role="listbox"></div>
      </div>
    </div>
    <input id="${id}" data-field="${field}" data-combobox-value type="hidden" />
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
  <section class="ticket-template-create">
    <header class="ttc-hero">
      <div class="ttc-hero-copy">
        <p class="ttc-eyebrow">JIRA TICKET WORKBENCH</p>
        <h2>Create developer tickets from a feature</h2>
      </div>
      <div class="ttc-hero-state">
        <span class="ttc-mode-badge">Preview before create</span>
        <span id="ttc-jira-sync-status" class="ttc-status-badge" data-state="idle">Jira metadata not loaded</span>
        <button class="ttc-help-link" data-tutorial-trigger type="button" aria-controls="ttc-tutorial">Show tutorial</button>
        <small id="ttc-jira-sync-detail" class="ttc-visually-hidden" aria-live="polite"></small>
      </div>
    </header>

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

    <div class="ttc-workbench-grid">
      <aside class="ttc-rail" aria-label="Feature context and reusable defaults">
        <section class="ttc-panel ttc-rail-card" data-tutorial-target="connection" aria-labelledby="ttc-connection-title">
          <div class="ttc-step-label">01 · CONNECTION</div>
          <div class="ttc-panel-header">
            <div>
              <h3 id="ttc-connection-title">Connect Jira</h3>
              <p>Read live Jira fields through the desktop PAT.</p>
            </div>
            <span id="ttc-pat-status" class="ttc-status-badge" data-state="checking">Checking PAT…</span>
          </div>
          <div class="ttc-form-stack">
            <label class="ttc-field"><span>Jira URL</span><input id="ttc-base-url" type="url" autocomplete="off" spellcheck="false" /></label>
            <label class="ttc-field"><span>Project key</span><input id="ttc-project-key" type="text" autocomplete="off" maxlength="32" /></label>
          </div>
          <details class="ttc-advanced-details">
            <summary>Connection safety</summary>
            <label class="ttc-tls-option">
              <input id="ttc-allow-invalid-tls" type="checkbox" />
              <span><strong>Allow untrusted Jira certificate</strong><small>Use only while the corporate CA is unavailable.</small></span>
            </label>
          </details>
          <button id="ttc-open-settings" class="btn btn-secondary ttc-full-button" type="button">Open credential settings</button>
          <button id="ttc-discover" class="btn btn-primary ttc-full-button" type="button">Load Jira metadata</button>
        </section>

        <section class="ttc-panel ttc-rail-card" data-tutorial-target="feature" aria-labelledby="ttc-feature-title">
          <div class="ttc-step-label">02 · FEATURE SETTINGS</div>
          <div class="ttc-panel-header">
            <div>
              <h3 id="ttc-feature-title">Feature settings</h3>
              <p>Save parent and feature-specific overrides.</p>
            </div>
            <span id="ttc-feature-status" class="ttc-status-badge" data-state="checking">Opening…</span>
          </div>
          ${customCombobox({ field: "feature-select", label: "Saved feature", placeholder: "New feature", id: "ttc-feature-select" })}
          <label class="ttc-field"><span>Feature name</span><input id="ttc-feature-name" type="text" placeholder="e.g. Payment Redeem Point" maxlength="100" /></label>
          <div class="ttc-template-actions">
            <button id="ttc-feature-new" class="btn btn-secondary" type="button">New</button>
            <button id="ttc-feature-save" class="btn btn-primary" type="button">Save feature settings</button>
            <button id="ttc-feature-duplicate" class="btn btn-secondary" type="button">Duplicate</button>
            <button id="ttc-feature-delete" class="btn btn-quiet" type="button">Delete</button>
          </div>
        </section>

        <details id="ttc-global-panel" class="ttc-panel ttc-defaults-panel" data-tutorial-target="global">
          <summary class="ttc-panel-summary">
            <span><span class="ttc-step-label">03 · DEFAULTS FOR EVERY TICKET</span><strong>Global defaults</strong><small>Set the starting values used for every new ticket. Feature settings can override them.</small></span>
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
      </aside>

      <main class="ttc-main-column">
        <div id="ttc-error" class="ttc-error" role="alert" hidden></div>
        <section id="ttc-create-workflow" class="ttc-create-workflow" hidden>
          <section class="ttc-panel ttc-flow-panel" data-tutorial-target="parent">
            <div class="ttc-step-label">04 · PARENT RESOLUTION</div>
            <div class="ttc-panel-header">
              <div>
                <h3>Choose where the tickets belong</h3>
                <p>Paste one or more Jira keys or URLs. Epic children are merged; direct Stories, Improvements, and Bugs are accepted.</p>
              </div>
              <span class="ttc-flow-status">Read first · write later</span>
            </div>
            <div class="ttc-parent-lookup">
              <label class="ttc-field"><span>Parent sources</span><textarea id="ttc-parent-input" data-field="parent-sources" rows="3" placeholder="One key or URL per line\nEVDEV-350436"></textarea></label>
              <button id="ttc-resolve-parent" class="btn btn-primary" type="button">Find eligible parents</button>
            </div>
            <div id="ttc-parent-result" class="ttc-parent-result" hidden>
              <div class="ttc-result-heading"><span class="ttc-step-label">PARENT CANDIDATES</span><p id="ttc-parent-source"></p></div>
              ${customCombobox({ field: "parent-select", label: "Create under", placeholder: "Choose an eligible parent", id: "ttc-parent-select" })}
            </div>
          </section>

          <section id="ttc-ticket-form" class="ttc-panel ttc-flow-panel" data-tutorial-target="ticket" hidden>
            <div class="ttc-step-label">05 · FEATURE-SPECIFIC TICKET SETTINGS</div>
            <div class="ttc-panel-header">
              <div>
                <h3>Feature ticket settings</h3>
                <p>Change only what this feature needs. Everything else is inherited from Global defaults.</p>
              </div>
              <span id="ttc-mode-note" class="ttc-flow-status">iOS + Android selected</span>
            </div>

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
              <article class="ttc-ticket-card" data-stream-card="ios"><div class="ttc-card-kicker">FE · iOS</div><h4>iOS developer matrix</h4><div data-people-scope="feature" data-people-stream="ios"></div></article>
              <article class="ttc-ticket-card" data-stream-card="android"><div class="ttc-card-kicker">FE · ANDROID</div><h4>Android developer matrix</h4><div data-people-scope="feature" data-people-stream="android"></div></article>
              <article class="ttc-ticket-card" data-stream-card="web" hidden>
                <div class="ttc-card-kicker">FE · WEB</div><h4>Web developer matrix</h4>
                <label class="ttc-field"><span>Summary</span><div class="ttc-prefixed-input"><strong>[Web]</strong><input data-field="summary-web" type="text" placeholder="Web Screen X" /></div></label>
                <div data-people-scope="feature" data-people-stream="web"></div>
              </article>
              <article class="ttc-ticket-card" data-stream-card="be" hidden>
                <div class="ttc-card-kicker">BE · COMPONENT</div><h4>Backend developer matrix</h4>
                ${customCombobox({ field: "be-component", label: "Component prefix", placeholder: "API", id: "ttc-be-component" })}
                <label class="ttc-field"><span>Summary</span><div class="ttc-prefixed-input"><strong data-be-prefix>[API]</strong><input data-field="summary-be" type="text" placeholder="POST service/v1/endpoint" /></div></label>
                <div data-people-scope="feature" data-people-stream="be"></div>
              </article>
              <article class="ttc-ticket-card ttc-ticket-card--shared" data-stream-card="shared">
                <div class="ttc-card-kicker">SHARED · AD / SA</div><h4>Design reviewers</h4>
                <p class="ttc-card-note">Feature-specific people override the global defaults.</p>
                <div data-people-scope="feature" data-people-stream="common"></div>
              </article>
            </div>

            <div class="ttc-section-divider"><span>Feature-specific fields</span><small>Inherited values are editable here for this feature.</small></div>
            <div class="ttc-form-grid ttc-shared-fields">
              <label class="ttc-field ttc-wide"><span>Description</span><textarea data-field="description" rows="4" placeholder="Optional Jira description"></textarea></label>
              <label class="ttc-field ttc-wide"><span>Confluence Page</span><input data-field="confluence-page" type="url" placeholder="https://confluence…" /></label>
              ${lookupInput({ field: "feature-labels", label: "Feature labels", placeholder: "Add a feature label…", lookup: "label", multiple: true })}
              ${customCombobox({ field: "ad-story-point", label: "AD Story Point", hint: "Required", id: "ttc-ad-story-point" })}
              ${customCombobox({ field: "dev-story-point", label: "Dev Story Point", hint: "Optional; defaults to 0", id: "ttc-dev-story-point" })}
              ${customCombobox({ field: "priority", label: "Priority", hint: "Low by default", id: "ttc-priority" })}
              ${customCombobox({ field: "release", label: "Release Number", hint: "Required", id: "ttc-release" })}
              ${customCombobox({ field: "squad", label: "Squad", hint: "Required", id: "ttc-squad" })}
              ${customCombobox({ field: "task-trigger", label: "Task Trigger By", hint: "Design by default", id: "ttc-task-trigger" })}
              <label class="ttc-field"><span>Start Development On</span><input data-field="start-date" type="date" /></label>
              <label class="ttc-field"><span>Deadline</span><input data-field="deadline" type="date" /></label>
              <label class="ttc-field"><span>Feature start offset</span><input data-field="start-offset-days" type="number" value="0" min="-30" max="365" /></label>
              <label class="ttc-field"><span>Feature duration</span><input data-field="deadline-offset-days" type="number" value="3" min="0" max="365" /></label>
              <label class="ttc-field ttc-wide"><span>Assignee</span><input data-field="assignee-display" type="text" readonly placeholder="Loaded from Jira PAT user" /></label>
            </div>
            <p id="ttc-override-notice" class="ttc-override-notice" hidden></p>
            <p id="ttc-date-hint" class="ttc-date-hint"></p>

            <section class="ttc-preview-panel">
              <div class="ttc-section-heading"><div><div class="ttc-step-label">06 · REVIEW</div><h4>Creation preview</h4><p>Confirm parent, stream, summaries, and labels before the only Jira write.</p></div></div>
              <div id="ttc-create-preview" class="ttc-create-preview"></div>
            </section>
            <div class="ttc-actions ttc-final-actions"><span id="ttc-create-status" class="ttc-note">Choose a parent and complete required fields.</span><button id="ttc-create" class="btn btn-primary" type="button">Review and create tickets</button></div>
          </section>
        </section>

        <div class="ttc-empty-state" id="ttc-workflow-empty">
          <div class="ttc-empty-state-mark">01</div>
          <h3>Load Jira metadata to start</h3>
          <p>Load live Jira fields before creating tickets.</p>
          <button class="btn btn-primary" data-empty-discover type="button">Load Jira metadata</button>
        </div>
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
