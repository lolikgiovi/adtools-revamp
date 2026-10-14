export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export const button = (action, label, disabled = false, className = "") =>
  `<button type="button" data-action="${action}" class="mq-button ${className}" ${disabled ? "disabled" : ""}>${label}</button>`;
export function shell(connections, desktop) {
  return `<section class="mq-tool" aria-label="Monitoring Config">
    <div class="mq-toolbar">
      <label class="mq-connection">Connection<select id="mq-connection" aria-label="Oracle connection" ${!desktop ? "disabled" : ""}>
        <option value="">Select a connection…</option>${connections.map((item, i) => `<option value="${i}">${escapeHtml(item.name)}</option>`).join("")}
      </select></label>
      <span class="mq-schema" translate="no">MONITORING</span>
      ${button("load", "Load", !desktop)}
      <span class="mq-toolbar-spacer"></span>
      <a href="#settings" class="mq-settings">Connections in Settings</a>
    </div>
    <div class="mq-status" role="status" aria-live="polite">${desktop ? "Select an Oracle connection to inspect monitoring configuration." : "Oracle loading requires AD Tools Desktop. Open this tool in the desktop app."}</div>
    <div class="mq-workspace">
      <aside class="mq-nav" aria-label="Monitoring menus">
        <div class="mq-nav-heading"><strong>Menus</strong>${button("add-menu", "Add", true)}</div>
        <label class="mq-search"><span class="mq-sr-only">Search menus</span><input id="mq-search" name="menu-search" type="search" placeholder="Search menus or channels…" autocomplete="off"></label>
        <div class="mq-menu-list"></div>
        <div class="mq-nav-footer">${button("health", "Configuration Health", true)}</div>
      </aside>
      <main class="mq-content" id="mq-content"><div class="mq-empty">
        <h2>Your monitoring workspace</h2><p>Load a connection to browse menus, summary queries, detail queries and their field mappings.</p>
        <p>Changes stay in a local draft until you review and choose Update Oracle.</p>
      </div></main>
    </div>
    <footer class="mq-footer"><span class="mq-draft-status">No local draft</span><span class="mq-toolbar-spacer"></span>
      ${button("discard", "Discard Draft", true)}${button("history", "History", true)}${button("review", 'Review Changes <span class="mq-change-count">0</span>', true, "mq-primary")}
    </footer>
  </section>`;
}
