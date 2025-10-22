export const SQLInClauseTemplate = /* html */ `
  <div class="tool-container sql-in-clause">
    <div class="sql-in-layout">
      <div class="pane editor-pane">
        <div class="pane-header">
          <h3>Input</h3>
          <span class="hint">Enter items, one per line</span>
        </div>
        <div id="sqlInEditor" class="monaco-editor-container"></div>
      </div>

      <div class="pane output-pane">
         <div class="pane-header">
           <h3>Output</h3>
           <div class="output-actions" style="display:flex;align-items:center;gap:.5rem;">
             <div class="format-controls">
               <label class="format-select-label">Format:</label>
               <select id="sqlInFormat" class="format-select">
                 <option value="single" selected>Single-line</option>
                 <option value="multi">Multi-line</option>
                 <option value="select">SELECT query</option>
               </select>
             </div>
             <button id="sqlInCopyBtn" class="btn btn-sm" title="Copy to clipboard">Copy</button>
           </div>
         </div>
         <div class="output-config">
           <div class="select-details">
             <input id="selectTable" type="text" placeholder="Table name" />
             <input id="selectColumn" type="text" placeholder="Column name" />
           </div>
         </div>
         <textarea id="sqlInOutput" class="output-text" rows="12" readonly></textarea>
       </div>
    </div>
  </div>
`;
