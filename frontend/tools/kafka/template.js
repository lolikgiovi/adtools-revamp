export const KafkaTemplate = /*html*/ `
  <div class="kafka-tool">
    <section id="kafkaConnection" class="kafka-connection" data-state="ready" aria-labelledby="kafkaConnectionHeading">
      <div class="kafka-connection-bar">
        <div class="kafka-connection-state">
          <span class="kafka-status-dot" aria-hidden="true"></span>
          <div>
            <h2 id="kafkaConnectionHeading">Kafka</h2>
            <p id="kafkaConnectionStatus" role="status" aria-live="polite">Add a bootstrap server to get started.</p>
          </div>
        </div>
        <div class="kafka-connection-actions">
          <button id="kafkaTest" class="btn btn-secondary btn-sm" type="button" disabled>Test connection</button>
          <details id="kafkaConnectionSettings" class="kafka-settings">
            <summary><span>Broker settings</span><svg class="kafka-picker-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
            <div class="kafka-settings-popover">
              <label for="kafkaBrokers">Bootstrap server</label>
              <input id="kafkaBrokers" type="text" placeholder="broker-1:9092,broker-2:9092" autocomplete="off" spellcheck="false" />
              <p class="kafka-setting-note">PLAINTEXT connection</p>
            </div>
          </details>
        </div>
      </div>
    </section>

    <nav class="kafka-flow-nav" aria-label="Kafka workflow on small screens">
      <button id="kafkaPublishFlow" class="kafka-flow-button is-active" type="button" aria-controls="kafkaPublishPanel" aria-pressed="true">Publish</button>
      <button id="kafkaListenFlow" class="kafka-flow-button" type="button" aria-controls="kafkaListenPanel" aria-pressed="false">Listen</button>
    </nav>

    <div id="kafkaWorkspace" class="kafka-workspace">
      <section id="kafkaPublishPanel" class="kafka-pane kafka-publish-pane is-active" aria-labelledby="kafkaComposeHeading">
        <div class="kafka-pane-header">
          <div>
            <h2 id="kafkaComposeHeading">Publish</h2>
          </div>
        </div>
        <div class="kafka-pane-body kafka-publish-body">
          <div class="kafka-publish-grid">
            <form id="kafkaForm" class="kafka-publish-form">
              <div class="kafka-topic-row">
                <div class="kafka-topic-field">
                  <div id="kafkaTopicPicker" class="kafka-topic-picker">
                    <input id="kafkaTopic" type="text" role="combobox" required autocomplete="off" spellcheck="false" aria-label="Topic" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="kafkaTopicOptions" placeholder="Search or enter a topic" />
                    <button id="kafkaTopicFavorite" class="kafka-icon-button" type="button" aria-label="Favorite topic" aria-pressed="false" title="Favorite topic">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
                    </button>
                    <button id="kafkaTopicToggle" type="button" aria-label="Browse topics" aria-controls="kafkaTopicOptions" aria-expanded="false"><svg class="kafka-picker-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
                    <div id="kafkaTopicMenu" class="kafka-topic-menu" hidden>
                      <div class="kafka-topic-menu-heading"><strong>Topics</strong><button id="kafkaTopicRefresh" type="button">Refresh</button></div>
                      <p id="kafkaTopicStatus" role="status" aria-live="polite"></p>
                      <div id="kafkaTopicOptions" role="listbox" aria-label="Broker topics"></div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="kafka-template-action-row">
                <div id="kafkaTemplatePicker" class="kafka-topic-picker kafka-template-picker">
                  <input id="kafkaTemplateSearch" type="text" role="combobox" aria-label="Template" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="kafkaSavedList" placeholder="Search or choose a template" autocomplete="off" spellcheck="false" />
                  <button id="kafkaTemplateFavorite" class="kafka-icon-button" type="button" aria-label="Favorite template" aria-pressed="false" title="Favorite template" disabled>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
                  </button>
                  <button id="kafkaTemplateToggle" type="button" aria-label="Browse templates" aria-controls="kafkaSavedList" aria-expanded="false"><svg class="kafka-picker-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
                  <details id="kafkaTemplates" class="kafka-templates">
                    <summary class="kafka-visually-hidden" tabindex="-1" aria-hidden="true">Templates</summary>
                    <div id="kafkaSavedPanel" class="kafka-templates-content">
                      <div class="kafka-template-menu-heading"><strong>Saved templates</strong><span id="kafkaTemplateCount" class="kafka-subhead-note"></span></div>
                      <p id="kafkaTemplateStatus" role="status" aria-live="polite"></p>
                      <div id="kafkaSavedList" role="listbox" aria-label="Saved templates"></div>
                    </div>
                  </details>
                </div>
                <div class="kafka-publish-actions">
                  <button id="kafkaTemplateSaveToggle" class="btn btn-secondary btn-sm" type="button" aria-expanded="false" aria-controls="kafkaTemplateSave" title="Save the current draft as a template">Save as</button>
                  <button id="kafkaPublish" class="btn btn-primary" type="submit">Publish</button>
                </div>
              </div>

              <div id="kafkaTemplateSave" class="kafka-template-save" hidden>
                <label for="kafkaRequestName">Template name</label>
                <div class="kafka-template-save-fields">
                  <input id="kafkaRequestName" type="text" maxlength="80" placeholder="e.g. Retry payment" autocomplete="off" />
                  <button id="kafkaSave" class="btn btn-secondary btn-sm" type="button">Save template</button>
                  <button id="kafkaTemplateSaveCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
                </div>
              </div>

              <div class="kafka-editor-section kafka-value-section">
                <div class="kafka-editor-heading"><label id="kafkaValueLabel" for="kafkaValue">Payload</label><div class="kafka-editor-controls"><label class="switch kafka-bulk-toggle" title="Publish the payload as a JSON array"><input id="kafkaBulk" type="checkbox" /><span class="slider"></span></label><span class="kafka-toggle-label">Bulk</span><button id="kafkaFormatValue" class="btn btn-ghost btn-sm" type="button">Format</button></div></div>
                <div id="kafkaValueEditor" class="kafka-json-editor" aria-labelledby="kafkaValueLabel"></div>
                <textarea id="kafkaValue" class="kafka-editor-fallback" rows="11" spellcheck="false">{
  "example": "value"
}</textarea>
                <p id="kafkaValueStatus" class="kafka-json-status" role="status" aria-live="polite"></p>
              </div>

              <details id="kafkaPublishOptions" class="kafka-publish-options">
                <summary><span>Options</span><span id="kafkaPublishOptionsSummary" class="kafka-subhead-note">Optional</span></summary>
                <div class="kafka-publish-options-content">
                  <label class="kafka-key-field" for="kafkaKey">Key <span>optional</span><input id="kafkaKey" type="text" autocomplete="off" placeholder="Message key" /></label>

                  <div id="kafkaHeadersSection" class="kafka-editor-section">
                    <div class="kafka-editor-heading"><label id="kafkaHeadersLabel" for="kafkaHeaders">Headers</label><div class="kafka-editor-controls"><button id="kafkaFormatHeaders" class="btn btn-ghost btn-sm" type="button">Format</button><button id="kafkaExpandHeaders" class="btn btn-ghost btn-sm" type="button" aria-controls="kafkaHeadersEditor" aria-expanded="false">Expand</button></div></div>
                    <div id="kafkaHeadersEditor" class="kafka-json-editor" aria-labelledby="kafkaHeadersLabel"></div>
                    <textarea id="kafkaHeaders" class="kafka-editor-fallback" rows="4" spellcheck="false">{}</textarea>
                    <p id="kafkaHeadersStatus" class="kafka-json-status" role="status" aria-live="polite"></p>
                  </div>
                </div>
              </details>

              <p id="kafkaCount" class="kafka-hint kafka-publish-count">1 message per click</p>
              <p id="kafkaPublishStatus" role="status" aria-live="polite"></p>
              <div id="kafkaDeliveries" class="kafka-deliveries" aria-live="polite"></div>
            </form>
          </div>
        </div>
      </section>

      <div id="kafkaResizer" class="kafka-resizer" role="separator" aria-orientation="vertical" aria-label="Resize Publish and Listen panes" aria-valuemin="420" aria-valuenow="0" tabindex="0"></div>

      <section id="kafkaListenPanel" class="kafka-pane kafka-listen-pane" aria-labelledby="kafkaListenHeading">
        <div class="kafka-pane-header kafka-listen-header">
          <h2 id="kafkaListenHeading">Listen</h2>
          <div class="kafka-listen-mode" role="tablist" aria-label="Listen mode">
            <button id="kafkaHistoryMode" class="kafka-listen-mode-button is-active" type="button" role="tab" aria-selected="true" aria-controls="kafkaHistoryView">Search</button>
            <button id="kafkaLiveMode" class="kafka-listen-mode-button" type="button" role="tab" aria-selected="false" aria-controls="kafkaLiveView" tabindex="-1">Live</button>
          </div>
        </div>
        <div class="kafka-pane-body kafka-listen-body">
          <div class="kafka-listen-topic-row">
            <label for="kafkaListenTopic">Topic</label>
            <div id="kafkaListenTopicPicker" class="kafka-topic-picker kafka-listen-topic-picker">
              <input
                id="kafkaListenTopic"
                type="text"
                role="combobox"
                required
                autocomplete="off"
                spellcheck="false"
                aria-label="Topic to listen on"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded="false"
                aria-controls="kafkaListenTopicOptions"
                placeholder="Search or enter a topic"
              />
              <button id="kafkaListenTopicFavorite" class="kafka-icon-button" type="button" aria-label="Favorite topic" aria-pressed="false" title="Favorite topic">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
              </button>
              <button id="kafkaListenTopicToggle" type="button" aria-label="Browse topics" aria-controls="kafkaListenTopicOptions" aria-expanded="false"><svg class="kafka-picker-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
              <div id="kafkaListenTopicMenu" class="kafka-topic-menu" hidden>
                <div class="kafka-topic-menu-heading"><strong>Topics</strong><button id="kafkaListenTopicRefresh" type="button">Refresh</button></div>
                <p id="kafkaListenTopicStatus" role="status" aria-live="polite"></p>
                <div id="kafkaListenTopicOptions" role="listbox" aria-label="Broker topics for listening"></div>
              </div>
            </div>
          </div>
          <p id="kafkaListenStatus" class="kafka-pane-caption" role="status" aria-live="polite"></p>
          <section id="kafkaHistoryView" class="kafka-history kafka-listen-view" role="tabpanel" aria-labelledby="kafkaHistoryMode">
            <form id="kafkaHistoryForm" class="kafka-history-form">
              <label class="kafka-visually-hidden" for="kafkaHistoryQuery">Search retained messages</label>
              <input id="kafkaHistoryQuery" type="text" minlength="3" maxlength="200" required placeholder="Trace ID, payload, key, or header" autocomplete="off" spellcheck="false" aria-label="Trace ID, payload, key, or header" />
              <div class="kafka-history-field">
                <label class="kafka-visually-hidden" for="kafkaHistoryTrigger">Since</label>
                <div id="kafkaHistoryPicker" class="kafka-date-picker">
                  <input id="kafkaHistorySince" type="hidden" required />
                  <button id="kafkaHistoryTrigger" class="kafka-date-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="kafkaHistoryCalendar">
                    <span id="kafkaHistoryDisplay"></span>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <div id="kafkaHistoryCalendar" class="kafka-date-popover" role="dialog" aria-labelledby="kafkaHistoryCalendarTitle" hidden>
                    <div class="kafka-date-header">
                      <h3 id="kafkaHistoryCalendarTitle"></h3>
                      <div class="kafka-date-nav" aria-label="Change month">
                        <button id="kafkaHistoryPrevious" class="kafka-date-nav-button" type="button" aria-label="Previous month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
                        <button id="kafkaHistoryNext" class="kafka-date-nav-button" type="button" aria-label="Next month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
                      </div>
                    </div>
                    <div class="kafka-date-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
                    <div id="kafkaHistoryDays" class="kafka-date-days" role="grid" aria-label="Calendar days"></div>
                    <div class="kafka-date-time">
                      <div><strong>Start time</strong><span>Local time</span></div>
                      <div class="kafka-time-fields">
                        <label>Hour<input id="kafkaHistoryHours" type="text" inputmode="numeric" maxlength="2" aria-label="Hour" /></label>
                        <span aria-hidden="true">:</span>
                        <label>Minute<input id="kafkaHistoryMinutes" type="text" inputmode="numeric" maxlength="2" aria-label="Minute" /></label>
                      </div>
                    </div>
                    <div class="kafka-date-footer">
                      <button id="kafkaHistoryNow" class="btn btn-ghost btn-sm" type="button">Now</button>
                      <div class="kafka-date-footer-actions"><button id="kafkaHistoryCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button><button id="kafkaHistoryApply" class="btn btn-primary btn-sm" type="button">Apply</button></div>
                    </div>
                  </div>
                </div>
              </div>
              <button id="kafkaHistorySearch" class="btn btn-secondary btn-sm" type="submit" disabled>Search</button>
            </form>
            <p id="kafkaHistoryStatus" role="status" aria-live="polite"></p>
            <div id="kafkaHistoryResults" class="kafka-messages kafka-history-results"></div>
          </section>

          <section id="kafkaLiveView" class="kafka-live-results kafka-listen-view" role="tabpanel" aria-labelledby="kafkaLiveMode kafkaLiveHeading" hidden>
            <div class="kafka-subhead">
              <div><h3 id="kafkaLiveHeading">Live messages</h3><span class="kafka-subhead-note">Optional · newest first · up to 100</span></div>
              <div class="kafka-listen-actions">
                <label class="switch kafka-from-beginning-toggle" title="Start at the earliest retained message"><input id="kafkaFromBeginning" type="checkbox" /><span class="slider"></span><span class="kafka-toggle-label">From start</span></label>
                <button id="kafkaListen" class="btn btn-secondary btn-sm" type="button" aria-pressed="false" disabled>Start listening</button>
              </div>
            </div>
            <div id="kafkaMessages" class="kafka-messages"><p class="kafka-empty">Add a bootstrap server, then enter a topic to listen.</p></div>
          </section>
        </div>
      </section>
    </div>
  </div>`;
