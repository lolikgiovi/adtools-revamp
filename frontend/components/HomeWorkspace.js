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

/** Home destinations share the sidebar's visibility rules and the command palette's recency store. */
export class HomeWorkspace {
  constructor(container, { tools, pinnedIds, recentStore, getIcon, onOpen, onSearch }) {
    this.container = container;
    this.options = { tools, pinnedIds, recentStore, getIcon, onOpen, onSearch };
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
      <div class="home-workspace-heading">
        <h2 id="home-tools-title">Your tools</h2>
        <button type="button" class="home-text-button" data-home-search>All tools <kbd>⌘K</kbd></button>
      </div>
      <div class="home-destinations" aria-labelledby="home-tools-title">
        <section class="${pinned.length ? "home-pinned" : "home-start"}" aria-labelledby="home-pinned-title">
          <h3 id="home-pinned-title">${pinned.length ? "Pinned" : "Get started"}</h3>
          <div class="home-tool-list">${(pinned.length ? pinned : tools.slice(0, 6)).map((tool) => row(tool)).join("")}</div>
        </section>
        ${
          recent.length
            ? `<section class="home-recent" aria-labelledby="home-recent-title">
          <h3 id="home-recent-title">Recent tools</h3>
          <div class="home-tool-list">${recent.map((tool) => row(tool, true)).join("")}</div>
        </section>`
            : ""
        }
      </div>`;
  }
}
