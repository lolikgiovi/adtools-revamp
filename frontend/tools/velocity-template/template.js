export const VelocityTemplateToolTemplate = /* html */ `
  <div class="tool-container velocity-template-tool">
    <div class="velocity-template-layout">
      <section class="velocity-pane velocity-payload-pane">
        <header class="velocity-pane-header">
          <h3>JSON Payload Input</h3>
          <div class="velocity-pane-actions">
            <button id="btnVelocityFormatPayload" class="btn btn-ghost btn-sm" title="Format JSON payload">Format Json</button>
            <button id="btnVelocityClearPayload" class="btn btn-ghost btn-sm" title="Clear payload">Clear</button>
            <button id="btnVelocityCopyPayload" class="btn btn-ghost btn-sm" title="Copy payload">Copy</button>
          </div>
        </header>
        <div id="velocityPayloadEditor" class="velocity-editor"></div>
      </section>

      <section class="velocity-pane velocity-template-pane">
        <header class="velocity-pane-header">
          <h3>Template Input</h3>
          <div class="velocity-pane-actions">
            <button id="btnVelocityParse" class="btn btn-primary btn-sm" title="Parse template with JSON payload">Parse</button>
            <button id="btnVelocityCheck" class="btn btn-ghost btn-sm" title="Check Velocity syntax">Check Syntax</button>
            <button id="btnVelocityCopyTemplate" class="btn btn-ghost btn-sm" title="Copy template">Copy</button>
            <button id="btnVelocityClearTemplate" class="btn btn-ghost btn-sm" title="Clear template">Clear</button>
          </div>
        </header>
        <div id="velocityTemplateEditor" class="velocity-editor"></div>
      </section>

      <section class="velocity-pane velocity-result-pane">
        <header class="velocity-pane-header">
          <div class="velocity-result-title">
            <h3>Template Parsing Result</h3>
            <span id="velocityResultBadge" class="velocity-result-badge">Empty</span>
          </div>
          <div class="velocity-pane-actions">
            <button id="btnVelocityShowRendered" class="btn btn-ghost btn-sm velocity-html-only" title="Show rendered HTML" style="display:none">Rendered</button>
            <button id="btnVelocityShowSource" class="btn btn-ghost btn-sm velocity-html-only" title="Show result source" style="display:none">Source</button>
            <button id="btnVelocityCopyResult" class="btn btn-ghost btn-sm" title="Copy result">Copy</button>
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
