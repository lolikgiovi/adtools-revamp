import { AboutTemplate } from "./template.js";
import "./styles.css";
import { tutorialContent, getSearchableItems, findContentById } from "./content.js";

/**
 * Simple markdown-to-HTML converter for tutorial content
 */
function renderMarkdown(markdown) {
  if (!markdown) return "";

  let html = markdown.trim();

  // Escape HTML first (but preserve intentional HTML entities)
  html = html
    .replace(/&(?!amp;|lt;|gt;|quot;|#)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Code blocks (fenced)
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang || "text"}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote><p>$1</p></blockquote>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match, content) => {
    const cells = content.split("|").map((c) => c.trim());
    return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
  });
  // Wrap consecutive table rows in table tags
  html = html.replace(/(<tr>[\s\S]*?<\/tr>[\n\r]*)+/g, (match) => {
    // Check if first row looks like a header (contains --- pattern or is first in sequence)
    const rows = match.trim().split("</tr>").filter((r) => r.trim());
    if (rows.length > 1) {
      // Check if second row is a separator row
      const secondRow = rows[1];
      if (secondRow && secondRow.includes("---")) {
        // Remove separator row and make first row a header
        const headerRow = rows[0].replace(/<td>/g, "<th>").replace(/<\/td>/g, "</th>") + "</tr>";
        const bodyRows = rows
          .slice(2)
          .map((r) => r.trim() + "</tr>")
          .join("\n");
        return `<table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`;
      }
    }
    return `<table><tbody>${match}</tbody></table>`;
  });

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>[\n\r]*)+/g, (match) => {
    if (!match.includes("<li>")) return match;
    return `<ul>${match}</ul>`;
  });

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Paragraphs - wrap lines that aren't already wrapped
  const lines = html.split("\n");
  const processed = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (
      trimmed.startsWith("<h") ||
      trimmed.startsWith("<ul") ||
      trimmed.startsWith("<ol") ||
      trimmed.startsWith("<li") ||
      trimmed.startsWith("<pre") ||
      trimmed.startsWith("<table") ||
      trimmed.startsWith("<thead") ||
      trimmed.startsWith("<tbody") ||
      trimmed.startsWith("<tr") ||
      trimmed.startsWith("<blockquote") ||
      trimmed.startsWith("<hr") ||
      trimmed.startsWith("</")
    ) {
      return line;
    }
    if (trimmed && !trimmed.startsWith("<")) {
      return `<p>${trimmed}</p>`;
    }
    return line;
  });

  return processed.join("\n");
}

