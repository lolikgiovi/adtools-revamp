import { getSearchInteractionKey } from "../core/RecentInteractionStore.js";
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
  "merge-sql": "Combine SQL files into one script",
  "check-image": "Check image IDs across environments",
};

/** Home destinations share the sidebar's visibility rules and the command palette's recency store. */
export class HomeWorkspace {
  constructor(container, { tools, pinnedIds, recentStore, getIcon, onOpen, onSearch, usageScope }) {
    this.container = container;
    this.options = { tools, pinnedIds, recentStore, getIcon, onOpen, onSearch, usageScope };
    container.addEventListener("click", (event) => {
      const target = event.target.closest("[data-home-tool]");
      if (target && this.options.tools.some((tool) => tool.id === target.dataset.homeTool)) {
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
  }

  updateUsage(usageScope) {
    this.options.usageScope = usageScope;
    this.renderRecommendations();
  }

  renderRecommendations() {
    const list = this.container.querySelector(".home-tip-list");
    if (!list) return;
    const { tools, usageScope, recentStore, getIcon } = this.options;
    const counts = new Map((usageScope?.tools || []).map((tool) => [tool.id, tool.count]));
    const recency = recentStore?.getRecencyMap() || new Map();
    const lastUsed = (tool) => recency.get(getSearchInteractionKey({ type: "tool", route: tool.id }))?.lastInteractedAt || 0;
    const tips = [...tools].sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0) || lastUsed(a) - lastUsed(b)).slice(0, 3);
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
