export const CompareConfigTemplate = /* html */ `
  <div class="tool-container compare-config">
    <div class="cc-section">
      <h3>Oracle Client</h3>
      <div class="cc-row">
        <button id="btnCheckPrime" class="btn btn-primary">Check & Prime Client</button>
        <span id="clientStatus" class="cc-status"></span>
      </div>
    </div>

    <div class="cc-grid">
      <div class="cc-section">
        <h3>Env 1</h3>
        <div class="cc-form">
          <label>Connection ID<input id="env1Id" type="text" placeholder="UAT1" /></label>
          <label>Username<input id="env1User" type="text" placeholder="scott" /></label>
          <label>Password<input id="env1Pass" type="password" placeholder="tiger" /></label>
          <div class="cc-row">
            <button id="btnSetCreds1" class="btn btn-sm">Set Credentials</button>
            <button id="btnGetCreds1" class="btn btn-sm">Get Credentials</button>
            <span id="credsStatus1" class="cc-status"></span>
          </div>
          <label>Host<input id="env1Host" type="text" placeholder="db-uat1.company.com" /></label>
          <label>Port<input id="env1Port" type="number" value="1521" /></label>
          <label>Service Name<input id="env1Service" type="text" placeholder="ORCLPDB1" /></label>
          <label>Schema<input id="env1Schema" type="text" placeholder="APP_SCHEMA" /></label>
          <div class="cc-row">
            <button id="btnTestConn1" class="btn btn-secondary">Test Connection</button>
            <span id="connStatus1" class="cc-status"></span>
          </div>
        </div>
      </div>

      <div class="cc-section">
        <h3>Env 2</h3>
        <div class="cc-form">
          <label>Connection ID<input id="env2Id" type="text" placeholder="PROD1" /></label>
          <label>Username<input id="env2User" type="text" placeholder="scott" /></label>
          <label>Password<input id="env2Pass" type="password" placeholder="tiger" /></label>
          <div class="cc-row">
            <button id="btnSetCreds2" class="btn btn-sm">Set Credentials</button>
            <button id="btnGetCreds2" class="btn btn-sm">Get Credentials</button>
            <span id="credsStatus2" class="cc-status"></span>
          </div>
          <label>Host<input id="env2Host" type="text" placeholder="db-prod1.company.com" /></label>
          <label>Port<input id="env2Port" type="number" value="1521" /></label>
          <label>Service Name<input id="env2Service" type="text" placeholder="ORCLPDB1" /></label>
          <label>Schema<input id="env2Schema" type="text" placeholder="APP_SCHEMA" /></label>
          <div class="cc-row">
            <button id="btnTestConn2" class="btn btn-secondary">Test Connection</button>
            <span id="connStatus2" class="cc-status"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="cc-section">
      <h3>Compare</h3>
      <div class="cc-form cc-compare">
        <label>Table<input id="cmpTable" type="text" placeholder="CONFIGS" /></label>
        <label>Fields (comma-separated)<input id="cmpFields" type="text" placeholder="ID,KEY,VALUE" /></label>
        <label>WHERE (optional)<input id="cmpWhere" type="text" placeholder="KEY IN ('X','Y','Z')" /></label>
        <div class="cc-row">
          <button id="btnCompare" class="btn btn-primary">Compare</button>
          <button id="btnExportJson" class="btn" disabled>Export JSON</button>
          <button id="btnExportCsv" class="btn" disabled>Export CSV</button>
          <span id="compareStatus" class="cc-status"></span>
        </div>
        <div class="cc-row cc-filters">
          <label class="cc-check"><input type="checkbox" id="fltMatches" /> Show Matches</label>
          <label class="cc-check"><input type="checkbox" id="fltDifferences" checked /> Show Differences</label>
          <label class="cc-check"><input type="checkbox" id="fltOnlyEnv1" checked /> Only Env1</label>
          <label class="cc-check"><input type="checkbox" id="fltOnlyEnv2" checked /> Only Env2</label>
        </div>
      </div>
    </div>

    <div class="cc-section">
      <h3>Presets</h3>
      <div class="cc-row">
        <input id="presetName" type="text" placeholder="Preset name" />
        <button id="btnSavePreset" class="btn">Save Preset</button>
        <select id="presetSelect" class="cc-select"></select>
        <button id="btnApplyPreset" class="btn">Apply</button>
        <button id="btnDeletePreset" class="btn">Delete</button>
        <span id="presetStatus" class="cc-status"></span>
      </div>
    </div>

    <div class="cc-section">
      <h3>Results</h3>
      <div id="cmpSummary" class="cc-summary"></div>
      <div id="cmpResults" class="cc-results"></div>
      <div class="cc-csv">
        <div class="cc-row">
          <button id="btnPreviewCsv" class="btn">Generate CSV Preview</button>
          <button id="btnDownloadCsv" class="btn">Download CSV (browser)</button>
          <span id="csvStatus" class="cc-status"></span>
        </div>
        <textarea id="csvPreview" rows="8" readonly placeholder="CSV preview will appear here..."></textarea>
      </div>
    </div>
  </div>
`;