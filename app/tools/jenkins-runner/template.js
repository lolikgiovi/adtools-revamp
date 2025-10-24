export const JenkinsRunnerTemplate = /*html*/ `
  <div class="jenkins-runner">
    <div class="jr-header">
      <h2>Jenkins Query Runner</h2>
      <div class="jr-status" data-role="status">Ready</div>
    </div>
    <div class="jr-controls">
      <label class="jr-field">
        <span>Jenkins URL <span class="setting-required" title="Required" aria-hidden="true">*</span></span>
        <input id="jenkins-baseurl" class="jr-input-readonly" type="text" placeholder="Set in Settings" aria-readonly="true" readonly />
      </label>
      <label class="jr-field">
        <span>Job Name <span class="setting-required" title="Required" aria-hidden="true">*</span></span>
        <select id="jenkins-job" class="jr-input">
          <option value="tester-execute-query-new">tester-execute-query-new</option>
          <option value="tester-execute-query">tester-execute-query</option>
        </select>
        <div class="jr-error" id="jenkins-job-error" style="display:none"></div>
      </label>
      <label class="jr-field">
        <span>ENV Choice <span class="setting-required" title="Required" aria-hidden="true">*</span></span>
        <select id="jenkins-env" class="jr-input"></select>
        <div class="jr-error" id="jenkins-env-error" style="display:none"></div>
      </label>
    </div>
    <div class="jr-sql">
      <div class="jr-sql-header">
        <label for="jenkins-sql"><span>SQL Query</span></label>
        <div class="jr-actions">
          <button id="jenkins-run" class="btn btn-primary">Run on Jenkins</button>
        </div>
      </div>
      <textarea id="jenkins-sql" rows="10" class="jr-textarea" placeholder="Write a read-only SQL query..."></textarea>
    </div>
    <div class="jr-logs">
      <div class="jr-log-header">
        <div class="jr-log-title">
          <span>Build Logs</span>
          <span id="jenkins-build-number" class="jr-build-number" style="display:none"></span>
        </div>
        <div class="jr-log-header-right">
          <a id="jenkins-build-link" href="#" target="_blank" rel="noopener" style="display:none">Open Build</a>
        </div>
      </div>
      <pre id="jenkins-logs" class="jr-log"></pre>
    </div>
    <div class="jr-hint" data-role="hint" style="display:none"></div>
  </div>
`;
