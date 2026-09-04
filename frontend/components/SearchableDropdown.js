const SELECTOR = "select:not([multiple]):not([data-searchable-dropdown-ignore])";
let instanceId = 0;
let documentObserver = null;
const instances = new Set();

function getSelectElements(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];

  const elements = [];
  if (root.nodeType === 1 && root.matches?.(SELECTOR)) elements.push(root);
  elements.push(...root.querySelectorAll(SELECTOR));
  return elements;
}

function getDescriptor(element, property) {
  let prototype = Object.getPrototypeOf(element);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (descriptor) return descriptor;
    prototype = Object.getPrototypeOf(prototype);
  }
  return null;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turns a native select into a searchable, keyboard-friendly combobox while
 * leaving the original element in the DOM as the source of truth. Existing
 * tool code can continue to read `.value`, populate options, and listen for
 * native `input`/`change` events without knowing about the visual upgrade.
 */
export class SearchableDropdown {
  constructor(select) {
    if (!select || select.tagName !== "SELECT" || select.multiple) {
      throw new Error("SearchableDropdown requires a single-select element");
    }

    this.select = select;
    this.wrapper = null;
    this.trigger = null;
    this.menu = null;
    this.searchInput = null;
    this.optionsEl = null;
    this.noResultsEl = null;
    this.filteredOptions = [];
    this.activeIndex = -1;
    this.isOpen = false;
    this.propertyPatches = [];
    this.labelAssociations = [];
    this.instanceId = ++instanceId;
    this.form = select.form || null;

    this.createElements();
    this.patchSelectProperties();
    this.bindEvents();
    this.sync();
    instances.add(this);
  }

