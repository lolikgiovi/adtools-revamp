export const JenkinsRunnerTemplate = /*html*/ `
  <div class="jenkins-runner">
    <div class="jr-tabs" aria-label="Jenkins Runner tabs">
      <div class="jr-tabs-left" role="tablist">
        <button class="jr-tab active" id="jr-tab-run-btn" role="tab" aria-selected="true" aria-controls="jr-tab-run">Run Query</button>
        <button class="jr-tab" id="jr-tab-history-btn" role="tab" aria-selected="false" aria-controls="jr-tab-history">History</button>
      </div>
      <div class="jr-status" data-role="status">Ready</div>
    </div>

    <div id="jr-tab-run" role="tabpanel" aria-labelledby="jr-tab-run-btn">
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
          <label for="jenkins-sql-editor"><span>SQL Query</span></label>
          <div class="jr-actions">
            <button id="jenkins-run" class="btn btn-primary">Run on Jenkins</button>
          </div>
        </div>
        <div id="jenkins-sql-editor" class="jr-monaco-editor"></div>
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

    <div id="jr-tab-history" role="tabpanel" aria-labelledby="jr-tab-history-btn" style="display:none">
      <div class="jr-history">
        <div class="jr-log-header">
          <span>Run History</span>
        </div>
        <table class="jr-history-table" aria-label="Run History">
          <thead>
            <tr>
              <th>Time</th>
              <th>Job</th>
              <th>ENV</th>
              <th>SQL</th>
              <th>Build</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="jr-history-list"></tbody>
        </table>
      </div>
    </div>
  </div>
`;
