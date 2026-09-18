export const KafkaTemplate = /*html*/ `
  <div class="kafka-tool">
      <section class="kafka-connection" aria-labelledby="kafkaConnectionHeading">
      <div class="kafka-section-title"><div><h2 id="kafkaConnectionHeading">Broker</h2><p>Shared by publisher and listener. Connection details stay on this device.</p></div><button id="kafkaTest" class="btn btn-secondary" type="button">Test connection</button></div>
      <label for="kafkaBrokers">Bootstrap servers</label>
      <input id="kafkaBrokers" type="text" placeholder="broker-1:9092,broker-2:9092" autocomplete="off" spellcheck="false" />
      <p class="kafka-hint">PLAINTEXT connection, matching your example. Do not enter passwords here.</p>
      <p id="kafkaConnectionStatus" role="status" aria-live="polite"></p>
    </section>
    <div class="kafka-layout">
      <section class="kafka-compose" aria-labelledby="kafkaComposeHeading">
        <div class="kafka-section-title"><div><h2 id="kafkaComposeHeading">Publish</h2><p>One click sends the displayed count once. Bulk is capped at 100, sent sequentially, with three seconds between publish actions.</p></div></div>
        <form id="kafkaForm">
          <div class="kafka-fields">
            <div class="kafka-topic-field">
              <label for="kafkaTopic">Topic</label>
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
            <label for="kafkaKey">Key <span>(optional)</span><input id="kafkaKey" type="text" autocomplete="off" placeholder="Message key" /></label>
          </div>
          <label for="kafkaHeaders">Headers <span>(optional JSON object)</span><input id="kafkaHeaders" type="text" value="{}" spellcheck="false" /></label>
          <div class="kafka-value-heading"><label for="kafkaValue">Value <span>(JSON)</span></label><label class="kafka-bulk-toggle"><input id="kafkaBulk" type="checkbox" /> Bulk array</label></div>
          <textarea id="kafkaValue" rows="11" spellcheck="false" placeholder='{"example":"value"}' required></textarea>
          <p id="kafkaCount" class="kafka-hint">1 message per click</p>
          <div class="kafka-actions"><button id="kafkaPublish" class="btn btn-primary" type="submit">Publish 1 message</button><input id="kafkaRequestName" type="text" maxlength="80" aria-label="Saved request name" placeholder="Request name" /><button id="kafkaSave" class="btn btn-secondary" type="button">Save request</button></div>
          <p id="kafkaPublishStatus" role="status" aria-live="polite"></p>
          <div id="kafkaDeliveries" class="kafka-deliveries" aria-live="polite"></div>
        </form>
      </section>
      <aside class="kafka-saved" aria-labelledby="kafkaSavedHeading"><div class="kafka-section-title"><div><h2 id="kafkaSavedHeading">Saved requests</h2><p>Stored locally on this device. Review values before publishing.</p></div></div><div id="kafkaSavedList"></div></aside>
    </div>
    <section class="kafka-listener" aria-labelledby="kafkaListenHeading">
      <div class="kafka-section-title"><div><h2 id="kafkaListenHeading">Listen</h2><p>Preview messages from the topic above. Listening never publishes and does not commit offsets.</p></div>
        <div class="kafka-listen-actions"><label><input id="kafkaFromBeginning" type="checkbox" /> From beginning</label><button id="kafkaListen" class="btn btn-secondary" type="button">Start listening</button><button id="kafkaStop" class="btn btn-secondary" type="button" disabled>Stop</button></div></div>
      <p id="kafkaListenStatus" role="status" aria-live="polite">Stopped</p><div id="kafkaMessages" class="kafka-messages"><p class="kafka-empty">Received messages appear here, up to the latest 100.</p></div>
    </section>
  </div>`;
