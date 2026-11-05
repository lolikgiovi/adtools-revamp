import { getSearchInteractionKey } from "../core/RecentInteractionStore.js";
import { recentDiagrams } from "../tools/plantuml/recent.js";
import "../styles/home-workspace.css";

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const TOOL_ACTIONS = {
  "master-lockey": "Find and copy localization keys",
  "sql-in-clause": "Turn a list into an SQL IN clause",
  "compress-image": "Shrink images before uploading",
  "json-tools": "Format and validate JSON",
  "uuid-generator": "Generate unique IDs",
  "base64-tools": "Encode or decode Base64",
  "char-counter": "Check text length and byte size",
  "qr-tools": "Generate a QR code or inspect TLV data",
  "quick-query": "Build SQL from a saved schema",
  querify: "Generate SQL from an Excel file",
  "lockey-update": "Prepare localization update SQL",
  "redis-cache": "Find and manage Redis cache keys",
  kafka: "Publish a message or listen to a topic",
  "compare-config": "Compare database configurations",
  "run-query": "Run a query through Jenkins",
  "run-batch": "Trigger a Jenkins batch job",
  "html-template": "Edit and preview an HTML template",
  "splunk-template": "Format a Splunk template",
  "velocity-template": "Preview a Velocity template with JSON",
  plantuml: "Write diagrams with a local live preview",
  "merge-sql": "Combine SQL files into one script",
  "check-image": "Check image IDs across environments",
};

const TABLE_KEY_PREFIX = "quick-query-table:";
const RECENT_TABLE_LIMIT = 4;

/** Home destinations share the sidebar's visibility rules and the command palette's recency store. */
export class HomeWorkspace {
  constructor(container, { tools, pinnedIds, recentStore, getIcon, onOpen, onOpenTable, onOpenDiagram, onSearch, usageScope, peerScope }) {
    this.container = container;
    this.options = { tools, pinnedIds, recentStore, getIcon, onOpen, onOpenTable, onOpenDiagram, onSearch, usageScope, peerScope };
    container.addEventListener("click", (event) => {
      const target = event.target.closest("[data-home-tool]");
      const table = event.target.closest("[data-home-table]");
      const diagram = event.target.closest("[data-home-diagram]");
      if (diagram) {
        this.options.onOpenDiagram?.(diagram.dataset.homeDiagram);
      } else if (table) {
        this.options.onOpenTable?.(table.dataset.homeTable);
      } else if (target && this.options.tools.some((tool) => tool.id === target.dataset.homeTool)) {
        this.options.onOpen(target.dataset.homeTool);
      } else if (event.target.closest("[data-home-search]")) {
        this.options.onSearch();
      }
    });
    this.render();
  }

  render() {
    const { tools, pinnedIds, recentStore, getIcon } = this.options;
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    const pinned = [...pinnedIds].map((id) => byId.get(id)).filter(Boolean);
    const recency = recentStore?.getRecencyMap() || new Map();
    const recent = tools
      .filter((tool) => recency.has(getSearchInteractionKey({ type: "tool", route: tool.id })))
      .sort((a, b) => recency.get(`tool:${a.id}`).order - recency.get(`tool:${b.id}`).order)
      .slice(0, 4);
    const row = (tool, showTime = false) => {
      const timestamp = recency.get(`tool:${tool.id}`)?.lastInteractedAt;
      const time = timestamp ? new Date(timestamp) : null;
      const validTime = time && Number.isFinite(time.getTime());
      const dateLabel = validTime
        ? time.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "";
      return `<button class="home-tool" type="button" data-home-tool="${escapeHtml(tool.id)}">
        <span class="home-tool-icon" aria-hidden="true">${getIcon(tool.icon)}</span>
        <span class="home-tool-name">${escapeHtml(tool.name)}</span>
        ${showTime && validTime ? `<time datetime="${time.toISOString()}">${escapeHtml(dateLabel)}</time>` : ""}
      </button>`;
    };
    this.container.innerHTML = `
      <section class="home-recent" aria-labelledby="home-recent-title">
        <div class="home-workspace-heading">
          <h2 id="home-recent-title">Recent tools</h2>
          <button type="button" class="home-text-button" data-home-search>All tools <kbd>⌘K</kbd></button>
        </div>
        <div class="home-tool-list">
          ${recent.length ? recent.map((tool) => row(tool, true)).join("") : '<p class="home-empty">No recent tools yet.</p>'}
        </div>
      </section>
      ${this.renderRecentTables(recentStore, byId, getIcon)}
      <section class="home-recent-diagrams" aria-labelledby="home-recent-diagrams-title" hidden>
        <h2 id="home-recent-diagrams-title">Recent sequence diagrams</h2>
        <div class="home-tool-list"></div>
      </section>
      ${
        pinned.length
          ? `<section class="home-pinned" aria-labelledby="home-pinned-title">
        <h2 id="home-pinned-title">Pinned</h2>
        <div class="home-tool-list">${pinned.map((tool) => row(tool)).join("")}</div>
      </section>`
          : ""
      }
      <section class="home-start" aria-labelledby="home-start-title">
        <h2 id="home-start-title">Get started</h2>
        <div class="home-tip-list"></div>
      </section>`;
    this.renderRecommendations();
    void this.renderRecentDiagrams();
  }

