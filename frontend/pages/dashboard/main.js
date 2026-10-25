import { AnalyticsDashboardPage } from "../analytics-dashboard/main.js";
import { ApprovalPage } from "../approval/main.js";
import { SettingsPublisher } from "./publishing.js";
import "./styles.css";
import "./publishing.css";

const SECTIONS = [
  ["analytics", "Analytics"],
  ["approvals", "Approvals"],
  ["publish-settings", "Publish Settings"],
];

export class DashboardPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.child = null;
  }

  mount(root, data = null) {
    const section = SECTIONS.some(([id]) => id === data?.section) ? data.section : "analytics";
    root.innerHTML = `<section class="dashboard-page">
      <nav class="dashboard-navigation" aria-label="Dashboard">
        ${SECTIONS.map(([id, label]) => `<a href="#dashboard/${id}"${id === section ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
      <div class="dashboard-section${section === "publish-settings" ? " settings-publishing" : ""}"></div>
    </section>`;
    const content = root.querySelector(".dashboard-section");
    this.child =
      section === "analytics"
        ? new AnalyticsDashboardPage({ eventBus: this.eventBus })
        : section === "approvals"
          ? new ApprovalPage()
          : new SettingsPublisher();
    this.child.mount(content);
    const actions = content.querySelector("[data-dashboard-session-actions]");
    if (actions) root.querySelector(".dashboard-navigation").append(actions);
  }

  unmount() {
    this.child?.unmount?.();
    this.child?.destroy?.();
    this.child = null;
  }
}