  createElements() {
    const selectClasses = Array.from(this.select.classList);
    const sourceId = this.select.id || `ad-searchable-dropdown-${this.instanceId}`;
    const triggerId = `${sourceId}-trigger`;
    const menuId = `${sourceId}-menu`;
    const optionListId = `${sourceId}-options`;
    const searchId = `${sourceId}-search`;
    const accessibleLabel = this.getAccessibleLabel();
    const originalParent = this.select.parentNode;
    const adjacentIcon = [this.select.previousElementSibling, this.select.nextElementSibling].find((sibling) =>
      sibling?.classList?.contains("dropdown-icon"),
    );

    this.accessibleLabel = accessibleLabel;

    if (!originalParent) throw new Error("SearchableDropdown select must be attached to the DOM");

    this.wrapper = document.createElement("div");
    this.wrapper.className = "ad-searchable-dropdown";
    this.wrapper.dataset.sourceId = this.select.id || "";
    this.wrapper.dataset.searchableDropdown = "true";
    selectClasses.forEach((className) => this.wrapper.classList.add(className));

    ["width", "minWidth", "maxWidth", "height", "alignSelf"].forEach((property) => {
      if (this.select.style[property]) this.wrapper.style[property] = this.select.style[property];
    });

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.id = triggerId;
    this.trigger.className = "ad-searchable-dropdown-trigger";
    selectClasses.forEach((className) => this.trigger.classList.add(className));
    this.trigger.setAttribute("aria-haspopup", "dialog");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.setAttribute("aria-controls", menuId);
    if (accessibleLabel) this.trigger.setAttribute("aria-label", accessibleLabel);
    if (this.select.title) this.trigger.title = this.select.title;
    if (this.select.hasAttribute("aria-required")) this.trigger.setAttribute("aria-required", this.select.getAttribute("aria-required"));
    if (this.select.hasAttribute("aria-invalid")) this.trigger.setAttribute("aria-invalid", this.select.getAttribute("aria-invalid"));

    const valueEl = document.createElement("span");
    valueEl.className = "ad-searchable-dropdown-value";
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("viewBox", "0 0 24 24");
    chevron.setAttribute("fill", "none");
    chevron.setAttribute("stroke", "currentColor");
    chevron.setAttribute("stroke-width", "2");
    chevron.setAttribute("stroke-linecap", "round");
    chevron.setAttribute("stroke-linejoin", "round");
    chevron.setAttribute("aria-hidden", "true");
    chevron.classList.add("ad-searchable-dropdown-chevron");
    const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    chevronPath.setAttribute("d", "m6 9 6 6 6-6");
    chevron.appendChild(chevronPath);
    this.trigger.append(valueEl, chevron);
    this.valueEl = valueEl;

    this.menu = document.createElement("div");
    this.menu.id = menuId;
    this.menu.className = "ad-searchable-dropdown-menu";
    this.menu.setAttribute("role", "dialog");
    this.menu.setAttribute("aria-label", accessibleLabel ? `${accessibleLabel} options` : "Select an option");
    this.menu.setAttribute("aria-hidden", "true");

    const searchWrap = document.createElement("div");
    searchWrap.className = "ad-searchable-dropdown-search-wrap";
    const searchIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    searchIcon.setAttribute("viewBox", "0 0 24 24");
    searchIcon.setAttribute("fill", "none");
    searchIcon.setAttribute("stroke", "currentColor");
    searchIcon.setAttribute("stroke-width", "1.8");
    searchIcon.setAttribute("aria-hidden", "true");
    searchIcon.classList.add("ad-searchable-dropdown-search-icon");
    const searchCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    searchCircle.setAttribute("cx", "11");
    searchCircle.setAttribute("cy", "11");
    searchCircle.setAttribute("r", "6.5");
    const searchLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
    searchLine.setAttribute("d", "m16 16 4 4");
    searchIcon.append(searchCircle, searchLine);

    this.searchInput = document.createElement("input");
    this.searchInput.id = searchId;
    this.searchInput.type = "search";
    this.searchInput.className = "ad-searchable-dropdown-search";
    this.searchInput.autocomplete = "off";
    this.searchInput.setAttribute("role", "searchbox");
    this.searchInput.setAttribute("aria-controls", optionListId);
    this.searchInput.placeholder = this.select.dataset.searchPlaceholder || "Search options";
    this.searchInput.spellcheck = false;
    searchWrap.append(searchIcon, this.searchInput);

    this.optionsEl = document.createElement("div");
    this.optionsEl.id = optionListId;
    this.optionsEl.className = "ad-searchable-dropdown-options";
    this.optionsEl.setAttribute("role", "listbox");
    this.optionsEl.tabIndex = -1;

    this.noResultsEl = document.createElement("div");
    this.noResultsEl.className = "ad-searchable-dropdown-no-results";
    this.noResultsEl.setAttribute("role", "status");
    this.noResultsEl.textContent = "No matching options";

    this.menu.append(searchWrap, this.optionsEl, this.noResultsEl);

    this.select.dataset.searchableDropdownEnhanced = "true";
    this.select.classList.add("ad-searchable-dropdown-native");
    this.originalTabIndex = this.select.getAttribute("tabindex");
    this.originalAriaHidden = this.select.getAttribute("aria-hidden");
    this.select.tabIndex = -1;
    this.select.setAttribute("aria-hidden", "true");

    originalParent.insertBefore(this.wrapper, this.select);
    this.wrapper.append(this.trigger, this.select, this.menu);

    if (this.select.id) {
      Array.from(document.querySelectorAll("label[for]")).forEach((label) => {
        if (label.htmlFor !== this.select.id) return;
        this.labelAssociations.push({ label, htmlFor: label.htmlFor });
        label.htmlFor = triggerId;
      });
    }

    if (adjacentIcon && adjacentIcon !== this.trigger && !this.wrapper.contains(adjacentIcon)) {
      adjacentIcon.classList.add("ad-searchable-dropdown-adjacent-icon");
      this.adjacentIcon = adjacentIcon;
    }
  }

  getAccessibleLabel() {
    const explicitLabel = this.select.getAttribute("aria-label");
    if (explicitLabel) return cleanText(explicitLabel);

    const labels = this.select.labels ? Array.from(this.select.labels) : [];
    const labelText = labels.map((label) => cleanText(label.textContent)).filter(Boolean).join(" ");
    return labelText || cleanText(this.select.title);
  }