  async renderRecentDiagrams() {
    const { tools, recentStore, getIcon, onOpenDiagram } = this.options;
    const tool = tools.find((tool) => tool.id === "plantuml");
    const section = this.container.querySelector(".home-recent-diagrams");
    if (!tool || !onOpenDiagram || !section) return;
    try {
      const files = await recentDiagrams(recentStore);
      if (!this.container.contains(section)) return;
      section.querySelector(".home-tool-list").innerHTML = files
        .map(
          (file) => `
        <button class="home-tool" type="button" data-home-diagram="${escapeHtml(file.id)}" title="${escapeHtml(file.path)}">
          <span class="home-tool-icon" aria-hidden="true">${getIcon(tool.icon)}</span>
          <span class="home-tool-name">${escapeHtml(file.name)}</span>
        </button>`,
        )
        .join("");
      section.hidden = !files.length;
    } catch {
      // Home remains usable when the local diagram database is unavailable.
      section.hidden = true;
    }
  }

  /** Quick Query tables the user opened or generated SQL for most recently. */
  renderRecentTables(recentStore, byId, getIcon) {
    const quickQuery = byId.get("quick-query");
    if (!quickQuery || !this.options.onOpenTable) return "";
    const tables = (recentStore?.getEntries?.() || [])
      .filter((entry) => entry.key.startsWith(TABLE_KEY_PREFIX))
      .slice(0, RECENT_TABLE_LIMIT)
      .map((entry) => entry.key.slice(TABLE_KEY_PREFIX.length));
    if (!tables.length) return "";
    const icon = getIcon(quickQuery.icon);
    return `<section class="home-recent-tables" aria-labelledby="home-recent-tables-title">
        <h2 id="home-recent-tables-title">Recent tables</h2>
        <div class="home-tool-list">${tables
          .map((table) => {
            const [schema, name = table] = table.split(".");
            return `<button class="home-tool home-table" type="button" data-home-table="${escapeHtml(table)}" title="${escapeHtml(table)}">
            <span class="home-tool-icon" aria-hidden="true">${icon}</span>
            <span class="home-table-copy"><span class="home-tool-name">${escapeHtml(name)}</span><small>${escapeHtml(schema)}</small></span>
          </button>`;
          })
          .join("")}</div>
      </section>`;
  }

  updateUsage(usageScope, peerScope = this.options.peerScope) {
    this.options.usageScope = usageScope;
    this.options.peerScope = peerScope;
    this.renderRecommendations();
  }

  renderRecommendations() {
    const list = this.container.querySelector(".home-tip-list");
    if (!list) return;
    const { tools, usageScope, peerScope, recentStore, getIcon } = this.options;
    const counts = new Map((usageScope?.tools || []).map((tool) => [tool.id, tool.count]));
    const peerCounts = new Map((peerScope?.tools || []).map((tool) => [tool.id, tool.count]));
    const recency = recentStore?.getRecencyMap() || new Map();
    const lastUsed = (tool) => recency.get(getSearchInteractionKey({ type: "tool", route: tool.id }))?.lastInteractedAt || 0;
    // Suggest what the team relies on that this user has not tried; without team data, the user's least-used tools.
    const untried = tools.filter((tool) => !counts.get(tool.id));
    const tips = [...(peerCounts.size && untried.length ? untried : tools)]
      .sort(
        (a, b) =>
          (peerCounts.get(b.id) || 0) - (peerCounts.get(a.id) || 0) ||
          (counts.get(a.id) || 0) - (counts.get(b.id) || 0) ||
          lastUsed(a) - lastUsed(b),
      )
      .slice(0, 3);
    list.innerHTML = tips
      .map(
        (tool) => `<button class="home-tool home-tip" type="button" data-home-tool="${escapeHtml(tool.id)}">
      <span class="home-tool-icon" aria-hidden="true">${getIcon(tool.icon)}</span>
      <span class="home-tip-copy">
        <span>${escapeHtml(TOOL_ACTIONS[tool.id] || tool.description || `Explore ${tool.name}`)}</span>
        <small>${escapeHtml(tool.name)}</small>
      </span>
    </button>`,
      )
      .join("");
  }
}
