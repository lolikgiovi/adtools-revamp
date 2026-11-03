const SECTION_KEY = "settings.ui.project-section";

export function mountProjectNavigation(page, category) {
  const root = document.createElement("section");
  root.className = "settings-category settings-project";
  root.setAttribute("aria-expanded", "true");
  root.innerHTML = `<h3 class="settings-category-heading"><span class="settings-category-header">Project</span></h3>
    <div class="settings-category-content" id="settings-category-project-settings"></div>`;
  const content = root.querySelector(".settings-category-content");
  const manager = category.items.find((item) => item.type === "project-manager");
  content.append(page.renderItem(manager));
  const navigation = document.createElement("nav");
  navigation.className = "project-settings-nav";
  navigation.setAttribute("aria-label", "Project settings");
  content.append(navigation);
  const sections = [
    ...category.items
      .filter((item) => item !== manager)
      .map((item) => ({
        id: item.type === "project-schema" ? "schemas" : "jira-project",
        label: item.type === "project-schema" ? "Quick Query schemas" : "Jira",
        items: [item],
      })),
    ...(category.categories || []).filter((section) => page.service.shouldShowCategory(section)),
  ];
  const entries = sections.map((section) => {
    const panel = page.renderCategory(section, 4);
    panel.classList.add("project-settings-panel");
    panel.querySelector(".project-section-heading")?.remove();
    panel.dataset.projectSection = section.id;
    panel.setAttribute("aria-expanded", "true");
    const heading = panel.querySelector(".settings-category-heading");
    const oldHeader = heading.querySelector(".settings-category-header");
    const title = document.createElement("span");
    title.className = "settings-category-header";
    title.textContent = section.label;
    oldHeader.replaceWith(title);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.label;
    button.dataset.projectSection = section.id;
    button.setAttribute("aria-controls", panel.querySelector(".settings-category-content").id);
    navigation.append(button);
    content.append(panel);
    return { button, panel, id: section.id };
  });
  let selected = localStorage.getItem(SECTION_KEY) || "environments";
  const select = (id, persist = true) => {
    const entry = entries.find((entry) => entry.id === id && !entry.panel.hidden);
    if (!entry) return;
    selected = id;
    if (persist) localStorage.setItem(SECTION_KEY, id);
    for (const current of entries) {
      current.panel.dataset.active = String(current === entry);
      if (current === entry) current.button.setAttribute("aria-current", "page");
      else current.button.removeAttribute("aria-current");
    }
  };
  for (const entry of entries) entry.button.addEventListener("click", () => select(entry.id));
  root.addEventListener("settings:reveal", (event) => select(event.detail));
  const sync = () => {
    for (const entry of entries) entry.button.hidden = entry.panel.hidden;
    select(
      entries.find((entry) => entry.id === selected && !entry.panel.hidden)?.id || entries.find((entry) => !entry.panel.hidden)?.id,
      false,
    );
  };
  sync();
  return { element: root, sync };
}
