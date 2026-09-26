export const RedisCacheTemplate = /*html*/ `
  <div class="redis-cache-tool">
    <main class="redis-cache-layout">
      <section class="redis-key-workspace" aria-labelledby="redisSearchHeading">
        <div class="redis-section-heading">
          <div>
            <h2 id="redisSearchHeading">Find cache keys</h2>
          </div>
          <span class="redis-scan-badge">10 results per page · SCAN 100/request</span>
        </div>
        <div class="redis-search-panel">
          <form id="redisKeySearchForm" class="redis-search-form">
            <div class="redis-search-field">
              <div class="redis-search-control">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16 16 4 4"></path></svg>
                <input id="redisPatternInput" type="text" maxlength="512" placeholder="session:user:*" aria-label="Key pattern" autocomplete="off" spellcheck="false" />
              </div>
            </div>
            <button id="redisSearchButton" class="btn btn-primary" type="submit">Find keys</button>
          </form>
        </div>
        <p id="redisSearchMessage" class="redis-search-message" role="status" aria-live="polite"></p>

        <div id="redisDeleteConfirmation" class="redis-delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="redisDeleteTitle" aria-describedby="redisDeleteDescription" hidden>
          <div class="redis-delete-dialog" role="document">
            <div class="redis-delete-dialog-body">
              <div class="redis-delete-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 8v5"></path><path d="M12 17h.01"></path><path d="M10.3 3.8 2.5 17.3A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.7L13.7 3.8a2 2 0 0 0-3.4 0Z"></path></svg>
              </div>
              <div>
                <h3 id="redisDeleteTitle">Clear selected cache keys?</h3>
                <p id="redisDeleteDescription"></p>
              </div>
            </div>
            <div class="redis-delete-actions">
              <button id="redisCancelDelete" class="btn btn-secondary btn-sm" type="button">Cancel</button>
              <button id="redisConfirmDelete" class="btn btn-danger btn-sm" type="button">Clear keys</button>
            </div>
          </div>
        </div>

        <div class="redis-results-toolbar">
          <div>
            <strong id="redisResultsCount">No results</strong>
            <span id="redisAppliedPattern"></span>
          </div>
          <div class="redis-results-actions">
            <button id="redisSelectAll" class="btn btn-ghost btn-sm" type="button" disabled>Select all</button>
            <button id="redisClearSelected" class="btn btn-danger btn-sm" type="button" disabled>Clear selected</button>
          </div>
        </div>

        <div id="redisResults" class="redis-results" role="region" aria-label="Redis key results" aria-live="polite" tabindex="0">
          <div class="redis-empty-state">
            <svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="13" rx="15" ry="6"></ellipse><path d="M9 13v10c0 3.3 6.7 6 15 6s15-2.7 15-6V13"></path><path d="M9 23v10c0 3.3 6.7 6 15 6 4.1 0 7.8-.7 10.5-1.9"></path><path d="m36 33 6 6m0-6-6 6"></path></svg>
            <h3>Search the keyspace</h3>
            <p>Results appear in bounded pages. Use View to inspect a key without changing it.</p>
          </div>
        </div>

        <nav id="redisPagination" class="redis-pagination" aria-label="Search result pages" hidden></nav>
      </section>

      <aside class="redis-sidebar" aria-label="Redis connection and saved keys">
        <section class="redis-connection-panel" aria-labelledby="redisConnectionHeading">
          <div class="redis-section-heading redis-connection-heading">
            <div>
              <h2 id="redisConnectionHeading">Connection</h2>
            </div>
          </div>

          <div class="redis-connection-summary" aria-live="polite">
            <span class="redis-status-dot" data-state="idle" aria-hidden="true"></span>
            <div>
              <strong id="redisConnectionLabel">Not configured</strong>
              <span id="redisConnectionDetail">Add the Redis connection in Settings.</span>
            </div>
          </div>
          <div class="redis-connection-actions">
            <button id="redisTestConnection" class="btn btn-primary btn-sm" type="button">Test connection</button>
            <button id="redisOpenSettings" class="btn btn-ghost btn-sm" type="button">Settings</button>
          </div>

          <section
            id="redisConnectionDiagnostics"
            class="redis-connection-diagnostics"
            aria-labelledby="redisConnectionDiagnosticsHeading"
            aria-live="polite"
            hidden
          >
            <div class="redis-diagnostic-header">
              <div>
                <h3 id="redisConnectionDiagnosticsHeading">Connection diagnostics</h3>
                <p id="redisConnectionDiagnosticSummary"></p>
              </div>
              <button id="redisDismissDiagnostics" class="btn btn-ghost btn-sm" type="button">Dismiss</button>
            </div>
            <div class="redis-diagnostic-outcome">
              <span id="redisDiagnosticStatusDot" class="redis-status-dot" data-state="idle" aria-hidden="true"></span>
              <strong id="redisDiagnosticStatus"></strong>
            </div>
            <dl class="redis-diagnostic-grid">
              <div>
                <dt>Endpoint</dt>
                <dd id="redisDiagnosticEndpoint"></dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd id="redisDiagnosticDatabase"></dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd id="redisDiagnosticTransport"></dd>
              </div>
              <div>
                <dt>Failure stage</dt>
                <dd id="redisDiagnosticStage"></dd>
              </div>
              <div>
                <dt>Round trip</dt>
                <dd id="redisDiagnosticLatency"></dd>
              </div>
            </dl>
            <div id="redisDiagnosticDetailBlock" class="redis-diagnostic-copy" hidden>
              <strong>Diagnostic detail</strong>
              <code id="redisDiagnosticDetail"></code>
            </div>
            <p id="redisDiagnosticHint" class="redis-diagnostic-hint" hidden></p>
          </section>
        </section>

        <section class="redis-favorites" aria-labelledby="redisFavoritesHeading">
          <div class="redis-section-heading redis-favorites-heading">
            <div>
              <h2 id="redisFavoritesHeading">Saved keys</h2>
            </div>
            <span id="redisFavoritesCount" class="redis-favorites-count">0</span>
          </div>
          <div id="redisFavoritesList" class="redis-favorites-list"></div>
        </section>
      </aside>
    </main>
    <div id="redisValueInspector" class="redis-value-inspector" role="dialog" aria-modal="true" aria-labelledby="redisValueInspectorHeading" hidden>
      <div class="redis-value-inspector-dialog" role="document">
        <div class="redis-value-inspector-header">
          <div>
            <h3 id="redisValueInspectorHeading">Value inspector</h3>
            <code id="redisValueInspectorKey"></code>
            <p id="redisValueInspectorMeta"></p>
          </div>
          <button id="redisCloseInspector" class="btn btn-ghost btn-sm" type="button">Close</button>
        </div>
        <div class="redis-value-inspector-search">
          <label for="redisValueSearch">Find in value</label>
          <div class="redis-value-inspector-search-controls">
            <input id="redisValueSearch" type="search" placeholder="Search this value" autocomplete="off" aria-controls="redisValueContent" disabled />
            <span id="redisValueSearchCount" role="status" aria-live="polite"></span>
            <button id="redisValuePreviousMatch" class="btn btn-ghost btn-sm" type="button" aria-label="Previous match" disabled>Previous</button>
            <button id="redisValueNextMatch" class="btn btn-ghost btn-sm" type="button" aria-label="Next match" disabled>Next</button>
          </div>
        </div>
        <div id="redisValueInspectorNotice" class="redis-value-inspector-notice" hidden></div>
        <div id="redisValueInspectorBody" class="redis-value-inspector-body">
          <pre id="redisValueContent" class="redis-value-content"></pre>
        </div>
      </div>
    </div>
  </div>
`;
