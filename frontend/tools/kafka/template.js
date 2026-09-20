export const KafkaTemplate = /*html*/ `
  <div class="kafka-tool">
      <section class="kafka-connection" aria-labelledby="kafkaConnectionHeading">
      <div class="kafka-section-title"><div><h2 id="kafkaConnectionHeading">Broker (Publisher and Listener)</h2></div><button id="kafkaTest" class="btn btn-secondary" type="button">Test connection</button></div>
      <label for="kafkaBrokers">Bootstrap servers (Plaintext Connection only)</label>
      <input id="kafkaBrokers" type="text" placeholder="broker-1:9092,broker-2:9092" autocomplete="off" spellcheck="false" />
      <p id="kafkaConnectionStatus" role="status" aria-live="polite"></p>
    </section>
    <div class="kafka-layout">
      <section class="kafka-compose" aria-labelledby="kafkaComposeHeading">
        <div class="kafka-section-title"><div><h2 id="kafkaComposeHeading">Publish</h2></div></div>
        <form id="kafkaForm">
          <div class="kafka-topic-row">
            <div class="kafka-topic-field">
              <label for="kafkaTopic">Topic Explorer</label>
              <div id="kafkaTopicPicker" class="kafka-topic-picker">
                <input id="kafkaTopic" type="text" role="combobox" required autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="kafkaTopicOptions" placeholder="Search or enter a topic" />
                <button id="kafkaTopicToggle" type="button" aria-label="Browse topics" aria-controls="kafkaTopicOptions" aria-expanded="false">▼</button>
                <div id="kafkaTopicMenu" class="kafka-topic-menu" hidden>
                  <div class="kafka-topic-menu-heading"><strong>Broker topics</strong><button id="kafkaTopicRefresh" type="button">Refresh</button></div>
                  <p id="kafkaTopicStatus" role="status" aria-live="polite"></p>
                  <div id="kafkaTopicOptions" role="listbox" aria-label="Broker topics"></div>
                </div>
              </div>
            </div>
            <button id="kafkaPublish" class="btn btn-primary" type="submit">Publish</button>
          </div>
          <label class="kafka-key-field" for="kafkaKey">Key <span>(optional)</span><input id="kafkaKey" type="text" autocomplete="off" placeholder="Message key" /></label>
          <div class="kafka-editor-section">
            <div class="kafka-editor-heading"><label id="kafkaHeadersLabel" for="kafkaHeaders">Header <span>(optional JSON object)</span></label><button id="kafkaFormatHeaders" class="btn btn-ghost btn-sm" type="button">Format JSON</button></div>
            <div id="kafkaHeadersEditor" class="kafka-json-editor" aria-labelledby="kafkaHeadersLabel"></div>
            <textarea id="kafkaHeaders" class="kafka-editor-fallback" rows="4" spellcheck="false">{}</textarea>
            <p id="kafkaHeadersStatus" class="kafka-json-status" role="status" aria-live="polite"></p>
          </div>
          <div class="kafka-editor-section kafka-value-section">
            <div class="kafka-editor-heading"><label id="kafkaValueLabel" for="kafkaValue">Value <span>(JSON)</span></label><div class="kafka-editor-controls"><label class="switch kafka-bulk-toggle" title="Publish the value as a JSON array"><input id="kafkaBulk" type="checkbox" /><span class="slider"></span></label><span class="kafka-toggle-label">Bulk array</span><button id="kafkaFormatValue" class="btn btn-ghost btn-sm" type="button">Format JSON</button></div></div>
            <div id="kafkaValueEditor" class="kafka-json-editor" aria-labelledby="kafkaValueLabel"></div>
            <textarea id="kafkaValue" class="kafka-editor-fallback" rows="11" spellcheck="false" placeholder='{"example":"value"}'></textarea>
            <p id="kafkaValueStatus" class="kafka-json-status" role="status" aria-live="polite"></p>
          </div>
          <p id="kafkaCount" class="kafka-hint">1 message per click</p>
          <div class="kafka-actions"><input id="kafkaRequestName" type="text" maxlength="80" aria-label="Template name" placeholder="Template name" /><button id="kafkaSave" class="btn btn-secondary" type="button">Save as Template</button></div>
          <p id="kafkaPublishStatus" role="status" aria-live="polite"></p>
          <div id="kafkaDeliveries" class="kafka-deliveries" aria-live="polite"></div>
        </form>
      </section>
      <aside class="kafka-saved" aria-labelledby="kafkaSavedHeading"><div class="kafka-section-title"><div><h2 id="kafkaSavedHeading">Saved requests</h2></div></div><div id="kafkaSavedList"></div></aside>
    </div>
    <section class="kafka-listener" aria-labelledby="kafkaListenHeading">
      <div class="kafka-section-title"><div><h2 id="kafkaListenHeading">Listen</h2></div>
        <div class="kafka-listen-actions"><label class="switch kafka-from-beginning-toggle" title="Start at the earliest retained message"><input id="kafkaFromBeginning" type="checkbox" /><span class="slider"></span></label><span class="kafka-toggle-label">From beginning</span><button id="kafkaListen" class="btn btn-secondary" type="button" aria-pressed="false">Start listening</button></div></div>
      <p id="kafkaListenStatus" role="status" aria-live="polite"></p><div id="kafkaMessages" class="kafka-messages"><p class="kafka-empty">Received messages appear here, up to the latest 100.</p></div>
    </section>
    <section class="kafka-listener kafka-history" aria-labelledby="kafkaHistoryHeading">
      <div class="kafka-section-title"><div><h2 id="kafkaHistoryHeading">Search retained history</h2><p class="kafka-hint">Search the selected topic’s payloads, keys, and headers from a start time. Scans up to 50,000 records or 30 seconds; returns up to 20 matches.</p></div></div>
      <form id="kafkaHistoryForm" class="kafka-history-form">
        <label for="kafkaHistoryQuery">Identifier<input id="kafkaHistoryQuery" type="text" minlength="3" maxlength="200" required placeholder="Trace ID or payload text" autocomplete="off" spellcheck="false" /></label>
        <div class="kafka-history-field">
          <label for="kafkaHistoryTrigger">Since</label>
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
                <button id="kafkaHistoryNow" class="btn btn-ghost btn-sm" type="button">Use current time</button>
                <div class="kafka-date-footer-actions"><button id="kafkaHistoryCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button><button id="kafkaHistoryApply" class="btn btn-primary btn-sm" type="button">Apply</button></div>
              </div>
            </div>
          </div>
        </div>
        <button id="kafkaHistorySearch" class="btn btn-secondary" type="submit">Search history</button>
      </form>
      <p id="kafkaHistoryStatus" role="status" aria-live="polite"></p>
      <div id="kafkaHistoryResults" class="kafka-messages"></div>
    </section>
  </div>`;
