const copyIcon = /* html */ `
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
`;

const trashIcon = /* html */ `
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6h18"></path>
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
  </svg>
`;

const panelLeftIcon = /* html */ `
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2"></rect>
    <path d="M9 4v16"></path>
    <path d="M15 10l-3 2 3 2"></path>
  </svg>
`;

export const VelocityTemplateToolTemplate = /* html */ `
  <div class="tool-container velocity-template-tool">
    <div id="velocityTemplateLayout" class="velocity-template-layout">
      <section class="velocity-pane velocity-payload-pane">
        <header class="velocity-pane-header">
          <h3>JSON Payload Input</h3>
          <div class="velocity-pane-actions">
            <button id="btnVelocityFormatPayload" class="btn btn-ghost btn-sm" title="Format JSON payload">Format Json</button>
            <button id="btnVelocityClearPayload" class="btn btn-ghost btn-sm btn-icon-only" title="Clear payload" aria-label="Clear payload">${trashIcon}</button>
            <button id="btnVelocityCopyPayload" class="btn btn-ghost btn-sm btn-icon-only" title="Copy payload" aria-label="Copy payload">${copyIcon}</button>
            <button id="btnVelocityTogglePayload" class="btn btn-ghost btn-sm btn-icon-only" title="Collapse payload pane" aria-label="Collapse payload pane" aria-expanded="true">${panelLeftIcon}</button>
          </div>
        </header>
        <div id="velocityPayloadEditor" class="velocity-editor"></div>
      </section>

      <button id="velocityPayloadCollapsedTab" class="velocity-collapsed-tab" title="Expand payload pane" aria-label="Expand payload pane" style="display:none">
        <span>Payload</span>
      </button>

      <div class="velocity-resize-handle velocity-resize-handle-payload" data-resize-handle="payload" role="separator" aria-orientation="vertical" title="Resize payload pane"></div>

      <section class="velocity-pane velocity-template-pane">
        <header class="velocity-pane-header">
          <h3>Template Input</h3>
          <div class="velocity-pane-actions">
            <button id="btnVelocityParse" class="btn btn-primary btn-sm" title="Parse template with JSON payload">Parse</button>
            <button id="btnVelocityCheck" class="btn btn-ghost btn-sm" title="Check Velocity syntax">Check Syntax</button>
            <button id="btnVelocityCopyTemplate" class="btn btn-ghost btn-sm btn-icon-only" title="Copy template" aria-label="Copy template">${copyIcon}</button>
            <button id="btnVelocityClearTemplate" class="btn btn-ghost btn-sm btn-icon-only" title="Clear template" aria-label="Clear template">${trashIcon}</button>
          </div>
        </header>
        <div id="velocityTemplateEditor" class="velocity-editor"></div>
      </section>

      <div class="velocity-resize-handle velocity-resize-handle-result" data-resize-handle="result" role="separator" aria-orientation="vertical" title="Resize result pane"></div>

      <section class="velocity-pane velocity-result-pane">
        <header class="velocity-pane-header">
          <div class="velocity-result-title">
            <h3>Template Parsing Result</h3>
            <span id="velocityResultBadge" class="velocity-result-badge">Empty</span>
          </div>
          <div class="velocity-pane-actions">
            <button id="btnVelocityShowRendered" class="btn btn-ghost btn-sm velocity-html-only" title="Show rendered HTML" style="display:none">Rendered</button>
            <button id="btnVelocityShowSource" class="btn btn-ghost btn-sm velocity-html-only" title="Show result source" style="display:none">Source</button>
            <button id="btnVelocityCopyResult" class="btn btn-ghost btn-sm btn-icon-only" title="Copy result" aria-label="Copy result">${copyIcon}</button>
            <button id="btnVelocityValidateResultJson" class="btn btn-ghost btn-sm" title="Validate result JSON">Validate JSON</button>
          </div>
        </header>
        <div id="velocityStatus" class="velocity-status" role="status" aria-live="polite"></div>
        <div id="velocityResultEditor" class="velocity-editor velocity-result-editor"></div>
        <iframe id="velocityHtmlPreview" class="velocity-html-preview" sandbox="allow-forms allow-scripts" style="display:none"></iframe>
      </section>
    </div>
  </div>
`;
