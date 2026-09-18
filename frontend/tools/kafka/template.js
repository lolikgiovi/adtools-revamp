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
            <div class="kafka-editor-heading"><label id="kafkaValueLabel" for="kafkaValue">Value <span>(JSON)</span></label><div class="kafka-editor-controls"><label class="kafka-bulk-toggle"><input id="kafkaBulk" type="checkbox" /> Bulk array</label><button id="kafkaFormatValue" class="btn btn-ghost btn-sm" type="button">Format JSON</button></div></div>
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
      <div class="kafka-section-title"><div><h2 id="kafkaListenHeading">Listen</h2><p>Preview messages from the topic above. Listening never publishes and does not commit offsets.</p></div>
        <div class="kafka-listen-actions"><label><input id="kafkaFromBeginning" type="checkbox" /> From beginning</label><button id="kafkaListen" class="btn btn-secondary" type="button">Start listening</button><button id="kafkaStop" class="btn btn-secondary" type="button" disabled>Stop</button></div></div>
      <p id="kafkaListenStatus" role="status" aria-live="polite">Stopped</p><div id="kafkaMessages" class="kafka-messages"><p class="kafka-empty">Received messages appear here, up to the latest 100.</p></div>
    </section>
  </div>`;
