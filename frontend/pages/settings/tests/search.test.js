// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SettingsSearch } from "../search.js";

function buildRoot() {
  const root = document.createElement("div");
  root.innerHTML = `
    <section class="settings-category" aria-expanded="false">
      <h3 class="settings-category-heading"><button class="settings-category-header" aria-expanded="false"><span>Appearance</span></button></h3>
      <div class="settings-category-content">
        <div class="setting-item" data-setting="theme"><div class="setting-name">Theme</div><div class="setting-description">Choose the color theme.</div></div>
      </div>
    </section>
    <section class="settings-category" aria-expanded="true">
      <h3 class="settings-category-heading"><button class="settings-category-header" aria-expanded="true"><span>Jenkins</span></button></h3>
      <div class="settings-category-content">
        <div class="setting-item" data-setting="config.jenkins.url"><div class="setting-name">Jenkins URL</div></div>
        <div class="setting-item" data-setting="config.jenkins.username"><div class="setting-name">Jenkins Username</div></div>
      </div>
    </section>
    <section class="settings-category" aria-expanded="true">
      <h3 class="settings-category-heading"><button class="settings-category-header" aria-expanded="true"><span>Database</span></button></h3>
      <div class="settings-category-content">
        <section class="settings-category" aria-expanded="false">
          <h3 class="settings-category-heading"><button class="settings-category-header" aria-expanded="false"><span>Oracle</span></button></h3>
          <div class="settings-category-content">
            <div class="setting-item" data-setting="config.oracle.connections"><div class="setting-name">Database Connections</div></div>
          </div>
        </section>
        <section class="settings-category" aria-expanded="true">
          <h3 class="settings-category-heading"><button class="settings-category-header" aria-expanded="true"><span>Redis</span></button></h3>
          <div class="settings-category-content">
            <div class="setting-item" data-setting="config.redis.host"><div class="setting-name">Redis Host</div></div>
          </div>
        </section>
      </div>
    </section>
  `;
  return root;
}

const item = (root, key) => root.querySelector(`.setting-item[data-setting="${key}"]`);
const category = (root, label) =>
  Array.from(root.querySelectorAll(".settings-category")).find(
    (element) => element.querySelector(":scope > .settings-category-heading > .settings-category-header")?.textContent.trim() === label,
  );

describe("Settings search", () => {
  it("keeps only matching items and their ancestor categories", () => {
    const root = buildRoot();
    const result = new SettingsSearch(root).apply("jenkins");

    expect(result).toEqual({ active: true, matches: 2, total: 5 });
    expect(category(root, "Appearance").hidden).toBe(true);
    expect(category(root, "Database").hidden).toBe(true);
    expect(category(root, "Jenkins").hidden).toBe(false);
    expect(item(root, "config.jenkins.url").hidden).toBe(false);
    expect(item(root, "config.jenkins.username").hidden).toBe(false);
  });

  it("matches setting keys, labels, and descriptions", () => {
    const root = buildRoot();
    const search = new SettingsSearch(root);

    expect(search.apply("redis.host").matches).toBe(1);
    expect(item(root, "config.redis.host").hidden).toBe(false);

    search.apply("color theme");
    expect(item(root, "theme").hidden).toBe(false);

    search.apply("jenkins username");
    expect(item(root, "config.jenkins.username").hidden).toBe(false);
    expect(item(root, "config.jenkins.url").hidden).toBe(true);
  });

  it("shows every item in a category whose label matches", () => {
    const root = buildRoot();
    new SettingsSearch(root).apply("database");

    expect(category(root, "Database").hidden).toBe(false);
    expect(category(root, "Oracle").hidden).toBe(false);
    expect(item(root, "config.oracle.connections").hidden).toBe(false);
    expect(category(root, "Redis").hidden).toBe(false);
    expect(item(root, "config.redis.host").hidden).toBe(false);
  });

  it("expands collapsed matches and restores the original state when cleared", () => {
    const root = buildRoot();
    const search = new SettingsSearch(root);
    const appearance = category(root, "Appearance");
    const oracle = category(root, "Oracle");

    search.apply("theme");
    expect(appearance.getAttribute("aria-expanded")).toBe("true");
    expect(appearance.querySelector(".settings-category-header").getAttribute("aria-expanded")).toBe("true");

    search.clear();
    expect(appearance.getAttribute("aria-expanded")).toBe("false");
    expect(appearance.querySelector(".settings-category-header").getAttribute("aria-expanded")).toBe("false");
    expect(appearance.hidden).toBe(false);
    expect(oracle.hidden).toBe(false);
    expect(root.querySelectorAll(".setting-item[hidden]")).toHaveLength(0);
  });

  it("reports no active search for a blank query", () => {
    const root = buildRoot();
    const result = new SettingsSearch(root).apply("   ");
    expect(result).toEqual({ active: false, matches: 0, total: 0 });
  });
});
