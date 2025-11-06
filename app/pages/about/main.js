import { AboutTemplate } from "./template.js";
import "./styles.css";

class AboutPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.container = null;
  }

  mount(root) {
    if (!root) {
      console.error("AboutPage: root container not provided");
      return;
    }
    root.innerHTML = AboutTemplate;
    this.container = root.querySelector(".about-page");
    this.eventBus?.emit?.("page:changed", { page: "about" });
  }

  deactivate() {}
}

export { AboutPage };