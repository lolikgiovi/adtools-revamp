// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { SearchableDropdown, enhanceSearchableDropdowns } from "../SearchableDropdown.js";

function renderSelect() {
  document.body.innerHTML = `
    <label for="environment">Environment</label>
    <select id="environment" aria-label="Environment">
      <option value="dev">Development</option>
      <option value="staging">Staging</option>
      <option value="production">Production</option>
    </select>
  `;
  return document.querySelector("#environment");
}

describe("SearchableDropdown", () => {
  it("enhances a select and filters options from the menu search", () => {
    const select = renderSelect();
    const [dropdown] = enhanceSearchableDropdowns(document.body);

    expect(dropdown).toBeInstanceOf(SearchableDropdown);
    expect(select.closest(".ad-searchable-dropdown")).toBe(dropdown.wrapper);
    expect(select.classList.contains("ad-searchable-dropdown-native")).toBe(true);

    dropdown.trigger.click();
    dropdown.searchInput.value = "stag";
    dropdown.searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(dropdown.optionsEl.children).toHaveLength(1);
    expect(dropdown.optionsEl.textContent).toContain("Staging");
    expect(dropdown.optionsEl.textContent).not.toContain("Production");
  });

  it("selects with Enter and keeps native value and change listeners working", () => {
    const select = renderSelect();
    const changeHandler = vi.fn();
    select.addEventListener("change", changeHandler);
    const [dropdown] = enhanceSearchableDropdowns(document.body);

    dropdown.trigger.click();
    dropdown.searchInput.value = "prod";
    dropdown.searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    dropdown.searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(select.value).toBe("production");
    expect(dropdown.valueEl.textContent).toBe("Production");
    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect(dropdown.isOpen).toBe(false);
  });

  it("reflects programmatic value and option updates", async () => {
    const select = renderSelect();
    const [dropdown] = enhanceSearchableDropdowns(document.body);

    select.value = "staging";
    expect(dropdown.valueEl.textContent).toBe("Staging");

    select.innerHTML = '<option value="qa">QA</option>';
    await Promise.resolve();

    expect(dropdown.valueEl.textContent).toBe("QA");
    dropdown.open();
    expect(dropdown.optionsEl.textContent).toContain("QA");
  });

  it("keeps the menu inside a narrow viewport when the trigger is near the edge", () => {
    renderSelect();
    const [dropdown] = enhanceSearchableDropdowns(document.body);
    const originalWidth = window.innerWidth;

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    dropdown.trigger.getBoundingClientRect = () => ({ left: 250, right: 340, top: 80, bottom: 116, width: 90, height: 36 });

    dropdown.open();

    const left = Number.parseFloat(dropdown.menu.style.getPropertyValue("--ad-searchable-dropdown-menu-left"));
    const width = Number.parseFloat(dropdown.menu.style.getPropertyValue("--ad-searchable-dropdown-menu-width"));
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + width).toBeLessThanOrEqual(348);

    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  });
});
