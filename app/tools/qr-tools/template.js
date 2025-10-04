window.QRToolsTemplate = /* html */ ` 
  <div class="tool-container qr-tools">
    <div class="qr-tools-layout">
      <div class="qr-tools-left">
        <div class="form-group">
          <label for="qrMode">Content Type</label>
          <select id="qrMode" class="form-control">
            <option value="text">Text</option>
            <option value="url">URL</option>
          </select>
        </div>

        <div class="form-group">
          <label for="qrContent">Content</label>
          <textarea id="qrContent" class="form-control" rows="4" placeholder="Enter URL or text"></textarea>
          <div id="qrValidation" class="help-text"></div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="qrColorForeground">Foreground</label>
            <input id="qrColorForeground" type="color" class="form-control" value="#000000" />
          </div>
          <div class="form-group">
            <label for="qrColorBackground">Background</label>
            <input id="qrColorBackground" type="color" class="form-control" value="#FFFFFF" />
          </div>
        </div>

        <div class="form-actions">
          <button id="qrDownloadPng" class="btn btn-primary" disabled>Download PNG</button>
          <button id="qrDownloadSvg" class="btn btn-primary" disabled>Download SVG</button>
          <button id="qrReset" class="btn btn-secondary">Reset</button>
        </div>
      </div>

      <div class="qr-tools-right">
        <div class="preview-header">
          <div class="preview-title">Preview</div>
        </div>
        <div class="preview-area">
          <canvas id="qrCanvas"></canvas>
        </div>
        <div id="qrContrastWarning" class="warning-text"></div>
      </div>
    </div>
  </div>
`;
