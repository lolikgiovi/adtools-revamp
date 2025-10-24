export const JenkinsRunnerTemplate = `
  <div class="jenkins-runner">
    <div class="jr-header">
      <h2>Jenkins Query Runner</h2>
      <div class="jr-status" data-role="status">Ready</div>
    </div>
    <div class="jr-controls">
      <label class="jr-field">
        <span>Base URL</span>
        <select id="jenkins-baseurl" class="jr-input"></select>
      </label>
      <label class="jr-field">
        <span>Job Name</span>
        <input id="jenkins-job" class="jr-input" type="text" placeholder="Enter Jenkins job name" />
      </label>
      <label class="jr-field">
        <span>ENV Choice</span>
        <select id="jenkins-env" class="jr-input"></select>
      </label>
    </div>
    <div class="jr-sql">
      <label>
        <span>SQL Text</span>
        <textarea id="jenkins-sql" rows="10" class="jr-textarea" placeholder="Write a read-only SQL query..."></textarea>
      </label>
    </div>
    <div class="jr-actions">
      <button id="jenkins-run" class="btn btn-primary">Run on Jenkins</button>
    </div>
    <div class="jr-logs">
      <div class="jr-log-header">
        <span>Build Logs</span>
        <a id="jenkins-build-link" href="#" target="_blank" rel="noopener" style="display:none">Open Build</a>
      </div>
      <pre id="jenkins-logs" class="jr-log"></pre>
    </div>
    <div class="jr-hint" data-role="hint" style="display:none"></div>
  </div>
`;