import appPackage from "../../../package.json";
import { buildToolDefinitions } from "../../config/toolDefinitions.js";
import toolsConfig from "../../config/tools.json";
import { toolGuides } from "./content.js";
import { AboutTemplate } from "./template.js";
import "./styles.css";

const APP_VERSION = String(appPackage?.version || "1.3.5");
const MACOS_INSTALL_COMMAND = 'curl -fsSL "https://adtools.lolik.workers.dev/install.sh?q=0" | bash';
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
    this.copyInstallButton = null;
    this.copyInstallResetTimer = null;
    this.handleCopyInstallCommand = this.handleCopyInstallCommand.bind(this);
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

    this.copyInstallButton = this.container.querySelector("#about-copy-install-command");
    this.copyInstallButton?.addEventListener("click", this.handleCopyInstallCommand);

    this.eventBus?.emit?.("page:changed", { page: "about" });
  }

  renderPage() {
    const catalog = getToolCatalog();
    const desktopOnlyCount = catalog.filter((tool) => tool.requiresTauri).length;
    const webCount = catalog.length - desktopOnlyCount;

    return `
      <article class="about-document">
        <section class="about-install" aria-labelledby="about-install-title">
          <div class="about-install-copy">
            <span class="about-install-eyebrow">AD Tools Desktop · macOS</span>
            <h1 id="about-install-title">Install the desktop app</h1>
            <p>Open Terminal, run the command below, and follow the on-screen prompts to complete the installation.</p>
          </div>
          <ol class="about-install-steps" aria-label="macOS installation steps">
            <li><span>1</span>Open Terminal on your Mac.</li>
            <li><span>2</span>Copy and run the install command.</li>
            <li><span>3</span>Follow the prompts in Terminal.</li>
          </ol>
          <div class="about-install-command">
            <code>${escapeHtml(MACOS_INSTALL_COMMAND)}</code>
            <button id="about-copy-install-command" type="button" aria-label="Copy macOS install command">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            </button>
          </div>
        </section>

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

  async handleCopyInstallCommand() {
    if (!this.copyInstallButton) return;

    const label = this.copyInstallButton.querySelector("span");

    try {
      await navigator.clipboard.writeText(MACOS_INSTALL_COMMAND);
      if (label) label.textContent = "Copied";
      this.eventBus?.emit?.("notification:show", {
        type: "success",
        message: "Install command copied to clipboard",
      });
    } catch (error) {
      console.error("Failed to copy macOS install command:", error);
      if (label) label.textContent = "Copy failed";
      this.eventBus?.emit?.("notification:show", {
        type: "error",
        message: "Unable to copy the install command",
      });
    }

    clearTimeout(this.copyInstallResetTimer);
    this.copyInstallResetTimer = setTimeout(() => {
      if (label) label.textContent = "Copy";
      this.copyInstallResetTimer = null;
    }, 2000);
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
    this.copyInstallButton?.removeEventListener("click", this.handleCopyInstallCommand);
    clearTimeout(this.copyInstallResetTimer);
    this.copyInstallButton = null;
    this.copyInstallResetTimer = null;
    this.root?.classList.remove("main-content-flush");
    this.root = null;
    this.container = null;
  }
}

export { AboutPage };