class AboutPage {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    this.container = null;
    this.currentCategory = null;
    this.currentItem = null;
    this.searchItems = [];
    this.openDropdown = null;
  }

  mount(root) {
    if (!root) {
      console.error("AboutPage: root container not provided");
      return;
    }
    root.innerHTML = AboutTemplate;
    this.container = root.querySelector(".tutorial-page");
    this.searchItems = getSearchableItems();

    this.renderTabs();
    this.bindEvents();

    // Show first item of first category by default
    const firstCategory = tutorialContent.categories[0];
    if (firstCategory && firstCategory.items.length > 0) {
      this.showContent(firstCategory.id, firstCategory.items[0].id);
    }

    this.eventBus?.emit?.("page:changed", { page: "about" });
  }

  renderTabs() {
    const tabsContainer = this.container.querySelector(".tutorial-tabs");
    if (!tabsContainer) return;

    let tabsHtml = "";

    for (const category of tutorialContent.categories) {
      if (category.isDropdown) {
        // Dropdown tab (for Tools with many items)
        tabsHtml += `
          <div class="tutorial-tab-dropdown" data-category="${category.id}">
            <button 
              class="tutorial-tab" 
              role="tab" 
              aria-selected="false"
              aria-haspopup="true"
              aria-expanded="false"
              data-category="${category.id}"
            >
              ${category.icon || ""}
              <span>${category.name}</span>
              <svg class="tutorial-tab-dropdown-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div class="tutorial-dropdown-menu" style="display: none;">
              ${category.items
                .map(
                  (item) => `
                <button class="tutorial-dropdown-item" data-item="${item.id}" data-category="${category.id}">
                  ${item.title}
                </button>
              `
                )
                .join("")}
            </div>
          </div>
        `;
      } else {
        // Regular tab
        tabsHtml += `
          <button 
            class="tutorial-tab" 
            role="tab" 
            aria-selected="false"
            data-category="${category.id}"
          >
            ${category.icon || ""}
            <span>${category.name}</span>
          </button>
        `;
      }
    }

    tabsContainer.innerHTML = tabsHtml;
  }

  bindEvents() {
    // Tab clicks
    this.container.querySelectorAll(".tutorial-tab").forEach((tab) => {
      tab.addEventListener("click", (e) => this.handleTabClick(e));
    });

    // Dropdown item clicks
    this.container.querySelectorAll(".tutorial-dropdown-item").forEach((item) => {
      item.addEventListener("click", (e) => this.handleDropdownItemClick(e));
    });

    // Search input
    const searchInput = this.container.querySelector("#tutorial-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => this.handleSearch(e));
      searchInput.addEventListener("keydown", (e) => this.handleSearchKeydown(e));
      searchInput.addEventListener("blur", () => {
        // Delay to allow click on results
        setTimeout(() => this.closeSearchResults(), 150);
      });
    }

    // Close dropdowns on outside click
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".tutorial-tab-dropdown")) {
        this.closeAllDropdowns();
      }
      if (!e.target.closest(".tutorial-search-wrapper")) {
        this.closeSearchResults();
      }
    });
  }

  handleTabClick(e) {
    const tab = e.currentTarget;
    const categoryId = tab.dataset.category;
    const category = tutorialContent.categories.find((c) => c.id === categoryId);

    if (!category) return;

    if (category.isDropdown) {
      // Toggle dropdown
      const dropdown = tab.closest(".tutorial-tab-dropdown");
      const menu = dropdown.querySelector(".tutorial-dropdown-menu");
      const isOpen = menu.style.display !== "none";

      this.closeAllDropdowns();

      if (!isOpen) {
        menu.style.display = "block";
        dropdown.classList.add("open");
        tab.setAttribute("aria-expanded", "true");
        this.openDropdown = dropdown;
      }
    } else {
      // Show first item of this category
      this.closeAllDropdowns();
      if (category.items.length > 0) {
        this.showContent(categoryId, category.items[0].id);
      }
    }
  }

  handleDropdownItemClick(e) {
    e.stopPropagation();
    const item = e.currentTarget;
    const categoryId = item.dataset.category;
    const itemId = item.dataset.item;

    this.closeAllDropdowns();
    this.showContent(categoryId, itemId);
  }

  closeAllDropdowns() {
    this.container.querySelectorAll(".tutorial-tab-dropdown").forEach((dropdown) => {
      const menu = dropdown.querySelector(".tutorial-dropdown-menu");
      const tab = dropdown.querySelector(".tutorial-tab");
      menu.style.display = "none";
      dropdown.classList.remove("open");
      tab.setAttribute("aria-expanded", "false");
    });
    this.openDropdown = null;
  }

  showContent(categoryId, itemId) {
    this.currentCategory = categoryId;
    this.currentItem = itemId;

    const result = findContentById(itemId);
    if (!result) return;

    const { category, item } = result;

    // Update tab active states
    this.container.querySelectorAll(".tutorial-tab").forEach((tab) => {
      const isActive = tab.dataset.category === categoryId;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    // Update dropdown item active states
    this.container.querySelectorAll(".tutorial-dropdown-item").forEach((di) => {
      di.classList.toggle("active", di.dataset.item === itemId);
    });

    // Render content
    const contentArea = this.container.querySelector(".tutorial-content");
    if (!contentArea) return;

    // Build sub-navigation for items in this category
    let subNavHtml = "";
    if (category.items.length > 1) {
      subNavHtml = `
        <nav class="tutorial-items-nav" aria-label="Section navigation">
          ${category.items
            .map(
              (i) => `
            <button 
              class="tutorial-item-btn ${i.id === itemId ? "active" : ""}" 
              data-item="${i.id}" 
              data-category="${categoryId}"
            >
              ${i.title}
            </button>
          `
            )
            .join("")}
        </nav>
      `;
    }

    const renderedContent = renderMarkdown(item.content);

    contentArea.innerHTML = `
      ${subNavHtml}
      <article class="tutorial-article">
        ${renderedContent}
      </article>
    `;

    // Bind sub-nav clicks
    contentArea.querySelectorAll(".tutorial-item-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.showContent(btn.dataset.category, btn.dataset.item);
      });
    });

    // Scroll to top
    contentArea.scrollTop = 0;
  }

  handleSearch(e) {
    const query = e.target.value.trim().toLowerCase();
    const resultsContainer = this.container.querySelector("#tutorial-search-results");

    if (!query) {
      this.closeSearchResults();
      return;
    }

    // Filter items
    const matches = this.searchItems.filter((item) => {
      const titleMatch = item.title.toLowerCase().includes(query);
      const contentMatch = item.content.toLowerCase().includes(query);
      const categoryMatch = item.categoryName.toLowerCase().includes(query);
      return titleMatch || contentMatch || categoryMatch;
    });

    if (matches.length === 0) {
      resultsContainer.innerHTML = `<div class="tutorial-search-empty">No results found</div>`;
    } else {
      resultsContainer.innerHTML = matches
        .slice(0, 8)
        .map(
          (item, index) => `
        <div 
          class="tutorial-search-item ${index === 0 ? "active" : ""}" 
          data-item="${item.id}" 
          data-category="${item.categoryId}"
          data-index="${index}"
        >
          <span class="tutorial-search-item-title">${item.title}</span>
          <span class="tutorial-search-item-category">${item.categoryName}</span>
        </div>
      `
        )
        .join("");

      // Bind click handlers
      resultsContainer.querySelectorAll(".tutorial-search-item").forEach((el) => {
        el.addEventListener("click", () => {
          this.showContent(el.dataset.category, el.dataset.item);
          this.closeSearchResults();
          this.container.querySelector("#tutorial-search").value = "";
        });
      });
    }

    resultsContainer.style.display = "block";
    this.searchActiveIndex = 0;
  }

  handleSearchKeydown(e) {
    const resultsContainer = this.container.querySelector("#tutorial-search-results");
    if (resultsContainer.style.display === "none") return;

    const items = resultsContainer.querySelectorAll(".tutorial-search-item");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.searchActiveIndex = Math.min(this.searchActiveIndex + 1, items.length - 1);
      this.updateSearchActiveItem(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.searchActiveIndex = Math.max(this.searchActiveIndex - 1, 0);
      this.updateSearchActiveItem(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const activeItem = items[this.searchActiveIndex];
      if (activeItem) {
        this.showContent(activeItem.dataset.category, activeItem.dataset.item);
        this.closeSearchResults();
        this.container.querySelector("#tutorial-search").value = "";
      }
    } else if (e.key === "Escape") {
      this.closeSearchResults();
    }
  }

  updateSearchActiveItem(items) {
    items.forEach((item, index) => {
      item.classList.toggle("active", index === this.searchActiveIndex);
    });
  }

  closeSearchResults() {
    const resultsContainer = this.container.querySelector("#tutorial-search-results");
    if (resultsContainer) {
      resultsContainer.style.display = "none";
    }
  }

  deactivate() {
    this.closeAllDropdowns();
    this.closeSearchResults();
  }
}

export { AboutPage };