  patchSelectProperties() {
    ["value", "selectedIndex", "disabled"].forEach((property) => {
      if (Object.prototype.hasOwnProperty.call(this.select, property)) return;
      const descriptor = getDescriptor(this.select, property);
      if (!descriptor || typeof descriptor.get !== "function" || typeof descriptor.set !== "function") return;

      const instance = this;
      Object.defineProperty(this.select, property, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          return descriptor.get.call(this);
        },
        set(value) {
          descriptor.set.call(this, value);
          instance.sync();
        },
      });
      this.propertyPatches.push({ property });
    });
  }

  bindEvents() {
    this.onTriggerClick = (event) => {
      event.preventDefault();
      if (this.select.disabled) return;
      this.toggle();
    };
    this.onTriggerKeydown = (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (!this.isOpen) this.open();
        return;
      }
      if (event.key === "Escape" && this.isOpen) {
        event.preventDefault();
        this.close(true);
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.open();
        this.searchInput.value = event.key;
        this.renderOptions();
      }
    };
    this.onSearchInput = () => this.renderOptions();
    this.onSearchKeydown = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.moveActive(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.moveActive(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const option = this.filteredOptions[this.activeIndex];
        if (option) this.chooseOption(option);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close(true);
      } else if (event.key === "Tab") {
        this.close(false);
      }
    };
    this.onOptionsClick = (event) => {
      const optionEl = event.target.closest?.("[data-option-index]");
      if (!optionEl || !this.optionsEl.contains(optionEl)) return;
      const option = this.filteredOptions[Number(optionEl.dataset.optionIndex)];
      if (option) this.chooseOption(option);
    };
    this.onOptionsPointerover = (event) => {
      const optionEl = event.target.closest?.("[data-option-index]");
      if (!optionEl || !this.optionsEl.contains(optionEl)) return;
      const index = Number(optionEl.dataset.optionIndex);
      if (Number.isInteger(index)) this.setActiveIndex(index);
    };
    this.onDocumentClick = (event) => {
      if (this.isOpen && !this.wrapper.contains(event.target)) this.close(false);
    };
    this.onSelectEvent = () => this.sync();
    this.onFormReset = () => {
      queueMicrotask(() => this.sync());
    };
    this.onViewportChange = () => this.positionMenu();

    this.trigger.addEventListener("click", this.onTriggerClick);
    this.trigger.addEventListener("keydown", this.onTriggerKeydown);
    this.searchInput.addEventListener("input", this.onSearchInput);
    this.searchInput.addEventListener("keydown", this.onSearchKeydown);
    this.optionsEl.addEventListener("click", this.onOptionsClick);
    this.optionsEl.addEventListener("pointerover", this.onOptionsPointerover);
    this.select.addEventListener("input", this.onSelectEvent);
    this.select.addEventListener("change", this.onSelectEvent);
    this.form?.addEventListener("reset", this.onFormReset);
    document.addEventListener("click", this.onDocumentClick);
    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("scroll", this.onViewportChange, true);

    if (typeof MutationObserver !== "undefined") {
      this.optionsObserver = new MutationObserver(() => this.sync());
      this.optionsObserver.observe(this.select, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "label", "selected", "value"],
      });
    }
  }

  getOptions() {
    return Array.from(this.select.options).map((option, index) => ({
      element: option,
      index,
      value: option.value,
      label: cleanText(option.textContent) || option.value,
      disabled: Boolean(option.disabled || option.parentElement?.disabled),
    }));
  }

  sync() {
    if (!this.select || !this.wrapper) return;

    const selected = this.select.options[this.select.selectedIndex];
    const selectedLabel = cleanText(selected?.textContent) || this.select.dataset.placeholder || "Select an option";
    this.valueEl.textContent = selectedLabel;
    if (this.accessibleLabel) this.trigger.setAttribute("aria-label", `${this.accessibleLabel}: ${selectedLabel}`);
    this.trigger.disabled = Boolean(this.select.disabled);
    this.trigger.setAttribute("aria-disabled", String(Boolean(this.select.disabled)));
    this.trigger.setAttribute("aria-expanded", String(this.isOpen));
    if (this.select.hasAttribute("aria-invalid")) {
      this.trigger.setAttribute("aria-invalid", this.select.getAttribute("aria-invalid"));
    }

    if (this.isOpen) this.renderOptions();
  }

  positionMenu() {
    if (!this.isOpen || !this.trigger || !this.menu) return;

    const triggerRect = this.trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const menuGap = 6;
    const viewportWidth = Math.max(window.innerWidth || document.documentElement.clientWidth || 0, viewportPadding * 2);
    const viewportHeight = Math.max(window.innerHeight || document.documentElement.clientHeight || 0, viewportPadding * 2);
    const preferredWidth = Math.max(triggerRect.width || 0, 240);
    const menuWidth = Math.min(preferredWidth, viewportWidth - viewportPadding * 2);
    const left = Math.min(Math.max(triggerRect.left, viewportPadding), viewportWidth - viewportPadding - menuWidth);

    this.menu.style.setProperty("--ad-searchable-dropdown-menu-width", `${menuWidth}px`);
    this.menu.style.setProperty("--ad-searchable-dropdown-menu-left", `${left}px`);

    const menuHeight = this.menu.getBoundingClientRect().height;
    const spaceBelow = viewportHeight - triggerRect.bottom - viewportPadding;
    const spaceAbove = triggerRect.top - viewportPadding;
    const openUp = menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const preferredTop = openUp ? triggerRect.top - menuHeight - menuGap : triggerRect.bottom + menuGap;
    const maxTop = Math.max(viewportPadding, viewportHeight - viewportPadding - menuHeight);
    const top = Math.min(Math.max(preferredTop, viewportPadding), maxTop);

    this.wrapper.classList.toggle("is-open-up", openUp);
    this.menu.style.setProperty("--ad-searchable-dropdown-menu-top", `${top}px`);
  }

  renderOptions() {
    const query = cleanText(this.searchInput.value).toLowerCase();
    const options = this.getOptions();
    this.filteredOptions = options.filter((option) => {
      if (!query) return true;
      return `${option.label} ${option.value}`.toLowerCase().includes(query);
    });

    this.optionsEl.replaceChildren();
    const selectedIndex = this.select.selectedIndex;
    this.filteredOptions.forEach((option, index) => {
      const optionEl = document.createElement("button");
      optionEl.type = "button";
      optionEl.className = "ad-searchable-dropdown-option";
      optionEl.dataset.optionIndex = String(index);
      optionEl.id = `${this.optionsEl.id}-${index}`;
      optionEl.setAttribute("role", "option");
      optionEl.setAttribute("aria-selected", String(option.index === selectedIndex));
      optionEl.setAttribute("aria-disabled", String(option.disabled));
      optionEl.disabled = option.disabled;

      const labelEl = document.createElement("span");
      labelEl.className = "ad-searchable-dropdown-option-label";
      labelEl.textContent = option.label;
      optionEl.appendChild(labelEl);

      const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      check.setAttribute("viewBox", "0 0 24 24");
      check.setAttribute("fill", "none");
      check.setAttribute("stroke", "currentColor");
      check.setAttribute("stroke-width", "2.4");
      check.setAttribute("stroke-linecap", "round");
      check.setAttribute("stroke-linejoin", "round");
      check.setAttribute("aria-hidden", "true");
      check.setAttribute("class", "ad-searchable-dropdown-check");
      const checkPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      checkPath.setAttribute("d", "m5 12 4 4L19 6");
      check.appendChild(checkPath);
      optionEl.appendChild(check);

      if (option.index === selectedIndex) optionEl.classList.add("is-selected");
      this.optionsEl.appendChild(optionEl);
    });

    this.noResultsEl.hidden = this.filteredOptions.length > 0;
    if (!this.filteredOptions.length) {
      this.activeIndex = -1;
      this.optionsEl.removeAttribute("aria-activedescendant");
      return;
    }

    const selectedVisibleIndex = this.filteredOptions.findIndex((option) => option.index === selectedIndex && !option.disabled);
    const currentIsUsable = this.filteredOptions[this.activeIndex] && !this.filteredOptions[this.activeIndex].disabled;
    if (!currentIsUsable) {
      this.activeIndex = selectedVisibleIndex >= 0 ? selectedVisibleIndex : this.filteredOptions.findIndex((option) => !option.disabled);
    }
    this.updateActiveOption();
  }

  updateActiveOption() {
    const optionEls = Array.from(this.optionsEl.querySelectorAll("[data-option-index]"));
    optionEls.forEach((optionEl, index) => optionEl.classList.toggle("is-active", index === this.activeIndex));

    const activeEl = optionEls[this.activeIndex];
    if (activeEl) {
      this.optionsEl.setAttribute("aria-activedescendant", activeEl.id);
      try {
        activeEl.scrollIntoView({ block: "nearest" });
      } catch (_) {}
    } else {
      this.optionsEl.removeAttribute("aria-activedescendant");
    }
  }

  setActiveIndex(index) {
    if (!this.filteredOptions[index] || this.filteredOptions[index].disabled) return;
    this.activeIndex = index;
    this.updateActiveOption();
  }

  moveActive(direction) {
    const available = this.filteredOptions.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
    if (!available.length) return;

    const currentPosition = available.indexOf(this.activeIndex);
    const nextPosition = currentPosition < 0 ? (direction > 0 ? 0 : available.length - 1) : (currentPosition + direction + available.length) % available.length;
    this.setActiveIndex(available[nextPosition]);
  }

  chooseOption(option) {
    if (option.disabled || this.select.disabled) return;

    const changed = this.select.value !== option.value;
    this.select.value = option.value;
    this.close(true);
    if (!changed) return;

    this.select.dispatchEvent(new Event("input", { bubbles: true }));
    this.select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  toggle() {
    if (this.isOpen) this.close(false);
    else this.open();
  }

  open() {
    if (this.select.disabled) return;
    this.isOpen = true;
    this.wrapper.classList.add("is-open");
    this.menu.setAttribute("aria-hidden", "false");
    this.trigger.setAttribute("aria-expanded", "true");
    this.searchInput.value = "";
    this.renderOptions();
    this.positionMenu();
    try {
      this.searchInput.focus({ preventScroll: true });
    } catch (_) {
      this.searchInput.focus();
    }
  }

  close(restoreFocus = false) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.wrapper.classList.remove("is-open");
    this.wrapper.classList.remove("is-open-up");
    this.menu.setAttribute("aria-hidden", "true");
    this.trigger.setAttribute("aria-expanded", "false");
    this.searchInput.value = "";
    this.activeIndex = -1;
    if (restoreFocus) this.trigger.focus();
  }

  destroy() {
    this.close(false);
    this.optionsObserver?.disconnect?.();
    this.trigger?.removeEventListener("click", this.onTriggerClick);
    this.trigger?.removeEventListener("keydown", this.onTriggerKeydown);
    this.searchInput?.removeEventListener("input", this.onSearchInput);
    this.searchInput?.removeEventListener("keydown", this.onSearchKeydown);
    this.optionsEl?.removeEventListener("click", this.onOptionsClick);
    this.optionsEl?.removeEventListener("pointerover", this.onOptionsPointerover);
    this.select?.removeEventListener("input", this.onSelectEvent);
    this.select?.removeEventListener("change", this.onSelectEvent);
    this.form?.removeEventListener("reset", this.onFormReset);
    document.removeEventListener("click", this.onDocumentClick);
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("scroll", this.onViewportChange, true);

    this.labelAssociations.forEach(({ label, htmlFor }) => {
      if (label.isConnected) label.htmlFor = htmlFor;
    });
    this.propertyPatches.forEach(({ property }) => {
      try {
        delete this.select[property];
      } catch (_) {}
    });
    this.select?.classList.remove("ad-searchable-dropdown-native");
    if (this.select) {
      delete this.select.dataset.searchableDropdownEnhanced;
      if (this.originalTabIndex === null) this.select.removeAttribute("tabindex");
      else this.select.setAttribute("tabindex", this.originalTabIndex);
      if (this.originalAriaHidden === null) this.select.removeAttribute("aria-hidden");
      else this.select.setAttribute("aria-hidden", this.originalAriaHidden);
    }
    this.adjacentIcon?.classList.remove("ad-searchable-dropdown-adjacent-icon");
    if (this.wrapper?.parentNode && this.select?.parentNode === this.wrapper) {
      this.wrapper.parentNode.insertBefore(this.select, this.wrapper);
      this.wrapper.remove();
    }
    instances.delete(this);
  }
}

export function enhanceSearchableDropdowns(root) {
  return getSelectElements(root)
    .filter((select) => !select.dataset.searchableDropdownEnhanced)
    .map((select) => {
      try {
        return new SearchableDropdown(select);
      } catch (error) {
        console.warn("Could not enhance select as a searchable dropdown:", error);
        return null;
      }
    })
    .filter(Boolean);
}

function pruneDetachedInstances() {
  instances.forEach((instance) => {
    if (!instance.wrapper?.isConnected && !instance.select?.isConnected) instance.destroy();
  });
}

/**
 * Installs one document observer so controls added by lazy-loaded tools or
 * settings pages receive the same treatment as controls in static templates.
 */
export function installSearchableDropdowns(root = document) {
  enhanceSearchableDropdowns(root);

  if (documentObserver || typeof MutationObserver === "undefined") return;
  const target = root?.body || root;
  if (!target || typeof target.nodeType !== "number") return;

  documentObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => enhanceSearchableDropdowns(node));
    });
    pruneDetachedInstances();
  });
  documentObserver.observe(target, { childList: true, subtree: true });
}
