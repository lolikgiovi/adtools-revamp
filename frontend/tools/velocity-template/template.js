export const VelocityTemplate = /* html */ `
  <div class="tool-container splunk-vtl-editor velocity-template-tool">
    <div class="vtl-layout">
      <section class="pane vtl-editor-pane" aria-labelledby="velocityEditorTitle">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group">
            <h3 id="velocityEditorTitle">Velocity Template</h3>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnCopyVelocity" class="btn btn-primary btn-sm" type="button">Copy</button>
            <details id="velocityMoreActions" class="vtl-actions-menu">
              <summary class="btn btn-secondary btn-sm">More</summary>
              <div class="vtl-actions-menu-popover app-popover-surface">
                <button id="btnPasteVelocity" type="button">Paste from clipboard</button>
                <button id="btnClearVelocity" class="is-destructive" type="button">Clear template</button>
              </div>
            </details>
          </div>
        </div>
        <div id="velocityEditor" class="monaco-editor-container"></div>
      </section>

      <div id="velocityResizer" class="vtl-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize editor and result panes" aria-valuemin="25" aria-valuemax="75" aria-valuenow="60"></div>

      <section class="pane vtl-parameters-pane" aria-labelledby="velocityContextTitle">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group"><h3 id="velocityContextTitle">Context Data</h3></div>
          <div class="vtl-panel-actions">
            <button id="btnSyncVelocityContext" class="btn btn-secondary btn-sm" type="button">Sync fields</button>
            <button id="btnFormatVelocityContext" class="btn btn-secondary btn-sm" type="button">Format JSON</button>
          </div>
        </div>
        <div id="velocityContextError" class="vtl-inline-error" role="alert" hidden></div>
        <div id="velocityContext" class="vtl-parameters-input" aria-label="Velocity context JSON"></div>
      </section>

      <section class="pane vtl-preview-pane" aria-labelledby="velocityResultTitle">
        <div class="pane-header vtl-compact-header">
          <div class="vtl-title-group">
            <h3 id="velocityResultTitle">Rendered Result</h3>
          </div>
          <div class="vtl-panel-actions">
            <button id="btnToggleVelocityWrap" class="btn btn-secondary btn-sm" type="button" aria-pressed="true">Wrap</button>
            <button id="btnCopyVelocityPreview" class="btn btn-secondary btn-sm" type="button">Copy</button>
          </div>
        </div>
        <div id="velocityPreviewStatus" class="vtl-inline-error velocity-preview-error" role="alert" hidden></div>
        <pre id="velocityPreview" class="vtl-preview-output" aria-label="Rendered Velocity template"></pre>
      </section>
    </div>
  </div>
`;
