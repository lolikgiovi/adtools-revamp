// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const stylesheetPath = path.resolve(testDirectory, "../../styles/components.css");

function getLastRule(stylesheet, selector) {
  const rules = [...stylesheet.matchAll(new RegExp(`^${selector.replace(/\./g, "\\.")}\\s*\\{([\\s\\S]*?)\\}`, "gm"))];
  return rules.at(-1)?.[1] || "";
}

describe("usage overview layout", () => {
  it("keeps counts clear of overlay scrollbars in scrollable tool lists", () => {
    const stylesheet = fs.readFileSync(stylesheetPath, "utf8");
    const rule = getLastRule(stylesheet, ".usage-feature-list");

    expect(rule).toContain("overflow-y: auto");
    expect(rule).toContain("padding-inline-end: 1rem");
  });

  it("provides a rotating, reduced-motion-safe loading indicator for team activity", () => {
    const stylesheet = fs.readFileSync(stylesheetPath, "utf8");

    expect(stylesheet).toContain(".usage-compare-spinner {");
    expect(stylesheet).toContain("animation: usage-compare-spin 0.85s linear infinite;");
    expect(stylesheet).toContain("@keyframes usage-compare-spin");
    expect(stylesheet).toContain(".usage-compare-spinner {\n    animation: none;");
  });

  it("keeps both scrollable tool lists aligned to the same available height", () => {
    const stylesheet = fs.readFileSync(stylesheetPath, "utf8");
    const rule = getLastRule(stylesheet, ".usage-scope-tools");

    expect(rule).toContain("display: flex");
    expect(rule).toContain("flex: 1");
    expect(rule).toContain("margin-top: 1rem");
    expect(stylesheet).not.toContain(".usage-scope-card-user .usage-scope-tools");
  });
});
