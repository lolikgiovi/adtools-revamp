// Browser fixture exercises the real controller/rendering/persistence with a synthetic service.
// It is not an Oracle bridge and is not part of the production entry graph.
import { MonitoringQuery } from "../main.js";
import fixture from "./fixture.json";
globalThis.__TAURI_INTERNALS__ = {}; // Test-only runtime gate; no invoke implementation.
let remote = structuredClone(fixture);
const tool = new MonitoringQuery();
tool.connections = [{ name: "Synthetic LOCAL", connect_string: "test-only" }];
tool.service = {
  async load() {
    return structuredClone(remote);
  },
  async apply(_connection, request) {
    for (const operation of request.operations) {
      const pk = remote.metadata.tables.find((table) => table.name === operation.table).primaryKey;
      remote.tables[operation.table] = remote.tables[operation.table].filter((row) => row[pk] !== operation.desired[pk]);
      remote.tables[operation.table].push(structuredClone(operation.desired));
    }
    return { state: "Committed", changeId: request.changeId };
  },
  async verify() {
    return { state: "Verified", message: "Synthetic expected values verified (fixture only)." };
  },
  async history() {
    return { transactions: [], complete: true };
  },
};
tool.mount(document.querySelector("#root"));
document.querySelector("#theme").addEventListener("click", () => document.documentElement.classList.toggle("dark"));
document.querySelector("#remote").addEventListener("click", () => {
  remote.tables.DSH_MENU[0].MENU_LABEL = "Remote synthetic edit";
  document.querySelector("#remote").textContent = "Remote Edit Staged";
});
const events = document.createElement('output');
events.id = 'fixture-events'; document.body.appendChild(events);
const originalAction = tool.action.bind(tool);
tool.action = async (...args) => {
  events.textContent = `Action ${args[0]} · state ${tool.state} · frozen ${tool.frozen}`;
  try { const result = await originalAction(...args); events.textContent += ` → ${tool.state}`; return result; }
  catch(error) { events.textContent += ` → ${error.message}`; throw error; }
};
