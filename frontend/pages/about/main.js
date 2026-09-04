import appPackage from "../../../package.json";
import { buildToolDefinitions } from "../../config/toolDefinitions.js";
import toolsConfig from "../../config/tools.json";
import { toolGuides } from "./content.js";
import { AboutTemplate } from "./template.js";
import "./styles.css";

const APP_VERSION = String(appPackage?.version || "1.3.5");
const TOOL_DEFINITIONS = buildToolDefinitions(toolsConfig?.tools || []);
const TOOL_GROUPS = [
  { id: "config", label: "Configuration & SQL" },
  { id: "general", label: "Data & utilities" },
  { id: "jenkins", label: "Jenkins automation" },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getToolCatalog() {
  return (toolsConfig?.tools || [])
    .map((config) => {
      const definition = TOOL_DEFINITIONS.get(config.id);
      return {
        id: String(config.id),
        name: String(config.name || definition?.name || config.id),
        category: String(config.category || "general"),
        description: String(definition?.description || "Utility for everyday application work."),
        requiresTauri: Boolean(config.requiresTauri),
        order: Number(config.order) || 0,
      };
    })
    .sort((a, b) => a.order - b.order);
}

class AboutPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.container = null;
    this.root = null;
  }

  mount(root) {
    if (!root) {
      console.error("AboutPage: root container not provided");
      return;
    }

    root.innerHTML = AboutTemplate;
    root.classList.add("main-content-flush");
    this.root = root;
    this.container = root.querySelector(".about-page");

    const year = this.container.querySelector("#about-year");
    const version = this.container.querySelector("#about-footer-version");
    if (year) year.textContent = String(new Date().getFullYear());
    if (version) version.textContent = `v${APP_VERSION}`;

    const content = this.container.querySelector(".about-content");
    if (content) content.innerHTML = this.renderPage();

    this.eventBus?.emit?.("page:changed", { page: "about" });
  }

  renderPage() {
    const catalog = getToolCatalog();
    const desktopOnlyCount = catalog.filter((tool) => tool.requiresTauri).length;
    const webCount = catalog.length - desktopOnlyCount;

    return `
      <article class="about-document">
        <section class="about-guides" aria-labelledby="about-guides-title">
          <div class="about-section-heading">
            <h1 id="about-guides-title">Tool guide</h1>
            <p>v${escapeHtml(APP_VERSION)} · ${catalog.length} tools · ${webCount} on Web · ${desktopOnlyCount} Desktop-only</p>
          </div>
          <div class="about-guide-groups">
            ${TOOL_GROUPS.map((group) => this.renderToolGroup(group, catalog)).join("")}
          </div>
        </section>
      </article>
    `;
  }

  renderToolGroup(group, catalog) {
    const tools = catalog.filter((tool) => tool.category === group.id);
    if (!tools.length) return "";

    return `
      <section class="about-guide-group" aria-labelledby="about-group-${escapeHtml(group.id)}">
        <div class="about-group-heading">
          <h3 id="about-group-${escapeHtml(group.id)}">${escapeHtml(group.label)}</h3>
          <span>${tools.length} ${tools.length === 1 ? "tool" : "tools"}</span>
        </div>
        <div class="about-guide-grid">
          ${tools.map((tool, index) => this.renderToolGuide(tool, index)).join("")}
        </div>
      </section>
    `;
  }

  renderToolGuide(tool, index) {
    const guide = toolGuides[tool.id] || {
      summary: tool.description,
      howToUse: ["Open the tool, enter the required input, and follow the controls to generate the result."],
      notes: "See the tool interface for available options.",
    };
    const availability = tool.requiresTauri ? "Desktop only" : "Web + Desktop";

    return `
      <article class="about-guide">
        <header class="about-guide-header">
          <div class="about-guide-title">
            <span class="about-guide-index">${String(index + 1).padStart(2, "0")}</span>
            <div>
              <h4>${escapeHtml(tool.name)}</h4>
              <p>${escapeHtml(guide.summary || tool.description)}</p>
            </div>
          </div>
          <span class="about-badge${tool.requiresTauri ? " about-badge-muted" : ""}">${escapeHtml(availability)}</span>
        </header>
        <div class="about-guide-body">
          <div>
            <h5>How to use</h5>
            <ol>
              ${guide.howToUse.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
            </ol>
          </div>
          <p class="about-guide-note"><strong>Note:</strong> ${escapeHtml(guide.notes)}</p>
        </div>
      </article>
    `;
  }

  deactivate() {}

  unmount() {
    this.root?.classList.remove("main-content-flush");
    this.root = null;
    this.container = null;
  }
}

export { AboutPage };
